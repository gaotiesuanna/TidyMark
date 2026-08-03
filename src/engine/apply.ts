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
  failedAt: number | null
  error: string | null
}

export async function applyPlan(
  ports: Ports,
  plan: OrganizePlan,
  accepted: Set<string>,
  onProgress?: (done: number, total: number) => void,
): Promise<ApplyResult> {
  const operations = filterAccepted(plan, accepted)

  const snapshot = await captureSnapshot(ports, plan.id, plan.scopeRootIds)
  await saveSnapshot(ports, snapshot)

  const tempToReal = new Map<string, string>()
  const createdFolderIds: string[] = []
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
      } else {
        await ports.bookmarks.update(operation.folderId, { title: operation.newTitle })
      }
      executed++
      await ports.storage.set(PROGRESS_KEY, { planId: plan.id, executed, total: operations.length })
      onProgress?.(executed, operations.length)
    } catch (error) {
      await saveSnapshot(ports, { ...snapshot, createdFolderIds })
      return {
        status: 'failed',
        executed,
        skipped,
        createdFolderIds,
        failedAt: i,
        error: String(error),
      }
    }
  }

  await saveSnapshot(ports, { ...snapshot, createdFolderIds })
  await ports.storage.remove(PROGRESS_KEY)
  return { status: 'completed', executed, skipped, createdFolderIds, failedAt: null, error: null }
}
