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

  it('同层照书签栏里的先后展示，既不按编号也不按书签数', () => {
    // 树里的先后、编号先后、书签数先后三者两两不同，只有「原样照抄树序」能得出期望顺序
    const built = buildResultTree(
      barWith(folder('93', '03 多的', 9), folder('91', '01 少的', 1), folder('92', '02 中的', 5)),
      ['1'], [],
    )
    expect(built[0]!.children.map((c) => c.title)).toEqual(['03 多的', '01 少的', '02 中的'])
  })

  it('带编号的和没编号的混在一层，谁也不被提前或挪后', () => {
    const built = buildResultTree(
      barWith(
        folder('81', '手工目录甲', 2),
        folder('82', '01 设计出来的', 3),
        folder('83', '手工目录乙', 9),
      ),
      ['1'], [],
    )
    // 带编号的那个夹在中间，书签数也不是最多的——三种排法都会把它挪走，原样照抄不会
    expect(built[0]!.children.map((c) => c.title)).toEqual([
      '手工目录甲',
      '01 设计出来的',
      '手工目录乙',
    ])
  })

  it('子目录同层同样照原样，别只在最外层放过排序', () => {
    const built = buildResultTree(
      barWith({
        id: '70',
        title: '01 AI',
        children: [folder('72', '01.2 多的', 6), folder('71', '01.1 少的', 1)],
      }),
      ['1'], [],
    )
    expect(built[0]!.children[0]!.children.map((c) => c.title)).toEqual(['01.2 多的', '01.1 少的'])
  })

  it('级联勾选的范围只展开最外层的根，不重复', () => {
    const cascaded = buildResultTree(tree, ['1', '10', '11', '12', '13'], [])
    expect(cascaded.map((r) => r.title)).toEqual(['书签栏'])
  })

  it('范围外的书签不出现', () => {
    expect(buildResultTree(tree, ['12'], []).map((r) => r.title)).toEqual(['02 开发'])
  })

  // 这一页自称展示「书签栏的真实结构」，而它手里拿到的就是重新读回的真实树。
  // 排序唯一会改变结果的时刻，恰是真实树没排成编号序的时刻——那时排序就是在说谎。
  it('一律按真实先后展示：真实树不是编号序，就不装成编号序', () => {
    const forest = barWith(
      { id: '81', title: '杂项', children: [folder('811', '手工子目录', 1), folder('812', '01 子的', 1)] },
      folder('82', '01 工作', 1),
    )
    const real = buildResultTree(forest, ['1'], [])
    expect(real[0]!.children.map((c) => c.title)).toEqual(['杂项', '01 工作'])
    // 子目录同样不动，别只在最外层放过排序
    expect(real[0]!.children[0]!.children.map((c) => c.title)).toEqual(['手工子目录', '01 子的'])
  })

  // 排序 move 失败（sortedFolders 为 0）、撤销之后目录名改回去、撤销半途失败只有一部分
  // 还顶着号——这些时刻书签栏里带编号的目录就是排在没编号的后面。照原样显示才是真话。
  it('带编号的目录排在没编号的后面时，照原样显示，不把带编号的提前', () => {
    const built = buildResultTree(
      barWith(
        folder('91', '随手放的', 1),
        folder('92', '01 工作', 1),
        folder('93', '临时', 1),
        folder('94', '02 学习', 1),
      ),
      ['1'], [],
    )
    expect(built[0]!.children.map((c) => c.title)).toEqual(['随手放的', '01 工作', '临时', '02 学习'])
  })
})
