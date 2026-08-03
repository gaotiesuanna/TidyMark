import { describe, it, expect } from 'vitest'
import { scanTree } from '@/core/scan'
import type { BookmarkNode } from '@/core/ports'

const tree: BookmarkNode[] = [
  {
    id: '0', title: '', children: [
      {
        id: '1', parentId: '0', index: 0, title: '书签栏', children: [
          { id: '10', parentId: '1', index: 0, title: 'react', children: [
            { id: '100', parentId: '10', index: 0, title: 'React', url: 'https://react.dev' },
            { id: '101', parentId: '10', index: 1, title: '', url: 'https://reactrouter.com' },
          ]},
          { id: '11', parentId: '1', index: 1, title: '空文件夹', children: [] },
          { id: '12', parentId: '1', index: 2, title: '重复', url: 'https://react.dev' },
        ],
      },
      {
        id: '2', parentId: '0', index: 1, title: '其他书签', children: [
          { id: '20', parentId: '2', index: 0, title: '不该被扫到', url: 'https://secret.internal' },
        ],
      },
    ],
  },
]

describe('scanTree', () => {
  it('只扫描勾选范围内的节点', () => {
    const result = scanTree(tree, ['1'])
    expect(result.bookmarks.map((b) => b.id).sort()).toEqual(['100', '101', '12'])
    expect(result.bookmarks.some((b) => b.url.includes('secret'))).toBe(false)
  })

  it('为每个书签计算相对于树根的完整路径', () => {
    const result = scanTree(tree, ['1'])
    const react = result.bookmarks.find((b) => b.id === '100')!
    expect(react.currentPath).toEqual(['书签栏', 'react'])
    expect(react.parentId).toBe('10')
    expect(react.index).toBe(0)
  })

  it('收集范围内的文件夹（含范围根本身）及其深度', () => {
    const result = scanTree(tree, ['1'])
    expect(result.folders.map((f) => f.id).sort()).toEqual(['1', '10', '11'])
    expect(result.folders.find((f) => f.id === '10')!.depth).toBe(1)
    expect(result.folders.find((f) => f.id === '1')!.depth).toBe(0)
  })

  it('统计健康指标', () => {
    const result = scanTree(tree, ['1'])
    expect(result.stats).toEqual({
      totalBookmarks: 3,
      totalFolders: 3,
      emptyFolders: 1,
      untitledBookmarks: 1,
      duplicateUrlGroups: 1,
      maxDepth: 1,
    })
  })

  it('多个范围根可同时扫描', () => {
    const result = scanTree(tree, ['1', '2'])
    expect(result.bookmarks).toHaveLength(4)
  })

  it('空范围返回空结果', () => {
    const result = scanTree(tree, [])
    expect(result.bookmarks).toHaveLength(0)
    expect(result.stats.totalBookmarks).toBe(0)
  })
})
