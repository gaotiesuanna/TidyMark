import { describe, it, expect } from 'vitest'
import { findDuplicateGroups } from '@/core/duplicates'
import type { BookmarkItem } from '@/core/types'

/** 只填判重用得上的字段，其余给确定的默认值，免得每条都写一长串。 */
function item(over: Partial<BookmarkItem> & { id: string; url: string }): BookmarkItem {
  return {
    title: 't', parentId: 'p', index: 0, currentPath: ['书签栏'],
    ...over,
  }
}

describe('findDuplicateGroups 分档', () => {
  it('URL 一模一样的成一组 exact', () => {
    const groups = findDuplicateGroups([
      item({ id: '1', url: 'https://a.com/p' }),
      item({ id: '2', url: 'https://a.com/p' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.kind).toBe('exact')
    expect(groups[0]!.items.map((i) => i.id).sort()).toEqual(['1', '2'])
  })

  it('归一化之后才相同的成一组 normalized', () => {
    const groups = findDuplicateGroups([
      item({ id: '1', url: 'https://a.com/p' }),
      item({ id: '2', url: 'https://a.com/p/' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.kind).toBe('normalized')
  })

  /**
   * 混合组必须整组降级成 normalized，不能拆成「一个 exact 组 + 一个 normalized 组」。
   * 拆了会让同一条书签出现在两组里，用户在一组里勾了删、另一组里又选了保留。
   */
  it('组里既有完全相同又有归一化才相同时，整组算 normalized', () => {
    const groups = findDuplicateGroups([
      item({ id: '1', url: 'https://a.com/p' }),
      item({ id: '2', url: 'https://a.com/p' }),
      item({ id: '3', url: 'https://a.com/p/' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.kind).toBe('normalized')
    expect(groups[0]!.items).toHaveLength(3)
  })

  it('只出现一次的不成组', () => {
    expect(findDuplicateGroups([item({ id: '1', url: 'https://a.com/p' })])).toEqual([])
  })

  it('归一化后不相同的不成组', () => {
    expect(findDuplicateGroups([
      item({ id: '1', url: 'https://a.com/p?id=1' }),
      item({ id: '2', url: 'https://a.com/p?id=2' }),
    ])).toEqual([])
  })

  it('非 http 协议照样判重', () => {
    const groups = findDuplicateGroups([
      item({ id: '1', url: 'chrome://extensions' }),
      item({ id: '2', url: 'chrome://extensions' }),
    ])
    expect(groups).toHaveLength(1)
  })

  it('一组三条以上', () => {
    const groups = findDuplicateGroups([
      item({ id: '1', url: 'https://a.com/p' }),
      item({ id: '2', url: 'https://a.com/p' }),
      item({ id: '3', url: 'https://a.com/p' }),
    ])
    expect(groups[0]!.items).toHaveLength(3)
  })
})

describe('findDuplicateGroups 默认保留哪条', () => {
  it('有标题的胜过空标题的', () => {
    const groups = findDuplicateGroups([
      item({ id: '1', url: 'https://a.com/p', title: '   ' }),
      item({ id: '2', url: 'https://a.com/p', title: '正经标题' }),
    ])
    expect(groups[0]!.keepId).toBe('2')
  })

  it('同为有标题时，路径浅的胜出', () => {
    const groups = findDuplicateGroups([
      item({ id: '1', url: 'https://a.com/p', currentPath: ['书签栏', '深', '更深'] }),
      item({ id: '2', url: 'https://a.com/p', currentPath: ['书签栏'] }),
    ])
    expect(groups[0]!.keepId).toBe('2')
  })

  it('路径一样深时，index 小的胜出', () => {
    const groups = findDuplicateGroups([
      item({ id: '1', url: 'https://a.com/p', index: 5 }),
      item({ id: '2', url: 'https://a.com/p', index: 2 }),
    ])
    expect(groups[0]!.keepId).toBe('2')
  })

  it('标题优先级高于路径深度', () => {
    const groups = findDuplicateGroups([
      item({ id: '1', url: 'https://a.com/p', title: '', currentPath: ['书签栏'] }),
      item({ id: '2', url: 'https://a.com/p', title: '有名字', currentPath: ['书签栏', '深', '更深'] }),
    ])
    expect(groups[0]!.keepId).toBe('2')
  })

  it('keepId 就是 items 的第一条，界面可以直接按顺序渲染', () => {
    const groups = findDuplicateGroups([
      item({ id: '1', url: 'https://a.com/p', index: 5 }),
      item({ id: '2', url: 'https://a.com/p', index: 2 }),
    ])
    expect(groups[0]!.items[0]!.id).toBe(groups[0]!.keepId)
  })

  it('全都一样时按 id 兜底，保证结果稳定', () => {
    const groups = findDuplicateGroups([
      item({ id: 'b', url: 'https://a.com/p' }),
      item({ id: 'a', url: 'https://a.com/p' }),
    ])
    expect(groups[0]!.keepId).toBe('a')
  })
})

describe('findDuplicateGroups 输出顺序', () => {
  it('大组排在前面，同样大时按 key 排，结果稳定', () => {
    const groups = findDuplicateGroups([
      item({ id: '1', url: 'https://z.com/p' }),
      item({ id: '2', url: 'https://z.com/p' }),
      item({ id: '3', url: 'https://a.com/p' }),
      item({ id: '4', url: 'https://a.com/p' }),
      item({ id: '5', url: 'https://a.com/p' }),
    ])
    expect(groups.map((g) => g.items.length)).toEqual([3, 2])
  })
})
