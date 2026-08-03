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

/**
 * 按「真正会落地的目录」重新连续编号。
 *
 * 编号是建树阶段按主题统计分配的，但目录只有收到书签才会被创建：
 * 分类模型没往某个目录放书签、或用户没勾选那些建议时，这个目录不会出现，
 * 它占用的号码就会变成空号（01、02、04…）。这里在应用前重排一遍。
 *
 * 只对推翻模式生效——非推翻模式的目录名是用户自己的，不该改动。
 */
export function renumberPlan(plan: OrganizePlan, accepted: Set<string>): OrganizePlan {
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

  const renumbered = new Map<string, string[]>()
  let topIndex = 0
  for (const candidate of plan.candidates) {
    if (candidate.path.length !== 1 || !used.has(candidate.id)) continue
    topIndex++
    const prefix = String(topIndex).padStart(2, '0')
    const title = `${prefix} ${stripNumberPrefix(candidate.path[0]!)}`
    renumbered.set(candidate.id, [title])

    let childIndex = 0
    for (const child of plan.candidates) {
      if (child.path.length !== 2 || child.path[0] !== candidate.path[0] || !used.has(child.id)) continue
      childIndex++
      renumbered.set(child.id, [title, `${prefix}.${childIndex} ${stripNumberPrefix(child.path[1]!)}`])
    }
  }

  const leaf = (id: string): string | null => renumbered.get(id)?.at(-1) ?? null
  // 没派上用场的目录不该顶着一个不会存在的号码，显示裸名字
  const pathFor = (candidate: CategoryCandidate): string[] =>
    renumbered.get(candidate.id) ?? candidate.path.map(stripNumberPrefix)

  const operations = plan.operations.flatMap((operation): BookmarkOperation[] => {
    if (operation.type === 'create_folder') {
      const title = leaf(operation.temporaryId)
      return title === null ? [operation] : [{ ...operation, title }]
    }
    if (operation.type === 'rename_folder') {
      const title = leaf(operation.folderId)
      // 这个目录本次没派上用场，就别改人家的名字
      return title === null ? [] : [{ ...operation, newTitle: title }]
    }
    return [operation]
  })

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
