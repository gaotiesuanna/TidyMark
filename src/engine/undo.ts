import type { Locale } from '@/core/locale'
import type { Ports } from '@/core/ports'
import {
  msgFolderRebuildFailed, msgNodeGone, msgRepositionFailed,
  msgReorderFailed, msgTitleManuallyChanged, msgTitleRestoreFailed,
} from './messages'
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
  /**
   * 本次撤销重建出来的范围根的**新** id，按快照顺序；没重建过任何根时为空数组。
   *
   * 重建只能新建节点，旧 id 一去不返。调用方（结果页）手里的 plan.scopeRootIds
   * 与 applyResult.mergeRootId 在合并撤销之后全指向不存在的节点，
   * 不把新 id 带出去，它就再也找不到那几个刚被还原回来的目录。
   */
  rebuiltRootIds: string[]
}

export async function undoLast(
  ports: Ports,
  locale: Locale,
  onProgress?: (done: number, total: number) => void,
): Promise<UndoResult> {
  const snapshot = await loadSnapshot(ports)
  if (snapshot === null) {
    return { status: 'no_snapshot', restored: 0, skipped: [], removedFolders: 0, rebuiltRootIds: [] }
  }

  const skipped: UndoSkip[] = []
  const restorable: SnapshotNode[] = []
  // 标题是我们改的，撤销时要还原；其余书签的标题一律不碰
  const renamedByUs = new Set(snapshot.renamedBookmarkIds ?? [])

  // 第 0 趟：重建被删掉的节点（目录，以及名单上的书签）。
  // 范围根先于其余节点——它们不在 nodes 里，但 nodes 的 parentId 可能指向它们。
  // 合并会有意删掉源根，先把根建出来并登记进 idMap，其下每个节点归位时
  // mapId(parentId) 才能落到新根上；否则整棵子树都会撞上一个已死的 id。
  // 快照里文件夹按先序排列，父目录必定排在子目录之前，因此顺序创建即可；
  // 重建出来的目录是新 id，用 idMap 把快照里的旧 id 映射过去。
  // rootNodes 用 ?? [] 兜底：字段是后加的，旧版本写进 storage 的快照里没有它，
  // 直接遍历会抛 TypeError，撤销整个失败，用户的书签树就卡在整理后的样子回不来了。
  const idMap = new Map<string, string>()
  const mapId = (id: string): string => idMap.get(id) ?? id
  // 老快照里没有这个字段（?? [] 兜底，与紧邻的 rootNodes 是同一种考虑），
  // 空名单 ⇒ 一条书签都不重建 ⇒ 与改动前逐字等价。
  const deletedByUs = new Set(snapshot.deletedBookmarkIds ?? [])
  for (const node of [...(snapshot.rootNodes ?? []), ...snapshot.nodes]) {
    // 不是「书签一律不重建」，而是「只重建我们自己删掉的那些」。
    //
    // 最初的方案是把这道闸整个删掉，理由是「AI 整理从不删书签，后面那道
    // get(id) !== null 会把它们全挡回去，所以是 no-op」。那个论证漏了一种情形：
    // 用户在 apply 之后自己手动删掉某条书签时，get 也返回 null——于是撤销会把
    // 他亲手删的东西复活。那是一条刻意的产品不变量，三条既有用例守着它
    //（「被用户删掉的书签不会被重新创建」及其两个同伴）。
    //
    // 「不存在」这个事实说不清原因，所以不靠推断，靠写快照那一方交代的名单。
    if (node.url !== undefined && !deletedByUs.has(node.id)) continue
    // get 也放进 try：它一旦 reject，异常会穿出整个 undoLast，什么都没还原就结束了。
    // 这一趟里其余每一步失败都只记一条 skip，单次查询没有理由是唯一的例外。
    try {
      if ((await ports.bookmarks.get(node.id)) !== null) continue
      const created = await ports.bookmarks.create({
        parentId: mapId(node.parentId),
        title: node.title,
        // BookmarksApi.create 的约定：传了 url 建书签，没传建文件夹
        ...(node.url !== undefined ? { url: node.url } : {}),
      })
      idMap.set(node.id, created.id)
    } catch (error) {
      skipped.push({ id: node.id, title: node.title, reason: msgFolderRebuildFailed(locale, String(error)) })
    }
  }

  // 重建出来的范围根还得归位：create 只能追加到父目录末尾，原本的兄弟次序就丢了，
  // 而 rootNodes 不参与后面两趟，没人会把它挪回去——撤销于是悄悄重排了用户的书签栏。
  // 只收被真正重建过的（idMap 里有记录才是重建过的）：幸存的范围根按定义不在其中，
  // 「撤销不动幸存的范围根」这条不变量因此原样成立。
  // 归位交给后面两趟而不是在 create 时传 index：只补回部分兄弟时，
  // 唯有第二趟那套按 parent 分组、组内升序插入的做法才能复原原始排列。
  const rebuiltRootIds: string[] = []
  for (const node of snapshot.rootNodes ?? []) {
    if (!idMap.has(node.id)) continue
    restorable.push(node)
    rebuiltRootIds.push(idMap.get(node.id)!)
  }

  // 校验：只还原仍然存在的节点。
  // 文件夹标题属于结构信息，若被 Apply 之后的操作改动，强制恢复；
  // 书签（带 url）的标题若被用户手动改过，视为用户的有意修改，跳过以免覆盖。
  for (const node of snapshot.nodes) {
    const current = await ports.bookmarks.get(mapId(node.id))
    if (current === null) {
      skipped.push({ id: node.id, title: node.title, reason: msgNodeGone(locale) })
      continue
    }
    const isFolder = node.url === undefined
    if (current.title !== node.title) {
      if (isFolder || renamedByUs.has(node.id)) {
        try {
          await ports.bookmarks.update(mapId(node.id), { title: node.title })
        } catch (error) {
          skipped.push({ id: node.id, title: node.title, reason: msgTitleRestoreFailed(locale, String(error)) })
          continue
        }
      } else {
        skipped.push({
          id: node.id, title: node.title, reason: msgTitleManuallyChanged(locale),
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
    const current = await ports.bookmarks.get(mapId(node.id))
    if (current !== null && current.parentId === mapId(node.parentId)) {
      parentRestored.push(node)
      continue
    }
    try {
      await ports.bookmarks.move(mapId(node.id), { parentId: mapId(node.parentId) })
      parentRestored.push(node)
    } catch (error) {
      skipped.push({ id: node.id, title: node.title, reason: msgRepositionFailed(locale, String(error)) })
    }
  }

  // 第二趟：按 parent 分组，在组内按 index 升序逐个落位。
  // 必须升序 —— 乱序插入会把已就位的节点挤走。
  const byParent = new Map<string, SnapshotNode[]>()
  for (const node of parentRestored) {
    const parentId = mapId(node.parentId)
    const group = byParent.get(parentId) ?? []
    group.push(node)
    byParent.set(parentId, group)
  }

  for (const [parentId, group] of byParent) {
    group.sort((a, b) => a.index - b.index)
    for (const node of group) {
      try {
        await ports.bookmarks.move(mapId(node.id), { parentId, index: node.index })
        done++
        onProgress?.(done, total)
      } catch (error) {
        skipped.push({ id: node.id, title: node.title, reason: msgReorderFailed(locale, String(error)) })
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
  return { status: 'completed', restored: done, skipped, removedFolders, rebuiltRootIds }
}
