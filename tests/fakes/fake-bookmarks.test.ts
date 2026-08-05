import { describe, it, expect } from 'vitest'
import { createFakeBookmarks } from './fake-bookmarks'

const initial = [
  {
    id: '1', title: '书签栏', children: [
      { id: '10', title: 'react', children: [
        { id: '100', title: 'React 文档', url: 'https://react.dev' },
        { id: '101', title: 'Router', url: 'https://reactrouter.com' },
      ]},
      { id: '11', title: 'blogs', children: [
        { id: '110', title: '某博客', url: 'https://blog.example.com' },
      ]},
    ],
  },
]

describe('createFakeBookmarks', () => {
  it('getTree 返回带 parentId 与 index 的完整树', async () => {
    const fake = createFakeBookmarks(initial)
    const tree = await fake.api.getTree()
    expect(tree[0]!.id).toBe('1')
    const react = tree[0]!.children![0]!
    expect(react.parentId).toBe('1')
    expect(react.index).toBe(0)
    expect(react.children![1]!.index).toBe(1)
  })

  it('create 在指定 parent 末尾新建文件夹并返回新 id', async () => {
    const fake = createFakeBookmarks(initial)
    const folder = await fake.api.create({ parentId: '1', title: '新建' })
    expect(folder.parentId).toBe('1')
    expect(folder.index).toBe(2)
    expect(folder.id).not.toBe('')
    expect(await fake.api.get(folder.id)).not.toBeNull()
  })

  it('move 到另一个 parent 后，原 parent 中后续节点的 index 前移', async () => {
    const fake = createFakeBookmarks(initial)
    await fake.api.move('100', { parentId: '11' })
    const router = await fake.api.get('101')
    expect(router!.parentId).toBe('10')
    expect(router!.index).toBe(0)
    const moved = await fake.api.get('100')
    expect(moved!.parentId).toBe('11')
    expect(moved!.index).toBe(1)
  })

  it('move 指定 index 时在同一 parent 内重排', async () => {
    const fake = createFakeBookmarks(initial)
    await fake.api.move('101', { index: 0 })
    expect((await fake.api.get('101'))!.index).toBe(0)
    expect((await fake.api.get('100'))!.index).toBe(1)
  })

  it('structure() 输出稳定的可断言快照', async () => {
    const fake = createFakeBookmarks(initial)
    expect(fake.structure()).toBe(
      [
        '书签栏/',
        '书签栏/react/',
        '书签栏/react/React 文档',
        '书签栏/react/Router',
        '书签栏/blogs/',
        '书签栏/blogs/某博客',
      ].join('\n'),
    )
  })

  it('remove 非空文件夹抛错', async () => {
    const fake = createFakeBookmarks(initial)
    await expect(fake.api.remove('10')).rejects.toThrow(/非空/)
  })

  it('操作不存在的 id 抛错', async () => {
    const fake = createFakeBookmarks(initial)
    await expect(fake.api.move('999', { parentId: '1' })).rejects.toThrow(/不存在/)
  })
})

describe('createFakeBookmarks 建书签', () => {
  it('create 带 url 时建出的是书签而不是文件夹', async () => {
    const fake = createFakeBookmarks(initial)
    const created = await fake.api.create({
      parentId: '11', title: '新书签', url: 'https://new.dev',
    })
    expect(created.url).toBe('https://new.dev')

    const tree = await fake.api.getTree()
    const blogs = tree[0]!.children![1]!
    const added = blogs.children![1]!
    expect(added.title).toBe('新书签')
    expect(added.url).toBe('https://new.dev')
    // 书签没有 children，否则会被当成文件夹
    expect(added.children).toBeUndefined()
  })

  it('create 不带 url 时仍然建文件夹', async () => {
    const fake = createFakeBookmarks(initial)
    const created = await fake.api.create({ parentId: '11', title: '新文件夹' })
    expect(created.url).toBeUndefined()

    const tree = await fake.api.getTree()
    const added = tree[0]!.children![1]!.children![1]!
    expect(added.children).toEqual([])
  })
})
