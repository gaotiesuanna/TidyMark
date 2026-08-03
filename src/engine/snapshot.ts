import { scanTree } from '@/core/scan'
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
}

export async function captureSnapshot(
  ports: Ports,
  planId: string,
  scopeRootIds: string[],
): Promise<BookmarkSnapshot> {
  const tree = await ports.bookmarks.getTree()
  const scan = scanTree(tree, scopeRootIds)
  const rootSet = new Set(scopeRootIds)

  const nodes: SnapshotNode[] = [
    ...scan.folders
      .filter((f) => !rootSet.has(f.id))
      .map((f) => ({ id: f.id, parentId: f.parentId ?? '', index: f.index, title: f.title })),
    ...scan.bookmarks.map((b) => ({
      id: b.id, parentId: b.parentId, index: b.index, title: b.title, url: b.url,
    })),
  ]

  return { createdAt: Date.now(), planId, scopeRootIds, nodes, createdFolderIds: [] }
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
