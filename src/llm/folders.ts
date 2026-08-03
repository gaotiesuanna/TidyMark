import { normalizeName } from '@/core/map'
import type { TagResult } from '@/core/types'
import { NO_TOPIC } from './tags'

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
