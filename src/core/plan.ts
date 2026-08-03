import type {
  BookmarkItem, BookmarkOperation, CategoryCandidate, Classification,
  OrganizePlan, PlanRow, PlanSummary,
} from './types'

export const LOW_CONFIDENCE = 0.7

export interface NewFolderSpec {
  temporaryId: string
  /** 挂在已存在的文件夹下时填写；挂在同批新建的文件夹下时为 null。 */
  parentId: string | null
  parentTemporaryId: string | null
  title: string
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

  const operations = [...createOps, ...moveOps]
  const plan: OrganizePlan = {
    id: input.id,
    createdAt: input.createdAt,
    scopeRootIds: input.scopeRootIds,
    rebuildStructure: input.rebuildStructure,
    candidates: input.candidates,
    operations,
    rows,
    summary: {
      totalBookmarks: 0, movedBookmarks: 0, unchangedBookmarks: 0,
      createdFolders: 0, renamedFolders: 0, lowConfidenceItems: 0,
    },
  }
  plan.summary = summarize(plan, new Set(rows.map((r) => r.bookmarkId)), input.items.length)
  return plan
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
