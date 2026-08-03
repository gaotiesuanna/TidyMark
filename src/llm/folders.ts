import { normalizeName } from '@/core/map'
import { matchDomainGroup } from '@/core/domainGroups'
import type { BookmarkItem, TagResult } from '@/core/types'
import { MAX_SIBLINGS } from '@/core/tree'
import { NO_TOPIC } from './tags'
import type { LlmClient } from './client'

export interface TopicCount {
  topic: string
  count: number
}

export interface FolderDesign {
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
  onLog?: (message: string, level: 'info' | 'warn' | 'error') => void
}

const BROAD_WORDS = 'AI、人工智能、开发、编程、技术、工具、学习、资源、其他'

function buildDesignPrompt(topics: TopicCount[], options: DesignOptions): string {
  const total = topics.reduce((sum, t) => sum + t.count, 0)
  const head =
    options.oneLevel === true
      ? [
          `下面这些标签来自「${options.parentTitle ?? ''}」目录里的 ${total} 个书签，需要为它们设计子目录。`,
          '这个共同点已经写在父目录名上，不要再拿它当分类依据。',
        ]
      : [`下面是从 ${total} 个书签中抽出的主题标签，每个标签后面是它的书签数。请据此设计目录结构。`]

  const rules =
    options.oneLevel === true
      ? [
          '1. 合并同义或高度重叠的标签，用一个子目录容纳它们。',
          '2. 只输出一层目录，children 一律返回空数组。',
          `3. 子目录不超过 ${MAX_SIBLINGS} 个。`,
          `4. 目录名要具体，禁止使用这些宽泛词：${BROAD_WORDS}。`,
        ]
      : [
          '1. 合并同义或高度重叠的标签，用一个目录容纳它们。',
          `2. 一级目录不超过 ${MAX_SIBLINGS} 个。`,
          '3. 书签少时只给一层目录，不要硬凑二级目录；只有当某个一级目录下确实存在多个清晰的子主题、书签数量也撑得起来时，才用 children 分出二级。',
          `4. 一级目录名要具体，禁止使用这些宽泛词：${BROAD_WORDS}。「Claude Code」「LLM 原理」「终端工具」是好名字，「AI」「开发」不是。`,
        ]

  return [
    ...head,
    '',
    '规则：',
    ...rules,
    '5. 每个标签必须出现在恰好一个目录的 topics 里，不要遗漏、不要重复。直接归入某个一级目录的标签写在它自己的 topics 里，归入子目录的写在子目录的 topics 里。',
    '6. 目录名用中文，专有技术名词（React、RAG、MCP）可直接用原文。',
    '',
    '标签清单：',
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
  options: DesignOptions = {},
): Promise<FolderDesign | null> {
  if (topics.length === 0) return null

  let raw: RawFolder[]
  try {
    const response = (await client.complete(buildDesignPrompt(topics, options), DESIGN_SCHEMA)) as {
      folders?: RawFolder[]
    }
    raw = response.folders ?? []
  } catch (error) {
    console.error('[TidyMark] 目录设计失败：', error)
    options.onLog?.(`目录设计失败，按标签数量退回旧方案：${String(error)}`, 'error')
    return null
  }

  const folders: FolderDesign['folders'] = []
  const mapping = new Map<string, string[]>()
  // 超出上限的目录整个丢弃，它吸收的标签一并视为未映射，落进「其他」
  for (const folder of raw.slice(0, MAX_SIBLINGS)) {
    const children = options.oneLevel === true ? [] : (folder.children ?? [])
    for (const topic of folder.topics ?? []) {
      mapping.set(normalizeName(topic), [folder.title])
    }
    // oneLevel 下模型仍可能给出 children，把它们的标签并进父目录而不是丢掉
    if (options.oneLevel === true) {
      for (const child of folder.children ?? []) {
        for (const topic of child.topics ?? []) mapping.set(normalizeName(topic), [folder.title])
      }
    }
    const kept = children.slice(0, MAX_SIBLINGS)
    for (const child of kept) {
      for (const topic of child.topics ?? []) {
        mapping.set(normalizeName(topic), [folder.title, child.title])
      }
    }
    folders.push({ title: folder.title, children: kept.map((c) => c.title) })
  }

  if (folders.length === 0) return null
  options.onLog?.(`目录设计完成：${folders.length} 个目录，归并 ${mapping.size} 个标签`, 'info')
  return { folders, mapping }
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
  options: DesignOptions = {},
): Promise<TagResult[]> {
  const bookmarkById = new Map(bookmarks.map((b) => [b.id, b]))
  const topicTags: TagResult[] = []
  const byGroup = new Map<string, { title: string; tags: TagResult[] }>()

  for (const tag of tags) {
    const bookmark = domainGroups.length === 0 ? undefined : bookmarkById.get(tag.bookmarkId)
    const group = bookmark === undefined ? null : matchDomainGroup(bookmark, domainGroups)
    if (group === null) {
      topicTags.push(tag)
      continue
    }
    const bucket = byGroup.get(group.key) ?? { title: group.folderTitle, tags: [] }
    bucket.tags.push(tag)
    byGroup.set(group.key, bucket)
  }

  const resolved = new Map<string, TagResult>()
  const run = async (batch: TagResult[], batchOptions: DesignOptions): Promise<void> => {
    const design = await designFolders(collectTopics(batch), client, batchOptions)
    // 设计失败就保留原始标签：碎片化的目录也好过整摊书签失去归属
    const next = design === null ? batch : applyDesign(batch, design)
    for (const tag of next) resolved.set(tag.bookmarkId, tag)
  }

  await run(topicTags, options)
  for (const { title, tags: batch } of byGroup.values()) {
    await run(batch, { ...options, oneLevel: true, parentTitle: title })
  }

  return tags.map((tag) => resolved.get(tag.bookmarkId) ?? tag)
}
