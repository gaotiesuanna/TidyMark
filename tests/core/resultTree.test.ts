import { describe, it, expect } from 'vitest'
import { buildResultTree } from '@/core/resultTree'
import type { BookmarkNode } from '@/core/ports'

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: '01 AI', children: [
        { id: '100', title: 'a', url: 'https://a' },
        { id: '11', title: '01.1 rag', children: [
          { id: '101', title: 'b', url: 'https://b' },
          { id: '102', title: 'c', url: 'https://c' },
        ]},
      ]},
      { id: '12', title: '02 开发', children: [
        { id: '103', title: 'd', url: 'https://d' },
      ]},
      // 未被接受的移动：书签还留在原来的目录里
      { id: '13', title: 'fastapi', children: [
        { id: '104', title: 'e', url: 'https://e' },
      ]},
    ]},
  ]},
]

const roots = (): ReturnType<typeof buildResultTree> => buildResultTree(tree, ['1'], ['10', '11'])

describe('buildResultTree', () => {
  it('按真实书签树还原层级', () => {
    const bar = roots()[0]!
    expect(bar.title).toBe('书签栏')
    expect(bar.children.map((c) => c.title)).toEqual(['01 AI', '02 开发', 'fastapi'])
  })

  it('统计直接书签数与含子目录的总数', () => {
    const ai = roots()[0]!.children.find((c) => c.title === '01 AI')!
    expect(ai.count).toBe(1)
    expect(ai.total).toBe(3)
  })

  it('标记本次新建的目录，已有目录不标记', () => {
    const bar = roots()[0]!
    expect(bar.children.find((c) => c.title === '01 AI')!.isNew).toBe(true)
    expect(bar.children.find((c) => c.title === 'fastapi')!.isNew).toBe(false)
  })

  it('留有未接受书签的旧目录照样出现在树里', () => {
    const stale = roots()[0]!.children.find((c) => c.title === 'fastapi')!
    expect(stale.total).toBe(1)
  })

  it('同层按书签总数从多到少排序', () => {
    const totals = roots()[0]!.children.map((c) => c.total)
    expect(totals).toEqual([...totals].sort((a, b) => b - a))
  })

  it('级联勾选的范围只展开最外层的根，不重复', () => {
    const cascaded = buildResultTree(tree, ['1', '10', '11', '12', '13'])
    expect(cascaded.map((r) => r.title)).toEqual(['书签栏'])
  })

  it('范围外的书签不出现', () => {
    expect(buildResultTree(tree, ['12']).map((r) => r.title)).toEqual(['02 开发'])
  })
})
