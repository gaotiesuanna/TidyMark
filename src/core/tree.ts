import { normalizeName, stripNumberPrefix } from './map'
import type { NewFolderSpec, RenameFolderSpec } from './plan'
import type { CategoryCandidate, TagResult } from './types'

/** 一个主题至少要有这么多书签，才值得拥有独立目录。 */
export const MIN_FOLDER_SIZE = 5
/** 同一层最多允许的目录数量。 */
export const MAX_SIBLINGS = 12
export const FALLBACK_TITLE = '其他'

export { stripNumberPrefix }

/** 复用已有目录时只需要这三个字段，FolderItem 可以直接传入。 */
export interface ExistingFolder {
  id: string
  parentId: string | null
  title: string
}

export interface BuildTreeInput {
  tags: TagResult[]
  /** 新目录挂载的范围根文件夹 id。 */
  rootId: string
  /** 范围内已存在的文件夹，用于复用而不是重复新建同名目录。 */
  existingFolders: ExistingFolder[]
}

export interface BuildTreeOutput {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  renameFolders: RenameFolderSpec[]
}

interface Group {
  title: string
  count: number
  children: Map<string, { title: string; count: number }>
}

/** 顶层 `01`，子层 `01.1`，同层按书签数从多到少编号。 */
function numbered(prefix: string, title: string): string {
  return `${prefix} ${title}`
}

export function buildCategoryTree(input: BuildTreeInput): BuildTreeOutput {
  if (input.tags.length === 0) return { candidates: [], newFolders: [], renameFolders: [] }

  const baseTitle = (folder: ExistingFolder): string => stripNumberPrefix(folder.title)
  const lookupKey = (parentId: string, title: string): string =>
    JSON.stringify([parentId, normalizeName(title)])

  // (父目录, 归一化后的名字) → 已有目录，用于复用
  const existingByParent = new Map<string, ExistingFolder>()
  // 归一化后的名字 → 已有写法，用于沿用用户自己的命名习惯
  const existingByName = new Map<string, string>()
  for (const folder of input.existingFolders) {
    const base = baseTitle(folder)
    const key = lookupKey(folder.parentId ?? '', base)
    if (!existingByParent.has(key)) existingByParent.set(key, folder)
    if (!existingByName.has(normalizeName(base))) existingByName.set(normalizeName(base), base)
  }
  const findChild = (parentId: string, title: string): ExistingFolder | null =>
    existingByParent.get(lookupKey(parentId, title)) ?? null

  const groups = new Map<string, Group>()
  for (const tag of input.tags) {
    const key = normalizeName(tag.primaryTopic)
    if (key === '') continue
    const group = groups.get(key) ?? {
      title: existingByName.get(key) ?? tag.primaryTopic,
      count: 0,
      children: new Map(),
    }
    group.count++
    if (tag.secondaryTopic !== null && normalizeName(tag.secondaryTopic) !== '') {
      const childKey = normalizeName(tag.secondaryTopic)
      const child = group.children.get(childKey) ?? {
        title: existingByName.get(childKey) ?? tag.secondaryTopic,
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

  // 兜底目录，接住所有没能形成独立目录的书签
  const hasFallback = ranked.some((g) => normalizeName(g.title) === normalizeName(FALLBACK_TITLE))
  const ordered = hasFallback
    ? ranked
    : [...ranked, { title: FALLBACK_TITLE, count: 0, children: new Map() } satisfies Group]

  const candidates: CategoryCandidate[] = []
  const newFolders: NewFolderSpec[] = []
  const renameFolders: RenameFolderSpec[] = []
  let counter = 0
  const nextId = (): string => `tmp:${++counter}`

  ordered.forEach((group, groupIndex) => {
    const prefix = String(groupIndex + 1).padStart(2, '0')
    const title = numbered(prefix, group.title)
    const existing = findChild(input.rootId, group.title)

    let parentRealId: string | null = null
    let parentTemporaryId: string | null = null
    if (existing !== null) {
      parentRealId = existing.id
      candidates.push({ id: existing.id, path: [title] })
      if (existing.title !== title) {
        renameFolders.push({ folderId: existing.id, oldTitle: existing.title, newTitle: title })
      }
    } else {
      parentTemporaryId = nextId()
      newFolders.push({
        temporaryId: parentTemporaryId, parentId: input.rootId, parentTemporaryId: null, title,
      })
      candidates.push({ id: parentTemporaryId, path: [title] })
    }

    const children = [...group.children.values()]
      .filter((c) => c.count >= MIN_FOLDER_SIZE)
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_SIBLINGS)
    children.forEach((child, childIndex) => {
      const childTitle = numbered(`${prefix}.${childIndex + 1}`, child.title)
      // 父目录是新建的，它下面不可能有已存在的子目录
      const existingChild = parentRealId === null ? null : findChild(parentRealId, child.title)
      if (existingChild !== null) {
        candidates.push({ id: existingChild.id, path: [title, childTitle] })
        if (existingChild.title !== childTitle) {
          renameFolders.push({
            folderId: existingChild.id, oldTitle: existingChild.title, newTitle: childTitle,
          })
        }
        return
      }
      const childId = nextId()
      newFolders.push({
        temporaryId: childId, parentId: parentRealId, parentTemporaryId, title: childTitle,
      })
      candidates.push({ id: childId, path: [title, childTitle] })
    })
  })

  return { candidates, newFolders, renameFolders }
}
