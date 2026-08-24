import type { Locale } from './locale'
import { normalizeName, stripNumberPrefix } from './map'
import type { NewFolderSpec } from './plan'
import { MIN_FOLDER_BOOKMARKS } from './prune'
import { FALLBACK_TITLE, MAX_SIBLINGS as PRODUCT_MAX_SIBLINGS } from './tree'
import { MAX_LEAF, SHAPE_MAX_SIBLINGS } from './shape'
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

/**
 * 留守判据的下限：少于这么多条就别再问模型了。
 *
 * 取 2 × MIN_FOLDER_BOOKMARKS 不是拍的——再切一次要站得住，至少得切出两个不会被
 * core/prune.ts 撤掉的子目录，而那需要 2 × MIN_FOLDER_BOOKMARKS 条。低于它触发
 * 相对判据，只是白花一次付费调用（organize-audit-holes 04 票判准 A）。
 */
const MIN_LEFTOVER_TO_SPLIT = MIN_FOLDER_BOOKMARKS * 2

export interface FallbackShare {
  /** 「其他」整个子树装了多少条。 */
  count: number
  /** 范围内书签总数。 */
  total: number
  /** count / total，0–1。 */
  share: number
}

export interface FallbackShareInput {
  candidates: CategoryCandidate[]
  classifications: Classification[]
  locale: Locale
  /** 范围内书签总数。A5 的分母是全库，不是「被分类到某处的书签数」。 */
  total: number
}

/**
 * 量判准 A5：「其他」整个子树占范围内书签总数的比例。
 *
 * **这不是 02 票摘掉的那条豁免又长回来了。** 那条豁免按名字决定「切不切」，已经删干净；
 * 这里按名字决定「量哪个目录」——A5 这条判准本身就是拿「其他」定义的，不认名字就无从量起。
 *
 * 两个要点：
 * - **算整个子树**，不是直属那几条。把「其他」切成 9 个子目录之后 A1 处处通过，
 *   而 69/199 一条没少——A5 量的是覆盖不是形状，切开不该让这个数凭空变小。
 * - **只认一级的「其他」**。A5 问的是「顶层设计有没有覆盖住这个库」，
 *   某个主题目录下面自己带一个「其他」是那个主题内部的事，不在这条判准的射程里。
 *
 * 没有一级的「其他」时返回 null——不是 0，两者含义不同（没建出来 vs 建了但是空的）。
 */
export function measureFallbackShare(input: FallbackShareInput): FallbackShare | null {
  const fallbackKey = normalizeName(FALLBACK_TITLE[input.locale])
  const fallback = input.candidates.find(
    (c) => c.path.length === 1 && normalizeName(stripNumberPrefix(c.path[0] ?? '')) === fallbackKey,
  )
  if (fallback === undefined) return null

  const subtree = new Set(
    input.candidates
      .filter((c) => c.path.length >= 1 && fallback.path.every((segment, i) => c.path[i] === segment))
      .map((c) => c.id),
  )
  let count = 0
  for (const classification of input.classifications) {
    if (classification.targetCategoryId === null) continue
    if (subtree.has(classification.targetCategoryId)) count += 1
  }

  return { count, total: input.total, share: input.total === 0 ? 0 : count / input.total }
}

export interface TopSiblings {
  count: number
  /**
   * 越了哪一档。两档性质不同，报给用户时不能含糊成一句「目录有点多」：
   * - `judgment`：超过判准 A3 的 SHAPE_MAX_SIBLINGS(10)，但产品的建树闸放得过；
   * - `product`：连 core/tree.ts 的 MAX_SIBLINGS(12) 都越了——那是建树阶段的最后兜底，
   *   走到这一步说明这个形状是**验算阶段造出来的**，建树期的闸根本没看见它。
   */
  tier: 'judgment' | 'product'
}

/**
 * 量判准 A3：一级目录有几个。
 *
 * A3 此前**只有设计/建树期的执行点**（core/tree.ts 的截断、core/newTopics.ts 的
 * slice），落成之后没有任何人再数一遍。而 promoteFallbackChildren 恰恰是在验算阶段
 * 改变一级目录数的——不补这一道，提升就是又造一个没人验算的状态，
 * 而那正是 organize-audit-holes 这张图存在的理由（07 票判准 A 的挂钩条件）。
 *
 * 没越线返回 null。
 */
export function measureTopSiblings(candidates: CategoryCandidate[]): TopSiblings | null {
  const count = candidates.filter((c) => c.path.length === 1).length
  if (count > PRODUCT_MAX_SIBLINGS) return { count, tier: 'product' }
  if (count > SHAPE_MAX_SIBLINGS) return { count, tier: 'judgment' }
  return null
}

/** 提升上来的目录的理由，会原样显示在结果页，必须双语，且讲的是「它凭什么直接进一级」。 */
export function promotedReason(locale: Locale, count: number): string {
  return locale === 'zh_CN'
    ? `本来要落进「其他」，但这一族有 ${count} 本书签、自成主题，直接提到一级`
    : `Would have landed in "Other", but this family has ${count} bookmarks and stands on its own, so it was promoted to the top level`
}

export interface PromoteInput {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  classifications: Classification[]
  locale: Locale
}

export interface PromoteResult {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  classifications: Classification[]
  /** 提上来的族，按原顺序。A3 的警告与日志要靠它说数字。 */
  promoted: Array<{ title: string; count: number }>
}

/**
 * 把「其他」切出来的族提升到一级。
 *
 * 为什么需要它：[06 票] 判了**下切不是合并的逆运算**——合并是设计阶段的减法，
 * 下切只能在落成后做嵌套，被挤掉的主题永远找不回一级。而 01 票量到「其他」里
 * 74% 是成建制的主题（量化交易 12 条、AI 编程工具 10 条……），它们本来就该在一级。
 * 提升是目前**唯一不花模型调用就能把主题捞回一级**的手段。
 *
 * 它**不是 A5 的解法**：把 69 条里的族提走之后「其他」仍剩约 10%，擦着红线（07 票判准 A）。
 * A5 的真解法在上游（预算与落位）。这里买到的是**扁平度与主题覆盖**。
 *
 * 代价是一级目录数会涨，可能越过 A3 的两档上限——所以调用方必须同时把 A3
 * 量出来报给用户，否则就是又造一个「产出了状态但没人验算」的洞。
 *
 * 三条约束：
 * - **不合并**。并起来要起名字，起名字要花模型调用，而「零调用」是这条路唯一的卖点；
 *   机械拼接还会撞上产品自己判为缺陷的复合标题（07 票判准 B）。
 * - **装不满 MIN_FOLDER_BOOKMARKS 的族不提**——提上去也是个站不住的一级目录。
 * - **提上来的插在「其他」前面**，让收容所留在最后一位（判准 C）。
 *
 * 必须在 buildPlan **之前**调用：一级编号由 core/plan.ts 的 renumberPlan 按
 * candidates 顺序整体重算（`bareName` 内含 stripNumberPrefix，旧号会被剥掉重给），
 * 放到 buildPlan 之后就会跟编号锚点打架。
 */
export function promoteFallbackChildren(input: PromoteInput): PromoteResult {
  const fallbackKey = normalizeName(FALLBACK_TITLE[input.locale])
  const fallback = input.candidates.find(
    (c) => c.path.length === 1 && normalizeName(stripNumberPrefix(c.path[0] ?? '')) === fallbackKey,
  )
  const noop: PromoteResult = {
    candidates: input.candidates, newFolders: input.newFolders,
    classifications: input.classifications, promoted: [],
  }
  if (fallback === undefined) return noop

  const fallbackSpec = input.newFolders.find((f) => f.temporaryId === fallback.id)
  if (fallbackSpec === undefined) return noop

  const counts = new Map<string, number>()
  for (const classification of input.classifications) {
    const id = classification.targetCategoryId
    if (id === null) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  const risers = input.candidates.filter(
    (c) => c.path.length === 2
      && c.path[0] === fallback.path[0]
      && (counts.get(c.id) ?? 0) >= MIN_FOLDER_BOOKMARKS,
  )
  if (risers.length === 0) return noop

  const riserIds = new Set(risers.map((c) => c.id))
  // 孙目录（及更深）跟着它们的祖先上提同样的一层
  const movedIds = new Set(riserIds)
  const lifted = new Map<string, string[]>()
  for (const candidate of input.candidates) {
    if (candidate.path.length < 2 || candidate.path[0] !== fallback.path[0]) continue
    const owner = risers.find((r) => r.path.every((segment, i) => candidate.path[i] === segment))
    if (owner === undefined) continue
    movedIds.add(candidate.id)
    lifted.set(candidate.id, candidate.path.slice(1))
  }

  const candidates = input.candidates.map(
    (c) => (lifted.has(c.id) ? { ...c, path: lifted.get(c.id)! } : c),
  )
  // 「其他」排到所有提上来的族后面：收容所在真实主题之后才读得通
  const fallbackIndex = candidates.findIndex((c) => c.id === fallback.id)
  const [fallbackEntry] = candidates.splice(fallbackIndex, 1)
  const lastRiser = candidates.reduce(
    (acc, c, i) => (riserIds.has(c.id) ? i : acc), -1,
  )
  candidates.splice(lastRiser + 1, 0, fallbackEntry!)

  const newFolders = input.newFolders.map((f) => (
    riserIds.has(f.temporaryId)
      ? { ...f, parentId: fallbackSpec.parentId, parentTemporaryId: fallbackSpec.parentTemporaryId }
      : f
  ))

  const reasonById = new Map(
    risers.map((r) => [r.id, promotedReason(input.locale, counts.get(r.id) ?? 0)]),
  )
  const classifications = input.classifications.map((c) => {
    const reason = c.targetCategoryId === null ? undefined : reasonById.get(c.targetCategoryId)
    return reason === undefined ? c : { ...c, reason }
  })

  return {
    candidates, newFolders, classifications,
    promoted: risers.map((r) => ({
      title: stripNumberPrefix(r.path.at(-1) ?? ''), count: counts.get(r.id) ?? 0,
    })),
  }
}

export interface OversizedFolder {
  id: string
  /** 目录名，已剥掉编号——讲给用户听时不必带上。 */
  title: string
  count: number
  /** 相对范围根的层级，范围根下第一级是 1。 */
  level: number
  /**
   * 因为哪条判据进的清单。报给用户时两者的说法完全不同，不能共用一句文案：
   * - `capacity`：装超过 maxLeaf 了；
   * - `leftovers`：没超上限，但下面已经分了子目录、这一层还散着比任何子目录都多的书签。
   *   拿「超过建议上限」去报它是说谎——那个数根本没越线。
   */
  kind: 'capacity' | 'leftovers'
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

  const counts = new Map<string, number>()
  for (const classification of input.classifications) {
    const id = classification.targetCategoryId
    if (id === null) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  /** 直属子目录里最大的那个装了多少条；没有子目录时返回 0。 */
  const largestChildCount = (candidate: CategoryCandidate): number => {
    const depth = candidate.path.length
    let max = 0
    for (const other of input.candidates) {
      if (other.path.length !== depth + 1) continue
      if (!candidate.path.every((segment, i) => other.path[i] === segment)) continue
      max = Math.max(max, counts.get(other.id) ?? 0)
    }
    return max
  }

  const found: OversizedFolder[] = []
  for (const candidate of input.candidates) {
    if ((input.scope ?? 'new') === 'new' && !newIds.has(candidate.id)) continue
    if (candidate.path.length >= maxLevel) continue
    const title = stripNumberPrefix(candidate.path.at(-1) ?? '')
    const count = counts.get(candidate.id) ?? 0
    // 两条判据取并集：
    // - 绝对容量：装超过 maxLeaf 就该切，跟有没有子目录无关；
    // - 相对留守：切过一轮之后父目录还留着一摊比任何子目录都大的散书签，那一层照样
    //   「下不去手」（判准 B3）。只看绝对容量会放过它——04 Web工程 切完剩 15 条、
    //   子目录各 3 条，15 曾被判成合格（organize-audit-holes 04 票判准 A）。
    // 相对判据要有下限：再问一次模型至少得能切出两个站得住的子目录，
    // 少于 2 × MIN_FOLDER_BOOKMARKS 条切不出来，触发它只是白花一次调用。
    const largest = largestChildCount(candidate)
    const strandedLeftovers =
      largest > 0 && count > largest && count >= MIN_LEFTOVER_TO_SPLIT
    if (count <= maxLeaf && !strandedLeftovers) continue
    found.push({
      id: candidate.id, title, count, level: candidate.path.length,
      kind: count > maxLeaf ? 'capacity' : 'leftovers',
    })
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
  /**
   * 要下切的目录。可以是本批新建的（`tmp:` 开头），也可以是复用的已有目录
   * （真实书签 id）——推翻模式下 findOversizedFolders 用 scope: 'all' 两种都吐
   * （organize-audit-holes 03 票）。子目录该挂哪个字段由下面的 `tmp:` 前缀判定。
   */
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
  // 判失败的只有「没切出东西」和「唯一那个桶把 mine 整个装走了」两种：后者建出来的子目录
  // 与父目录一模一样，零区分度，只让用户多点一次。
  //
  // 而「一个桶 + 有留守」是**真划分**，从前跟着一起作废是把桶本可以收走的书签一起赔掉——
  // 真实那一遍 04 Web工程 的 15 条留守正是这么来的（organize-audit-holes 04 票判准 B）。
  const mapped = buckets.reduce((sum, b) => sum + b.bookmarkIds.length, 0)
  if (buckets.length === 0 || (buckets.length === 1 && mapped === mine.size)) {
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
    // 复用的已有目录 id 是真实书签 id，挂 parentTemporaryId 的话 engine/apply.ts
    // 会拿它去 tempToReal 里查、查不到就整条计划报「父目录无法解析」。
    // 用的是与 core/structure.ts 同一条 `tmp:` 前缀约定。
    const parentIsNew = input.parent.id.startsWith('tmp:')
    newFolders.push({
      temporaryId,
      parentId: parentIsNew ? null : input.parent.id,
      parentTemporaryId: parentIsNew ? input.parent.id : null,
      title,
    })
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
