import type { Locale } from './locale'
import { normalizeName, stripNumberPrefix } from './map'
import { summarize } from './plan'
import { FALLBACK_TITLE } from './tree'
import type { BookmarkOperation, CategoryCandidate, OrganizePlan, PlanRow, UnchangedRow } from './types'

export interface StructureEdits {
  /** candidate id → 用户输入的新名字，不含编号前缀。 */
  renames: Record<string, string>
  /** 被删掉的 candidate id。 */
  removed: string[]
  /**
   * 被合并的 candidate id → 接收方 candidate id。
   *
   * **合并 = 删除 + 指定去处**：被合并的目录同时出现在 `removed` 里，这里只回答「里面的书签去哪」。
   * 两件事必须一起写（store 的 `mergeNode` 保证这一点），只写一处会得到
   * 「目录没了但书签按默认链回落」或「书签改投了但目录还在」两种半截状态。
   */
  mergedInto: Record<string, string>
}

export const EMPTY_EDITS: StructureEdits = { renames: {}, removed: [], mergedInto: {} }

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

/**
 * 结构页删掉一个目录后，`resolve()` 找不到回落点时用的理由——
 * 「没有合适目录」是模型说的，这里不是，是用户自己删掉了收留它的地方，说法要分清。
 */
function noFallbackReason(locale: Locale): string {
  return locale === 'zh_CN'
    ? '你删掉了本来要收它的目录，现在没有别的地方可去'
    : 'The folder that was going to hold it got deleted, and there is nowhere else for it to go'
}

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
  // 合并根是容器不是分类，删掉它整棵树就无处可去
  if (plan.mergeRoot !== null) removed.delete(plan.mergeRoot.temporaryId)

  /** 合并根改名后的标题；用户清空输入时退回模型给的原名。 */
  const mergeRootTitle =
    plan.mergeRoot === null
      ? null
      : (edits.renames[plan.mergeRoot.temporaryId]?.trim() ?? '') === ''
        ? plan.mergeRoot.title
        : edits.renames[plan.mergeRoot.temporaryId]!.trim()

  const byId = new Map(plan.candidates.map((c) => [c.id, c]))
  const parentOf = buildParentMap(plan.candidates)
  const fallbackId = plan.candidates.find((c) => isFallback(c, locale))?.id ?? null

  // 一级目录被删时，它的子目录一并消失
  for (const candidate of plan.candidates) {
    const parent = parentOf.get(candidate.id)
    if (parent !== undefined && removed.has(parent)) removed.add(candidate.id)
  }

  /** 书签原本的目标目录若被删，算出它该落到哪里；null 表示无处可去、不再移动。 */
  function resolve(categoryId: string, seen: Set<string>): string | null {
    if (!removed.has(categoryId)) return categoryId
    if (seen.has(categoryId)) return fallbackId
    seen.add(categoryId)

    // 用户指定的去处优先于所有默认回落：他刚刚亲手说了这批书签该去哪，
    // 比「二级回落到父目录」这类默认规则算数。接收方自己也被合并时继续往下走，
    // 成环由上面的 seen 兜住（落回「其他」，不会转圈）
    const merged = edits.mergedInto[categoryId]
    if (merged !== undefined) return resolve(merged, seen)

    const candidate = byId.get(categoryId)
    if (candidate === undefined) return fallbackId

    // 二级目录回落到父目录，而不是「其他」
    const parent = parentOf.get(categoryId)
    if (parent !== undefined) return resolve(parent, seen)

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
    retarget.set(operation.bookmarkId, resolve(operation.toCategoryId, new Set()))
  }

  const operations = plan.operations.flatMap((operation): BookmarkOperation[] => {
    if (operation.type === 'create_folder') {
      if (operation.temporaryId === plan.mergeRoot?.temporaryId) {
        return [{ ...operation, title: mergeRootTitle! }]
      }
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

  const prefix = mergeRootTitle === null ? [] : [mergeRootTitle]
  // resolve() 找不到回落点时（删掉的目录没有兜底目录可去）这条书签不再进 rows，
  // 但「rows 与 unchanged 互斥且完备」这条不变式出了 buildPlan 也必须成立——
  // 不能像早先那样直接丢弃，得给它在 unchanged 里补一个位置，否则复核页上这条书签
  // 会一个字都不出现（见 issues/05「决定 3」，正是这一轮要消灭的状态）。
  const orphaned: UnchangedRow[] = []
  const rows: PlanRow[] = plan.rows.flatMap((row) => {
    const target = retarget.get(row.bookmarkId) ?? null
    if (target === null) {
      orphaned.push({
        bookmarkId: row.bookmarkId, title: row.title, url: row.url, currentPath: row.fromPath,
        kind: 'noTarget', reason: noFallbackReason(locale),
      })
      return []
    }
    const path = pathById.get(target)
    return [{
      ...row,
      toPath: path === undefined ? row.toPath : [...prefix, ...path],
      toCategoryId: target,
    }]
  })
  const unchanged = orphaned.length === 0 ? plan.unchanged : [...plan.unchanged, ...orphaned]

  const next: OrganizePlan = {
    ...plan, candidates, operations, rows, unchanged,
    mergeRoot: plan.mergeRoot === null ? null : { ...plan.mergeRoot, title: mergeRootTitle! },
  }
  return {
    ...next,
    summary: summarize(next, new Set(rows.map((r) => r.bookmarkId)), plan.summary.totalBookmarks),
  }
}
