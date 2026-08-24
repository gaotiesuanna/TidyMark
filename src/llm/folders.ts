import { normalizeName, stripNumberPrefix } from '@/core/map'
import type { Locale } from '@/core/locale'
import type { TagResult } from '@/core/types'
import type { TopicCluster } from '@/core/newTopics'
import { MAX_SIBLINGS } from '@/core/tree'
import { SHAPE_MAX_SIBLINGS } from '@/core/shape'
import { NO_TOPIC } from './tags'
import type { LlmClient } from './client'
import {
  logCompoundNames, logCompoundNamesRemain, logDuplicateTopics, logFamiliesRemain, logFoldersDropped,
  logFoldersDone, logFoldersFailed, logFoldersRetryFailed, logFragmentedFamilies, logNoTopicMapped,
} from './logs'
import { foldersPrompt, mergeNamePrompt, newFolderNamesPrompt } from './prompts'

export interface TopicCount {
  topic: string
  count: number
}

export interface FolderDesign {
  /** 目录树的展示形态，真正驱动建树的是下面的 mapping；folders 只用于日志计数与测试观测，tree.ts 不读它。 */
  folders: Array<{ title: string; children: string[] }>
  /** normalizeName(原始标签) → 目录路径，长度 1 或 2。查不到的标签视为未映射。 */
  mapping: Map<string, string[]>
}

/**
 * 把逐条的标签压成「标签 → 书签数」的清单，交给模型设计目录。
 *
 * 归一化只用于去重，清单里给模型看的是首次出现的原始写法——
 * 模型要照着它写目录名，`l l m` 这种归一化形态不适合直接示人。
 */
export function collectTopics(tags: TagResult[]): TopicCount[] {
  const byKey = new Map<string, TopicCount>()
  for (const tag of tags) {
    const key = normalizeName(tag.primaryTopic)
    if (key === '') continue
    const hit = byKey.get(key)
    if (hit === undefined) byKey.set(key, { topic: tag.primaryTopic, count: 1 })
    else hit.count++
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count)
}

/**
 * 把设计结果写回标签：一级目录名进 primaryTopic，二级目录名进 secondaryTopic。
 *
 * 写回之后标签集合就等于最终目录集合，core/tree.ts 因此不必再按数量筛选。
 * 模型漏映射的标签置空——这些书签不参与建树，但分类阶段仍会给它们找个目录。
 */
export function applyDesign(tags: TagResult[], design: FolderDesign): TagResult[] {
  return tags.map((tag) => {
    const path = design.mapping.get(normalizeName(tag.primaryTopic))
    if (path === undefined || path.length === 0) {
      return { bookmarkId: tag.bookmarkId, primaryTopic: NO_TOPIC, secondaryTopic: null }
    }
    return { bookmarkId: tag.bookmarkId, primaryTopic: path[0]!, secondaryTopic: path[1] ?? null }
  })
}

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['folders'],
  properties: {
    folders: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'topics', 'children'],
        properties: {
          title: { type: 'string' },
          topics: { type: 'array', items: { type: 'string' } },
          children: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'topics'],
              properties: {
                title: { type: 'string' },
                topics: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  },
}

interface RawFolder {
  title: string
  topics: string[]
  children: Array<{ title: string; topics: string[] }>
}

export interface DesignOptions {
  /** true 时只出一层目录。撑爆的目录下切时（core/audit.ts → handlers.ts）走这一支。 */
  oneLevel?: boolean
  /** 只出一层时，把父目录名告诉模型，避免它把组名再当分类依据。 */
  parentTitle?: string
  /**
   * 同一层目录数上限。省略时用 MAX_SIBLINGS。
   *
   * oneLevel 摊不读这个值，固定用 SHAPE_MAX_SIBLINGS——与 core/tree.ts
   * 组内子目录截断对齐（见 final-review.md I3）。
   */
  maxTopFolders?: number
  /**
   * 二级目录（一级目录下的 children）数量上限。省略时退回 maxTopFolders 的值——
   * oneLevel 摊用不到它，因为 children 恒被强制成空数组；
   * 非 oneLevel 摊两层形状下不该复用一级预算，理由见 core/tree.ts 的
   * BuildTreeInput.maxChildFolders。
   */
  maxChildFolders?: number
  /** 允许再往下分一层。false 时提示词要求模型只输出一层。 */
  allowChildren?: boolean
  /** 这批目录的绝对层级（见 core/level.ts）。省略按 1 算。 */
  startLevel?: number
  /** 这批目录会被放进哪个目录。 */
  containerTitle?: string
  /** 目录至少要装下几个书签。省略表示用户关掉了这项约束。 */
  minFolderSize?: number
  existingFolders?: string[]
  onLog?: (message: string, level: 'info' | 'warn' | 'error') => void
  /** 每摊设计开始前检查一次，返回 true 就跳过剩余摊子。 */
  isCancelled?: () => boolean
}

function buildDesignPrompt(topics: TopicCount[], options: DesignOptions, locale: Locale): string {
  const total = topics.reduce((sum, t) => sum + t.count, 0)
  // 组分摊（oneLevel）的上限固定用 SHAPE_MAX_SIBLINGS，不借用 options.maxTopFolders——
  // 那个数传的是主题那一摊的预算（topWithFallback + 1），与组内截断是两件事。
  // core/tree.ts 组内子目录截断本来就用 SHAPE_MAX_SIBLINGS，这里不跟上，提示词给模型
  // 的目标数和建树阶段真正生效的上限就会是两个不同的数（见 final-review.md I3）。
  const max = options.oneLevel === true ? SHAPE_MAX_SIBLINGS : (options.maxTopFolders ?? MAX_SIBLINGS)
  // tree.ts 建树时会再留一个位置给「其他」，非 oneLevel 时的上限要和它对齐，否则模型给满
  // 上限时最小的那个会被建树阶段静默丢弃
  const maxSiblings = options.oneLevel === true ? max : max - 1

  return [
    ...foldersPrompt(locale, {
      total,
      parentTitle: options.oneLevel === true ? (options.parentTitle ?? '') : undefined,
      maxSiblings,
      ...(options.allowChildren === undefined ? {} : { allowChildren: options.allowChildren }),
      ...(options.startLevel === undefined ? {} : { startLevel: options.startLevel }),
      ...(options.containerTitle === undefined ? {} : { containerTitle: options.containerTitle }),
      ...(options.minFolderSize === undefined ? {} : { minFolderSize: options.minFolderSize }),
      ...(options.existingFolders === undefined ? {} : { existingFolders: options.existingFolders }),
    }),
    '',
    locale === 'zh_CN' ? '标签清单：' : 'Label list:',
    JSON.stringify(topics, null, 2),
  ].join('\n')
}

/**
 * 目录名有没有把两个概念捆在一起。
 *
 * 中文连接词两侧各要求至少两个字：「饱和度」这种把「和」嵌在词里的名字不该被误判，
 * 而真正的复合名（「记忆与向量存储」「Python 配置与排错」）两侧都不止两个字。
 * 连接词字符类覆盖「与」「和」「及」「、」「/」「／」「＆」「&」「+」——「及」顺带盖住「以及」
 * （「以」并进左侧词块），「/」「＆」是模型被禁用「与」「和」之后最省力的两种改法
 * （见 issues review I2：不补的话最常见的重问结果会被静默判成成功）。
 * 英文只认独立成词的 and / & / 斜杠，以及逗号列举——「Q&A」「AT&T」「Text-to-Speech」是
 * 一个概念，放过；不带空格的斜杠只在两侧都是 ≤3 个字符的缩写时放过
 * （护住「CI/CD」「I/O」「TCP/IP」「A/B」），更长的一律认成复合
 * （「Speech synthesis/cloning」这种不带空格的斜杠恰恰是英文目录名里更常见的写法）。
 *
 * 判错的方向是不对称的：多认一个只是白问一次模型，漏认一个就留下一对会抢书签的目录，
 * 所以边界往「宁可多问一次」偏。
 */
export function isCompoundName(title: string, locale: Locale): boolean {
  const name = title.trim()
  if (locale === 'zh_CN') {
    return /[一-鿿A-Za-z0-9]{2,}\s*[与和及、/／＆&+]\s*[一-鿿A-Za-z0-9]{2,}/.test(name)
  }
  if (/\s(and|&)\s|\s\/\s|,\s*[A-Za-z]/i.test(name)) return true
  const slash = /([A-Za-z0-9]+)\/([A-Za-z0-9]+)/.exec(name)
  if (slash !== null && !(slash[1]!.length <= 3 && slash[2]!.length <= 3)) return true
  return false
}

export interface FolderFamily {
  /** 这一族共享的主体名，重问时要点给模型看。 */
  prefix: string
  /** 属于这一族的兄弟目录名，保持设计产物里的原始顺序。 */
  titles: string[]
}

/**
 * 英文主体至少这么多字母才作数——比它短的多半是缩写（CI、CLI、Pro-），
 * 撞上一两个字母不说明是同一个东西。
 */
const MIN_ASCII_PREFIX = 3
/** 中文主体至少两个字：「模」一个字撞得太容易（模型 / 模块 / 模板）。 */
const MIN_CJK_PREFIX = 2

function commonPrefix(a: string, b: string): string {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1
  return a.slice(0, i)
}

/**
 * 前缀在这个名字里有没有停在词边界上。
 *
 * 「Prometheus监控」与「Protobuf序列化」共享 `Pro`，长度够了却是半个单词——
 * 后面还接着小写字母就说明单词没写完，不算同一个主体。中日文字符不参与这条判断，
 * 它们本来就字字可断。
 */
function endsAtBoundary(name: string, prefix: string): boolean {
  const next = name[prefix.length]
  return next === undefined || !/[a-z0-9]/i.test(next)
}

/** 两个名字共享的主体名；够不上「同一个主体」时返回 null。 */
function familyPrefix(a: string, b: string): string | null {
  const prefix = commonPrefix(a, b).trim()
  if (prefix === '') return null
  const min = /[\u4e00-\u9fff]/.test(prefix) ? MIN_CJK_PREFIX : MIN_ASCII_PREFIX
  if ([...prefix].length < min) return null
  if (!endsAtBoundary(a, prefix) || !endsAtBoundary(b, prefix)) return null
  return prefix
}

/** 一批同层兄弟里所有「共享同一个主体」的族，不看书签数。 */
function familiesIn(titles: string[]): FolderFamily[] {
  const candidates = new Set<string>()
  for (let i = 0; i < titles.length; i += 1) {
    for (let j = i + 1; j < titles.length; j += 1) {
      const prefix = familyPrefix(titles[i]!, titles[j]!)
      if (prefix !== null) candidates.add(prefix)
    }
  }
  // 同一批成员可能被长短两个前缀同时命中（「语音」与「语音识」），只留最长的那个——
  // 点名给模型看时，越长越像一个真的主体名。
  const bySignature = new Map<string, FolderFamily>()
  for (const prefix of candidates) {
    const members = titles.filter((title) => title.startsWith(prefix) && endsAtBoundary(title, prefix))
    if (members.length < 2) continue
    const signature = members.join('\u0000')
    const kept = bySignature.get(signature)
    if (kept === undefined || prefix.length > kept.prefix.length) {
      bySignature.set(signature, { prefix, titles: members })
    }
  }
  return [...bySignature.values()]
}

/**
 * 同一个主体被拆成几个并列目录——「FastAPI教程」「FastAPI实战」「FastAPI数据库」
 * 本该是一个「FastAPI」，撑得起来再用 children 分侧面。
 *
 * 与 isCompoundName 是一对：那条治「一个名字捆了两个概念」，这条治「一个概念摊成了几个名字」。
 * 提示词规则 1 只要求合并「同义或高度重叠」的标签，而这几个名字既不同义也不重叠——
 * 它们是同一个主体的不同侧面，模型照规则办事也会这么拆，所以只能在这里兜。
 *
 * 判据只剩一条：**同主体就算一族**——共享一个够长、且停在词边界上的前缀（见 familyPrefix）。
 *
 * 曾经还有第二条「碎」（这一族里多数目录装不到 2 × minFolderSize 个书签），一级目录那一摊
 * 用它、组内那一摊用 `ignoreSize` 关掉它。**那个分层判错了**（见
 * issues/38-source-vs-topic.md 的 D1）：真实产出里「FastAPI教程 / 实战 / 数据库 / 用户认证」
 * 四个一级目录正是被它放行的——四个成员里有两个装了 6 条以上，就够不上「多数偏小」。
 * 而尺寸健康根本不构成「不该合并」的理由：一个主体占掉四个一级位子，挤掉的是真正需要
 * 区分的东西；并起来太大也不必怕，落成之后 core/audit.ts 的 findOversizedFolders 会按
 * 实际占用把它再切开，那把尺子量的是真实书签数，比设计阶段的估计准。
 *
 * `minFolderSize` 缺席（用户关掉了这项约束）时一概不检测：关掉它本就意味着
 * 「我接受小目录」，这时候还去合并等于绕过用户的开关。
 */
export function fragmentedFamilies(
  design: FolderDesign,
  minFolderSize?: number,
): FolderFamily[] {
  if (minFolderSize === undefined) return []
  const found: FolderFamily[] = []
  found.push(...familiesIn(design.folders.map((folder) => folder.title)))
  for (const folder of design.folders) {
    found.push(...familiesIn(folder.children))
  }
  return found
}

/**
 * 一次 requestDesign 的结果。不在这里打任何 onLog——一摊可能连着发两次请求
 * （首轮 + 重问），日志该打在哪一次、打给谁看，只有调用方（designFolders）知道
 * 「这次是不是最终会被采用的那一版」（见 issues review I1）。
 */
type DesignAttempt =
  | { ok: true; design: FolderDesign; duplicateDetail: string | null; droppedTitles: string[] }
  | { ok: false; detail: string }

/** 发一次请求并把返回解析成 FolderDesign；失败时把原因带回去，不在这里打日志。 */
async function requestDesign(
  prompt: string,
  client: LlmClient,
  locale: Locale,
  options: DesignOptions,
): Promise<DesignAttempt> {
  try {
    const response = (await client.complete(prompt, DESIGN_SCHEMA)) as {
      folders?: RawFolder[]
    }
    const raw = response.folders ?? []
    // 以下几处 throw 的文案会经 catch 里的 String(error) 拼进 onLog 的 detail，
    // 因此也要双语，不能当成纯开发者日志处理。
    if (!Array.isArray(raw)) {
      throw new Error(locale === 'zh_CN' ? '模型返回的 folders 不是数组' : "The model's folders field is not an array")
    }

    // 非 oneLevel 时留一个位置给 tree.ts 建树时补的「其他」，避免第 max 个目录
    // 在这里放行、却在建树阶段被静默截掉。oneLevel 固定用 SHAPE_MAX_SIBLINGS，
    // 理由同 buildDesignPrompt（I3）
    const max = options.oneLevel === true ? SHAPE_MAX_SIBLINGS : (options.maxTopFolders ?? MAX_SIBLINGS)
    const limit = options.oneLevel === true ? max : max - 1
    // 二级（children）截断不该复用一级的 max——两者预算不同（见 DesignOptions.
    // maxChildFolders 的 JSDoc）。省略时退回 max，与改造前的行为一致。
    const maxChild = options.maxChildFolders ?? max
    const folders: FolderDesign['folders'] = []
    const mapping = new Map<string, string[]>()
    // 标签归一化后 → 声明过它的目录标题集合，用于检测提示词第 5 条要求的
    // 「每个标签只能出现在一个目录的 topics 里」是否被模型违反
    const declaredBy = new Map<string, { display: string; owners: Set<string> }>()
    const setMapping = (topic: string, ownerLabel: string, path: string[]): void => {
      const key = normalizeName(topic)
      const entry = declaredBy.get(key) ?? { display: topic, owners: new Set<string>() }
      entry.owners.add(ownerLabel)
      declaredBy.set(key, entry)
      // 同一标签被多个目录声明时，保留最后一个（现有行为不变，见下方汇总警告）
      mapping.set(key, path)
    }
    // 超出上限的目录整个丢弃，它吸收的标签一并视为未映射，落进「其他」。
    // 丢了哪几个要带回给调用方——静默丢弃会让「其他」莫名变大而无人知晓（06 票判准 C）。
    const droppedTitles = raw
      .slice(limit)
      .map((folder) => (typeof folder?.title === 'string' ? folder.title : ''))
      .filter((title) => title !== '')
    for (const folder of raw.slice(0, limit)) {
      if (typeof folder !== 'object' || folder === null || typeof folder.title !== 'string') {
        throw new Error(locale === 'zh_CN' ? '模型返回的目录形状非法' : 'The model returned a malformed folder')
      }
      if (!Array.isArray(folder.topics)) {
        throw new Error(locale === 'zh_CN' ? '模型返回的 topics 不是数组' : "The folder's topics field is not an array")
      }
      const children = options.oneLevel === true ? [] : (folder.children ?? [])
      if (!Array.isArray(children)) {
        throw new Error(locale === 'zh_CN' ? '模型返回的 children 不是数组' : "The folder's children field is not an array")
      }
      for (const topic of folder.topics) {
        setMapping(topic, folder.title, [folder.title])
      }
      // oneLevel 下模型仍可能给出 children，把它们的标签并进父目录而不是丢掉
      if (options.oneLevel === true) {
        for (const child of folder.children ?? []) {
          for (const topic of child.topics ?? []) setMapping(topic, folder.title, [folder.title])
        }
      }
      const kept = children.slice(0, maxChild)
      for (const child of kept) {
        for (const topic of child.topics ?? []) {
          setMapping(topic, `${folder.title}/${child.title}`, [folder.title, child.title])
        }
      }
      folders.push({ title: folder.title, children: kept.map((c) => c.title) })
    }

    if (folders.length === 0) return { ok: false, detail: locale === 'zh_CN' ? '模型没有返回任何目录' : 'The model returned no folders' }

    // 同一标签被多个目录同时声明：不抛错、取最后一个，但汇总成一条警告方便排查——
    // 只有这一版最终被采用时才该打给用户看，交给调用方决定
    const duplicated = [...declaredBy.values()].filter((entry) => entry.owners.size > 1)
    const duplicateDetail = duplicated.length === 0 ? null : duplicated
      .map((entry) =>
        locale === 'zh_CN'
          ? `「${entry.display}」被 ${entry.owners.size} 个目录同时声明`
          : `"${entry.display}" was declared by ${entry.owners.size} folders`,
      )
      .join(locale === 'zh_CN' ? '；' : '; ')

    return { ok: true, design: { folders, mapping }, duplicateDetail, droppedTitles }
  } catch (error) {
    // 只进开发者控制台，不必双语。
    console.error('[TidyMark] 目录设计失败：', error)
    return { ok: false, detail: String(error) }
  }
}

/**
 * 一版设计最终被采用时，统一在这里打「设计完成」与「重复声明」两条日志——
 * 不管一摊里发了一次请求还是两次，这两条只会各打一次，且数字/详情都取自
 * 真正被返回给调用方的那一版（见 issues review I1）。
 */
function logAdopted(
  attempt: { design: FolderDesign; duplicateDetail: string | null; droppedTitles: string[] },
  locale: Locale,
  options: DesignOptions,
): void {
  if (attempt.duplicateDetail !== null) {
    options.onLog?.(logDuplicateTopics(locale, attempt.duplicateDetail), 'warn')
  }
  if (attempt.droppedTitles.length > 0) {
    const detail = attempt.droppedTitles
      .map((title) => (locale === 'zh_CN' ? `「${title}」` : `"${title}"`))
      .join(locale === 'zh_CN' ? '、' : ', ')
    options.onLog?.(logFoldersDropped(locale, attempt.droppedTitles.length, detail), 'warn')
  }
  options.onLog?.(logFoldersDone(locale, attempt.design.folders.length, attempt.design.mapping.size), 'info')
}

/**
 * 看到全部标签的那一次调用，由它归并同义标签并定下目录树。
 *
 * 标签抽取是分批并发的，模型看不到全局，必然抽出「Claude Code」「CC 工作流」
 * 这类碎片。碎片各自都不够大，按数量筛只会把它们统统扔进「其他」。
 * 归并只能在这里做——这是唯一看得到全部标签的地方。
 *
 * 失败返回 null，调用方退回未归并的原始标签，不让整次分析白跑。
 */
export async function designFolders(
  topics: TopicCount[],
  client: LlmClient,
  locale: Locale,
  options: DesignOptions = {},
): Promise<FolderDesign | null> {
  if (topics.length === 0) return null

  const prompt = buildDesignPrompt(topics, options, locale)
  const first = await requestDesign(prompt, client, locale, options)
  if (!first.ok) {
    // 首轮真的失败：调用方会退回原始标签，这条文案说「保留原始标签」是对的
    options.onLog?.(logFoldersFailed(locale, first.detail), 'error')
    return null
  }

  const firstIssues = findIssues(first.design, topics, options, locale)
  if (issueCount(firstIssues) === 0) {
    logAdopted(first, locale, options)
    return first.design
  }

  if (firstIssues.compound.length > 0) {
    options.onLog?.(logCompoundNames(locale, firstIssues.compound.join(locale === 'zh_CN' ? '、' : ', ')), 'warn')
  }
  if (firstIssues.families.length > 0) {
    options.onLog?.(logFragmentedFamilies(locale, familyDetail(locale, firstIssues.families)), 'warn')
  }

  // 重问是取消之后才新发起的一次请求，不属于「已经在跑的这次请求不中途打断」
  // 这条承诺覆盖的范围——用户点了取消，这次请求本就不该发出去（见 issues review I3）。
  if (options.isCancelled?.() === true) {
    logAdopted(first, locale, options)
    return first.design
  }

  // 只重问一次。重问失败（网络错、返回形状不对）就用第一版——名字不好看，
  // 也好过整摊书签退回碎片化的原始标签。
  // 两类毛病共用这一次：分开各问一次会把一摊的请求数从 2 涨到 3，而模型
  // 一次能同时改掉两样，没有理由拆成两轮。
  const second = await requestDesign(
    [prompt, '', ...issueFeedback(locale, firstIssues)].join('\n'),
    client, locale, options,
  )
  if (!second.ok) {
    // 重问失败≠首轮失败：第一版仍然被采用，不是退回原始标签，
    // 不能打 logFoldersFailed 那条文案（见 issues review I1）
    options.onLog?.(logFoldersRetryFailed(locale, second.detail), 'warn')
    logAdopted(first, locale, options)
    return first.design
  }

  const secondIssues = findIssues(second.design, topics, options, locale)
  // 重问回来毛病总数不比第一版少，说明这一版没有变好——「收手」不等于「必须用它」，
  // 退回更差的一版与「宁可名字不好看」的兜底哲学不符（见 issues review M8）。
  // 两类毛病加总起来比，是因为它们共用了同一次重问：只盯其中一类，会出现
  // 「复合名少了一个、碎目录多了三个」也算变好的荒唐结果。
  const useFirst = issueCount(secondIssues) >= issueCount(firstIssues)
  const chosen = useFirst ? first : second
  const remaining = useFirst ? firstIssues : secondIssues
  if (remaining.compound.length > 0) {
    options.onLog?.(
      logCompoundNamesRemain(locale, remaining.compound.join(locale === 'zh_CN' ? '、' : ', ')),
      'warn',
    )
  }
  if (remaining.families.length > 0) {
    options.onLog?.(logFamiliesRemain(locale, familyDetail(locale, remaining.families)), 'warn')
  }
  logAdopted(chosen, locale, options)
  return chosen.design
}

/** 一版设计里所有该重问的毛病。两类分开存，日志与反馈都要分别点名。 */
interface DesignIssues {
  compound: string[]
  families: FolderFamily[]
}

function findIssues(
  design: FolderDesign,
  topics: TopicCount[],
  options: DesignOptions,
  locale: Locale,
): DesignIssues {
  return {
    compound: compoundTitles(design, locale),
    families: fragmentedFamilies(design, options.minFolderSize),
  }
}

function issueCount(issues: DesignIssues): number {
  return issues.compound.length + issues.families.length
}

/** 同族碎片的展示形态，日志与重问反馈共用一份，两处不会说出不同的名字。 */
function familyDetail(locale: Locale, families: FolderFamily[]): string {
  if (locale === 'zh_CN') {
    return families.map((f) => `「${f.prefix}」：${f.titles.join('、')}`).join('；')
  }
  return families.map((f) => `"${f.prefix}": ${f.titles.join(', ')}`).join('; ')
}

/** 设计里所有复合名，一级与二级都算。 */
function compoundTitles(design: FolderDesign, locale: Locale): string[] {
  const all = design.folders.flatMap((f) => [f.title, ...f.children])
  return all.filter((title) => isCompoundName(title, locale))
}

/**
 * 重问时追加的反馈。必须点名，模型才知道要改哪几个。
 *
 * 「其余规则不变」这句收在 issueFeedback 末尾统一说一次——两类毛病同时出现时，
 * 各自再说一遍会让模型以为是两条不同的指示。
 */
function compoundFeedback(locale: Locale, names: string[]): string[] {
  if (locale === 'zh_CN') {
    return [
      `刚才那一版里这些目录名把两个概念捆在了一起：${names.join('、')}。`,
      '每个目录只装一个概念，被拆掉的那个概念要么单独开目录，要么并进别处。',
    ]
  }
  return [
    `These folder names from the previous pass bundle two concepts: ${names.join(', ')}.`,
    'One concept per folder. Give the concept you drop its own folder, or fold it into an existing one.',
  ]
}

/** 同族碎片的反馈。点名到主体，模型才知道并成什么名字。 */
function familyFeedback(locale: Locale, families: FolderFamily[]): string[] {
  if (locale === 'zh_CN') {
    return [
      `刚才那一版里这几组目录把同一个主体拆成了几个装不满的目录：${familyDetail(locale, families)}。`,
      '每一组请并成一个以该主体命名的目录，不要按侧面并列拆开。',
    ]
  }
  return [
    `These folder groups from the previous pass split one subject across several folders too small to fill: ${familyDetail(locale, families)}.`,
    'Merge each group into a single folder named after that subject, instead of splitting it by aspect.',
  ]
}

/** 把这一版的全部毛病拼成一段反馈，末尾统一交代一次「其余规则不变」。 */
function issueFeedback(locale: Locale, issues: DesignIssues): string[] {
  const lines: string[] = [locale === 'zh_CN' ? '请重新设计一版。' : 'Design another version.']
  if (issues.compound.length > 0) lines.push(...compoundFeedback(locale, issues.compound))
  if (issues.families.length > 0) lines.push(...familyFeedback(locale, issues.families))
  lines.push(locale === 'zh_CN' ? '其余规则不变。' : 'Every other rule stays the same.')
  return lines
}

/**
 * 全部标签走一次目录设计，把设计结果写回标签。
 *
 * 曾经分成「主题」与「各聚合组」几摊、每摊各设计一次：命中域名规则的书签先被关进
 * 组目录，组内再按功能域抽一套标签、单独设计一层子目录。整套机制随
 * issues/38-source-vs-topic.md 的 D4 删掉——按来源分的第一层把「项目本身」和
 * 「怎么用这个项目」劈在两个一级目录里（实测 20%），而检索时用户想的是主题，
 * 不是这条书签当初存的是仓库还是它的文档站。
 *
 * 设计失败时整摊标签原样保留：碎片化的目录也好过整摊书签失去归属。
 */
export async function designTagFolders(
  tags: TagResult[],
  client: LlmClient,
  locale: Locale,
  options: DesignOptions = {},
): Promise<TagResult[]> {
  if (options.isCancelled?.() === true) return tags

  // 「不许语义重叠」会让模型主动不建某些目录，那些标签映射不到目录、被 applyDesign
  // 置成 NO_TOPIC，最终去处交给分类阶段决定（见 issues review I5）。
  // 这里只数、不拦：规则本身不改，只是把它的代价变得可观测。
  const before = new Set(
    tags.map((tag, index) => (tag.primaryTopic === NO_TOPIC ? index : -1)).filter((i) => i >= 0),
  )
  const design = await designFolders(collectTopics(tags), client, locale, options)
  // 设计失败就保留原始标签：碎片化的目录也好过整摊书签失去归属
  if (design === null) return tags
  const next = applyDesign(tags, design)
  const newlyUnmapped = next.filter(
    (tag, index) => !before.has(index) && tag.primaryTopic === NO_TOPIC,
  ).length
  if (newlyUnmapped > 0) {
    options.onLog?.(logNoTopicMapped(locale, newlyUnmapped), 'info')
  }
  return next
}

const NAME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string' },
  },
}

/**
 * 给合并出来的容器目录起名。一次调用，失败返回 null 由调用方兜底。
 *
 * 命名失败不该让整次分析白跑——名字在结构确认页还能改，目录结构才是贵的那部分。
 */
export async function nameMergedFolder(
  topics: TopicCount[],
  sourceTitles: string[],
  client: LlmClient,
  locale: Locale,
  options: { onLog?: (message: string, level: 'info' | 'warn' | 'error') => void } = {},
): Promise<string | null> {
  if (topics.length === 0) return null
  try {
    const prompt = [
      ...mergeNamePrompt(locale, sourceTitles),
      '',
      locale === 'zh_CN' ? '主题清单：' : 'Topic list:',
      JSON.stringify(topics, null, 2),
    ].join('\n')
    const response = (await client.complete(prompt, NAME_SCHEMA)) as { name?: unknown }
    const name = stripNumberPrefix(String(response.name ?? '').trim()).trim()
    return name === '' ? null : name
  } catch (error) {
    // 只进开发者控制台，不必双语，与 designFolders 的失败兜底同一套形态。
    console.error('[TidyMark] 合并目录命名失败：', error)
    options.onLog?.(String(error), 'warn')
    return null
  }
}

const NEW_FOLDER_NAMES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['names'],
  properties: {
    names: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'name'],
        properties: { key: { type: 'string' }, name: { type: 'string' } },
      },
    },
  },
}

/**
 * 给非推翻模式要新建的目录起名。一次调用。
 *
 * **绝大多数簇能拿到名字**：模型漏了、起了重名，都退回簇自己的主题名；整个调用失败，
 * 全部退回主题名。起名本身失败不该毁掉整次分析——那批书签宁可进一个名字朴素的目录，
 * 也好过留在原地找不到。
 *
 * **唯一的例外：连主题名自己也撞了已有目录名（或本轮另一个簇）时，这个簇整个不出现在
 * 返回的 map 里。** 调用方（`core/newTopics.ts` 的 `planNewFolders`）据此不给它建目录——
 * 撞名建出的重名兄弟会在下一轮把 `classify.ts` 的 idByPath 搞坏，是幂等性 churn 的种子。
 */
export async function nameNewTopics(
  clusters: TopicCluster[],
  existingTitles: string[],
  client: LlmClient,
  locale: Locale,
  options: { onLog?: (message: string, level: 'info' | 'warn' | 'error') => void } = {},
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (clusters.length === 0) return names

  // 已有目录名与本轮已定的新名字共用一张表：既不能撞已有目录，也不能两个簇同名
  const taken = new Set(existingTitles.map((t) => normalizeName(stripNumberPrefix(t))))
  let proposed = new Map<string, string>()
  try {
    const prompt = [
      ...newFolderNamesPrompt(locale, existingTitles),
      '',
      locale === 'zh_CN' ? '待命名的主题：' : 'Topics to name:',
      JSON.stringify(clusters.map((c) => ({ key: c.key, topic: c.title, count: c.bookmarkIds.length })), null, 2),
    ].join('\n')
    const response = (await client.complete(prompt, NEW_FOLDER_NAMES_SCHEMA)) as {
      names?: Array<{ key?: unknown; name?: unknown }>
    }
    proposed = new Map(
      (response.names ?? []).map((n) => [String(n.key ?? ''), String(n.name ?? '')]),
    )
  } catch (error) {
    // 只进开发者控制台，不必双语，与 nameMergedFolder 的失败兜底同一套形态。
    console.error('[TidyMark] 新目录命名失败：', error)
    options.onLog?.(String(error), 'warn')
  }

  for (const cluster of clusters) {
    const raw = stripNumberPrefix(String(proposed.get(cluster.key) ?? '').trim()).trim()
    const fallback = cluster.title
    const primary = raw === '' ? fallback : raw
    // 撞名就退回主题名；主题名自己也撞的话——不能再「让它撞」了：一个重名兄弟会在
    // 下一轮把 classify.ts 的 idByPath 搞坏（那边的注释已经警告过，同路径只留最后一个），
    // 而重名兄弟正是幂等性 churn 的种子（见 issues review C1）。整簇跳过，这批书签
    // 留在原地，比造一个认不出的重名目录更安全。
    let chosen: string | null = null
    if (!taken.has(normalizeName(primary))) {
      chosen = primary
    } else if (primary !== fallback && !taken.has(normalizeName(fallback))) {
      chosen = fallback
    }
    if (chosen === null) continue
    taken.add(normalizeName(chosen))
    names.set(cluster.key, chosen)
  }
  return names
}
