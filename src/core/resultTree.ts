import { findScopeRoots } from './scan'
import type { BookmarkNode } from './ports'

/** 整理结果的目录树节点，用于在结果页预览整理后的真实结构。 */
export interface ResultTreeNode {
  id: string
  title: string
  /** 本次整理新建的目录。 */
  isNew: boolean
  /** 直接放在该目录下的书签数。 */
  count: number
  /** 含子目录在内的书签总数。 */
  total: number
  children: ResultTreeNode[]
}

/**
 * 从整理完成后重新读取的书签树，构建结果页展示的目录结构。
 *
 * 直接读真实书签树而不是从方案推导：方案只知道「被接受的书签去了哪」，
 * 未接受的书签仍留在原目录里，只看方案会得出一棵与实际不符的树。
 */
export function buildResultTree(
  tree: BookmarkNode[],
  scopeRootIds: string[],
  createdFolderIds: string[] = [],
): ResultTreeNode[] {
  const created = new Set(createdFolderIds)

  function build(node: BookmarkNode): ResultTreeNode {
    const children: ResultTreeNode[] = []
    let count = 0
    for (const child of node.children ?? []) {
      if (child.url !== undefined) count++
      else children.push(build(child))
    }
    children.sort((a, b) => b.total - a.total || a.title.localeCompare(b.title))
    return {
      id: node.id,
      title: node.title,
      isNew: created.has(node.id),
      count,
      total: count + children.reduce((sum, child) => sum + child.total, 0),
      children,
    }
  }

  return findScopeRoots(tree, scopeRootIds).map(build)
}
