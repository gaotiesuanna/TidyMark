import { normalizeName, stripNumberPrefix } from '@/core/map'
import { groupFolderTitle, matchDomainGroup } from '@/core/domainGroups'
import type { Locale } from '@/core/locale'
import type { BookmarkItem, TagResult } from '@/core/types'
import type { TopicCluster } from '@/core/newTopics'
import { MAX_SIBLINGS } from '@/core/tree'
import { NO_TOPIC } from './tags'
import type { LlmClient } from './client'
import { logDuplicateTopics, logFoldersDone, logFoldersFailed } from './logs'
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
  /** true 时只出一层目录，用于聚合组内部。 */
  oneLevel?: boolean
  /** 只出一层时，把父目录名告诉模型，避免它把组名再当分类依据。 */
  parentTitle?: string
  /** 同一层目录数上限。省略时用 MAX_SIBLINGS。 */
  maxTopFolders?: number
  /** 允许再往下分一层。false 时提示词要求模型只输出一层。 */
  allowChildren?: boolean
  /** 这批目录的绝对层级（见 core/level.ts）。省略按 1 算。 */
  startLevel?: number
  /** 这批目录会被放进哪个目录。 */
  containerTitle?: string
  /** 目录至少要装下几个书签。省略表示用户关掉了这项约束。 */
  minFolderSize?: number
  onLog?: (message: string, level: 'info' | 'warn' | 'error') => void
  /** 每摊设计开始前检查一次，返回 true 就跳过剩余摊子。 */
  isCancelled?: () => boolean
}

function buildDesignPrompt(topics: TopicCount[], options: DesignOptions, locale: Locale): string {
  const total = topics.reduce((sum, t) => sum + t.count, 0)
  const max = options.maxTopFolders ?? MAX_SIBLINGS
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
    }),
    '',
    locale === 'zh_CN' ? '标签清单：' : 'Label list:',
    JSON.stringify(topics, null, 2),
  ].join('\n')
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

  try {
    const response = (await client.complete(buildDesignPrompt(topics, options, locale), DESIGN_SCHEMA)) as {
      folders?: RawFolder[]
    }
    const raw = response.folders ?? []
    // 以下几处 throw 的文案会经 catch 里的 String(error) 拼进 onLog 的 detail，
    // 因此也要双语，不能当成纯开发者日志处理。
    if (!Array.isArray(raw)) {
      throw new Error(locale === 'zh_CN' ? '模型返回的 folders 不是数组' : "The model's folders field is not an array")
    }

    // 非 oneLevel 时留一个位置给 tree.ts 建树时补的「其他」，避免第 max 个目录
    // 在这里放行、却在建树阶段被静默截掉
    const max = options.maxTopFolders ?? MAX_SIBLINGS
    const limit = options.oneLevel === true ? max : max - 1
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
    // 超出上限的目录整个丢弃，它吸收的标签一并视为未映射，落进「其他」
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
      const kept = children.slice(0, max)
      for (const child of kept) {
        for (const topic of child.topics ?? []) {
          setMapping(topic, `${folder.title}/${child.title}`, [folder.title, child.title])
        }
      }
      folders.push({ title: folder.title, children: kept.map((c) => c.title) })
    }

    if (folders.length === 0) return null

    // 同一标签被多个目录同时声明：不抛错、取最后一个，但汇总成一条警告方便排查
    const duplicated = [...declaredBy.values()].filter((entry) => entry.owners.size > 1)
    if (duplicated.length > 0) {
      const detail = duplicated
        .map((entry) =>
          locale === 'zh_CN'
            ? `「${entry.display}」被 ${entry.owners.size} 个目录同时声明`
            : `"${entry.display}" was declared by ${entry.owners.size} folders`,
        )
        .join(locale === 'zh_CN' ? '；' : '; ')
      options.onLog?.(logDuplicateTopics(locale, detail), 'warn')
    }

    options.onLog?.(logFoldersDone(locale, folders.length, mapping.size), 'info')
    return { folders, mapping }
  } catch (error) {
    // 只进开发者控制台，不必双语。
    console.error('[TidyMark] 目录设计失败：', error)
    options.onLog?.(logFoldersFailed(locale, String(error)), 'error')
    return null
  }
}

/**
 * 把标签分成「主题」与「各聚合组」几摊，每摊各设计一次目录。
 *
 * 命中聚合组的书签已经确定落在组目录下，它们的功能域标签（「文档解析」「RAG 检索」）
 * 只该决定组内的子目录。混进一级目录那次请求，顶层会被 GitHub 仓库的细粒度标签淹没。
 *
 * 任何一摊设计失败，只有那一摊退回原始标签，其余照常归并。
 */
export async function designTagFolders(
  tags: TagResult[],
  bookmarks: BookmarkItem[],
  domainGroups: string[],
  client: LlmClient,
  locale: Locale,
  options: DesignOptions = {},
): Promise<TagResult[]> {
  const bookmarkById = new Map(bookmarks.map((b) => [b.id, b]))
  // 按下标（而非 bookmarkId）分摊、回填：同一个 bookmarkId 出现两次时两条各自独立映射，
  // 不会因为共用同一个 key 而互相覆盖
  const topicEntries: Array<{ index: number; tag: TagResult }> = []
  const byGroup = new Map<string, { title: string; entries: Array<{ index: number; tag: TagResult }> }>()

  tags.forEach((tag, index) => {
    const bookmark = domainGroups.length === 0 ? undefined : bookmarkById.get(tag.bookmarkId)
    const group = bookmark === undefined ? null : matchDomainGroup(bookmark, domainGroups)
    if (group === null) {
      topicEntries.push({ index, tag })
      return
    }
    // 这里的 title 只喂给提示词与日志，不是最终目录名——产出层已在 tree.ts 双语化。
    const bucket = byGroup.get(group.key) ?? { title: groupFolderTitle(group, locale), entries: [] }
    bucket.entries.push({ index, tag })
    byGroup.set(group.key, bucket)
  })

  // 每个下标默认落回原始标签；每摊各自按位写回，等长同序与「每条各自映射」两条承诺都成立
  const result: TagResult[] = tags.slice()
  const run = async (
    entries: Array<{ index: number; tag: TagResult }>,
    batchOptions: DesignOptions,
  ): Promise<void> => {
    const batch = entries.map((entry) => entry.tag)
    const design = await designFolders(collectTopics(batch), client, locale, batchOptions)
    // 设计失败就保留原始标签：碎片化的目录也好过整摊书签失去归属
    const next = design === null ? batch : applyDesign(batch, design)
    next.forEach((tag, i) => {
      result[entries[i]!.index] = tag
    })
  }

  // 每摊开始前查一次取消：命中就跳过剩余摊子，已经在跑的这次请求不中途打断
  if (options.isCancelled?.() !== true) {
    await run(topicEntries, options)
    for (const { title, entries } of byGroup.values()) {
      if (options.isCancelled?.() === true) break
      await run(entries, { ...options, oneLevel: true, parentTitle: title })
    }
  }

  return result
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
