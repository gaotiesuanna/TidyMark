import { djb2 } from '@/core/hash'
import type { Locale } from '@/core/locale'
import { classifyByRules } from '@/core/rules'
import { resolveByRules } from '@/core/map'
import { sanitizeUrl } from '@/core/sanitize'
import type { BookmarkItem, CachedClassification, CategoryCandidate, Classification } from '@/core/types'
import type { LlmClient } from './client'
import { fallbackReason, logBatchDone } from './logs'
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
    ...classifyPrompt(locale),
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
  }
}

async function runBatch(
  batch: BookmarkItem[],
  candidates: CategoryCandidate[],
  client: LlmClient,
  locale: Locale,
): Promise<Classification[]> {
  const validIds = new Set(candidates.map((c) => c.id))
  // 仅用于满足类型初始化：正常执行路径下，走到最终 return 之前必然先经过下面的
  // catch 把它覆盖成真实错误信息，这个初始值实际不会被用户看到，不必双语。
  let lastError = '未知错误'

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = (await client.complete(
        buildBatchPrompt(batch, candidates, locale),
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
        return {
          bookmarkId: item.id,
          targetCategoryId: target,
          confidence: target === null ? 0 : hit.confidence,
          reason: hit.reason,
          source: 'llm',
        }
      })
    } catch (error) {
      lastError = String(error)
      // 只进开发者控制台，不进侧栏日志，不必双语。
      console.error('[TidyMark] 分类请求失败：', error)
      const retryable = (error as { retryable?: boolean }).retryable === true
      if (!retryable) break
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500))
      }
    }
  }
  return batch.map((item) => unclassified(item, fallbackReason(locale, 'failed', lastError), lastError))
}

export async function classifyBookmarks(input: ClassifyInput): Promise<Classification[]> {
  const { items, candidates, client, cache, locale, model } = input
  const batchSize = input.batchSize ?? 25
  const concurrency = input.concurrency ?? 4

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

  const batches: BookmarkItem[][] = []
  for (let i = 0; i < pending.length; i += batchSize) batches.push(pending.slice(i, i + batchSize))

  let done = resolved.size
  input.onProgress?.(done, items.length)

  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < batches.length) {
      if (input.isCancelled?.() === true) return
      const index = cursor++
      const batch = batches[index]!
      const startedAt = Date.now()
      const results = await runBatch(batch, candidates, client, locale)
      const ok = results.filter((r) => r.source === 'llm').length
      const summary = logBatchDone(locale, index, batches.length, batch.length, ok, Date.now() - startedAt)
      // 只进开发者控制台，不必双语。
      console.log(`[TidyMark] ${summary}`)
      if (ok === batch.length) input.onLog?.(summary, 'info')
      else if (ok === 0) {
        const sep = locale === 'zh_CN' ? '。' : '. '
        input.onLog?.(`${summary}${sep}${results[0]?.reason ?? ''}`, 'error')
      } else input.onLog?.(summary, 'warn')
      for (let i = 0; i < results.length; i++) {
        const result = results[i]!
        resolved.set(result.bookmarkId, result)
        if (result.source === 'llm') {
          const path = result.targetCategoryId === null ? null : pathById.get(result.targetCategoryId)
          // 目标 id 一定在候选里（runBatch 已按 validIds 过滤过），查不到就宁可不缓存：
          // 不能把「查不到」存成 null，那是「无合适目录」的意思，是另一回事。
          // 注意：null 与 undefined 在这里意思不同，别改成真值判断（如 if (path)）
          // ——那会把「无合适目录」也当成「查不到」，永远不缓存。
          if (path !== undefined) {
            cache.set(cacheKey(batch[i]!, candidates, locale, model), {
              targetPath: path,
              url: batch[i]!.url,
              confidence: result.confidence,
              reason: result.reason,
            })
          }
        }
      }
      done += batch.length
      input.onProgress?.(done, items.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker))

  return items.map((item) => resolved.get(item.id) ?? unclassified(item, fallbackReason(locale, 'unprocessed')))
}
