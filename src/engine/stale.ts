import { classifyStaleBookmarks, type StaleScanResult } from '@/core/stale'
import type { BookmarkNode, Ports } from '@/core/ports'
import { findScopeRoots, scanTree } from '@/core/scan'

export async function scanStaleBookmarks(
  ports: Ports,
  scopeRootIds: string[],
  scannedAt = Date.now(),
): Promise<StaleScanResult> {
  const tree = await ports.bookmarks.getTree()
  const roots = findScopeRoots(tree, scopeRootIds)
  const scan = scanTree(tree, roots.map((root) => root.id))
  const scopeRootIdByBookmarkId = new Map<string, string>()

  function walk(node: BookmarkNode, scopeRootId: string): void {
    if (node.url !== undefined) scopeRootIdByBookmarkId.set(node.id, scopeRootId)
    for (const child of node.children ?? []) walk(child, scopeRootId)
  }

  for (const root of roots) walk(root, root.id)

  if (ports.history === undefined) throw new Error('History API unavailable')
  const visits = await ports.history.search()
  return classifyStaleBookmarks(scan.bookmarks, visits, scannedAt, scopeRootIdByBookmarkId)
}
