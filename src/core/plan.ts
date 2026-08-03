import { stripNumberPrefix } from './map'
import type {
  BookmarkItem, BookmarkOperation, CategoryCandidate, Classification,
  OrganizePlan, PlanRow, PlanSummary, TagResult,
} from './types'

export const LOW_CONFIDENCE = 0.7

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

  const moveOps: BookmarkOperation[] = []
  const rows: PlanRow[] = []

  for (const item of input.items) {
    const classification = byId.get(item.id)
    if (!classification?.targetCategoryId) continue
    const target = candidateById.get(classification.targetCategoryId)
    if (!target) continue
    // 已经在目标目录里，无需移动
    if (item.parentId === classification.targetCategoryId) continue

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
      toPath: target.path,
      confidence: classification.confidence,
      reason: classification.reason,
    })
  }

  const operations = [...createOps, ...renameOps, ...moveOps]
  const plan: OrganizePlan = {
    id: input.id,
    createdAt: input.createdAt,
    scopeRootIds: input.scopeRootIds,
    rebuildStructure: input.rebuildStructure,
    candidates: input.candidates,
    operations,
    rows,
    warnings: input.warnings ?? [],
    tags: input.tags ?? [],
    summary: {
      totalBookmarks: 0, movedBookmarks: 0, unchangedBookmarks: 0,
      createdFolders: 0, renamedFolders: 0, lowConfidenceItems: 0,
    },
  }
  plan.summary = summarize(plan, new Set(rows.map((r) => r.bookmarkId)), input.items.length)
  return plan
}

/** 重排时需要知道范围内每个目录当前的真实名字与父子关系。FolderItem 可以直接传入。 */
export interface ScopeFolder {
  id: string
  parentId: string | null
  title: string
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
 * 传入 scopeFolders 时，上一轮整理留下、本轮没被设计到的编号目录也一起参与重排。
 * 不然它们会顶着旧号码留在原地，和本轮的新号撞车（04 金融 与 04 其他并存）。
 * 判定只看目录名有没有编号前缀：没编号的目录是用户自己建的，一律不动。
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

  const used = new Set<string>()
  const targetOf = new Map<string, string>()
  for (const operation of plan.operations) {
    if (operation.type !== 'move_bookmark' || !accepted.has(operation.bookmarkId)) continue
    used.add(operation.toCategoryId)
    targetOf.set(operation.bookmarkId, operation.toCategoryId)
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
  const rootIds = new Set(plan.scopeRootIds)

  /** 目录此刻在书签栏里的真实名字。改名操作里的 oldTitle 最准，其次是扫描结果。 */
  const currentTitle = (id: string): string =>
    renameByFolderId.get(id)?.oldTitle ?? folderById.get(id)?.title ?? byId.get(id)?.path.at(-1) ?? ''

  /** 重排后要保留的名字（不含编号）。候选目录用本轮设计的名字，其余用它现在的名字。 */
  const bareName = (id: string): string =>
    stripNumberPrefix(byId.get(id)?.path.at(-1) ?? folderById.get(id)?.title ?? '')

  // 本轮没收到书签、但已经带着上一轮编号的真实目录也要重排，否则会和新号撞车
  const participates = (id: string): boolean =>
    used.has(id) || (!newFolderIds.has(id) && hasNumberPrefix(currentTitle(id)))

  /** 本轮没进候选、但带着旧编号的遗留目录，接在设计好的目录后面。 */
  const strays = (isChildOf: (folder: ScopeFolder) => boolean): string[] =>
    scopeFolders
      .filter((f) => !candidateIds.has(f.id) && !rootIds.has(f.id) && isChildOf(f) && hasNumberPrefix(f.title))
      .map((f) => f.id)

  const renumbered = new Map<string, string[]>()
  const topIds = [
    ...plan.candidates.filter((c) => c.path.length === 1 && participates(c.id)).map((c) => c.id),
    ...strays((f) => f.parentId !== null && rootIds.has(f.parentId)),
  ]

  topIds.forEach((topId, index) => {
    const title = `${String(index + 1).padStart(2, '0')} ${bareName(topId)}`
    renumbered.set(topId, [title])

    const designedPath = byId.get(topId)?.path[0]
    const childIds = [
      ...plan.candidates
        .filter((c) => c.path.length === 2 && c.path[0] === designedPath && participates(c.id))
        .map((c) => c.id),
      ...strays((f) => f.parentId === topId),
    ]
    childIds.forEach((childId, childIndex) => {
      const childTitle = `${String(childIndex + 1).padStart(2, '0')} ${bareName(childId)}`
      renumbered.set(childId, [title, childTitle])
    })
  })

  const leaf = (id: string): string | null => renumbered.get(id)?.at(-1) ?? null
  // 没派上用场的目录不该顶着一个不会存在的号码，显示裸名字
  const pathFor = (candidate: CategoryCandidate): string[] =>
    renumbered.get(candidate.id) ?? candidate.path.map(stripNumberPrefix)

  // 改名操作按重排结果重新生成：既有的可能号码变了，遗留目录则本来就没有改名操作
  const renameOps: BookmarkOperation[] = []
  for (const [id, path] of renumbered) {
    if (newFolderIds.has(id)) continue // 新建目录的名字写在 create_folder 里
    const oldTitle = currentTitle(id)
    const newTitle = path.at(-1)!
    if (oldTitle === newTitle) continue
    renameOps.push({ type: 'rename_folder', folderId: id, oldTitle, newTitle })
  }

  const operations: BookmarkOperation[] = [
    ...plan.operations.flatMap((operation): BookmarkOperation[] => {
      if (operation.type !== 'create_folder') return []
      const title = leaf(operation.temporaryId)
      return title === null ? [operation] : [{ ...operation, title }]
    }),
    ...renameOps,
    ...plan.operations.filter((o) => o.type === 'move_bookmark'),
  ]

  return {
    ...plan,
    operations,
    candidates: plan.candidates.map((c) => ({ ...c, path: pathFor(c) })),
    rows: plan.rows.map((row) => {
      const path = row.toPath.map(stripNumberPrefix)
      const numbered = renumbered.get(targetOf.get(row.bookmarkId) ?? '')
      return { ...row, toPath: numbered ?? path }
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
    lowConfidenceItems: plan.rows.filter(
      (r) => accepted.has(r.bookmarkId) && r.confidence < LOW_CONFIDENCE,
    ).length,
  }
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
  const renames = plan.operations.filter((o) => o.type === 'rename_folder')
  return [...keptCreates, ...renames, ...moves]
}
