import { describe, it, expect } from 'vitest'
import { undoLast } from '@/engine/undo'
import { loadSnapshot, saveSnapshot, captureSnapshot } from '@/engine/snapshot'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'
import type { Ports } from '@/core/ports'

const initial = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'react', children: [] },
      { id: '11', title: '杂项', children: [
        { id: '100', title: 'A', url: 'https://a.dev' },
        { id: '101', title: 'B', url: 'https://b.dev' },
        { id: '102', title: 'C', url: 'https://c.dev' },
      ]},
    ]},
  ]},
]

function setup() {
  const fake = createFakeBookmarks(initial)
  const storage = createFakeStorage()
  const ports: Ports = { bookmarks: fake.api, storage }
  return { fake, storage, ports }
}

describe('undoLast 重建被删掉的文件夹', () => {
  it('文件夹被删掉后重建，书签回到里面', async () => {
    const { ports, fake } = setup()
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['1']))
    // 模拟清理：先把书签搬走，再删掉空目录
    for (const id of ['100', '101', '102']) await fake.api.move(id, { parentId: '10' })
    await fake.api.remove('11')

    const result = await undoLast(ports, 'zh_CN')
    expect(result.skipped).toEqual([])
    expect(fake.structure()).toContain('书签栏/杂项/A')
    expect(fake.structure()).toContain('书签栏/杂项/C')
  })

  it('嵌套目录被整串删掉也能重建，层级不乱', async () => {
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: '外层', children: [
            { id: '11', title: '内层', children: [
              { id: '100', title: 'A', url: 'https://a.dev' },
            ]},
          ]},
        ]},
      ]},
    ])
    const ports: Ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['1']))
    await fake.api.move('100', { parentId: '1' })
    await fake.api.remove('11')
    await fake.api.remove('10')

    await undoLast(ports, 'zh_CN')
    expect(fake.structure()).toContain('书签栏/外层/内层/A')
  })

  it('被用户删掉的书签不会被重新创建', async () => {
    const { ports, fake } = setup()
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['1']))
    await fake.api.remove('100')

    const result = await undoLast(ports, 'zh_CN')
    expect(result.skipped.some((s) => s.id === '100')).toBe(true)
    expect(fake.structure()).not.toContain('杂项/A')
  })

  it('级联勾选下清理空目录后撤销仍能完整复原', async () => {
    // 回归测试：侧栏勾「书签栏」时 toggleChecked 会级联勾上它所有子目录，
    // captureSnapshot 传入的 scopeRootIds 因此是 ['1', '10', '11']，而不是只有 ['1']。
    // 若快照的 rootSet 判定直接拿 scopeRootIds 当集合（旧 bug），'10'、'11' 会被
    // 一并当成范围根滤出 nodes，清理空目录删掉它们之后撤销就无法重建，
    // 书签归位时 parentId 指向已经不存在的旧目录 id，最终整棵树对不上原状。
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: '前端', children: [
            { id: '100', title: 'React', url: 'https://react.dev' },
          ]},
          { id: '11', title: '后端', children: [
            { id: '101', title: 'Node', url: 'https://node.dev' },
          ]},
        ]},
      ]},
    ])
    const ports: Ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const before = fake.structure()
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['1', '10', '11']))

    // 模拟「清理空目录」：整理先把书签搬走，子目录变空后再被删掉
    await fake.api.move('100', { parentId: '1' })
    await fake.api.move('101', { parentId: '1' })
    await fake.api.remove('10')
    await fake.api.remove('11')

    const result = await undoLast(ports, 'zh_CN')
    expect(result.skipped).toEqual([])
    expect(fake.structure()).toBe(before)
  })
})

describe('undoLast', () => {
  it('无快照时返回 no_snapshot', async () => {
    const { ports } = setup()
    expect(await undoLast(ports, 'zh_CN')).toMatchObject({ status: 'no_snapshot', restored: 0 })
  })

  it('把书签移回原 parent', async () => {
    const { ports, fake } = setup()
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['1']))
    await fake.api.move('100', { parentId: '10' })

    const result = await undoLast(ports, 'zh_CN')
    expect(result.status).toBe('completed')
    expect((await fake.api.get('100'))!.parentId).toBe('11')
  })

  it('恢复原本的 index 顺序，不被后插入的挤走', async () => {
    const { ports, fake } = setup()
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['1']))
    // 打乱：全部移到 react，且顺序颠倒
    await fake.api.move('102', { parentId: '10' })
    await fake.api.move('101', { parentId: '10' })
    await fake.api.move('100', { parentId: '10' })

    await undoLast(ports, 'zh_CN')
    // 顶层含隐藏的空标题根节点 '0'（模拟 Chrome 的书签根），structure() 会照实输出其 '/' 前缀。
    expect(fake.structure()).toBe(
      ['/', '/书签栏/', '/书签栏/react/', '/书签栏/杂项/', '/书签栏/杂项/A', '/书签栏/杂项/B', '/书签栏/杂项/C'].join(
        '\n',
      ),
    )
  })

  it('恢复被重命名的文件夹标题', async () => {
    const { ports, fake } = setup()
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['1']))
    await fake.api.update('11', { title: '归档' })

    await undoLast(ports, 'zh_CN')
    expect((await fake.api.get('11'))!.title).toBe('杂项')
  })

  it('删除本次新建且已清空的文件夹', async () => {
    const { ports, fake } = setup()
    const snapshot = await captureSnapshot(ports, 'p1', ['1'])
    const created = await fake.api.create({ parentId: '1', title: '前端' })
    await fake.api.move('100', { parentId: created.id })
    await saveSnapshot(ports, { ...snapshot, createdFolderIds: [created.id] })

    const result = await undoLast(ports, 'zh_CN')
    expect(result.removedFolders).toBe(1)
    expect(await fake.api.get(created.id)).toBeNull()
  })

  it('新建文件夹里若还有用户后来放进去的东西，则保留不删', async () => {
    const { ports, fake } = setup()
    const snapshot = await captureSnapshot(ports, 'p1', ['1'])
    const created = await fake.api.create({ parentId: '1', title: '前端' })
    await fake.api.move('100', { parentId: created.id })
    await saveSnapshot(ports, { ...snapshot, createdFolderIds: [created.id] })
    // 用户事后手动新增了一条
    await fake.api.create({ parentId: created.id, title: '用户自己建的' })

    const result = await undoLast(ports, 'zh_CN')
    expect(result.removedFolders).toBe(0)
    expect(await fake.api.get(created.id)).not.toBeNull()
  })

  it('节点已被用户删除时跳过并记录，不抛错', async () => {
    const { ports, fake } = setup()
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['1']))
    await fake.api.remove('100')

    const result = await undoLast(ports, 'zh_CN')
    expect(result.status).toBe('completed')
    expect(result.skipped).toContainEqual({ id: '100', title: 'A', reason: '节点已不存在' })
  })

  it('英文 locale 下节点已不存在的提示也是英文', async () => {
    const { ports, fake } = setup()
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['1']))
    await fake.api.remove('100')

    const result = await undoLast(ports, 'en')
    expect(result.skipped).toContainEqual({ id: '100', title: 'A', reason: 'Node no longer exists' })
  })

  it('用户在 Apply 之后手动改过标题的节点不被覆盖', async () => {
    const { ports, fake } = setup()
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['1']))
    await fake.api.move('100', { parentId: '10' })
    await fake.api.update('100', { title: 'A（我改过）' })

    const result = await undoLast(ports, 'zh_CN')
    expect(result.skipped).toContainEqual({
      id: '100', title: 'A', reason: '标题已被手动修改，跳过以免覆盖',
    })
    expect((await fake.api.get('100'))!.parentId).toBe('10')
    expect((await fake.api.get('100'))!.title).toBe('A（我改过）')
  })

  it('英文 locale 下标题手动修改的提示也是英文', async () => {
    const { ports, fake } = setup()
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['1']))
    await fake.api.move('100', { parentId: '10' })
    await fake.api.update('100', { title: 'A（我改过）' })

    const result = await undoLast(ports, 'en')
    expect(result.skipped).toContainEqual({
      id: '100', title: 'A', reason: 'Title was manually changed; skipped to avoid overwriting it',
    })
  })

  it('单个节点还原失败不影响其余节点', async () => {
    const fake = createFakeBookmarks(initial)
    const storage = createFakeStorage()
    const ports: Ports = { bookmarks: fake.api, storage }
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['1']))
    await fake.api.move('100', { parentId: '10' })
    await fake.api.move('101', { parentId: '10' })

    let calls = 0
    ports.bookmarks = {
      ...fake.api,
      async move(id, dest) {
        calls++
        if (id === '100' && calls <= 1) throw new Error('模拟失败')
        return fake.api.move(id, dest)
      },
    }
    const result = await undoLast(ports, 'zh_CN')
    expect(result.status).toBe('completed')
    expect(result.skipped.some((s) => s.id === '100')).toBe(true)
    expect((await fake.api.get('101'))!.parentId).toBe('11')
  })

  it('撤销成功后清除快照，防止二次撤销', async () => {
    const { ports } = setup()
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['1']))
    await undoLast(ports, 'zh_CN')
    expect(await loadSnapshot(ports)).toBeNull()
  })

  it('还原时先归位 parent 再排序，跨目录乱序也能完全复原', async () => {
    const { ports, fake } = setup()
    const before = fake.structure()
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['1']))
    await fake.api.move('101', { parentId: '10', index: 0 })
    await fake.api.move('100', { parentId: '10', index: 0 })
    await fake.api.move('102', { parentId: '10', index: 1 })

    await undoLast(ports, 'zh_CN')
    expect(fake.structure()).toBe(before)
  })
})

describe('undoLast 重建被删的范围根', () => {
  it('源根被删后能重建，整棵子树回到原位', async () => {
    const { ports, fake } = setup()
    const before = fake.structure()
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['10', '11']))
    // 模拟合并：书签搬进新建的容器目录，两个源根被清理掉
    const merged = await fake.api.create({ parentId: '1', title: 'AI 学习' })
    for (const id of ['100', '101', '102']) await fake.api.move(id, { parentId: merged.id })
    await fake.api.remove('10')
    await fake.api.remove('11')

    const result = await undoLast(ports, 'zh_CN')
    expect(result.skipped).toEqual([])
    await fake.api.remove(merged.id)
    expect(fake.structure()).toEqual(before)
  })

  it('范围根未被删时不移动它', async () => {
    const { ports, fake } = setup()
    await saveSnapshot(ports, await captureSnapshot(ports, 'p1', ['10', '11']))
    // Chrome 语义下同 parent 内向后移动以移除前的下标计算，index: 1 对首位元素是空操作，
    // 必须传 2 才真的把 '10' 挪到 '11' 后面，否则这条用例什么都没验证
    await fake.api.move('10', { parentId: '1', index: 2 })
    await undoLast(ports, 'zh_CN')
    expect((await fake.api.get('10'))!.index).toBe(1)
  })

  it('旧快照没有 rootNodes 时不报错', async () => {
    const { ports } = setup()
    const snapshot = await captureSnapshot(ports, 'p1', ['1'])
    const legacy = { ...snapshot }
    delete (legacy as Partial<typeof snapshot>).rootNodes
    await saveSnapshot(ports, legacy as typeof snapshot)
    expect((await undoLast(ports, 'zh_CN')).status).toBe('completed')
  })
})
