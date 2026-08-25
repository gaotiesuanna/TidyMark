import { stripNumberPrefix } from './map'
import type { TitleRewrite } from './titles'
import type {
  BookmarkItem, BookmarkOperation, CategoryCandidate, Classification,
  OrganizePlan, PlanRow, PlanSummary, TagResult, UnchangedRow,
} from './types'

/**
 * 标记「低置信度」用的阈值——只用来在复核页打个提醒标签，不再决定默认勾不勾选
 * （那部分行为改动留给后面的任务）。
 *
 * 原先是 0.7，但真实那一轮 110 条书签里低于它的只有 1 条，形同虚设；
 * 提到 0.85 能标出 18 条（16%），才是个用户审得完的量。
 */
export const MARK_CONFIDENCE = 0.85

export interface NewFolderSpec {
  temporaryId: string
  /** 挂在已存在的文件夹下时填写；挂在同批新建的文件夹下时为 null。 */
  parentId: string | null
  parentTemporaryId: string | null
  title: string
}

/** 复用已有目录时，把它改名成带编号的新名字。 */
export interface RenameFolderSpec {
  folderId: string
  oldTitle: string
  newTitle: string
}

export interface BuildPlanInput {
  id: string
  createdAt: number
  scopeRootIds: string[]
  rebuildStructure: boolean
  items: BookmarkItem[]
  candidates: CategoryCandidate[]
  classifications: Classification[]
  newFolders: NewFolderSpec[]
  renameFolders?: RenameFolderSpec[]
  warnings?: string[]
  tags?: TagResult[]
  /** 合并模式：所有新目录挂在这个本批新建的容器目录下。 */
  mergeRoot?: NonNullable<OrganizePlan['mergeRoot']>
  /** GitHub 标题统一，与移动无关，由设置开关决定是否传入。 */
  titleRewrites?: TitleRewrite[]
}

export function buildPlan(input: BuildPlanInput): OrganizePlan {
  const byId = new Map(input.classifications.map((c) => [c.bookmarkId, c]))
  const candidateById = new Map(input.candidates.map((c) => [c.id, c]))
  const newFolderIds = new Set(input.newFolders.map((f) => f.temporaryId))

  const createOps: BookmarkOperation[] = input.newFolders.map((f) => ({
    type: 'create_folder',
    temporaryId: f.temporaryId,
    parentId: f.parentId,
    parentTemporaryId: f.parentTemporaryId,
    title: f.title,
  }))

  const renameOps: BookmarkOperation[] = (input.renameFolders ?? []).map((f) => ({
    type: 'rename_folder',
    folderId: f.folderId,
    oldTitle: f.oldTitle,
    newTitle: f.newTitle,
  }))

  const renameBookmarkOps: BookmarkOperation[] = (input.titleRewrites ?? []).map((r) => ({
    type: 'rename_bookmark',
    bookmarkId: r.bookmarkId,
    oldTitle: r.oldTitle,
    newTitle: r.newTitle,
  }))

  const moveOps: BookmarkOperation[] = []
  const rows: PlanRow[] = []
  const unchanged: UnchangedRow[] = []

  /** 记一条未变动的书签，三类原因共用同一副骨架。 */
  const markUnchanged = (item: BookmarkItem, kind: UnchangedRow['kind'], reason: string): void => {
    unchanged.push({
      bookmarkId: item.id, title: item.title, url: item.url, currentPath: item.currentPath,
      kind, reason,
    })
  }

  // 合并把书签移出了它原来的顶层目录，只显示范围根内的相对路径看不出东西去了哪
  const prefix = input.mergeRoot === undefined ? [] : [input.mergeRoot.title]

  for (const item of input.items) {
    const classification = byId.get(item.id)

    // 压根没被分类到，或分类阶段本身就失败了——这次没盖到它
    if (classification === undefined || classification.source === 'none') {
      markUnchanged(item, 'failed', classification?.reason ?? '')
      continue
    }

    // 模型判「无合适目录」，或它给的目录在候选里根本查不到
    if (classification.targetCategoryId === null) {
      markUnchanged(item, 'noTarget', classification.reason)
      continue
    }
    const target = candidateById.get(classification.targetCategoryId)
    if (!target) {
      markUnchanged(item, 'noTarget', classification.reason)
      continue
    }

    // 已经在目标目录里，无需移动
    if (item.parentId === classification.targetCategoryId) {
      markUnchanged(item, 'inPlace', '')
      continue
    }

    const isTemporary = newFolderIds.has(classification.targetCategoryId)
    moveOps.push({
      type: 'move_bookmark',
      bookmarkId: item.id,
      fromParentId: item.parentId,
      originalIndex: item.index,
      toCategoryId: classification.targetCategoryId,
      toTemporaryId: isTemporary ? classification.targetCategoryId : null,
      confidence: classification.confidence,
      reason: classification.reason,
    })
    rows.push({
      bookmarkId: item.id,
      title: item.title,
      url: item.url,
      fromPath: item.currentPath,
      toPath: [...prefix, ...target.path],
      toCategoryId: classification.targetCategoryId,
      confidence: classification.confidence,
      reason: classification.reason,
      source: classification.source,
    })
  }

  const operations = [...createOps, ...renameOps, ...renameBookmarkOps, ...moveOps]
  const plan: OrganizePlan = {
    id: input.id,
    createdAt: input.createdAt,
    scopeRootIds: input.scopeRootIds,
    rebuildStructure: input.rebuildStructure,
    candidates: input.candidates,
    operations,
    rows,
    unchanged,
    warnings: input.warnings ?? [],
    tags: input.tags ?? [],
    mergeRoot: input.mergeRoot ?? null,
    summary: {
      totalBookmarks: 0, movedBookmarks: 0, unchangedBookmarks: 0,
      createdFolders: 0, renamedFolders: 0, renamedBookmarks: 0, lowConfidenceItems: 0,
    },
  }
  plan.summary = summarize(plan, new Set(rows.map((r) => r.bookmarkId)), input.items.length)
  return plan
}

/** 重排时需要知道范围内每个目录当前的真实名字、父子关系与层级。FolderItem 可以直接传入。 */
export interface ScopeFolder {
  id: string
  parentId: string | null
  title: string
  /**
   * 相对扫描根的深度，扫描根为 0、一级目录为 1。
   *
   * 层级只能靠它判断，不能靠 scopeRootIds——勾选界面是级联的，
   * 那个数组里装着范围内几乎所有目录，拿它当「根」会把一切都当成根。
   */
  depth: number
}

/**
 * 目录名是否带着 TidyMark 编的号。
 * 与 stripNumberPrefix 用同一个模式，保证「判定带号」与「去掉号」永远一致。
 */
function hasNumberPrefix(title: string): boolean {
  return stripNumberPrefix(title) !== title
}

/**
 * 按「真正会落地的目录」重新连续编号。
 *
 * 编号是建树阶段按主题统计分配的，但目录只有收到书签才会被创建：
 * 分类模型没往某个目录放书签、或用户没勾选那些建议时，这个目录不会出现，
 * 它占用的号码就会变成空号（01、02、04…）。这里在应用前重排一遍。
 *
 * 传入 scopeFolders 时，上一轮整理留下、本轮没被设计到的目录会接着本轮
 * 设计目录的最大号往后编——剥成裸名会在书签栏里留下没编号的目录。
 * 剥掉旧号再编，避免和本轮 01..N 撞车。名字本身以数字开头的不剥不编。
 *
 * 只对推翻模式生效——非推翻模式的目录名是用户自己的，不该改动。
 */
export function renumberPlan(
  plan: OrganizePlan,
  accepted: Set<string>,
  scopeFolders: ScopeFolder[] = [],
): OrganizePlan {
  if (!plan.rebuildStructure) return plan

  const byId = new Map(plan.candidates.map((c) => [c.id, c]))
  const topByTitle = new Map<string, CategoryCandidate>()
  for (const candidate of plan.candidates) {
    if (candidate.path.length === 1) topByTitle.set(candidate.path[0]!, candidate)
  }

  // 两者有意不同源，别再合回一个循环：
  // targetOf 决定「这一行显示什么路径」，登记全部移动——取消勾选一行，
  // 不该让它的目标目录编号凭空消失，那个目录还会因为别的行被建出来。
  // used 决定「哪些目录会被创建、参与编号」，只认已接受的——
  // 一个书签都没收到的目录根本不会被建出来，不该占号。
  // 两者一起作用的结果：目录真的不会被创建时，targetOf 查到的 id 不在 renumbered 里，
  // 那一行自然退回裸名字，此时不带号才是诚实的。
  const used = new Set<string>()
  const targetOf = new Map<string, string>()
  for (const operation of plan.operations) {
    if (operation.type !== 'move_bookmark') continue
    targetOf.set(operation.bookmarkId, operation.toCategoryId)
    if (!accepted.has(operation.bookmarkId)) continue
    used.add(operation.toCategoryId)
  }
  // 子目录被用到时，它的父目录也必须保留
  for (const id of [...used]) {
    const candidate = byId.get(id)
    if (candidate === undefined || candidate.path.length < 2) continue
    const parent = topByTitle.get(candidate.path[0]!)
    if (parent !== undefined) used.add(parent.id)
  }

  const newFolderIds = new Set(
    plan.operations.flatMap((o) => (o.type === 'create_folder' ? [o.temporaryId] : [])),
  )
  const renameByFolderId = new Map(
    plan.operations.flatMap((o) => (o.type === 'rename_folder' ? [[o.folderId, o] as const] : [])),
  )
  const folderById = new Map(scopeFolders.map((f) => [f.id, f]))
  const candidateIds = new Set(plan.candidates.map((c) => c.id))

  /** 目录此刻在书签栏里的真实名字。改名操作里的 oldTitle 最准，其次是扫描结果。 */
  const currentTitle = (id: string): string =>
    renameByFolderId.get(id)?.oldTitle ?? folderById.get(id)?.title ?? byId.get(id)?.path.at(-1) ?? ''

  /** 重排后要保留的名字（不含编号）。参与编号的只有候选目录，用的就是本轮设计的名字。 */
  const bareName = (id: string): string => stripNumberPrefix(byId.get(id)?.path.at(-1) ?? '')

  /**
   * 本轮设计里的一级目录一律编号，包括一个书签都没移入的已有目录。
   * 二级只重排已经带编号的——用户在某个目录下自己整理的子目录保持原样。
   * 两级都排除本轮新建但没收到书签的目录，它们根本不会被创建，不该占号。
   *
   * 只管候选目录：没进本轮设计的目录不占设计号段，改由 strayIds 那一段接着往后编。
   */
  const participates = (id: string, topLevel: boolean): boolean =>
    used.has(id) || (!newFolderIds.has(id) && (topLevel || hasNumberPrefix(currentTitle(id))))

  /**
   * 上一轮留下、本轮没进候选的已有目录。它们不占设计号段，接着本层最大号往后编。
   *
   * 扫描根（depth 0）不碰——它头上的号属于它的父层，不归本轮管。
   * 更深的目录也编：落地后不应再出现没编号的目录。
   *
   * 合并模式例外：范围内的旧目录正是即将被清空删除的源目录子树，
   * 给它们改名毫无意义，还会让 summary.renamedFolders 虚高。
   */
  const strayIds: string[] =
    plan.mergeRoot !== null
      ? []
      : scopeFolders
          .filter((f) => !candidateIds.has(f.id) && f.depth >= 1)
          .map((f) => f.id)

  const renumbered = new Map<string, string[]>()
  const topIds = plan.candidates
    .filter((c) => c.path.length === 1 && participates(c.id, true))
    .map((c) => c.id)

  topIds.forEach((topId, index) => {
    const title = `${String(index + 1).padStart(2, '0')} ${bareName(topId)}`
    renumbered.set(topId, [title])

    const designedPath = byId.get(topId)?.path[0]
    const childIds = plan.candidates
      .filter((c) => c.path.length === 2 && c.path[0] === designedPath && participates(c.id, false))
      .map((c) => c.id)
    childIds.forEach((childId, childIndex) => {
      const childTitle = `${String(childIndex + 1).padStart(2, '0')} ${bareName(childId)}`
      renumbered.set(childId, [title, childTitle])
    })
  })

  const leaf = (id: string): string | null => renumbered.get(id)?.at(-1) ?? null
  // 没派上用场的目录不该顶着一个不会存在的号码，显示裸名字
  const pathFor = (candidate: CategoryCandidate): string[] =>
    renumbered.get(candidate.id) ?? candidate.path.map(stripNumberPrefix)

  // 改名操作按重排结果重新生成：既有目录的号码可能变了
  const renameOps: BookmarkOperation[] = []
  for (const [id, path] of renumbered) {
    if (newFolderIds.has(id)) continue // 新建目录的名字写在 create_folder 里
    const oldTitle = currentTitle(id)
    const newTitle = path.at(-1)!
    if (oldTitle === newTitle) continue
    renameOps.push({ type: 'rename_folder', folderId: id, oldTitle, newTitle })
  }

  // 保底：没进本轮设计的目录也给号，接着该层设计目录的最大号往后编。
  // 先剥旧号再编，避免和本轮 01..N 撞车。名字本身以数字开头的不剥不编。
  const createdByTempId = new Map(
    plan.operations.flatMap((o) => (o.type === 'create_folder' ? [[o.temporaryId, o] as const] : [])),
  )
  const parentOf = (id: string): string | null => {
    const existing = folderById.get(id)
    if (existing !== undefined) return existing.parentId
    const created = createdByTempId.get(id)
    if (created === undefined) return null
    return created.parentTemporaryId ?? created.parentId
  }
  const designedCountByParent = new Map<string, number>()
  for (const id of renumbered.keys()) {
    const parentId = parentOf(id)
    if (parentId === null) continue
    designedCountByParent.set(parentId, (designedCountByParent.get(parentId) ?? 0) + 1)
  }
  const strayByParent = new Map<string, string[]>()
  for (const id of strayIds) {
    const parentId = folderById.get(id)?.parentId
    if (parentId === null || parentId === undefined) continue
    const group = strayByParent.get(parentId) ?? []
    group.push(id)
    strayByParent.set(parentId, group)
  }
  for (const [parentId, ids] of strayByParent) {
    let next = (designedCountByParent.get(parentId) ?? 0) + 1
    for (const id of ids) {
      const oldTitle = currentTitle(id)
      const bare = stripNumberPrefix(oldTitle)
      if (hasNumberPrefix(bare)) continue
      const newTitle = `${String(next).padStart(2, '0')} ${bare}`
      next++
      if (oldTitle !== newTitle) {
        renameOps.push({ type: 'rename_folder', folderId: id, oldTitle, newTitle })
      }
    }
  }

  const operations: BookmarkOperation[] = [
    ...plan.operations.flatMap((operation): BookmarkOperation[] => {
      if (operation.type !== 'create_folder') return []
      const title = leaf(operation.temporaryId)
      return title === null ? [operation] : [{ ...operation, title }]
    }),
    ...renameOps,
    // 标题改写与编号无关，原样保留
    ...plan.operations.filter((o) => o.type === 'rename_bookmark'),
    ...plan.operations.filter((o) => o.type === 'move_bookmark'),
  ]

  return {
    ...plan,
    operations,
    candidates: plan.candidates.map((c) => ({ ...c, path: pathFor(c) })),
    rows: plan.rows.map((row) => {
      const path = row.toPath.map(stripNumberPrefix)
      const numbered = renumbered.get(targetOf.get(row.bookmarkId) ?? '')
      if (numbered === undefined) return { ...row, toPath: path }
      // renumbered 里是 candidate 的相对路径，不补前缀会把合并根冲掉
      const prefix = plan.mergeRoot === null ? [] : [plan.mergeRoot.title]
      return { ...row, toPath: [...prefix, ...numbered] }
    }),
  }
}

export function summarize(
  plan: OrganizePlan,
  accepted: Set<string>,
  totalBookmarks?: number,
): PlanSummary {
  const acceptedOps = filterAccepted(plan, accepted)
  const moved = acceptedOps.filter((o) => o.type === 'move_bookmark').length
  const total = totalBookmarks ?? plan.summary.totalBookmarks
  return {
    totalBookmarks: total,
    movedBookmarks: moved,
    unchangedBookmarks: total - moved,
    createdFolders: acceptedOps.filter((o) => o.type === 'create_folder').length,
    renamedFolders: acceptedOps.filter((o) => o.type === 'rename_folder').length,
    renamedBookmarks: acceptedOps.filter((o) => o.type === 'rename_bookmark').length,
    lowConfidenceItems: plan.rows.filter(
      (r) => accepted.has(r.bookmarkId) && r.confidence < MARK_CONFIDENCE,
    ).length,
  }
}

/**
 * 把一条建议改投到另一个目录。
 *
 * 复核页此前对一条不满意的建议只能「拒绝」，而拒绝等于书签留在原地——按根尺子那是**最差的结果**
 * （见 issues/06-review-at-scale.md「决定 3」）。有了这个，一次拒绝可以变成一次修正。
 *
 * 纯函数：行与移动操作一起改，两处不能只改一处，否则界面显示的去处与真正会写进书签栏的不一致。
 * 目标不在候选里、或这条书签不在方案里时**原样返回同一个对象**，调用方可以用引用相等判断有没有变。
 */
export function retargetRow(plan: OrganizePlan, bookmarkId: string, targetId: string): OrganizePlan {
  const target = plan.candidates.find((c) => c.id === targetId)
  if (target === undefined) return plan
  if (!plan.rows.some((r) => r.bookmarkId === bookmarkId)) return plan

  // 本轮新建的目录才有临时 id；改投到已有目录时它必须是 null，否则 apply 会去找一个不存在的新建记录
  const isTemporary = plan.operations.some(
    (o) => o.type === 'create_folder' && o.temporaryId === targetId,
  )
  // 与 buildPlan、applyStructureEdits 两处写 toPath 保持一致：合并模式下要带合并根前缀，
  // 否则界面显示的路径会跟同一份列表里别的行（都带着前缀）对不上，还会因此自成一组
  const prefix = plan.mergeRoot === null ? [] : [plan.mergeRoot.title]

  return {
    ...plan,
    rows: plan.rows.map((r) =>
      r.bookmarkId === bookmarkId ? { ...r, toPath: [...prefix, ...target.path], toCategoryId: targetId } : r,
    ),
    operations: plan.operations.map((o) =>
      o.type === 'move_bookmark' && o.bookmarkId === bookmarkId
        ? { ...o, toCategoryId: targetId, toTemporaryId: isTemporary ? targetId : null }
        : o,
    ),
  }
}

/**
 * 路径拼 key 的分隔符用 U+0000：目录名里 '/' 与空格都可能出现，
 * 拿它们当分隔符时 ['A/B'] 与 ['A', 'B'] 会拼出同一个 key，两个不同的目录就撞成一个。
 *
 * 但分隔符只是这里次要的那一半威胁。**主要威胁是不同父目录下的同名目录**：
 * 这些路径都是相对各自扫描根的，勾了「书签栏」与「其他书签」两个范围根时，
 * 两边各自的「工作」相对路径都是 `['工作']`，换什么分隔符都挡不住——真要认准身份
 * 得按 id 认（`scan.ts` 数重名目录、`9f3f4e5` 的复核页分组都是这么做的），
 * 而 PlanRow / UnchangedRow 现在还没带父目录 id。已开票 29 跟进：
 * 那个错法是漏说（该提示时没提示），与本函数「宁可少说，不可乱说」的取向一致。
 */
function pathKey(path: string[]): string {
  return path.join('\u0000')
}

/**
 * 取消勾选这条建议，会不会成为「那个原目录活下来」的唯一原因。
 *
 * 票 15 接受残留（不去挪用户明确拒绝移动的书签），但用户有权知道后果。
 * 只在「最后一个留守者」时为真：原目录里还有别的书签不走时，那个目录本来就会活下来，
 * 这时提示纯属噪音——取消勾选并不是它活下来的原因。
 *
 * 判定不看 bookmarkId 自己在不在 accepted 里：调用方问的是「（再）取消它会怎样」，
 * 勾着问和取消之后问得到同一个答案。
 *
 * **已知边界**：只看书签，不看子目录。原目录若还有子目录，它同样会活下来，
 * 而这里不提示——宁可少说，不可乱说。
 */
export function wouldStrandFolder(
  plan: OrganizePlan,
  accepted: Set<string>,
  bookmarkId: string,
): boolean {
  const row = plan.rows.find((r) => r.bookmarkId === bookmarkId)
  if (row === undefined) return false

  // 书签就散在扫描根下面时什么都不说。fromPath[0] 永远是扫描根自己的名字
  // （scan.ts 是 `walk(root, [], 0)` 起步、进子目录才 `[...path, node.title]`），
  // 所以长度 1 就等于「它的原目录就是扫描根」。而非合并模式下 applyPlan 给
  // removeEmpty 的 removableRootIds 是空数组，扫描根一定不会被删——本轮新建的目录
  // 还挂在它下面呢。这时说「不移动它就会保留目录『书签栏』」是乱说，不是少说。
  // 合并模式是例外：源根本来就要被搬空删掉，那时这句话是真的。
  if (row.fromPath.length <= 1 && plan.mergeRoot === null) return false

  const from = pathKey(row.fromPath)

  // 本轮压根不会动的书签就在这个目录里
  if (plan.unchanged.some((u) => pathKey(u.currentPath) === from)) return false
  // 同一个原目录里另有一条建议也没被勾选——留下这个目录的不止这一条
  return !plan.rows.some(
    (r) => r.bookmarkId !== bookmarkId && pathKey(r.fromPath) === from && !accepted.has(r.bookmarkId),
  )
}

/**
 * 保留被接受的 move，以及这些 move 真正需要的 create_folder（含其祖先链）。
 * 顺序保证 create_folder 先于 move，且父文件夹先于子文件夹。
 */
export function filterAccepted(plan: OrganizePlan, accepted: Set<string>): BookmarkOperation[] {
  const moves = plan.operations.filter(
    (o): o is Extract<BookmarkOperation, { type: 'move_bookmark' }> =>
      o.type === 'move_bookmark' && accepted.has(o.bookmarkId),
  )
  const creates = plan.operations.filter(
    (o): o is Extract<BookmarkOperation, { type: 'create_folder' }> => o.type === 'create_folder',
  )
  const createByTempId = new Map(creates.map((c) => [c.temporaryId, c]))

  const needed = new Set<string>()
  for (const move of moves) {
    let cursor = move.toTemporaryId
    while (cursor !== null && !needed.has(cursor)) {
      needed.add(cursor)
      cursor = createByTempId.get(cursor)?.parentTemporaryId ?? null
    }
  }

  const keptCreates = creates.filter((c) => needed.has(c.temporaryId))
  // 标题改写是设置开关的结果，与「是否接受某条移动建议」无关，一律保留
  const renames = plan.operations.filter(
    (o) => o.type === 'rename_folder' || o.type === 'rename_bookmark',
  )
  return [...keptCreates, ...renames, ...moves]
}
