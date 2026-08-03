import type { BookmarkNode } from './ports'
import type { BookmarkItem, FolderItem, ScanResult, ScanStats } from './types'

function findNodes(tree: BookmarkNode[], ids: Set<string>): BookmarkNode[] {
  const found: BookmarkNode[] = []
  const stack = [...tree]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (ids.has(node.id)) found.push(node)
    for (const child of node.children ?? []) stack.push(child)
  }
  return found
}

export function scanTree(tree: BookmarkNode[], scopeRootIds: string[]): ScanResult {
  const bookmarks: BookmarkItem[] = []
  const folders: FolderItem[] = []
  const roots = findNodes(tree, new Set(scopeRootIds))

  function walk(node: BookmarkNode, path: string[], depth: number): void {
    if (node.url !== undefined) {
      bookmarks.push({
        id: node.id,
        title: node.title,
        url: node.url,
        parentId: node.parentId ?? '',
        index: node.index ?? 0,
        currentPath: path,
      })
      return
    }
    folders.push({
      id: node.id,
      title: node.title,
      parentId: node.parentId ?? null,
      index: node.index ?? 0,
      path,
      depth,
    })
    const childPath = [...path, node.title]
    for (const child of node.children ?? []) walk(child, childPath, depth + 1)
  }

  for (const root of roots) walk(root, [], 0)

  const urlCounts = new Map<string, number>()
  for (const item of bookmarks) urlCounts.set(item.url, (urlCounts.get(item.url) ?? 0) + 1)

  const stats: ScanStats = {
    totalBookmarks: bookmarks.length,
    totalFolders: folders.length,
    emptyFolders: folders.filter(
      (f) => !bookmarks.some((b) => b.parentId === f.id) && !folders.some((c) => c.parentId === f.id),
    ).length,
    untitledBookmarks: bookmarks.filter((b) => b.title.trim() === '').length,
    duplicateUrlGroups: [...urlCounts.values()].filter((n) => n > 1).length,
    maxDepth: folders.reduce((max, f) => Math.max(max, f.depth), 0),
  }

  return { bookmarks, folders, stats }
}
