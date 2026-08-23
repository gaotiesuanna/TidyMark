import { findEmptyFolders, type EmptyFolder } from './empty'
import type { BookmarkNode } from './ports'

/** 用户在清理页勾出来的三张名单。执行与预览用的是同一份。 */
export interface CleanupSelection {
  /** 要删掉的书签：重复项里没被保留的那些，加上选了「删除」的死链。 */
  deleteBookmarkIds: string[]
  /** 要移进「失效链接」文件夹的书签。 */
  moveBookmarkIds: string[]
  /** 要删掉的空目录。 */
  deleteFolderIds: string[]
}

/** 把一批书签从树里剪掉，返回新树。原树不动。 */
function pruneTree(nodes: BookmarkNode[], vacated: Set<string>): BookmarkNode[] {
  const result: BookmarkNode[] = []
  for (const node of nodes) {
    if (node.url !== undefined) {
      if (!vacated.has(node.id)) result.push(node)
      continue
    }
    result.push({ ...node, children: pruneTree(node.children ?? [], vacated) })
  }
  return result
}

/**
 * 「如果按当前勾选执行，哪些目录会变空」。
 *
 * 存在的理由是预览要说真话。直接对当前这棵树调 `findEmptyFolders`，报的是删除
 * **前**的空目录数，跟实际清掉的对不上——`engine/apply.ts` 里 `removeEmpty` 那句
 * 注释（「必须在所有移动执行完之后调用——判空依据的是移动后的真实书签树」）说的
 * 是同一件事，这里只是把它提前到预览，好让用户勾一下就立刻看见后果。
 *
 * 参数叫 vacated 不叫 removed：**被移进「失效链接」文件夹的书签也腾空了原来的位置**，
 * 调用方必须把「删除」和「移走」两批一起传进来。只传删除那批，预览会漏报一部分
 * 目录，用户执行完才发现多清了几个。
 */
export function emptyAfterRemoval(
  tree: BookmarkNode[],
  scopeRootIds: string[],
  vacatedBookmarkIds: Iterable<string>,
): EmptyFolder[] {
  const vacated = new Set(vacatedBookmarkIds)
  if (vacated.size === 0) return findEmptyFolders(tree, scopeRootIds)
  return findEmptyFolders(pruneTree(tree, vacated), scopeRootIds)
}
