import { describe, it, expect } from 'vitest'
import { applyCleanup, type CleanupInput } from '@/engine/cleanup'
import { SNAPSHOT_KEY, type BookmarkSnapshot } from '@/engine/snapshot'
import { scanTree } from '@/core/scan'
import type { BookmarksApi } from '@/core/ports'
import type { ScanResult } from '@/core/types'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'

function setup() {
  const bookmarks = createFakeBookmarks([
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '目录甲', children: [
          { id: '100', title: 'a', url: 'https://a' },
          { id: '101', title: 'a 又存了一遍', url: 'https://a' },
        ]},
        { id: '11', title: '目录乙', children: [
          { id: '110', title: 'dead', url: 'https://dead' },
        ]},
      ]},
    ]},
  ])
  const storage = createFakeStorage()
  return { bookmarks, storage, ports: { bookmarks: bookmarks.api, storage } }
}

async function scanOf(ports: { bookmarks: BookmarksApi }): Promise<ScanResult> {
  return scanTree(await ports.bookmarks.getTree(), ['1'])
}

function input(over: Partial<CleanupInput>, scan: ScanResult): CleanupInput {
  return {
    planId: 'c1', scopeRootIds: ['1'], barId: '1', deadFolderTitle: '失效链接',
    selection: { deleteBookmarkIds: [], moveBookmarkIds: [], deleteFolderIds: [] },
    items: scan.bookmarks, folders: scan.folders,
    ...over,
  }
}

describe('applyCleanup 删除', () => {
  it('删掉选中的书签', async () => {
    const { ports, bookmarks } = setup()
    const scan = await scanOf(ports)
    const result = await applyCleanup(ports, input({
      selection: { deleteBookmarkIds: ['101'], moveBookmarkIds: [], deleteFolderIds: [] },
    }, scan), 'zh_CN')

    expect(result.status).toBe('completed')
    expect(result.deleted).toBe(1)
    expect(await bookmarks.api.get('101')).toBeNull()
    expect(await bookmarks.api.get('100')).not.toBeNull()
  })

  it('删掉选中的空目录', async () => {
    const { ports, bookmarks } = setup()
    const scan = await scanOf(ports)
    await applyCleanup(ports, input({
      selection: { deleteBookmarkIds: ['110'], moveBookmarkIds: [], deleteFolderIds: ['11'] },
    }, scan), 'zh_CN')

    expect(await bookmarks.api.get('11')).toBeNull()
  })

  /**
   * 不采用「删完重新跑一遍 findEmptyFolders 把结果全删掉」的做法：那会删掉
   * 用户没勾的目录。按名单走，复查只是兜底。
   */
  it('没被勾中的空目录不删', async () => {
    const { ports, bookmarks } = setup()
    const scan = await scanOf(ports)
    await applyCleanup(ports, input({
      selection: { deleteBookmarkIds: ['110'], moveBookmarkIds: [], deleteFolderIds: [] },
    }, scan), 'zh_CN')

    expect(await bookmarks.api.get('11')).not.toBeNull()
  })

  it('勾中的目录执行时其实不空，跳过并记一条 skipped，不硬删', async () => {
    const { ports, bookmarks } = setup()
    const scan = await scanOf(ports)
    const result = await applyCleanup(ports, input({
      selection: { deleteBookmarkIds: [], moveBookmarkIds: [], deleteFolderIds: ['11'] },
    }, scan), 'zh_CN')

    expect(await bookmarks.api.get('11')).not.toBeNull()
    expect(result.skipped.map((s) => s.bookmarkId)).toContain('11')
  })
})

describe('applyCleanup 移到失效链接文件夹', () => {
  it('新建文件夹并把书签移进去', async () => {
    const { ports, bookmarks } = setup()
    const scan = await scanOf(ports)
    const result = await applyCleanup(ports, input({
      selection: { deleteBookmarkIds: [], moveBookmarkIds: ['110'], deleteFolderIds: [] },
    }, scan), 'zh_CN')

    expect(result.moved).toBe(1)
    expect(result.deadFolderId).not.toBeNull()
    const moved = await bookmarks.api.get('110')
    expect(moved!.parentId).toBe(result.deadFolderId)
  })

  /**
   * 复用已存在的同名文件夹，而且**不记进 createdFolderIds**——否则撤销会把
   * 用户上一轮攒下的死链一起删掉。
   */
  it('同名文件夹已存在时复用它，且不进 createdFolderIds', async () => {
    const bookmarks = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '9', title: '失效链接', children: [
            { id: '90', title: '上一轮的', url: 'https://old-dead' },
          ]},
          { id: '11', title: '目录乙', children: [
            { id: '110', title: 'dead', url: 'https://dead' },
          ]},
        ]},
      ]},
    ])
    const storage = createFakeStorage()
    const ports = { bookmarks: bookmarks.api, storage }
    const scan = scanTree(await bookmarks.api.getTree(), ['1'])

    const result = await applyCleanup(ports, input({
      selection: { deleteBookmarkIds: [], moveBookmarkIds: ['110'], deleteFolderIds: [] },
    }, scan), 'zh_CN')

    expect(result.deadFolderId).toBe('9')
    const snapshot = await storage.get<BookmarkSnapshot>(SNAPSHOT_KEY)
    expect(snapshot!.createdFolderIds).not.toContain('9')
  })
})

describe('applyCleanup 快照', () => {
  it('只装本次会被动到的节点，不装整个范围', async () => {
    const { ports, storage } = setup()
    const scan = await scanOf(ports)
    await applyCleanup(ports, input({
      selection: { deleteBookmarkIds: ['101'], moveBookmarkIds: [], deleteFolderIds: [] },
    }, scan), 'zh_CN')

    const snapshot = await storage.get<BookmarkSnapshot>(SNAPSHOT_KEY)
    expect(snapshot!.nodes.map((n) => n.id)).toEqual(['101'])
  })

  /**
   * 最容易漏的一条，漏了就是真 bug：被移走的书签没被删，undo 第 0 趟的 get
   * 会返回非 null 从而跳过重建，而归位趟只处理快照里有的节点——于是撤销之后
   * 它们留在「失效链接」文件夹里回不去原位，界面却报了撤销成功。
   */
  it('被移走的书签也必须进快照，连同原来的 parentId 与 index', async () => {
    const { ports, storage } = setup()
    const scan = await scanOf(ports)
    await applyCleanup(ports, input({
      selection: { deleteBookmarkIds: [], moveBookmarkIds: ['110'], deleteFolderIds: [] },
    }, scan), 'zh_CN')

    const snapshot = await storage.get<BookmarkSnapshot>(SNAPSHOT_KEY)
    const moved = snapshot!.nodes.find((n) => n.id === '110')
    expect(moved).toBeDefined()
    expect(moved!.parentId).toBe('11')
    expect(moved!.index).toBe(0)
  })

  it('删除名单只收被删的，不收被移走的', async () => {
    const { ports, storage } = setup()
    const scan = await scanOf(ports)
    await applyCleanup(ports, input({
      selection: { deleteBookmarkIds: ['101'], moveBookmarkIds: ['110'], deleteFolderIds: [] },
    }, scan), 'zh_CN')

    const snapshot = await storage.get<BookmarkSnapshot>(SNAPSHOT_KEY)
    expect(snapshot!.deletedBookmarkIds).toEqual(['101'])
  })

  it('目录排在书签前面，撤销时才能先把目录建出来给书签落脚', async () => {
    const { ports, storage } = setup()
    const scan = await scanOf(ports)
    await applyCleanup(ports, input({
      selection: { deleteBookmarkIds: ['110'], moveBookmarkIds: [], deleteFolderIds: ['11'] },
    }, scan), 'zh_CN')

    const snapshot = await storage.get<BookmarkSnapshot>(SNAPSHOT_KEY)
    const ids = snapshot!.nodes.map((n) => n.id)
    expect(ids.indexOf('11')).toBeLessThan(ids.indexOf('110'))
  })

  it('快照在任何改动之前就写下了', async () => {
    const { ports, storage, bookmarks } = setup()
    const scan = await scanOf(ports)
    const original = bookmarks.api.remove.bind(bookmarks.api)
    let snapshotAtFirstRemove: unknown = 'never removed'
    bookmarks.api.remove = async (id: string) => {
      if (snapshotAtFirstRemove === 'never removed') {
        snapshotAtFirstRemove = await storage.get(SNAPSHOT_KEY)
      }
      return original(id)
    }

    await applyCleanup(ports, input({
      selection: { deleteBookmarkIds: ['101'], moveBookmarkIds: [], deleteFolderIds: [] },
    }, scan), 'zh_CN')

    expect(snapshotAtFirstRemove).not.toBeNull()
    expect(snapshotAtFirstRemove).not.toBe('never removed')
  })
})

describe('applyCleanup 容错', () => {
  it('单条失败只记 skipped，不中断其余', async () => {
    const { ports, bookmarks } = setup()
    const scan = await scanOf(ports)
    const original = bookmarks.api.remove.bind(bookmarks.api)
    bookmarks.api.remove = async (id: string) => {
      if (id === '101') throw new Error('boom')
      return original(id)
    }

    const result = await applyCleanup(ports, input({
      selection: { deleteBookmarkIds: ['101', '110'], moveBookmarkIds: [], deleteFolderIds: [] },
    }, scan), 'zh_CN')

    expect(result.status).toBe('completed')
    expect(result.deleted).toBe(1)
    expect(result.skipped.map((s) => s.bookmarkId)).toContain('101')
    expect(await bookmarks.api.get('110')).toBeNull()
  })

  it('书签在执行前已经被用户自己删了，记 skipped 不报错', async () => {
    const { ports, bookmarks } = setup()
    const scan = await scanOf(ports)
    await bookmarks.api.remove('101')

    const result = await applyCleanup(ports, input({
      selection: { deleteBookmarkIds: ['101'], moveBookmarkIds: [], deleteFolderIds: [] },
    }, scan), 'zh_CN')

    expect(result.status).toBe('completed')
    expect(result.skipped.map((s) => s.bookmarkId)).toContain('101')
  })
})
