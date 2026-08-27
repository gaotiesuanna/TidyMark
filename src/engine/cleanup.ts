import type { CleanupSelection } from '@/core/cleanup'
import { findDuplicateGroups, type DuplicateGroup } from '@/core/duplicates'
import { findEmptyFolders, type EmptyFolder } from '@/core/empty'
import type { Locale } from '@/core/locale'
import type { Ports } from '@/core/ports'
import { scanTree } from '@/core/scan'
import type { BookmarkItem, FolderItem } from '@/core/types'
import type { SkipRecord } from './apply'
import {
  msgCleanupBookmarkGone, msgCleanupDeleteFailed,
  msgCleanupFolderNotEmpty, msgCleanupMoveFailed,
} from './messages'
import { saveSnapshot, type BookmarkSnapshot, type SnapshotNode } from './snapshot'

export interface CleanupScan {
  duplicates: DuplicateGroup[]
  /** 扫描当时就已经空着的目录。「删了重复项之后才变空」的那批由界面用 emptyAfterRemoval 推。 */
  emptyFolders: EmptyFolder[]
  items: BookmarkItem[]
  folders: FolderItem[]
  scopeRootIds: string[]
}

export interface CleanupInput {
  planId: string
  scopeRootIds: string[]
  selection: CleanupSelection
  /** 已按界面语言取好的「失效链接」。engine 不 import i18n 以外的取词入口，文案由调用方给。 */
  deadFolderTitle: string
  /** 已按界面语言取好的「待清理」。每个范围根各自复用或创建同名直接子目录。 */
  staleMoveFolderTitle: string
  /** 「失效链接」文件夹建在谁下面，通常是书签栏。 */
  barId: string
  items: BookmarkItem[]
  folders: FolderItem[]
}

export interface CleanupResult {
  status: 'completed' | 'failed'
  deleted: number
  moved: number
  removedFolders: EmptyFolder[]
  /** 本次用到的「失效链接」文件夹 id，没用到时为 null。新建的和复用的都在这里。 */
  deadFolderId: string | null
  skipped: SkipRecord[]
  error: string | null
}

/** 全库扫描：顶层节点 id 全传进 scanTree 就是整棵树。 */
export async function scanForCleanup(ports: Ports): Promise<CleanupScan> {
  const tree = await ports.bookmarks.getTree()
  const rootIds = tree.flatMap((node) => (node.children ?? []).map((child) => child.id))
  const scan = scanTree(tree, rootIds)
  return {
    duplicates: findDuplicateGroups(scan.bookmarks),
    emptyFolders: findEmptyFolders(tree, rootIds),
    items: scan.bookmarks,
    folders: scan.folders,
    scopeRootIds: rootIds,
  }
}

/**
 * 拼一份只含**本次会被动到的节点**的快照。
 *
 * 不调 `captureSnapshot`：那个函数装的是整个范围的每个节点，因为 AI 整理会挪动
 * 范围里的一切。清理不一样——它只碰几十条，其余一根手指都不碰，装全量既浪费
 * 也让撤销去动它不该动的东西。
 *
 * 三类节点缺一不可，第二类最容易漏：被移走的书签**没被删**，撤销第 0 趟的 get
 * 会返回非 null 从而跳过重建，而归位趟只处理快照里有的节点——不进快照，撤销之后
 * 它们就留在「失效链接」文件夹里回不去原位，界面却报了撤销成功。
 *
 * 目录必须排在书签之前：一个目录可能是「删掉它最后一条书签才变空的」，撤销时要先把
 * 目录建出来拿到新 id，那条书签才有地方回（靠 undo.ts 的 idMap 转写）。
 * folders 来自 scanTree 的先序遍历，父目录本就在子目录之前，直接按原序即可。
 */
function buildSnapshot(input: CleanupInput, planId: string, createdAt: number): BookmarkSnapshot {
  const touchedBookmarks = new Set([
    ...input.selection.deleteBookmarkIds,
    ...input.selection.moveBookmarkIds,
    ...input.selection.staleMoveBookmarkIds,
  ])
  const touchedFolders = new Set(input.selection.deleteFolderIds)

  const folderNodes: SnapshotNode[] = input.folders
    .filter((f) => touchedFolders.has(f.id))
    .map((f) => ({ id: f.id, parentId: f.parentId ?? '', index: f.index, title: f.title }))

  const bookmarkNodes: SnapshotNode[] = input.items
    .filter((b) => touchedBookmarks.has(b.id))
    .map((b) => ({ id: b.id, parentId: b.parentId, index: b.index, title: b.title, url: b.url }))

  return {
    createdAt,
    planId,
    scopeRootIds: input.scopeRootIds,
    nodes: [...folderNodes, ...bookmarkNodes],
    // 只放被删除的那批。移走的书签没被删，撤销走的是归位那一趟——
    // 把它放进删除名单不会立刻出错，但语义是错的（见 engine/snapshot.ts 该字段的注释）
    deletedBookmarkIds: [...input.selection.deleteBookmarkIds],
    createdFolderIds: [],
    renamedBookmarkIds: [],
    rootNodes: [],
  }
}

export async function applyCleanup(
  ports: Ports,
  input: CleanupInput,
  locale: Locale,
  options: { onProgress?: (done: number, total: number) => void; now?: () => number } = {},
): Promise<CleanupResult> {
  const now = options.now ?? ((): number => Date.now())
  const onProgress = options.onProgress
  const skipped: SkipRecord[] = []
  const createdFolderIds: string[] = []
  const removedFolders: EmptyFolder[] = []
  let deleted = 0
  let moved = 0
  let deadFolderId: string | null = null

  const snapshot = buildSnapshot(input, input.planId, now())
  await saveSnapshot(ports, snapshot)
  const total = input.selection.deleteBookmarkIds.length
    + input.selection.moveBookmarkIds.length
    + input.selection.staleMoveBookmarkIds.length
    + input.selection.deleteFolderIds.length
  let done = 0
  const tick = (): void => { onProgress?.(++done, total) }
  onProgress?.(0, total)

  try {
    // 1. 按范围根分组移动长期未点击书签。每个范围根只解析一次目的地，
    //    这样同根的多条书签一定复用同一个直接子目录。
    const staleByRoot = new Map<string, string[]>()
    for (const id of input.selection.staleMoveBookmarkIds) {
      const rootId = input.selection.staleMoveRootByBookmarkId[id]
      if (rootId === undefined) {
        skipped.push({ bookmarkId: id, reason: msgCleanupMoveFailed(locale, 'scope root is missing') })
        tick()
        continue
      }
      const ids = staleByRoot.get(rootId) ?? []
      ids.push(id)
      staleByRoot.set(rootId, ids)
    }

    for (const [rootId, ids] of staleByRoot) {
      let staleFolderId = input.folders.find(
        (folder) => folder.parentId === rootId && folder.title === input.staleMoveFolderTitle,
      )?.id
      if (staleFolderId === undefined) {
        try {
          const created = await ports.bookmarks.create({
            parentId: rootId,
            title: input.staleMoveFolderTitle,
          })
          staleFolderId = created.id
          createdFolderIds.push(created.id)
        } catch (error) {
          for (const id of ids) {
            skipped.push({ bookmarkId: id, reason: msgCleanupMoveFailed(locale, String(error)) })
            tick()
          }
          continue
        }
      }

      for (const id of ids) {
        try {
          if ((await ports.bookmarks.get(id)) === null) {
            skipped.push({ bookmarkId: id, reason: msgCleanupBookmarkGone(locale, id) })
            continue
          }
          await ports.bookmarks.move(id, { parentId: staleFolderId })
          moved++
        } catch (error) {
          skipped.push({ bookmarkId: id, reason: msgCleanupMoveFailed(locale, String(error)) })
        } finally {
          tick()
        }
      }
    }

    // 2. 「失效链接」文件夹：同名已存在就复用，且**不记进 createdFolderIds**——
    //    记了的话撤销会把用户上一轮攒下的死链一起删掉。
    if (input.selection.moveBookmarkIds.length > 0) {
      const existing = input.folders.find(
        (f) => f.parentId === input.barId && f.title === input.deadFolderTitle,
      )
      if (existing !== undefined) {
        deadFolderId = existing.id
      } else {
        const created = await ports.bookmarks.create({
          parentId: input.barId,
          title: input.deadFolderTitle,
        })
        deadFolderId = created.id
        createdFolderIds.push(created.id)
      }
    }

    // 3. 移走
    for (const id of input.selection.moveBookmarkIds) {
      try {
        if ((await ports.bookmarks.get(id)) === null) {
          skipped.push({ bookmarkId: id, reason: msgCleanupBookmarkGone(locale, id) })
          continue
        }
        await ports.bookmarks.move(id, { parentId: deadFolderId! })
        moved++
      } catch (error) {
        skipped.push({ bookmarkId: id, reason: msgCleanupMoveFailed(locale, String(error)) })
      } finally {
        tick()
      }
    }

    // 3. 删书签
    for (const id of input.selection.deleteBookmarkIds) {
      try {
        if ((await ports.bookmarks.get(id)) === null) {
          skipped.push({ bookmarkId: id, reason: msgCleanupBookmarkGone(locale, id) })
          continue
        }
        await ports.bookmarks.remove(id)
        deleted++
      } catch (error) {
        skipped.push({ bookmarkId: id, reason: msgCleanupDeleteFailed(locale, String(error)) })
      } finally {
        tick()
      }
    }

    // 4. 删空目录。
    //    按用户勾的名单走，不重新跑一遍 findEmptyFolders 把结果全删掉——那会删掉
    //    他没勾的目录。预览是纯函数算的、与真实结果一致，名单就够；
    //    逐个复查一次是否真空只是兜底，防的是执行期间用户自己往里放了东西。
    if (input.selection.deleteFolderIds.length > 0) {
      const tree = await ports.bookmarks.getTree()
      const nowEmpty = new Set(findEmptyFolders(tree, input.scopeRootIds).map((f) => f.id))
      const byId = new Map(input.folders.map((f) => [f.id, f]))
      for (const id of input.selection.deleteFolderIds) {
        try {
          if (!nowEmpty.has(id)) {
            skipped.push({ bookmarkId: id, reason: msgCleanupFolderNotEmpty(locale) })
            continue
          }
          await ports.bookmarks.remove(id)
          const folder = byId.get(id)
          removedFolders.push({
            id,
            title: folder?.title ?? '',
            path: folder?.path ?? [],
          })
        } catch (error) {
          skipped.push({ bookmarkId: id, reason: msgCleanupDeleteFailed(locale, String(error)) })
        } finally {
          tick()
        }
      }
    }

    // 5. 回填新建的文件夹 id，撤销靠它把「失效链接」删掉
    await saveSnapshot(ports, { ...snapshot, createdFolderIds })

    return { status: 'completed', deleted, moved, removedFolders, deadFolderId, skipped, error: null }
  } catch (error) {
    await saveSnapshot(ports, { ...snapshot, createdFolderIds })
    return {
      status: 'failed', deleted, moved, removedFolders, deadFolderId, skipped,
      error: String(error),
    }
  }
}
