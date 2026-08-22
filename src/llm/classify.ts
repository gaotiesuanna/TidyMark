import { djb2 } from '@/core/hash'
import type { Locale } from '@/core/locale'
import { classifyByRules } from '@/core/rules'
import { resolveByRules } from '@/core/map'
import { sanitizeUrl } from '@/core/sanitize'
import type { BookmarkItem, CachedClassification, CategoryCandidate, Classification } from '@/core/types'
import type { LlmClient } from './client'
import { fallbackReason, logBatchDone, logBatchSplit } from './logs'
import { classifyPrompt } from './prompts'

export interface ClassifyInput {
  items: BookmarkItem[]
  candidates: CategoryCandidate[]
  client: LlmClient
  cache: Map<string, CachedClassification>
  batchSize?: number
  concurrency?: number
  onProgress?: (done: number, total: number) => void
  onLog?: (message: string, level: 'info' | 'warn' | 'error') => void
  /** 每批开始前检查一次，返回 true 就停止派发后续批次。 */
  isCancelled?: () => boolean
  /** 规则表命中的标签走哪种语言。必填——Record<Locale, string> 的强制在调用点这一侧也不能松口。 */
  locale: Locale
  /** 本轮用的模型名。进缓存 key——换模型就是换产出，不该沿用旧判断。 */
  model: string
  /**
   * 提示词里带不带「无归属时回传 topic」那条规则（classifyPrompt 的第 5 条）。
   * 推翻模式的候选是刚设计出来的，用不上这条、也不该让它的提示词因此变化——
   * 省略时默认 true，只有 background/handlers.ts 在推翻模式下显式传 false。
   */
  includeTopicRule?: boolean
}

const MAX_RETRIES = 2

/**
 * 路径拼接用 \u0000 而不是 '/'：目录名里允许出现 '/'，用它当分隔符时
 * ['a/b'] 与 ['a', 'b'] 拼出来一模一样。key 只是撞了会白算一次，
 * 但命中后要拿路径换回 id，认错了就是把书签送进另一个目录。
 */
function pathKey(path: string[]): string {
  return path.join('\u0000')
}

/**
 * 缓存 key = 书签 URL + 「模型看到的这批候选目录」。
 *
 * 只认路径，完全不碰 id。推翻模式下候选的 id 是 buildCategoryTree 顺序生成的
 * tmp:N，跨轮次没有意义：两轮候选数量相同 key 就撞，上一轮的分类会被套用到
 * 这一轮完全不同的目录上（跑一次不满意 → 放弃 → 改设置再跑，正好踩中）。
 *
 * sort() 让 key 与候选顺序无关——顺序变而集合不变时模型看到的是同一批目录，
 * 本就该命中。locale 与 model 一并进 key：换语言或换模型就是换产出
 * （缓存里连模型写的 reason 都存着），沿用旧判断没有道理。
 */
export function cacheKey(
  item: BookmarkItem,
  candidates: CategoryCandidate[],
  locale: Locale,
  model: string,
): string {
  const version = djb2([locale, model, ...candidates.map((c) => pathKey(c.path)).sort()].join('|'))
  return `${djb2(item.url)}:${version}`
}

export function buildBatchPrompt(
  items: BookmarkItem[],
  candidates: CategoryCandidate[],
  locale: Locale,
  includeTopicRule = true,
): string {
  const folderLabel = locale === 'zh_CN' ? '目录' : 'folder'
  const catalog = candidates.map((c) => `- id=${c.id} ${folderLabel}=${c.path.join(' / ')}`).join('\n')
  const payload = items.map((item) => {
    const url = sanitizeUrl(item.url)
    return {
      bookmark_id: item.id,
      title: item.title,
      domain: url?.domain ?? '',
      path: url?.path ?? '',
      current_folder: item.currentPath.join(' / '),
    }
  })

  return [
    ...classifyPrompt(locale, includeTopicRule),
    '',
    locale === 'zh_CN' ? '候选目录：' : 'Candidate folders:',
    catalog,
    '',
    locale === 'zh_CN' ? '待分类书签：' : 'Bookmarks to classify:',
    JSON.stringify(payload, null, 2),
  ].join('\n')
}

function buildSchema(candidates: CategoryCandidate[]): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['results'],
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['bookmark_id', 'target_category_id', 'confidence', 'reason'],
          properties: {
            bookmark_id: { type: 'string' },
            target_category_id: {
              type: ['string', 'null'],
              enum: [...candidates.map((c) => c.id), null],
            },
            confidence: { type: 'number' },
            reason: { type: 'string' },
            topic: { type: 'string' },
          },
        },
      },
    },
  }
}

interface RawResult {
  bookmark_id: string
  target_category_id: string | null
  confidence: number
  reason: string
  topic?: string
}

function unclassified(item: BookmarkItem, reason: string, detail?: string): Classification {
  return { bookmarkId: item.id, targetCategoryId: null, confidence: 0, reason, detail, source: 'none' }
}

/**
 * 把缓存条目还原成 Classification。两道校验任何一道没过都返回 null——当没
 * 命中，重新问模型：
 *
 * - url 对不上：key 里只有 djb2(item.url) 这个 32 位哈希，不是 url 本身，
 *   两个不同的 URL 完全可能撞出同一个 key。这一道专门抓这种撞车，不然会把
 *   另一个书签的分类结果套过来，比白算一次更糟。
 * - targetPath 换不到当前候选里的 id：要么是 key 里 version 那段哈希撞了，
 *   要么候选集里已经没有这个目录了（两轮之间目录被删/改了名）。两种情况
 *   都宁可白花一次调用，也不能把书签送进另一个目录。
 */
function fromCache(
  item: BookmarkItem,
  cached: CachedClassification,
  idByPath: Map<string, string>,
): Classification | null {
  if (cached.url !== item.url) return null
  let target: string | null = null
  if (cached.targetPath !== null) {
    const id = idByPath.get(pathKey(cached.targetPath))
    if (id === undefined) return null
    target = id
  }
  return {
    bookmarkId: item.id,
    targetCategoryId: target,
    confidence: cached.confidence,
    reason: cached.reason,
    source: 'llm',
    ...(cached.topic === undefined ? {} : { topic: cached.topic }),
  }
}

/**
 * `onSplit` 在这一批因输出被截断而拆开时调一次，参数是被拆的条数。
 * 日志由调用方记——runBatch 手里没有批次序号，也不该管日志文案。
 */
async function runBatch(
  batch: BookmarkItem[],
  candidates: CategoryCandidate[],
  client: LlmClient,
  locale: Locale,
  includeTopicRule: boolean,
  onSplit: (size: number) => void = () => {},
): Promise<Classification[]> {
  const validIds = new Set(candidates.map((c) => c.id))
  // 仅用于满足类型初始化：正常执行路径下，走到最终 return 之前必然先经过下面的
  // catch 把它覆盖成真实错误信息，这个初始值实际不会被用户看到，不必双语。
  let lastError = '未知错误'
  let truncated = false

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = (await client.complete(
        buildBatchPrompt(batch, candidates, locale, includeTopicRule),
        buildSchema(candidates),
      )) as { results?: RawResult[] }
      const byId = new Map((raw.results ?? []).map((r) => [r.bookmark_id, r]))

      return batch.map((item) => {
        const hit = byId.get(item.id)
        if (!hit) return unclassified(item, fallbackReason(locale, 'noResult'))
        const target =
          hit.target_category_id !== null && validIds.has(hit.target_category_id)
            ? hit.target_category_id
            : null
        const topic = target === null ? String(hit.topic ?? '').trim() : ''
        return {
          bookmarkId: item.id,
          targetCategoryId: target,
          confidence: target === null ? 0 : hit.confidence,
          reason: hit.reason,
          source: 'llm',
          // 有归属时不带 topic：那个字段只为无家可归的书签存在，
          // 留着会让下游误以为这条书签还需要一个新目录。
          ...(topic === '' ? {} : { topic }),
        }
      })
    } catch (error) {
      lastError = String(error)
      truncated = (error as { truncated?: boolean }).truncated === true
      // 只进开发者控制台，不进侧栏日志，不必双语。
      console.error('[TidyMark] 分类请求失败：', error)
      const retryable = (error as { retryable?: boolean }).retryable === true
      if (!retryable) break
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500))
      }
    }
  }
  // 输出被截断（client.ts 的 LlmError.truncated）：原样再问只会在同一个字上再断
  // 一次，所以不走上面的重试，改成拆成两半分别问。两半各自返回与自己逐位对齐的
  // 结果，顺序拼回去，「返回值与 batch 一一对应」这条契约不变（调用方按下标把
  // results[i] 配给 batch[i]）；拆完仍失败的那一半照常降级为未分类，丢的只有它。
  if (truncated && batch.length > 1) {
    onSplit(batch.length)
    const mid = Math.ceil(batch.length / 2)
    // 顺序问而不是并发：外层已经有 concurrency 个 worker 在跑，
    // 一批刚被截断说明这条线正吃力，没必要再往上叠一倍请求。
    const head = await runBatch(batch.slice(0, mid), candidates, client, locale, includeTopicRule, onSplit)
    const tail = await runBatch(batch.slice(mid), candidates, client, locale, includeTopicRule, onSplit)
    return [...head, ...tail]
  }
  return batch.map((item) => unclassified(item, fallbackReason(locale, 'failed', lastError), lastError))
}

export async function classifyBookmarks(input: ClassifyInput): Promise<Classification[]> {
  const { items, candidates, client, cache, locale, model } = input
  const batchSize = input.batchSize ?? 25
  const concurrency = input.concurrency ?? 4
  const includeTopicRule = input.includeTopicRule ?? true

  // 缓存存的是路径，两个方向都要换：命中时路径 → id，写入时 id → 路径。
  // 路径不保证唯一——两个同名同父的目录会撞出同一个 pathKey，new Map 按最后
  // 一个赢，命中时只能换到其中一个 id。后果是同名同父、走错了那一个，
  // 属于用路径当 key 这个设计本身带的代价，不是这里的疏漏。
  const idByPath = new Map(candidates.map((c) => [pathKey(c.path), c.id]))
  const pathById = new Map(candidates.map((c) => [c.id, c.path]))

  const resolved = new Map<string, Classification>()
  const pending: BookmarkItem[] = []

  for (const item of items) {
    const cached = cache.get(cacheKey(item, candidates, locale, model))
    const hit = cached ? fromCache(item, cached, idByPath) : null
    if (hit) {
      resolved.set(item.id, hit)
      continue
    }
    const rule = classifyByRules(item, locale)
    const byRule = rule ? resolveByRules(item, rule, candidates) : null
    if (byRule) {
      resolved.set(item.id, byRule)
      continue
    }
    pending.push(item)
  }

  // 同一个 URL 的两个书签对模型是同一个问题：cacheKey 里书签那一半是
  // djb2(item.url)，另一半（locale/model/候选集）在一轮里是常量，所以同 URL
  // 就是同 key。冷缓存下两条都不命中、都进 pending、都进批次发出去，等于为
  // 同一个问题付两遍钱，而且每轮都付。这里按 URL 分组，每组只派第一条当代表
  // 进批次，结果再扇出给同组其余书签。
  //
  // 分组用 URL 本身而不是 cacheKey：djb2 是 32 位，两个不同的 URL 撞出同一个
  // key 是可能的（fromCache 第一道校验防的就是这个），用 key 分组会把两个不
  // 相干的问题合并成一个，比白算一次更糟。反过来同 URL 必然同 key，所以按
  // URL 分组不会漏掉任何一对该折叠的。这不是纸上谈兵：
  // https://news.example.com/qpWaK9EZKadT 与 https://news.example.com/PkheS7JVe8x9
  // 的 djb2 都是 1sor99f，tests/llm/classify.test.ts 里有一条用例专门钉着
  // 它们各问各的。别把这里「优化」成按 cacheKey 分组。
  //
  // 折叠的只是「提问」，不是书签：两个书签仍然是两个书签，各自照常出现在
  // 返回值里、照常被移动，复核页上照常两行。
  //
  // 折叠自己欠的账，别推给 cacheKey：cacheKey 不含标题，管的是「跨轮次还能不能
  // 复用」；而在冷缓存的这一轮里，折叠之前两条各自带着自己的 title 与
  // current_folder 进 payload，模型本来是能分别判的。折叠之后，非代表那条的
  // 标题与所在目录在本轮内就到不了模型面前了——这是折叠新引入的损失，不是老账。
  /** 建组与查组共用这一个 key 函数：两处不同步不会报错，只会静默地不再扇出。 */
  const groupKey = (bookmark: BookmarkItem): string => bookmark.url
  const groups = new Map<string, BookmarkItem[]>()
  for (const item of pending) {
    const key = groupKey(item)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  /**
   * 代表背后的整组。代表一定来自 groups.values()，查不到只可能是建组与查组的
   * key 不同步——那是编程错误，宁可当场炸也不要兜底。这里原本写的是
   * `?? [rep]`，正是那句兜底让「只改了建组那一侧的 key」这种改动一声不吭地
   * 通过：不再扇出，重复书签全掉进「未处理」，进度还少报。
   */
  const groupOf = (rep: BookmarkItem): BookmarkItem[] => groups.get(groupKey(rep))!

  const representatives = [...groups.values()].map((group) => group[0]!)
  const batches: BookmarkItem[][] = []
  for (let i = 0; i < representatives.length; i += batchSize) {
    batches.push(representatives.slice(i, i + batchSize))
  }

  let done = resolved.size
  input.onProgress?.(done, items.length)

  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < batches.length) {
      if (input.isCancelled?.() === true) return
      const index = cursor++
      const batch = batches[index]!
      // 日志里的「条」一律指书签，不指请求条目：batch 里装的是代表，一个代表
      // 背后可能站着若干个同 URL 的书签。用户在同一屏里先看到「N 个书签」、
      // 后看到「N 条移动建议」，中间这一行换个口径没人看得懂。
      const size = batch.reduce((sum, rep) => sum + groupOf(rep).length, 0)
      const startedAt = Date.now()
      const results = await runBatch(batch, candidates, client, locale, includeTopicRule, (size) =>
        input.onLog?.(
          logBatchSplit(
            locale, locale === 'zh_CN' ? '分类批次' : 'Classify batch', index, batches.length, size,
          ),
          'warn',
        ),
      )
      // ok 同样按书签数算。一组要么整组成功要么整组失败（结果是照抄代表的），
      // 所以 ok === size ⟺ 全部代表都成功、ok === 0 ⟺ 没有一个代表成功——
      // 下面那套「全成功 / 全失败 / 部分」的分级，口径和按请求条目数算时完全一致。
      let ok = 0
      for (let i = 0; i < results.length; i++) {
        if (results[i]!.source === 'llm') ok += groupOf(batch[i]!).length
      }
      const summary = logBatchDone(
        locale, index, batches.length, size, ok, Date.now() - startedAt, batch.length,
      )
      // 只进开发者控制台，不必双语。
      console.log(`[TidyMark] ${summary}`)
      if (ok === size) input.onLog?.(summary, 'info')
      else if (ok === 0) {
        const sep = locale === 'zh_CN' ? '。' : '. '
        input.onLog?.(`${summary}${sep}${results[0]?.reason ?? ''}`, 'error')
      } else input.onLog?.(summary, 'warn')
      for (let i = 0; i < results.length; i++) {
        const result = results[i]!
        // 结果扇出给同组全部书签：它们问的是同一个问题，答案照抄，只把
        // bookmarkId 换成各自的。source !== 'llm' 的（请求失败、模型漏返回）
        // 同样要扇出——否则一条失败会变成「一条失败 + 一条凭空消失」，
        // 后者会掉进最后那句 unprocessed 兜底里。
        for (const member of groupOf(batch[i]!)) {
          resolved.set(member.id, { ...result, bookmarkId: member.id })
        }
        if (result.source === 'llm') {
          const path = result.targetCategoryId === null ? null : pathById.get(result.targetCategoryId)
          // 目标 id 一定在候选里（runBatch 已按 validIds 过滤过），查不到就宁可不缓存：
          // 不能把「查不到」存成 null，那是「无合适目录」的意思，是另一回事。
          // 注意：null 与 undefined 在这里意思不同，别改成真值判断（如 if (path)）
          // ——那会把「无合适目录」也当成「查不到」，永远不缓存。
          //
          // key 取的是 batch[i]（组代表），但 cacheKey 只认 URL，同组书签的
          // key 完全一样——写一条就够全组下一轮都命中。这正是折叠的依据。
          if (path !== undefined) {
            cache.set(cacheKey(batch[i]!, candidates, locale, model), {
              targetPath: path,
              url: batch[i]!.url,
              confidence: result.confidence,
              reason: result.reason,
              ...(result.topic === undefined ? {} : { topic: result.topic }),
            })
          }
        }
      }
      // onProgress 报的是 items.length 的进度，所以这里加的是「这批代表背后
      // 一共多少条书签」（上面那个 size），不是批次长度——折叠之后两者不再
      // 相等，按批次长度加会让进度条停在一个比总数小的终值上。
      done += size
      input.onProgress?.(done, items.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker))

  return items.map((item) => resolved.get(item.id) ?? unclassified(item, fallbackReason(locale, 'unprocessed')))
}
