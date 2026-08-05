import { describe, it, expect } from 'vitest'
import { importTree } from '@/engine/importTree'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'
import type { Ports } from '@/core/ports'
import type { ExportNode } from '@/core/export'

const initial = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: '已有目录', children: [] },
    ]},
  ]},
]

function setup() {
  const fake = createFakeBookmarks(initial)
  const ports: Ports = { bookmarks: fake.api, storage: createFakeStorage() }
  return { fake, ports }
}

const nested: ExportNode[] = [
  { name: 'NiceG', children: [
    { name: '组件库', children: [
      { name: 'shadcn/ui', url: 'https://ui.shadcn.com' },
      { name: 'Radix', url: 'https://radix-ui.com' },
    ]},
    { name: 'Figma', url: 'https://figma.com' },
  ]},
]

describe('importTree', () => {
  it('先建目标文件夹，内容全部建在它里面', async () => {
    const { fake, ports } = setup()
    const result = await importTree(ports, nested, '导入 2026-08-04', '1')

    expect(fake.structure()).toContain('书签栏/导入 2026-08-04/')
    expect(fake.structure()).toContain('书签栏/导入 2026-08-04/NiceG/组件库/shadcn/ui')
    // 目标文件夹的 id 要返回给调用方
    const created = await ports.bookmarks.get(result.folderId)
    expect(created!.title).toBe('导入 2026-08-04')
  })

  it('嵌套层级与顺序都与文件一致', async () => {
    const { ports } = setup()
    await importTree(ports, nested, '导入', '1')
    const tree = await ports.bookmarks.getTree()
    const target = tree[0]!.children![0]!.children![1]!
    expect(target.title).toBe('导入')

    const niceg = target.children![0]!
    expect(niceg.title).toBe('NiceG')
    // 组件库在前、Figma 在后，与 nested 中的顺序一致
    expect(niceg.children!.map((c) => c.title)).toEqual(['组件库', 'Figma'])
    expect(niceg.children![0]!.children!.map((c) => c.title)).toEqual(['shadcn/ui', 'Radix'])
    expect(niceg.children![1]!.url).toBe('https://figma.com')
  })

  it('统计建出来的书签数与文件夹数，目标文件夹本身不计入', async () => {
    const { ports } = setup()
    const result = await importTree(ports, nested, '导入', '1')
    expect(result.bookmarks).toBe(3)
    expect(result.folders).toBe(2)
    expect(result.skipped).toEqual([])
  })

  it('空文件夹也会被建出来', async () => {
    const { fake, ports } = setup()
    await importTree(ports, [{ name: '空的', children: [] }], '导入', '1')
    expect(fake.structure()).toContain('书签栏/导入/空的/')
  })

  it('平铺的书签列表（links 格式归一后的形状）直接建在目标文件夹下', async () => {
    const { ports } = setup()
    const result = await importTree(ports, [
      { name: 'A', url: 'https://a.dev' },
      { name: 'B', url: 'https://b.dev' },
    ], '导入', '1')
    expect(result.bookmarks).toBe(2)
    expect(result.folders).toBe(0)
  })

  it('单条书签创建失败时记入 skipped 并继续建后面的', async () => {
    const fake = createFakeBookmarks(initial)
    const ports: Ports = {
      bookmarks: {
        ...fake.api,
        async create(arg) {
          if (arg.url === 'https://bad.dev') throw new Error('boom')
          return fake.api.create(arg)
        },
      },
      storage: createFakeStorage(),
    }
    const result = await importTree(ports, [
      { name: '好', url: 'https://good.dev' },
      { name: '坏', url: 'https://bad.dev' },
      { name: '也好', url: 'https://also-good.dev' },
    ], '导入', '1')

    expect(result.bookmarks).toBe(2)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.name).toBe('坏')
    expect(result.skipped[0]!.url).toBe('https://bad.dev')
    expect(result.skipped[0]!.reason).toContain('创建失败')
  })

  it('文件夹创建失败时跳过它整棵子树，不影响同级', async () => {
    const fake = createFakeBookmarks(initial)
    const ports: Ports = {
      bookmarks: {
        ...fake.api,
        async create(arg) {
          if (arg.title === '坏目录') throw new Error('boom')
          return fake.api.create(arg)
        },
      },
      storage: createFakeStorage(),
    }
    const result = await importTree(ports, [
      { name: '坏目录', children: [{ name: '里面的', url: 'https://inner.dev' }] },
      { name: '好目录', children: [{ name: '正常的', url: 'https://ok.dev' }] },
    ], '导入', '1')

    expect(result.folders).toBe(1)
    expect(result.bookmarks).toBe(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.name).toBe('坏目录')
    expect(fake.structure()).toContain('书签栏/导入/好目录/正常的')
    expect(fake.structure()).not.toContain('里面的')
  })

  it('空的 nodes 只建出一个空的目标文件夹', async () => {
    const { fake, ports } = setup()
    const result = await importTree(ports, [], '导入', '1')
    expect(result.bookmarks).toBe(0)
    expect(result.folders).toBe(0)
    expect(fake.structure()).toContain('书签栏/导入/')
  })
})
