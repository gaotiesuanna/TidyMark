import type { Locale } from './locale'
import { normalizeName, stripNumberPrefix } from './map'
import { summarize } from './plan'
import { FALLBACK_TITLE } from './tree'
import type { BookmarkOperation, CategoryCandidate, OrganizePlan, PlanRow } from './types'

export interface StructureEdits {
  /** candidate id → 用户输入的新名字，不含编号前缀。 */
  renames: Record<string, string>
  /** 被删掉的 candidate id。 */
  removed: string[]
}

export const EMPTY_EDITS: StructureEdits = { renames: {}, removed: [] }

/** 结构确认页渲染用的两层视图。 */
export interface StructureNode {
  id: string
  title: string
  /** 本节点及其子节点将移入的书签数。 */
  count: number
  removable: boolean
  children: StructureNode[]
}

const isFallback = (candidate: CategoryCandidate, locale: Locale): boolean =>
  candidate.path.length === 1 &&
  normalizeName(stripNumberPrefix(candidate.path[0]!)) === normalizeName(FALLBACK_TITLE[locale])

/** 编辑后的裸名字：用户改过就用他的，否则用去掉编号的原名。 */
const titleOf = (candidate: CategoryCandidate, edits: StructureEdits): string =>
  edits.renames[candidate.id] ?? stripNumberPrefix(candidate.path.at(-1)!)

/** 子目录 → 它所属的一级目录 id。靠 path[0] 关联，同一个 plan 内唯一。 */
function buildParentMap(candidates: CategoryCandidate[]): Map<string, string> {
  const topByPath = new Map<string, string>()
  for (const candidate of candidates) {
    if (candidate.path.length === 1) topByPath.set(candidate.path[0]!, candidate.id)
  }
  const parentOf = new Map<string, string>()
  for (const candidate of candidates) {
    if (candidate.path.length !== 2) continue
    const parent = topByPath.get(candidate.path[0]!)
    if (parent !== undefined) parentOf.set(candidate.id, parent)
  }
  return parentOf
}

/** 每个书签本次会被移到哪个 candidate。没有移动操作的书签不在表里。 */
function buildTargetMap(operations: BookmarkOperation[]): Map<string, string> {
  const targets = new Map<string, string>()
  for (const operation of operations) {
    if (operation.type === 'move_bookmark') targets.set(operation.bookmarkId, operation.toCategoryId)
  }
  return targets
}

export function buildStructureView(
  plan: OrganizePlan, edits: StructureEdits, locale: Locale,
): StructureNode[] {
  const removed = new Set(edits.removed)
  const parentOf = buildParentMap(plan.candidates)
  const targets = buildTargetMap(plan.operations)

  const directCount = new Map<string, number>()
  for (const categoryId of targets.values()) {
    directCount.set(categoryId, (directCount.get(categoryId) ?? 0) + 1)
  }

  const nodes: StructureNode[] = []
  for (const candidate of plan.candidates) {
    if (candidate.path.length !== 1 || removed.has(candidate.id)) continue
    const children: StructureNode[] = plan.candidates
      .filter((c) => c.path.length === 2 && parentOf.get(c.id) === candidate.id && !removed.has(c.id))
      .map((c) => ({
        id: c.id,
        title: titleOf(c, edits),
        count: directCount.get(c.id) ?? 0,
        removable: true,
        children: [],
      }))
    nodes.push({
      id: candidate.id,
      title: titleOf(candidate, edits),
      count: (directCount.get(candidate.id) ?? 0) + children.reduce((sum, c) => sum + c.count, 0),
      removable: !isFallback(candidate, locale),
      children,
    })
  }
  return nodes
}

export function applyStructureEdits(
  plan: OrganizePlan, edits: StructureEdits, locale: Locale,
): OrganizePlan {
  const removed = new Set(edits.removed)
  const byId = new Map(plan.candidates.map((c) => [c.id, c]))
  const parentOf = buildParentMap(plan.candidates)
  const fallbackId = plan.candidates.find((c) => isFallback(c, locale))?.id ?? null

  // 一级目录被删时，它的子目录一并消失
  for (const candidate of plan.candidates) {
    const parent = parentOf.get(candidate.id)
    if (parent !== undefined && removed.has(parent)) removed.add(candidate.id)
  }

  const topByTopic = new Map<string, string>()
  for (const candidate of plan.candidates) {
    if (candidate.path.length !== 1 || candidate.domainGroup !== undefined) continue
    topByTopic.set(normalizeName(stripNumberPrefix(candidate.path[0]!)), candidate.id)
  }
  const topicOf = new Map(plan.tags.map((t) => [t.bookmarkId, t.primaryTopic]))

  /** 书签原本的目标目录若被删，算出它该落到哪里；null 表示无处可去、不再移动。 */
  function resolve(categoryId: string, bookmarkId: string, seen: Set<string>): string | null {
    if (!removed.has(categoryId)) return categoryId
    if (seen.has(categoryId)) return fallbackId
    seen.add(categoryId)

    const candidate = byId.get(categoryId)
    if (candidate === undefined) return fallbackId

    // 二级目录回落到父目录，而不是「其他」
    const parent = parentOf.get(categoryId)
    if (parent !== undefined) return resolve(parent, bookmarkId, seen)

    // 聚合目录按书签自己的主题回落到同名主题目录
    if (candidate.domainGroup !== undefined) {
      const topic = topicOf.get(bookmarkId) ?? ''
      const hit = topic === '' ? undefined : topByTopic.get(normalizeName(topic))
      if (hit !== undefined && hit !== categoryId) return resolve(hit, bookmarkId, seen)
    }
    return fallbackId
  }

  const candidates: CategoryCandidate[] = plan.candidates
    .filter((c) => !removed.has(c.id))
    .map((c) => {
      const own = titleOf(c, edits)
      if (c.path.length === 1) return { ...c, path: [own] }
      const parent = parentOf.get(c.id)
      const parentCandidate = parent === undefined ? undefined : byId.get(parent)
      const parentTitle =
        parentCandidate === undefined ? stripNumberPrefix(c.path[0]!) : titleOf(parentCandidate, edits)
      return { ...c, path: [parentTitle, own] }
    })

  const pathById = new Map(candidates.map((c) => [c.id, c.path]))
  const survivingTempIds = new Set(candidates.map((c) => c.id))

  const retarget = new Map<string, string | null>()
  for (const operation of plan.operations) {
    if (operation.type !== 'move_bookmark') continue
    retarget.set(operation.bookmarkId, resolve(operation.toCategoryId, operation.bookmarkId, new Set()))
  }

  const operations = plan.operations.flatMap((operation): BookmarkOperation[] => {
    if (operation.type === 'create_folder') {
      if (removed.has(operation.temporaryId)) return []
      return [{ ...operation, title: pathById.get(operation.temporaryId)?.at(-1) ?? operation.title }]
    }
    if (operation.type === 'rename_folder') {
      if (removed.has(operation.folderId)) return []
      return [{ ...operation, newTitle: pathById.get(operation.folderId)?.at(-1) ?? operation.newTitle }]
    }
    // 标题改写与目录结构无关，原样带过
    if (operation.type === 'rename_bookmark') return [operation]
    const target = retarget.get(operation.bookmarkId) ?? null
    if (target === null) return []
    return [{
      ...operation,
      toCategoryId: target,
      // 目标若不是本批新建的目录（例如复用的真实目录），toTemporaryId 必须是 null
      toTemporaryId: survivingTempIds.has(target) && target.startsWith('tmp:') ? target : null,
    }]
  })

  const rows: PlanRow[] = plan.rows.flatMap((row) => {
    const target = retarget.get(row.bookmarkId) ?? null
    if (target === null) return []
    return [{ ...row, toPath: pathById.get(target) ?? row.toPath }]
  })

  const next: OrganizePlan = { ...plan, candidates, operations, rows }
  return {
    ...next,
    summary: summarize(next, new Set(rows.map((r) => r.bookmarkId)), plan.summary.totalBookmarks),
  }
}
