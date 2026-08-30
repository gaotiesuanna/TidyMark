import { describe, it, expect } from 'vitest'
import {
  EXPORT_FORMAT,
  countScopedBookmarks,
  exportFileName,
  toLinksExport,
  toTreeExport,
} from '@/core/export'
import type { BookmarkNode } from '@/core/ports'

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', parentId: '0', index: 0, title: '书签栏', children: [
      { id: '10', parentId: '1', index: 0, title: 'NiceG', children: [
        { id: '100', parentId: '10', index: 0, title: '组件库', children: [
          { id: '1000', parentId: '100', index: 0, title: 'shadcn/ui', url: 'https://ui.shadcn.com' },
          { id: '1001', parentId: '100', index: 1, title: '', url: 'https://radix-ui.com' },
        ]},
        { id: '101', parentId: '10', index: 1, title: '空文件夹', children: [] },
        { id: '102', parentId: '10', index: 2, title: 'Figma', url: 'https://figma.com' },
        { id: '103', parentId: '10', index: 3, title: '重复', url: 'https://ui.shadcn.com' },
      ]},
      { id: '11', parentId: '1', index: 1, title: '其他', children: [
        { id: '110', parentId: '11', index: 0, title: '不该被导出', url: 'https://secret.internal' },
      ]},
    ]},
  ]},
]

// 用本地时间构造，这样文件名里的本地日期与断言无关于测试机时区
const AT = new Date(2026, 7, 4, 10, 0, 0)

describe('toTreeExport', () => {
  it('导出嵌套结构，文件夹与书签用 children / url 区分', () => {
    const result = toTreeExport(tree, ['10'], AT)
    expect(result.roots).toEqual([
      { name: 'NiceG', children: [
        { name: '组件库', children: [
          { name: 'shadcn/ui', url: 'https://ui.shadcn.com' },
          { name: '', url: 'https://radix-ui.com' },
        ]},
        { name: '空文件夹', children: [] },
        { name: 'Figma', url: 'https://figma.com' },
        { name: '重复', url: 'https://ui.shadcn.com' },
      ]},
    ])
  })

  it('头字段带版本标识与导出时间', () => {
    const result = toTreeExport(tree, ['10'], AT)
    expect(result.format).toBe(EXPORT_FORMAT)
    expect(EXPORT_FORMAT).toBe('tidymark/v1')
    expect(result.kind).toBe('tree')
    expect(result.exportedAt).toBe(AT.toISOString())
  })

  it('不导出 Chrome 的 id / parentId / index', () => {
    const json = JSON.stringify(toTreeExport(tree, ['10'], AT))
    expect(json).not.toContain('"id"')
    expect(json).not.toContain('"parentId"')
    expect(json).not.toContain('"index"')
  })

  it('父子同时勾选时不重复导出同一棵子树', () => {
    // ScopeStep 的勾选是级联的，父与子必定同时出现在 scopeRootIds 里
    const result = toTreeExport(tree, ['10', '100'], AT)
    expect(result.roots).toHaveLength(1)
    // tsconfig 开了 noUncheckedIndexedAccess，下标访问要显式断言非空
    expect(result.roots[0]!.name).toBe('NiceG')
  })

  it('范围外的书签不会被导出', () => {
    const json = JSON.stringify(toTreeExport(tree, ['10'], AT))
    expect(json).not.toContain('secret.internal')
  })

  it('多个互不包含的范围根都导出', () => {
    const result = toTreeExport(tree, ['10', '11'], AT)
    expect(result.roots.map((r) => r.name)).toEqual(['NiceG', '其他'])
  })

  it('空范围导出空 roots', () => {
    expect(toTreeExport(tree, [], AT).roots).toEqual([])
  })
})

describe('toLinksExport', () => {
  it('深度优先展平，保持树内原始顺序', () => {
    const result = toLinksExport(tree, ['10'], AT)
    expect(result.bookmarks).toEqual([
      { name: 'shadcn/ui', url: 'https://ui.shadcn.com' },
      { name: '', url: 'https://radix-ui.com' },
      { name: 'Figma', url: 'https://figma.com' },
      { name: '重复', url: 'https://ui.shadcn.com' },
    ])
  })

  it('重复 URL 不去重——导出是快照不是清洗', () => {
    const urls = toLinksExport(tree, ['10'], AT).bookmarks.map((b) => b.url)
    expect(urls.filter((u) => u === 'https://ui.shadcn.com')).toHaveLength(2)
  })

  it('空文件夹在纯链接清单里自然消失', () => {
    const json = JSON.stringify(toLinksExport(tree, ['10'], AT))
    expect(json).not.toContain('空文件夹')
  })

  it('头字段带版本标识与导出时间', () => {
    const result = toLinksExport(tree, ['10'], AT)
    expect(result.format).toBe(EXPORT_FORMAT)
    expect(result.kind).toBe('links')
    expect(result.exportedAt).toBe(AT.toISOString())
  })

  it('父子同时勾选时不重复展平', () => {
    expect(toLinksExport(tree, ['10', '100'], AT).bookmarks).toHaveLength(4)
  })
})

describe('countScopedBookmarks', () => {
  it('递归统计范围内所有后代书签', () => {
    expect(countScopedBookmarks(tree, ['10'])).toBe(4)
  })

  it('父子同时勾选时不重复计数', () => {
    expect(countScopedBookmarks(tree, ['10', '100'])).toBe(4)
  })

  it('与实际导出的条数一致', () => {
    expect(countScopedBookmarks(tree, ['1'])).toBe(toLinksExport(tree, ['1'], AT).bookmarks.length)
  })

  it('空范围为 0', () => {
    expect(countScopedBookmarks(tree, [])).toBe(0)
  })
})

describe('exportFileName', () => {
  it('按格式与本地日期命名', () => {
    expect(exportFileName('tree', AT)).toBe('reshelve-tree-2026-08-04.json')
    expect(exportFileName('links', AT)).toBe('reshelve-links-2026-08-04.json')
  })

  it('月和日补零', () => {
    expect(exportFileName('tree', new Date(2026, 0, 9, 0, 0, 0))).toBe('reshelve-tree-2026-01-09.json')
  })

  it('文件名用本地日期、exportedAt 用 UTC——同一时刻两者故意不同', () => {
    // vitest.config.ts 把测试时区钉死在 Asia/Shanghai（UTC+8）
    // 本地时间 2026-08-04 01:00 对应的 UTC 时间是 2026-08-03 17:00
    const at = new Date(2026, 7, 4, 1, 0, 0)
    expect(exportFileName('tree', at)).toBe('reshelve-tree-2026-08-04.json')
    const exportedAt = toTreeExport(tree, ['10'], at).exportedAt
    expect(exportedAt).toMatch(/Z$/)
    expect(exportedAt).toContain('2026-08-03')
  })
})
