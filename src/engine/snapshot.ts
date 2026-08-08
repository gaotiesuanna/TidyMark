import { findScopeRoots, scanTree } from '@/core/scan'
import type { Ports } from '@/core/ports'

export const SNAPSHOT_KEY = 'tidymark:snapshot'

export interface SnapshotNode {
  id: string
  parentId: string
  index: number
  title: string
  url?: string
}

export interface BookmarkSnapshot {
  createdAt: number
  planId: string
  scopeRootIds: string[]
  nodes: SnapshotNode[]
  /** Apply 过程中新建的文件夹 id，撤销时若为空则删除。由 applyPlan 回填。 */
  createdFolderIds: string[]
  /**
   * Apply 过程中被我们改过标题的书签 id。由 applyPlan 回填。
   *
   * 撤销默认不覆盖书签标题——标题对不上通常意味着用户自己改过。
   * 只有这个名单里的书签，标题才是我们改的，撤销时要还原。
   */
  renamedBookmarkIds: string[]
  /**
   * 范围根自身，不含 Chrome 的永久目录（parentId === '0'，删不掉也移不动）。
   *
   * nodes 不收录范围根——它们从不被删，撤销也不该移动它们。
   * 但合并会有意清空并删除源根，撤销时必须能把它们重建出来，
   * 否则其下每个节点归位时 parentId 都指向一个已死的 id。
   */
  rootNodes: SnapshotNode[]
}

export async function captureSnapshot(
  ports: Ports,
  planId: string,
  scopeRootIds: string[],
): Promise<BookmarkSnapshot> {
  const tree = await ports.bookmarks.getTree()
  const scan = scanTree(tree, scopeRootIds)
  // scopeRootIds 是级联勾选的全集，直接拿它当范围根会把范围内每个目录都当成根滤掉，
  // 快照里一个文件夹都不剩。判定必须和 scanTree 用同一套去重。
  const rootSet = new Set(findScopeRoots(tree, scopeRootIds).map((r) => r.id))

  const nodes: SnapshotNode[] = [
    ...scan.folders
      .filter((f) => !rootSet.has(f.id))
      .map((f) => ({ id: f.id, parentId: f.parentId ?? '', index: f.index, title: f.title })),
    ...scan.bookmarks.map((b) => ({
      id: b.id, parentId: b.parentId, index: b.index, title: b.title, url: b.url,
    })),
  ]

  const rootNodes: SnapshotNode[] = scan.folders
    .filter((f) => rootSet.has(f.id) && f.parentId !== null && f.parentId !== '0')
    .map((f) => ({ id: f.id, parentId: f.parentId!, index: f.index, title: f.title }))

  return {
    createdAt: Date.now(), planId, scopeRootIds, nodes,
    createdFolderIds: [], renamedBookmarkIds: [], rootNodes,
  }
}

export async function saveSnapshot(ports: Ports, snapshot: BookmarkSnapshot): Promise<void> {
  await ports.storage.set(SNAPSHOT_KEY, snapshot)
}

export async function loadSnapshot(ports: Ports): Promise<BookmarkSnapshot | null> {
  return ports.storage.get<BookmarkSnapshot>(SNAPSHOT_KEY)
}

export async function clearSnapshot(ports: Ports): Promise<void> {
  await ports.storage.remove(SNAPSHOT_KEY)
}
