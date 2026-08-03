import { findScopeRoots } from './scan'
import type { BookmarkNode } from './ports'

export interface EmptyFolder {
  id: string
  title: string
  /** 父目录链，不含自身。 */
  path: string[]
}

/**
 * 找出范围内整个子树都不含书签的文件夹。
 * 返回顺序保证子目录在父目录之前，调用方按顺序删除即可。
 * 范围根本身不会被返回，同一个目录也不会返回两次。
 */
export function findEmptyFolders(tree: BookmarkNode[], scopeRootIds: string[]): EmptyFolder[] {
  const empty: EmptyFolder[] = []

  // 返回子树里是否含有书签；后序遍历，子目录先于父目录入列
  function walk(node: BookmarkNode, path: string[], isRoot: boolean): boolean {
    if (node.url !== undefined) return true
    const childPath = [...path, node.title]
    let hasBookmark = false
    for (const child of node.children ?? []) {
      if (walk(child, childPath, false)) hasBookmark = true
    }
    if (!hasBookmark && !isRoot) empty.push({ id: node.id, title: node.title, path })
    return hasBookmark
  }

  for (const root of findScopeRoots(tree, scopeRootIds)) walk(root, [], true)
  return empty
}
