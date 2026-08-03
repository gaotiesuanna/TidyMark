import { findEmptyFolders, type EmptyFolder } from '@/core/empty'
import { planFolderOrder } from '@/core/order'
import { filterAccepted } from '@/core/plan'
import type { Ports } from '@/core/ports'
import type { OrganizePlan } from '@/core/types'
import { captureSnapshot, saveSnapshot } from './snapshot'

export const PROGRESS_KEY = 'tidymark:apply-progress'

export interface SkipRecord {
  bookmarkId: string
  reason: string
}

export interface ApplyResult {
  status: 'completed' | 'failed'
  executed: number
  skipped: SkipRecord[]
  createdFolderIds: string[]
  /** 移动完成后被清理掉的空目录，撤销时会重建。 */
  removedFolders: EmptyFolder[]
  /** 按编号重新排位的目录数量。 */
  sortedFolders: number
  /** 被统一了标题的书签 id。 */
  renamedBookmarkIds: string[]
  failedAt: number | null
  error: string | null
}

export interface ApplyOptions {
  onProgress?: (done: number, total: number) => void
  /** 移动完成后清理范围内不含任何书签的目录。 */
  removeEmptyFolders?: boolean
}

/**
 * 清理范围内的空目录。子目录先于父目录删除，单个失败不影响其余。
 * 必须在所有移动执行完之后调用——判空依据的是移动后的真实书签树。
 */
async function removeEmpty(
  ports: Ports,
  scopeRootIds: string[],
  skipped: SkipRecord[],
): Promise<EmptyFolder[]> {
  const tree = await ports.bookmarks.getTree()
  const removed: EmptyFolder[] = []
  for (const folder of findEmptyFolders(tree, scopeRootIds)) {
    try {
      await ports.bookmarks.remove(folder.id)
      removed.push(folder)
    } catch (error) {
      skipped.push({ bookmarkId: folder.id, reason: `空文件夹删除失败：${String(error)}` })
    }
  }
  return removed
}

/**
 * 让带编号的目录在书签栏里真的按编号排列。
 *
 * 必须在移动与清理都结束之后调用——依据的是最终的真实书签树。
 * 单个目录排序失败不影响其余，最多是它留在原位。
 */
async function sortFolders(
  ports: Ports,
  scopeRootIds: string[],
  skipped: SkipRecord[],
): Promise<number> {
  const tree = await ports.bookmarks.getTree()
  let sorted = 0
  for (const move of planFolderOrder(tree, scopeRootIds)) {
    try {
      await ports.bookmarks.move(move.id, { parentId: move.parentId, index: move.index })
      sorted++
    } catch (error) {
      skipped.push({ bookmarkId: move.id, reason: `目录排序失败：${String(error)}` })
    }
  }
  return sorted
}

export async function applyPlan(
  ports: Ports,
  plan: OrganizePlan,
  accepted: Set<string>,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const onProgress = options.onProgress
  const operations = filterAccepted(plan, accepted)

  const snapshot = await captureSnapshot(ports, plan.id, plan.scopeRootIds)
  await saveSnapshot(ports, snapshot)

  const tempToReal = new Map<string, string>()
  const createdFolderIds: string[] = []
  const renamedBookmarkIds: string[] = []
  const skipped: SkipRecord[] = []
  let executed = 0

  await ports.storage.set(PROGRESS_KEY, { planId: plan.id, executed: 0, total: operations.length })
  onProgress?.(0, operations.length)

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i]!
    try {
      if (operation.type === 'create_folder') {
        const parentId =
          operation.parentTemporaryId !== null
            ? tempToReal.get(operation.parentTemporaryId)
            : operation.parentId
        if (parentId === undefined || parentId === null) {
          throw new Error(`无法解析文件夹 ${operation.title} 的父目录`)
        }
        const created = await ports.bookmarks.create({ parentId, title: operation.title })
        tempToReal.set(operation.temporaryId, created.id)
        createdFolderIds.push(created.id)
      } else if (operation.type === 'move_bookmark') {
        const existing = await ports.bookmarks.get(operation.bookmarkId)
        if (existing === null) {
          skipped.push({ bookmarkId: operation.bookmarkId, reason: '书签已不存在' })
          continue
        }
        const targetId =
          operation.toTemporaryId !== null
            ? tempToReal.get(operation.toTemporaryId)
            : operation.toCategoryId
        if (targetId === undefined) throw new Error(`无法解析目标目录 ${operation.toCategoryId}`)
        await ports.bookmarks.move(operation.bookmarkId, { parentId: targetId })
      } else if (operation.type === 'rename_folder') {
        await ports.bookmarks.update(operation.folderId, { title: operation.newTitle })
      } else {
        await ports.bookmarks.update(operation.bookmarkId, { title: operation.newTitle })
        // 记下来，撤销时才分得清标题是我们改的还是用户自己改的
        renamedBookmarkIds.push(operation.bookmarkId)
      }
      executed++
      await ports.storage.set(PROGRESS_KEY, { planId: plan.id, executed, total: operations.length })
      onProgress?.(executed, operations.length)
    } catch (error) {
      await saveSnapshot(ports, { ...snapshot, createdFolderIds, renamedBookmarkIds })
      return {
        status: 'failed',
        executed,
        skipped,
        createdFolderIds,
        removedFolders: [],
        sortedFolders: 0,
        renamedBookmarkIds,
        failedAt: i,
        error: String(error),
      }
    }
  }

  // 只有整批操作都成功才清理——中途失败时结构还没落定，删目录只会添乱
  const removedFolders =
    options.removeEmptyFolders === true
      ? await removeEmpty(ports, plan.scopeRootIds, skipped)
      : []

  // 非推翻模式不产生编号，也就没有需要排序的目录，不该动用户自己的排列
  const sortedFolders = plan.rebuildStructure
    ? await sortFolders(ports, plan.scopeRootIds, skipped)
    : 0

  await saveSnapshot(ports, { ...snapshot, createdFolderIds, renamedBookmarkIds })
  await ports.storage.remove(PROGRESS_KEY)
  return {
    status: 'completed', executed, skipped, createdFolderIds, removedFolders, sortedFolders,
    renamedBookmarkIds, failedAt: null, error: null,
  }
}
