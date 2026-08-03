import { filterAccepted } from './plan'
import type { OrganizePlan } from './types'

/** 整理结果的目录树节点，用于在结果页预览整理后的结构。 */
export interface ResultTreeNode {
  title: string
  path: string[]
  /** 本次整理新建的目录。 */
  isNew: boolean
  /** 直接落入该目录的书签数。 */
  count: number
  /** 含子目录在内的书签总数。 */
  total: number
  children: ResultTreeNode[]
}

function keyOf(path: string[]): string {
  return JSON.stringify(path)
}

/**
 * 根据方案与被接受的书签，还原整理后的目录结构。
 * 只包含真正接收到书签的目录，未被接受的移动不出现在树里。
 */
export function buildResultTree(plan: OrganizePlan, accepted: Set<string>): ResultTreeNode[] {
  const pathByTemporaryId = new Map(plan.candidates.map((c) => [c.id, c.path]))
  const newPaths = new Set<string>()
  for (const operation of filterAccepted(plan, accepted)) {
    if (operation.type !== 'create_folder') continue
    const path = pathByTemporaryId.get(operation.temporaryId)
    if (path !== undefined) newPaths.add(keyOf(path))
  }

  const roots: ResultTreeNode[] = []
  const byKey = new Map<string, ResultTreeNode>()

  function ensure(path: string[]): ResultTreeNode {
    const key = keyOf(path)
    const existing = byKey.get(key)
    if (existing !== undefined) return existing
    const node: ResultTreeNode = {
      title: path[path.length - 1] ?? '',
      path,
      isNew: newPaths.has(key),
      count: 0,
      total: 0,
      children: [],
    }
    byKey.set(key, node)
    if (path.length <= 1) roots.push(node)
    else ensure(path.slice(0, -1)).children.push(node)
    return node
  }

  for (const row of plan.rows) {
    if (!accepted.has(row.bookmarkId)) continue
    if (row.toPath.length === 0) continue
    ensure(row.toPath).count++
  }

  function finalize(node: ResultTreeNode): number {
    node.total = node.count + node.children.reduce((sum, child) => sum + finalize(child), 0)
    node.children.sort((a, b) => b.total - a.total || a.title.localeCompare(b.title))
    return node.total
  }
  for (const root of roots) finalize(root)
  roots.sort((a, b) => b.total - a.total || a.title.localeCompare(b.title))

  return roots
}
