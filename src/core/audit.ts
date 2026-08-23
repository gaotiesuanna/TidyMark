import { normalizeName, stripNumberPrefix } from './map'
import type { NewFolderSpec } from './plan'
import type { CategoryCandidate, Classification } from './types'

/** 读父目录名字只需要这两个字段，FolderItem 可以直接传入。 */
export interface ExistingFolderRef {
  id: string
  title: string
}

export interface CollapseInput {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  classifications: Classification[]
  /** 范围内已存在的目录。父目录是范围根这类已有目录时，从这里读它的名字。 */
  existingFolders: ExistingFolderRef[]
  /** 合并模式下容器目录的临时 id。它不参与塌陷——拆了它 planMergeRoot 的引用就断了。 */
  mergeRootTemporaryId?: string | null
}

export interface CollapseResult {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  classifications: Classification[]
  /** 被塌掉的目录名（带编号），供日志与排查。 */
  collapsedTitles: string[]
}

/** 判同名的唯一一把尺子：剥编号再归一化。「01 GitHub」与「GitHub」是同一个名字。 */
function baseKey(title: string): string {
  return normalizeName(stripNumberPrefix(title))
}

/**
 * 重排某个父目录下**本批新建**子目录的编号。
 *
 * 父目录已有的、用户自己的子目录不参与：编号是 TidyMark 给自己建的目录加的，
 * 拿它去改用户的目录名等于顺手重命名他没让我们碰的东西。
 */
function renumberChildren(
  newFolders: NewFolderSpec[],
  candidates: CategoryCandidate[],
  parentId: string | null,
  parentTemporaryId: string | null,
): void {
  const siblings = newFolders.filter((f) =>
    parentTemporaryId !== null
      ? f.parentTemporaryId === parentTemporaryId
      : f.parentTemporaryId === null && f.parentId === parentId,
  )
  siblings.forEach((folder, index) => {
    const title = `${String(index + 1).padStart(2, '0')} ${stripNumberPrefix(folder.title)}`
    folder.title = title
    const candidate = candidates.find((c) => c.id === folder.temporaryId)
    if (candidate !== undefined) candidate.path = [...candidate.path.slice(0, -1), title]
  })
}

/**
 * 塌掉「新建目录与它父目录同名」的穿透层。
 *
 * 为什么会出现：core/tree.ts 发射一级目录时只用 findChild(rootId, title) 查
 * **范围根下面的子目录**有没有重名可以复用，从来没跟范围根**自己**的名字比过。
 * 范围根叫「01 GitHub」、又勾了 github 聚合组时，组目录就叫「GitHub」，
 * 于是 `01 GitHub / 01 GitHub / …`。
 *
 * 为什么 core/prune.ts 接不住：它只撤装不满的目录，而这个目录装得满满的。
 *
 * 四条不碰：不在 newFolders 里的目录（用户自己建的，哪怕跟父同名也是他的安排）、
 * 合并模式的容器目录、范围根本身、以及任何书签的实际归属——上提只改目录结构，
 * 书签跟着它原来待的那个目录走。
 *
 * 迭代到不动点：同名可能连着两层，拆完一层还可能新冒出一对。
 */
export function collapseSameNameFolders(input: CollapseInput): CollapseResult {
  let newFolders = input.newFolders.map((f) => ({ ...f }))
  let candidates = input.candidates.map((c) => ({ ...c }))
  const classifications = input.classifications.map((c) => ({ ...c }))
  const titleById = new Map(input.existingFolders.map((f) => [f.id, f.title]))
  const collapsedTitles: string[] = []

  for (;;) {
    const specById = new Map(newFolders.map((f) => [f.temporaryId, f]))
    const parentTitleOf = (folder: NewFolderSpec): string | undefined =>
      folder.parentTemporaryId !== null
        ? specById.get(folder.parentTemporaryId)?.title
        : folder.parentId === null
          ? undefined
          : titleById.get(folder.parentId)

    const victim = newFolders.find((f) => {
      if (f.temporaryId === (input.mergeRootTemporaryId ?? null)) return false
      const parentTitle = parentTitleOf(f)
      return parentTitle !== undefined && baseKey(parentTitle) === baseKey(f.title)
    })
    if (victim === undefined) break

    collapsedTitles.push(victim.title)
    const parentId = victim.parentId
    const parentTemporaryId = victim.parentTemporaryId
    // 上面已确认父目录存在，两者必有其一非 null
    const parentCandidateId = (parentTemporaryId ?? parentId)!

    // 新建目录的子孙必然也是新建目录（复用已有目录只发生在父目录是已有目录时），
    // 所以顺着 parentTemporaryId 就能收全
    const descendants = new Set<string>()
    const collect = (id: string): void => {
      for (const f of newFolders) {
        if (f.parentTemporaryId === id && !descendants.has(f.temporaryId)) {
          descendants.add(f.temporaryId)
          collect(f.temporaryId)
        }
      }
    }
    collect(victim.temporaryId)

    const victimCandidate = candidates.find((c) => c.id === victim.temporaryId)
    const cutAt = victimCandidate === undefined ? -1 : victimCandidate.path.length - 1

    newFolders = newFolders
      .filter((f) => f.temporaryId !== victim.temporaryId)
      .map((f) => (f.parentTemporaryId === victim.temporaryId ? { ...f, parentId, parentTemporaryId } : f))

    for (const classification of classifications) {
      if (classification.targetCategoryId === victim.temporaryId) {
        classification.targetCategoryId = parentCandidateId
      }
    }

    candidates = candidates
      .filter((c) => c.id !== victim.temporaryId)
      .map((c) => {
        if (!descendants.has(c.id) || cutAt < 0) return c
        const path = [...c.path.slice(0, cutAt), ...c.path.slice(cutAt + 1)]
        const inherited =
          victimCandidate?.domainGroup !== undefined && c.domainGroup === undefined
            ? { domainGroup: victimCandidate.domainGroup }
            : {}
        return { ...c, path, ...inherited }
      })

    renumberChildren(newFolders, candidates, parentId, parentTemporaryId)
  }

  return { candidates, newFolders, classifications, collapsedTitles }
}
