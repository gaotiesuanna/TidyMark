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
 *
 * **这里一律不排序，这正是它说真话的方式。** 那一页写着「书签栏的真实结构」，
 * 而手里拿到的就是真实结构：`store.ts` 的 apply/undo 结束都会 `refreshTree()`
 * 重新读回整棵树，Chrome 返回的 children 本身就是 index 序，也就是书签栏里的真实先后。
 *
 * 之所以连「按编号排」也不做：
 * - 推翻模式下 `engine/apply.ts` 已经跑过 `sortFolders`，把 `planFolderOrder` 的顺序
 *   真的写进了 Chrome。树读回来时就已经是编号序，这里再排一遍是纯空操作。
 * - 排序唯一会改变结果的时刻，恰恰是真实树没排成编号序的时刻——排序 move 失败、
 *   撤销之后目录名改回去、撤销半途失败只有一部分还顶着号……那些时刻排序不是在帮忙，
 *   是在把一棵没被排过的树画成排过的样子，也就是在说谎。
 *
 * （更早的版本按书签总数降序排，同样与书签栏对不上。每行右侧本来就显示书签数，
 * 「一眼看见哪个最大」不靠排序也拿得到。）
 */
export function buildResultTree(
  tree: BookmarkNode[],
  scopeRootIds: string[],
  createdFolderIds: string[],
): ResultTreeNode[] {
  const created = new Set(createdFolderIds)

  function build(node: BookmarkNode): ResultTreeNode {
    const children: ResultTreeNode[] = []
    let count = 0
    for (const child of node.children ?? []) {
      if (child.url !== undefined) count++
      else children.push(build(child))
    }
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
