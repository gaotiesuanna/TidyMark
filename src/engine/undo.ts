import type { Ports } from '@/core/ports'
import { clearSnapshot, loadSnapshot, type SnapshotNode } from './snapshot'

export interface UndoSkip {
  id: string
  title: string
  reason: string
}

export interface UndoResult {
  status: 'completed' | 'no_snapshot'
  restored: number
  skipped: UndoSkip[]
  removedFolders: number
}

export async function undoLast(
  ports: Ports,
  onProgress?: (done: number, total: number) => void,
): Promise<UndoResult> {
  const snapshot = await loadSnapshot(ports)
  if (snapshot === null) {
    return { status: 'no_snapshot', restored: 0, skipped: [], removedFolders: 0 }
  }

  const skipped: UndoSkip[] = []
  const restorable: SnapshotNode[] = []

  // 校验：只还原仍然存在的节点。
  // 文件夹标题属于结构信息，若被 Apply 之后的操作改动，强制恢复；
  // 书签（带 url）的标题若被用户手动改过，视为用户的有意修改，跳过以免覆盖。
  for (const node of snapshot.nodes) {
    const current = await ports.bookmarks.get(node.id)
    if (current === null) {
      skipped.push({ id: node.id, title: node.title, reason: '节点已不存在' })
      continue
    }
    const isFolder = node.url === undefined
    if (current.title !== node.title) {
      if (isFolder) {
        try {
          await ports.bookmarks.update(node.id, { title: node.title })
        } catch (error) {
          skipped.push({ id: node.id, title: node.title, reason: `标题恢复失败：${String(error)}` })
          continue
        }
      } else {
        skipped.push({
          id: node.id, title: node.title, reason: '标题已被手动修改，跳过以免覆盖',
        })
        continue
      }
    }
    restorable.push(node)
  }

  const total = restorable.length
  let done = 0
  onProgress?.(0, total)

  // 第一趟：把所有节点归位到正确的 parent（先不管顺序）。
  // 若当前 parent 已经正确，跳过多余的 move 调用。
  const parentRestored: SnapshotNode[] = []
  for (const node of restorable) {
    const current = await ports.bookmarks.get(node.id)
    if (current !== null && current.parentId === node.parentId) {
      parentRestored.push(node)
      continue
    }
    try {
      await ports.bookmarks.move(node.id, { parentId: node.parentId })
      parentRestored.push(node)
    } catch (error) {
      skipped.push({ id: node.id, title: node.title, reason: `归位失败：${String(error)}` })
    }
  }

  // 第二趟：按 parent 分组，在组内按 index 升序逐个落位。
  // 必须升序 —— 乱序插入会把已就位的节点挤走。
  const byParent = new Map<string, SnapshotNode[]>()
  for (const node of parentRestored) {
    const group = byParent.get(node.parentId) ?? []
    group.push(node)
    byParent.set(node.parentId, group)
  }

  for (const group of byParent.values()) {
    group.sort((a, b) => a.index - b.index)
    for (const node of group) {
      try {
        await ports.bookmarks.move(node.id, { parentId: node.parentId, index: node.index })
        done++
        onProgress?.(done, total)
      } catch (error) {
        skipped.push({ id: node.id, title: node.title, reason: `排序失败：${String(error)}` })
      }
    }
  }

  // 删除本次新建且已清空的文件夹。倒序删除，保证子文件夹先于父文件夹。
  let removedFolders = 0
  for (const folderId of [...snapshot.createdFolderIds].reverse()) {
    try {
      await ports.bookmarks.remove(folderId)
      removedFolders++
    } catch {
      // 非空说明用户往里放了新东西，保留不动
    }
  }

  await clearSnapshot(ports)
  return { status: 'completed', restored: done, skipped, removedFolders }
}
