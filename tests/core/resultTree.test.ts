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

/** 造一个装着 count 条书签的目录，书签本身无关紧要，只为把 total 撑到指定数量。 */
const folder = (id: string, title: string, count: number): BookmarkNode => ({
  id,
  title,
  children: Array.from({ length: count }, (_, i) => ({
    id: `${id}-${i}`,
    title: `b${i}`,
    url: `https://${id}/${i}`,
  })),
})

/** 把若干目录按给定先后挂进书签栏，得到 buildResultTree 能吃的整棵树。 */
const barWith = (...folders: BookmarkNode[]): BookmarkNode[] => [
  { id: '0', title: '', children: [{ id: '1', title: '书签栏', children: folders }] },
]

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

  it('同层按编号升序排，与书签数无关', () => {
    // 树里的先后、编号先后、书签数先后三者两两不同，只有「按编号升序」能得出期望顺序
    const built = buildResultTree(
      barWith(folder('93', '03 多的', 9), folder('91', '01 少的', 1), folder('92', '02 中的', 5)),
      ['1'],
    )
    expect(built[0]!.children.map((c) => c.title)).toEqual(['01 少的', '02 中的', '03 多的'])
  })

  it('没编号的目录跟在带编号的后面，彼此保持树里的先后', () => {
    const built = buildResultTree(
      barWith(
        folder('81', '手工目录甲', 2),
        folder('82', '01 设计出来的', 3),
        folder('83', '手工目录乙', 9),
      ),
      ['1'],
    )
    // 乙的书签比甲多，但没编号的两个只按树里的先后排，甲仍在乙前
    expect(built[0]!.children.map((c) => c.title)).toEqual([
      '01 设计出来的',
      '手工目录甲',
      '手工目录乙',
    ])
  })

  it('子目录同层也按编号升序排，不按书签数', () => {
    const built = buildResultTree(
      barWith({
        id: '70',
        title: '01 AI',
        children: [folder('72', '01.2 多的', 6), folder('71', '01.1 少的', 1)],
      }),
      ['1'],
    )
    expect(built[0]!.children[0]!.children.map((c) => c.title)).toEqual(['01.1 少的', '01.2 多的'])
  })

  it('级联勾选的范围只展开最外层的根，不重复', () => {
    const cascaded = buildResultTree(tree, ['1', '10', '11', '12', '13'])
    expect(cascaded.map((r) => r.title)).toEqual(['书签栏'])
  })

  it('范围外的书签不出现', () => {
    expect(buildResultTree(tree, ['12']).map((r) => r.title)).toEqual(['02 开发'])
  })
})
