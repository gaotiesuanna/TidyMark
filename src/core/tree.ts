import { normalizeName } from './map'
import type { NewFolderSpec } from './plan'
import type { CategoryCandidate, TagResult } from './types'

/** 一个主题至少要有这么多书签，才值得拥有独立目录。 */
export const MIN_FOLDER_SIZE = 5
/** 同一层最多允许的目录数量。 */
export const MAX_SIBLINGS = 12
export const FALLBACK_TITLE = '其他'

export interface BuildTreeInput {
  tags: TagResult[]
  /** 新目录挂载的范围根文件夹 id。 */
  rootId: string
  /** 范围内现有的文件夹标题，用于复用命名。 */
  existingFolders: string[]
}

interface Group {
  title: string
  count: number
  children: Map<string, { title: string; count: number }>
}

export function buildCategoryTree(input: BuildTreeInput): {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
} {
  if (input.tags.length === 0) return { candidates: [], newFolders: [] }

  // 现有文件夹名优先：归一化后同名时直接沿用原有写法
  const existingByKey = new Map(input.existingFolders.map((t) => [normalizeName(t), t]))

  const groups = new Map<string, Group>()
  for (const tag of input.tags) {
    const key = normalizeName(tag.primaryTopic)
    if (key === '') continue
    const group = groups.get(key) ?? {
      title: existingByKey.get(key) ?? tag.primaryTopic,
      count: 0,
      children: new Map(),
    }
    group.count++
    if (tag.secondaryTopic !== null && normalizeName(tag.secondaryTopic) !== '') {
      const childKey = normalizeName(tag.secondaryTopic)
      const child = group.children.get(childKey) ?? {
        title: existingByKey.get(childKey) ?? tag.secondaryTopic,
        count: 0,
      }
      child.count++
      group.children.set(childKey, child)
    }
    groups.set(key, group)
  }

  const ranked = [...groups.values()]
    .filter((g) => g.count >= MIN_FOLDER_SIZE)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_SIBLINGS - 1) // 留一个位置给「其他」

  const candidates: CategoryCandidate[] = []
  const newFolders: NewFolderSpec[] = []
  let counter = 0
  const nextId = (): string => `tmp:${++counter}`

  for (const group of ranked) {
    const id = nextId()
    newFolders.push({ temporaryId: id, parentId: input.rootId, parentTemporaryId: null, title: group.title })
    candidates.push({ id, path: [group.title] })

    const children = [...group.children.values()]
      .filter((c) => c.count >= MIN_FOLDER_SIZE)
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_SIBLINGS)
    for (const child of children) {
      const childId = nextId()
      newFolders.push({ temporaryId: childId, parentId: null, parentTemporaryId: id, title: child.title })
      candidates.push({ id: childId, path: [group.title, child.title] })
    }
  }

  // 兜底目录，接住所有没能形成独立目录的书签
  const fallbackId = nextId()
  newFolders.push({
    temporaryId: fallbackId, parentId: input.rootId, parentTemporaryId: null, title: FALLBACK_TITLE,
  })
  candidates.push({ id: fallbackId, path: [FALLBACK_TITLE] })

  return { candidates, newFolders }
}
