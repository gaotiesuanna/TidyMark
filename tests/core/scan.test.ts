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
      duplicateFolderGroups: 0,
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

describe('scanTree 去重', () => {
  const nested = [
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: 'fastapi', children: [
          { id: '100', title: 'A', url: 'https://a.dev' },
        ]},
      ]},
    ]},
  ]

  it('父子同时被勾选时不重复遍历同一棵子树', () => {
    // ScopeStep 的勾选是级联的，父与子必定同时出现在 scopeRootIds 里
    const scan = scanTree(nested, ['1', '10'])
    expect(scan.folders.map((f) => f.id)).toEqual(['1', '10'])
    expect(scan.bookmarks.map((b) => b.id)).toEqual(['100'])
    expect(scan.stats.totalFolders).toBe(2)
    expect(scan.stats.totalBookmarks).toBe(1)
  })

  it('层级相对扫描根计算，一级目录 depth 为 1', () => {
    const scan = scanTree(nested, ['1', '10'])
    expect(scan.folders.find((f) => f.id === '1')!.depth).toBe(0)
    expect(scan.folders.find((f) => f.id === '10')!.depth).toBe(1)
  })
})

/**
 * depth 相对于勾选点、level 是书签库里的固定位置——两个数字必须都在，
 * 且在勾了「其他书签」这种情况下会明显分叉：depth 归零重算，level 不变。
 */
describe('scanTree 带上绝对层级', () => {
  it('勾书签栏时，栏里的目录 depth 与 level 都是 1', () => {
    const folder = scanTree(tree, ['1']).folders.find((f) => f.id === '10')
    expect(folder?.depth).toBe(1)
    expect(folder?.level).toBe(1)
  })

  it('勾其他书签时 depth 归零重算，level 仍按书签库的位置算', () => {
    const folders = scanTree(tree, ['2']).folders
    const root = folders.find((f) => f.id === '2')
    expect(root?.depth).toBe(0)
    // 「其他书签」在栏的最右端显示成一个文件夹，所以它自己就是一级
    expect(root?.level).toBe(1)
  })

  it('勾一个深层目录时，level 不会因为勾选点变化而变小', () => {
    expect(scanTree(tree, ['10']).folders.find((f) => f.id === '10')?.level).toBe(1)
    expect(scanTree(tree, ['1']).folders.find((f) => f.id === '10')?.level).toBe(1)
  })
})

describe('scanTree 数重名目录', () => {
  it('同父同名算一组，编号不影响判定', () => {
    const tree = [{ id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '01 GitHub', children: [] },
        { id: '11', title: '01 GitHub', children: [] },
        { id: '12', title: '05 GitHub', children: [] },
        { id: '13', title: '02 前端', children: [] },
      ]},
    ]}]
    const scan = scanTree(tree, ['1'])
    // 三个 GitHub 是一组（编号剥掉后同名），「前端」不成组
    expect(scan.stats.duplicateFolderGroups).toBe(1)
  })

  it('不同父目录下的同名目录不算重名——路径不同，分得清', () => {
    const tree = [{ id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '前端', children: [{ id: '100', title: '工具', children: [] }] },
        { id: '11', title: '后端', children: [{ id: '110', title: '工具', children: [] }] },
      ]},
    ]}]
    expect(scanTree(tree, ['1']).stats.duplicateFolderGroups).toBe(0)
  })

  it('两组重名就是 2', () => {
    const tree = [{ id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: 'GitHub', children: [] },
        { id: '11', title: 'GitHub', children: [] },
        { id: '12', title: '论文', children: [] },
        { id: '13', title: '论文', children: [] },
      ]},
    ]}]
    expect(scanTree(tree, ['1']).stats.duplicateFolderGroups).toBe(2)
  })

  it('没有重名时是 0', () => {
    const tree = [{ id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: 'GitHub', children: [] },
        { id: '11', title: '论文', children: [] },
      ]},
    ]}]
    expect(scanTree(tree, ['1']).stats.duplicateFolderGroups).toBe(0)
  })
})
