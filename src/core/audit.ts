import type { Locale } from './locale'
import { normalizeName, stripNumberPrefix } from './map'
import type { NewFolderSpec } from './plan'
import { MAX_LEAF } from './shape'
import { FALLBACK_TITLE } from './tree'
import type { CategoryCandidate, Classification, TagResult } from './types'

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
 * 范围根叫「01 GitHub」、而设计出来的一级目录里恰好也有一个「GitHub」时，
 * 就成了 `01 GitHub / 01 GitHub / …`。
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
        return { ...c, path }
      })

    renumberChildren(newFolders, candidates, parentId, parentTemporaryId)
  }

  return { candidates, newFolders, classifications, collapsedTitles }
}

/**
 * 目录树最深切到第几层（范围根下第一级算 1）。
 *
 * 为什么是 3：Chrome 的书签菜单每多一层就多一次悬停，三次已经是体验上限。
 * 深过它，「技术上更均衡的树」换来的是用户根本点不到底。
 */
export const MAX_AUDIT_LEVEL = 3

export interface OversizedFolder {
  id: string
  /** 目录名，已剥掉编号——讲给用户听时不必带上。 */
  title: string
  count: number
  /** 相对范围根的层级，范围根下第一级是 1。 */
  level: number
}

export interface OversizedInput {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  classifications: Classification[]
  locale: Locale
  /** 'new'（默认）只看本批新建的目录；'all' 连用户已有目录一起看，用于出警告。 */
  scope?: 'new' | 'all'
  /** 层级 >= 这个值的目录不再进清单。默认 MAX_AUDIT_LEVEL。 */
  maxLevel?: number
  /** 叶子容量上限。默认 MAX_LEAF。 */
  maxLeaf?: number
}

/**
 * 找出装得过满、值得再切一层的目录。
 *
 * 这是判准 A1 唯一真正生效的地方，用的是 core/shape.ts 的 MAX_LEAF(12)。
 * deriveShape 那边看的是另一个数（STRETCH_LEAF，20），它只回答「预测该分几层」，
 * 算的还是平均值——预测故意宽松，宽松能成立的前提正是这里有一道严格验算兜底
 * （两个数为什么分家见 core/shape.ts 与 issues/38-source-vs-topic.md 的 D2）。
 * 模型完全可以把一个主题设计成一个装 60 条的目录，只有数过真实归属才拦得住。
 *
 * 占用按 classifications 数。
 *
 * 已知偏差：数的是**计划**里的归属，不是应用之后书签栏的真实占用。用户在复核页
 * 取消掉一部分移动后，实际落地的目录会比这里量到的小。这个偏差不修——复核页的
 * 取消是用户的决定，不该反过来推翻结构。
 */
export function findOversizedFolders(input: OversizedInput): OversizedFolder[] {
  const maxLevel = input.maxLevel ?? MAX_AUDIT_LEVEL
  const maxLeaf = input.maxLeaf ?? MAX_LEAF
  const newIds = new Set(input.newFolders.map((f) => f.temporaryId))
  const fallbackKey = normalizeName(FALLBACK_TITLE[input.locale])

  const counts = new Map<string, number>()
  for (const classification of input.classifications) {
    const id = classification.targetCategoryId
    if (id === null) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  const found: OversizedFolder[] = []
  for (const candidate of input.candidates) {
    if ((input.scope ?? 'new') === 'new' && !newIds.has(candidate.id)) continue
    if (candidate.path.length >= maxLevel) continue
    const title = stripNumberPrefix(candidate.path.at(-1) ?? '')
    // 「其他」是收容所，没有主题可言，再切一层只是把杂物摊成几堆杂物
    if (candidate.path.length === 1 && normalizeName(title) === fallbackKey) continue
    const count = counts.get(candidate.id) ?? 0
    if (count <= maxLeaf) continue
    found.push({ id: candidate.id, title, count, level: candidate.path.length })
  }

  // 占用大的排前面：一轮里先切最撑的那个，止损判据（最大占用有没有下降）才有意义
  return found.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

/** 下切后的理由会原样显示在结果页，必须双语，且讲的是「为什么被再分一层」。 */
export function deepenReason(locale: Locale, title: string, count: number, maxLeaf: number): string {
  return locale === 'zh_CN'
    ? `「${title}」装了 ${count} 个书签，超过单目录 ${maxLeaf} 个的上限，按主题再分一层`
    : `"${title}" holds ${count} bookmarks, over the per-folder limit of ${maxLeaf}, so it was split by topic`
}

/**
 * 生成不与建树阶段撞号的临时 id。
 *
 * 必须沿用 `tmp:` 前缀：core/structure.ts 用 `startsWith('tmp:')` 判断一个目标
 * 是不是本批新建的目录，换前缀会让结构确认页把新目录当成用户已有的目录。
 */
export function createTemporaryIdFactory(existing: NewFolderSpec[]): () => string {
  let max = 0
  for (const folder of existing) {
    const matched = /^tmp:(\d+)$/.exec(folder.temporaryId)
    if (matched !== null) max = Math.max(max, Number(matched[1]))
  }
  return () => `tmp:${++max}`
}

export interface ExpandInput {
  /** 要下切的目录。必须是本批新建的——findOversizedFolders 默认只吐这一种。 */
  parent: CategoryCandidate
  /**
   * parent 名下书签的标签，primaryTopic 已被 llm/folders.ts 的 applyDesign
   * 改写成子目录名。primaryTopic 归一化后为空（含 NO_TOPIC）表示模型没映射它。
   */
  tags: TagResult[]
  /** 当前全量分类。只有 targetCategoryId === parent.id 的会被改写。 */
  classifications: Classification[]
  nextTemporaryId: () => string
  /** parent 原本装了多少条，写进 reason。 */
  count: number
  maxLeaf: number
  locale: Locale
}

export interface ExpandResult {
  newFolders: NewFolderSpec[]
  candidates: CategoryCandidate[]
  classifications: Classification[]
  /** 真的建出来的子目录数。0 表示这次没能切开。 */
  createdCount: number
}

/**
 * 把一个撑爆的目录按标签切成子目录。
 *
 * 这一步**不花钱**：llm/folders.ts 的 FolderDesign.mapping 是「标签 → 目录路径」，
 * applyDesign 是纯函数，把书签分进设计好的子目录不需要再问一次模型。调用方只花
 * 一次 designFolders。
 *
 * 两条与 core/tree.ts 对齐的语义：
 * - 没被映射到的书签**留在父目录里**平铺，与组根的 ownBookmarkIds 是同一个行为；
 * - 只切得出一个子目录就整个放弃。那一层不承载任何区分度，建出来只是让用户多点一次。
 */
export function expandFolder(input: ExpandInput): ExpandResult {
  const mine = new Set(
    input.classifications.filter((c) => c.targetCategoryId === input.parent.id).map((c) => c.bookmarkId),
  )

  const byTopic = new Map<string, { title: string; bookmarkIds: string[] }>()
  for (const tag of input.tags) {
    if (!mine.has(tag.bookmarkId)) continue
    const key = normalizeName(tag.primaryTopic)
    if (key === '') continue
    const bucket = byTopic.get(key) ?? { title: tag.primaryTopic, bookmarkIds: [] }
    bucket.bookmarkIds.push(tag.bookmarkId)
    byTopic.set(key, bucket)
  }

  const buckets = [...byTopic.values()].sort((a, b) => b.bookmarkIds.length - a.bookmarkIds.length)
  if (buckets.length < 2) {
    return { newFolders: [], candidates: [], classifications: input.classifications, createdCount: 0 }
  }

  const parentTitle = stripNumberPrefix(input.parent.path.at(-1) ?? '')
  const reason = deepenReason(input.locale, parentTitle, input.count, input.maxLeaf)
  const newFolders: NewFolderSpec[] = []
  const candidates: CategoryCandidate[] = []
  const targetByBookmark = new Map<string, string>()

  buckets.forEach((bucket, index) => {
    const title = `${String(index + 1).padStart(2, '0')} ${bucket.title}`
    const temporaryId = input.nextTemporaryId()
    newFolders.push({ temporaryId, parentId: null, parentTemporaryId: input.parent.id, title })
    candidates.push({ id: temporaryId, path: [...input.parent.path, title] })
    for (const bookmarkId of bucket.bookmarkIds) targetByBookmark.set(bookmarkId, temporaryId)
  })

  const classifications = input.classifications.map((c) => {
    const target = targetByBookmark.get(c.bookmarkId)
    if (target === undefined || c.targetCategoryId !== input.parent.id) return c
    return { ...c, targetCategoryId: target, reason }
  })

  return { newFolders, candidates, classifications, createdCount: newFolders.length }
}
