import { describe, it, expect } from 'vitest'
import { findEmptyFolders } from '@/core/empty'
import type { BookmarkNode } from '@/core/ports'

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: '空目录', children: [] },
      { id: '11', title: '有书签', children: [
        { id: '100', title: 'a', url: 'https://a' },
      ]},
      { id: '12', title: '只有空子目录', children: [
        { id: '120', title: '空子目录', children: [] },
        { id: '121', title: '更深一层', children: [
          { id: '1210', title: '最深', children: [] },
        ]},
      ]},
      { id: '13', title: '子目录里有书签', children: [
        { id: '130', title: '子', children: [
          { id: '101', title: 'b', url: 'https://b' },
        ]},
      ]},
    ]},
    { id: '2', title: '其他书签', children: [
      { id: '20', title: '范围外的空目录', children: [] },
    ]},
  ]},
]

const ids = (): string[] => findEmptyFolders(tree, ['1']).map((f) => f.id)

describe('findEmptyFolders', () => {
  it('删除不含任何书签的目录', () => {
    expect(ids()).toContain('10')
  })

  it('含书签的目录不删', () => {
    expect(ids()).not.toContain('11')
  })

  it('子目录里有书签的目录不删', () => {
    expect(ids()).not.toContain('13')
    expect(ids()).not.toContain('130')
  })

  it('整串只有空子目录的子树全部删除', () => {
    expect(ids()).toEqual(expect.arrayContaining(['12', '120', '121', '1210']))
  })

  it('子目录排在父目录前面，可以按顺序直接删', () => {
    const order = ids()
    expect(order.indexOf('1210')).toBeLessThan(order.indexOf('121'))
    expect(order.indexOf('121')).toBeLessThan(order.indexOf('12'))
    expect(order.indexOf('120')).toBeLessThan(order.indexOf('12'))
  })

  it('范围根本身即使为空也不删', () => {
    expect(findEmptyFolders([{ id: '1', title: '书签栏', children: [] }], ['1'])).toEqual([])
  })

  it('范围外的空目录不动', () => {
    expect(ids()).not.toContain('20')
  })

  it('返回目录名与路径，供结果页展示', () => {
    const deep = findEmptyFolders(tree, ['1']).find((f) => f.id === '1210')
    expect(deep).toMatchObject({ title: '最深', path: ['书签栏', '只有空子目录', '更深一层'] })
  })

  it('多个范围根各自独立处理', () => {
    expect(findEmptyFolders(tree, ['1', '2']).map((f) => f.id)).toContain('20')
  })
})

describe('findEmptyFolders 与级联勾选的范围', () => {
  // 勾选界面会把子文件夹一并勾上，scopeRootIds 因此同时包含父与子
  const cascaded = ['1', '10', '11', '12', '120', '121', '1210', '13', '130']

  it('同一个空目录只返回一次，不会重复删除', () => {
    const ids = findEmptyFolders(tree, cascaded).map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('被级联勾中的子目录仍然会被清理', () => {
    expect(findEmptyFolders(tree, cascaded).map((f) => f.id)).toContain('120')
  })

  it('只有最外层的范围根受保护', () => {
    const ids = findEmptyFolders(tree, cascaded).map((f) => f.id)
    expect(ids).not.toContain('1')
    expect(ids).toEqual(expect.arrayContaining(['10', '12']))
  })
})

describe('findEmptyFolders 可删除的范围根', () => {
  it('范围根被列为可删且已空时会被删除', () => {
    const ids = findEmptyFolders(tree, ['10', '11'], ['10', '11']).map((f) => f.id)
    expect(ids).toContain('10')
  })

  it('含书签的范围根即使可删也不删', () => {
    const ids = findEmptyFolders(tree, ['10', '11'], ['10', '11']).map((f) => f.id)
    expect(ids).not.toContain('11')
  })

  it('不在可删名单里的范围根仍不删', () => {
    const ids = findEmptyFolders(tree, ['10', '11'], ['11']).map((f) => f.id)
    expect(ids).not.toContain('10')
  })

  it('不传第三个参数时行为不变', () => {
    const ids = findEmptyFolders(tree, ['10', '11']).map((f) => f.id)
    expect(ids).not.toContain('10')
    expect(ids).not.toContain('11')
  })
})
