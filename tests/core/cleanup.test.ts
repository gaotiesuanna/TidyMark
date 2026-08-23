import { describe, it, expect } from 'vitest'
import { emptyAfterRemoval } from '@/core/cleanup'
import type { BookmarkNode } from '@/core/ports'

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: '只有一条书签', children: [
        { id: '100', title: 'a', url: 'https://a' },
      ]},
      { id: '11', title: '两条书签', children: [
        { id: '110', title: 'b', url: 'https://b' },
        { id: '111', title: 'c', url: 'https://c' },
      ]},
      { id: '12', title: '祖父', children: [
        { id: '120', title: '父', children: [
          { id: '1200', title: '子', children: [
            { id: '12000', title: 'd', url: 'https://d' },
          ]},
        ]},
      ]},
    ]},
  ]},
]

const ids = (removed: string[]): string[] =>
  emptyAfterRemoval(tree, ['1'], removed).map((f) => f.id)

describe('emptyAfterRemoval', () => {
  it('什么都不删时，结果与 findEmptyFolders 一致（本树里没有空目录）', () => {
    expect(ids([])).toEqual([])
  })

  it('删掉唯一那条书签，父目录变空', () => {
    expect(ids(['100'])).toContain('10')
  })

  it('只删掉两条中的一条，父目录不算空', () => {
    expect(ids(['110'])).not.toContain('11')
  })

  it('两条都删掉，父目录才算空', () => {
    expect(ids(['110', '111'])).toContain('11')
  })

  it('连锁：子空了祖父也空，三层一起返回', () => {
    const result = ids(['12000'])
    expect(result).toContain('1200')
    expect(result).toContain('120')
    expect(result).toContain('12')
  })

  it('子目录排在父目录之前，调用方顺序删除即可', () => {
    const result = ids(['12000'])
    expect(result.indexOf('1200')).toBeLessThan(result.indexOf('120'))
    expect(result.indexOf('120')).toBeLessThan(result.indexOf('12'))
  })

  it('范围根本身不返回，哪怕整棵树都被删空', () => {
    expect(ids(['100', '110', '111', '12000'])).not.toContain('1')
  })

  it('不修改传入的树', () => {
    const before = JSON.stringify(tree)
    emptyAfterRemoval(tree, ['1'], ['100'])
    expect(JSON.stringify(tree)).toBe(before)
  })
})
