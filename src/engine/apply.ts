import { findEmptyFolders, type EmptyFolder } from '@/core/empty'
import type { Locale } from '@/core/locale'
import { planBareFolderRenames, planFolderOrder } from '@/core/order'
import { filterAccepted } from '@/core/plan'
import type { BookmarkNode, Ports } from '@/core/ports'
import { findScopeRoots } from '@/core/scan'
import type { OrganizePlan } from '@/core/types'
import {
  msgBookmarkGone, msgEmptyFolderRemoveFailed, msgFolderNumberFailed, msgFolderSortFailed,
  msgParentUnresolved, msgTargetUnresolved,
} from './messages'
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
  /** 合并模式下新建的容器目录的真实 id；非合并模式为 null。 */
  mergeRootId: string | null
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
 *
 * removableRootIds 里的范围根允许连自身一起删——合并把源根搬空了，留个空壳没人想要。
 */
async function removeEmpty(
  ports: Ports,
  scopeRootIds: string[],
  skipped: SkipRecord[],
  locale: Locale,
  removableRootIds: string[] = [],
): Promise<EmptyFolder[]> {
  const tree = await ports.bookmarks.getTree()
  const removed: EmptyFolder[] = []
  for (const folder of findEmptyFolders(tree, scopeRootIds, removableRootIds)) {
    try {
      await ports.bookmarks.remove(folder.id)
      removed.push(folder)
    } catch (error) {
      skipped.push({ bookmarkId: folder.id, reason: msgEmptyFolderRemoveFailed(locale, String(error)) })
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
  locale: Locale,
): Promise<number> {
  const tree = await ports.bookmarks.getTree()
  let sorted = 0
  for (const move of planFolderOrder(tree, scopeRootIds)) {
    try {
      await ports.bookmarks.move(move.id, { parentId: move.parentId, index: move.index })
      sorted++
    } catch (error) {
      skipped.push({ bookmarkId: move.id, reason: msgFolderSortFailed(locale, String(error)) })
    }
  }
  return sorted
}

/**
 * 落地后的保底：范围内还没编号的目录补上号，接着该层已有最大号往后编。
 * 必须在排序之前调用——补完号 planFolderOrder 才能把它们排进编号序列。
 */
async function numberBareFolders(
  ports: Ports,
  scopeRootIds: string[],
  skipped: SkipRecord[],
  locale: Locale,
  skipIds: ReadonlySet<string>,
): Promise<void> {
  const tree = await ports.bookmarks.getTree()
  const renames: { id: string; newTitle: string }[] = []

  function walk(node: BookmarkNode): void {
    const folders = (node.children ?? []).filter((child) => child.url === undefined && !skipIds.has(child.id))
    for (const rename of planBareFolderRenames(folders)) {
      renames.push({ id: rename.id, newTitle: rename.newTitle })
    }
    for (const child of node.children ?? []) {
      if (child.url === undefined) walk(child)
    }
  }

  for (const root of findScopeRoots(tree, scopeRootIds)) walk(root)

  for (const rename of renames) {
    try {
      await ports.bookmarks.update(rename.id, { title: rename.newTitle })
    } catch (error) {
      skipped.push({ bookmarkId: rename.id, reason: msgFolderNumberFailed(locale, String(error)) })
    }
  }
}

export async function applyPlan(
  ports: Ports,
  plan: OrganizePlan,
  accepted: Set<string>,
  locale: Locale,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const onProgress = options.onProgress
  const operations = filterAccepted(plan, accepted)

  const snapshot = await captureSnapshot(ports, plan.id, plan.scopeRootIds)
  await saveSnapshot(ports, snapshot)

  const tempToReal = new Map<string, string>()
  const createdFolderIds: string[] = []
  const renamedBookmarkIds: string[] = []
  let mergeRootId: string | null = null
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
          throw new Error(msgParentUnresolved(locale, operation.title))
        }
        const created = await ports.bookmarks.create({ parentId, title: operation.title })
        tempToReal.set(operation.temporaryId, created.id)
        createdFolderIds.push(created.id)
        // 容器目录的真实 id 只有这里知道，收尾的清理与排序都要靠它才能进到合并根内部
        if (operation.temporaryId === plan.mergeRoot?.temporaryId) mergeRootId = created.id
      } else if (operation.type === 'move_bookmark') {
        const existing = await ports.bookmarks.get(operation.bookmarkId)
        if (existing === null) {
          skipped.push({ bookmarkId: operation.bookmarkId, reason: msgBookmarkGone(locale) })
          continue
        }
        const targetId =
          operation.toTemporaryId !== null
            ? tempToReal.get(operation.toTemporaryId)
            : operation.toCategoryId
        if (targetId === undefined) throw new Error(msgTargetUnresolved(locale, operation.toCategoryId))
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
        mergeRootId,
        failedAt: i,
        error: String(error),
      }
    }
  }

  // 合并根不在 scopeRootIds 里，不带上它，它内部的空目录清不掉、编号目录也排不了序
  const effectiveRootIds = mergeRootId === null ? plan.scopeRootIds : [...plan.scopeRootIds, mergeRootId]
  // 合并把源根有意清空，留下空壳不是任何人想要的结果，不受「清理空目录」开关约束。
  // 名单取 sourceRootIds 而不是 scopeRootIds——后者是级联勾选的全集。
  const removableRootIds = mergeRootId === null ? [] : (plan.mergeRoot?.sourceRootIds ?? [])

  // 只有整批操作都成功才清理——中途失败时结构还没落定，删目录只会添乱
  const removedFolders =
    options.removeEmptyFolders === true || mergeRootId !== null
      ? await removeEmpty(ports, effectiveRootIds, skipped, locale, removableRootIds)
      : []

  // 非推翻模式不产生编号，也不该给用户自己的目录补号或重排
  if (plan.rebuildStructure) {
    await numberBareFolders(
      ports,
      effectiveRootIds,
      skipped,
      locale,
      mergeRootId === null ? new Set() : new Set([mergeRootId]),
    )
  }
  const sortedFolders = plan.rebuildStructure
    ? await sortFolders(ports, effectiveRootIds, skipped, locale)
    : 0

  await saveSnapshot(ports, { ...snapshot, createdFolderIds, renamedBookmarkIds })
  await ports.storage.remove(PROGRESS_KEY)
  return {
    status: 'completed', executed, skipped, createdFolderIds, removedFolders, sortedFolders,
    renamedBookmarkIds, mergeRootId, failedAt: null, error: null,
  }
}
