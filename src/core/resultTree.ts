import { folderNumber } from './order'
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
 * 与 `core/order.ts` 的 `planFolderOrder` 同一条规则：带编号的排最前、彼此按编号升序，
 * 没编号的跟在后面、相对顺序不变（返回 0，`Array.prototype.sort` 自 ES2019 起稳定）。
 *
 * 结果页那一段文案写着「书签栏的真实结构」，那就得是真实顺序。而「真实顺序」在两种模式下
 * 是两回事，所以这个比较函数只在推翻模式下用（见 `buildResultTree` 的 numberedOrder）：
 *
 * - 推翻模式：`engine/apply.ts` 会跑 `sortFolders`，把 `planFolderOrder` 的顺序真的落进
 *   Chrome，书签栏里的真实顺序就是「带编号的在前、按号升序」。
 * - 非推翻模式：`apply.ts` 明写着不产生编号、不动用户自己的排列，书签栏的真实顺序就是
 *   树里读出来的原始先后。这时再按编号排，等于把带编号的旧目录凭空提到最前面——
 *   那一页照样在说谎，只是换了个说谎方式。
 *
 * （此前这里按书签总数降序排，与书签栏对不上，而这一页恰恰是拿来对照真实结构的。
 * 每行右侧本来就显示书签数，「一眼看见哪个最大」不靠排序也拿得到。）
 */
function byFolderNumber(a: ResultTreeNode, b: ResultTreeNode): number {
  const left = folderNumber(a.title)
  const right = folderNumber(b.title)
  if (left !== null && right !== null) return left - right
  if (left !== null) return -1
  if (right !== null) return 1
  return 0
}

/**
 * 从整理完成后重新读取的书签树，构建结果页展示的目录结构。
 *
 * 直接读真实书签树而不是从方案推导：方案只知道「被接受的书签去了哪」，
 * 未接受的书签仍留在原目录里，只看方案会得出一棵与实际不符的树。
 *
 * numberedOrder 由调用方从 `plan.rebuildStructure` 传入：只有推翻模式才真的把编号顺序
 * 落进了书签栏，其余情况一律保留树里的原始先后（见上面 byFolderNumber 的注释）。
 * 三个参数都不给默认值——排不排序是「这一页说不说真话」的开关，得让调用方每次都表态。
 */
export function buildResultTree(
  tree: BookmarkNode[],
  scopeRootIds: string[],
  createdFolderIds: string[],
  numberedOrder: boolean,
): ResultTreeNode[] {
  const created = new Set(createdFolderIds)

  function build(node: BookmarkNode): ResultTreeNode {
    const children: ResultTreeNode[] = []
    let count = 0
    for (const child of node.children ?? []) {
      if (child.url !== undefined) count++
      else children.push(build(child))
    }
    if (numberedOrder) children.sort(byFolderNumber)
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
