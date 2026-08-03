import { describe, it, expect } from 'vitest'
import { captureSnapshot, saveSnapshot, loadSnapshot, clearSnapshot, SNAPSHOT_KEY } from '@/engine/snapshot'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'

const initial = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'react', children: [
        { id: '100', title: 'React', url: 'https://react.dev' },
      ]},
    ]},
    { id: '2', title: '其他书签', children: [
      { id: '200', title: '不在范围内', url: 'https://out.dev' },
    ]},
  ]},
]

function ports() {
  const bookmarks = createFakeBookmarks(initial)
  return { ports: { bookmarks: bookmarks.api, storage: createFakeStorage() }, fake: bookmarks }
}

describe('captureSnapshot', () => {
  it('只记录范围内的节点', async () => {
    const { ports: p } = ports()
    const snapshot = await captureSnapshot(p, 'plan-1', ['1'])
    expect(snapshot.nodes.map((n) => n.id).sort()).toEqual(['10', '100'])
  })

  it('记录每个节点的 parentId、index、title、url', async () => {
    const { ports: p } = ports()
    const snapshot = await captureSnapshot(p, 'plan-1', ['1'])
    expect(snapshot.nodes.find((n) => n.id === '100')).toEqual({
      id: '100', parentId: '10', index: 0, title: 'React', url: 'https://react.dev',
    })
  })

  it('记录 planId 与范围根', async () => {
    const { ports: p } = ports()
    const snapshot = await captureSnapshot(p, 'plan-1', ['1'])
    expect(snapshot.planId).toBe('plan-1')
    expect(snapshot.scopeRootIds).toEqual(['1'])
    expect(snapshot.createdFolderIds).toEqual([])
  })
})

describe('快照存取', () => {
  it('保存后能原样读回', async () => {
    const { ports: p } = ports()
    const snapshot = await captureSnapshot(p, 'plan-1', ['1'])
    await saveSnapshot(p, snapshot)
    expect(await loadSnapshot(p)).toEqual(snapshot)
  })

  it('保存新快照会覆盖旧快照', async () => {
    const { ports: p } = ports()
    await saveSnapshot(p, await captureSnapshot(p, 'plan-1', ['1']))
    await saveSnapshot(p, await captureSnapshot(p, 'plan-2', ['2']))
    expect((await loadSnapshot(p))!.planId).toBe('plan-2')
  })

  it('无快照时返回 null', async () => {
    const { ports: p } = ports()
    expect(await loadSnapshot(p)).toBeNull()
  })

  it('清除后读不到', async () => {
    const { ports: p } = ports()
    await saveSnapshot(p, await captureSnapshot(p, 'plan-1', ['1']))
    await clearSnapshot(p)
    expect(await loadSnapshot(p)).toBeNull()
  })

  it('使用约定的存储 key', async () => {
    const { ports: p } = ports()
    await saveSnapshot(p, await captureSnapshot(p, 'plan-1', ['1']))
    expect(Object.keys((p.storage as ReturnType<typeof createFakeStorage>).dump()))
      .toContain(SNAPSHOT_KEY)
  })
})
