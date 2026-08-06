import { describe, it, expect } from 'vitest'
import { buildImportPreview, findBookmarksBar, parseImportFile } from '@/core/import'
import type { ExportNode } from '@/core/export'
import type { BookmarkNode } from '@/core/ports'

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'NiceG', children: [
        { id: '100', title: '已有的', url: 'https://ui.shadcn.com' },
      ]},
    ]},
    { id: '2', title: '其他书签', children: [] },
  ]},
]

// vitest.config.ts 已把时区钉死为 Asia/Shanghai
const AT = new Date(2026, 7, 4, 10, 0, 0)

function treeDoc(roots: unknown[]): string {
  return JSON.stringify({ format: 'tidymark/v1', kind: 'tree', exportedAt: '', roots })
}

function linksDoc(bookmarks: unknown[]): string {
  return JSON.stringify({ format: 'tidymark/v1', kind: 'links', exportedAt: '', bookmarks })
}

function parsed(text: string) {
  const result = parseImportFile(text)
  if (!result.ok) throw new Error(`期望解析成功，实际失败：${JSON.stringify(result.error)}`)
  return result.doc
}

describe('parseImportFile 文件级校验', () => {
  it('不是合法 JSON 时报错', () => {
    expect(parseImportFile('{ 这不是 json')).toEqual({
      ok: false, error: { code: 'invalidJson' },
    })
  })

  it('format 不认识时报错', () => {
    const text = JSON.stringify({ format: 'tidymark/v2', kind: 'tree', roots: [] })
    expect(parseImportFile(text)).toEqual({
      ok: false, error: { code: 'unsupportedFormat' },
    })
  })

  it('完全没有 format 字段时报错', () => {
    expect(parseImportFile(JSON.stringify({ roots: [] }))).toEqual({
      ok: false, error: { code: 'unsupportedFormat' },
    })
  })

  it('顶层不是对象时报错', () => {
    expect(parseImportFile('[]')).toEqual({
      ok: false, error: { code: 'unsupportedFormat' },
    })
  })

  it('kind 不认识时报错并带上原值', () => {
    const text = JSON.stringify({ format: 'tidymark/v1', kind: 'csv', roots: [] })
    expect(parseImportFile(text)).toEqual({
      ok: false, error: { code: 'unknownKind', kind: 'csv' },
    })
  })

  it('kind 字段缺失时报错并带上 undefined', () => {
    const text = JSON.stringify({ format: 'tidymark/v1', roots: [] })
    expect(parseImportFile(text)).toEqual({
      ok: false, error: { code: 'unknownKind', kind: 'undefined' },
    })
  })

  it('kind 为 tree 但 roots 不是数组时报错', () => {
    const text = JSON.stringify({ format: 'tidymark/v1', kind: 'tree', roots: {} })
    expect(parseImportFile(text)).toEqual({ ok: false, error: { code: 'malformed' } })
  })

  it('kind 为 links 但 bookmarks 缺失时报错', () => {
    const text = JSON.stringify({ format: 'tidymark/v1', kind: 'links' })
    expect(parseImportFile(text)).toEqual({ ok: false, error: { code: 'malformed' } })
  })

  it('合法的 tree 文件解析成功', () => {
    const result = parseImportFile(treeDoc([{ name: 'A', children: [] }]))
    expect(result).toEqual({ ok: true, doc: { kind: 'tree', roots: [{ name: 'A', children: [] }] } })
  })

  it('合法的 links 文件解析成功', () => {
    const result = parseImportFile(linksDoc([{ name: 'A', url: 'https://a.dev' }]))
    expect(result).toEqual({ ok: true, doc: { kind: 'links', bookmarks: [{ name: 'A', url: 'https://a.dev' }] } })
  })
})

describe('buildImportPreview 归一', () => {
  it('tree 保持嵌套结构', () => {
    const doc = parsed(treeDoc([
      { name: 'NiceG', children: [
        { name: '组件库', children: [{ name: 'shadcn/ui', url: 'https://ui.shadcn.com' }] },
        { name: 'Figma', url: 'https://figma.com' },
      ]},
    ]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([
      { name: 'NiceG', children: [
        { name: '组件库', children: [{ name: 'shadcn/ui', url: 'https://ui.shadcn.com' }] },
        { name: 'Figma', url: 'https://figma.com' },
      ]},
    ])
    expect(preview.bookmarkCount).toBe(2)
    expect(preview.folderCount).toBe(2)
  })

  it('links 归一成一层平铺的书签，没有文件夹', () => {
    const doc = parsed(linksDoc([
      { name: 'A', url: 'https://a.dev' },
      { name: 'B', url: 'https://b.dev' },
    ]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([
      { name: 'A', url: 'https://a.dev' },
      { name: 'B', url: 'https://b.dev' },
    ])
    expect(preview.bookmarkCount).toBe(2)
    expect(preview.folderCount).toBe(0)
  })

  it('空文件夹保留', () => {
    const doc = parsed(treeDoc([{ name: '空的', children: [] }]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([{ name: '空的', children: [] }])
    expect(preview.folderCount).toBe(1)
    expect(preview.bookmarkCount).toBe(0)
  })
})

describe('buildImportPreview 节点级容错', () => {
  it('节点不是对象时跳过', () => {
    const doc = parsed(treeDoc(['字符串', 42, null, { name: 'A', url: 'https://a.dev' }]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([{ name: 'A', url: 'https://a.dev' }])
  })

  it('name 缺失或不是字符串时当成空串', () => {
    const doc = parsed(treeDoc([{ url: 'https://a.dev' }, { name: 42, url: 'https://b.dev' }]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([
      { name: '', url: 'https://a.dev' },
      { name: '', url: 'https://b.dev' },
    ])
  })

  it('url 不是字符串且没有 children 时跳过', () => {
    const doc = parsed(treeDoc([{ name: 'A', url: 42 }, { name: 'B', url: 'https://b.dev' }]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([{ name: 'B', url: 'https://b.dev' }])
  })

  it('children 不是数组时当成空文件夹', () => {
    const doc = parsed(treeDoc([{ name: 'A', children: '坏了' }]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([{ name: 'A', children: [] }])
  })

  it('既没有 url 也没有 children 时跳过', () => {
    const doc = parsed(treeDoc([{ name: '孤儿' }, { name: 'B', url: 'https://b.dev' }]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([{ name: 'B', url: 'https://b.dev' }])
  })

  it('url 非字符串但 children 是数组时当成文件夹处理', () => {
    const doc = parsed(treeDoc([
      { name: 'A', url: 42, children: [{ name: 'B', url: 'https://b.dev' }] },
    ]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([
      { name: 'A', children: [{ name: 'B', url: 'https://b.dev' }] },
    ])
    expect(preview.folderCount).toBe(1)
    expect(preview.bookmarkCount).toBe(1)
  })

  it('url 与 children 同时存在时按书签处理', () => {
    const doc = parsed(treeDoc([
      { name: 'A', url: 'https://a.dev', children: [{ name: 'C', url: 'https://c.dev' }] },
    ]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([{ name: 'A', url: 'https://a.dev' }])
    expect(preview.bookmarkCount).toBe(1)
  })

  it('坏节点被剔除后不计入统计', () => {
    const doc = parsed(treeDoc([null, { name: 'A', url: 'https://a.dev' }]))
    expect(buildImportPreview(doc, tree, AT, 'zh_CN').bookmarkCount).toBe(1)
  })

  it('超过 MAX_DEPTH（64）的嵌套被截断且不抛异常，64 层以内正常保留', () => {
    // 用循环构造一条深度 100 的文件夹链，链条最底部挂一个书签
    function nestedChain(depth: number): unknown {
      let node: unknown = { name: 'leaf', url: 'https://leaf.dev' }
      for (let i = depth; i >= 1; i--) node = { name: `f${i}`, children: [node] }
      return node
    }
    const doc = parsed(treeDoc([nestedChain(100), { name: '正常的', url: 'https://normal.dev' }]))

    expect(() => buildImportPreview(doc, tree, AT, 'zh_CN')).not.toThrow()
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')

    // 同级的正常书签完全不受深链条影响
    expect(preview.nodes.find((n) => n.name === '正常的')).toEqual({
      name: '正常的', url: 'https://normal.dev',
    })

    // 沿深链条往下走，数一数实际保留了几层——超过 64 层的部分（包括最底部的叶子书签）应当被丢弃
    let node: ExportNode = preview.nodes.find((n) => n.name === 'f1')!
    let levels = 1
    while ('children' in node && node.children.length > 0) {
      levels += 1
      node = node.children[0]!
    }
    expect(levels).toBeLessThan(100)
    expect(levels).toBeLessThanOrEqual(65)
    // 走到底是个空文件夹（叶子书签被丢弃），不是那颗 leaf 书签本身
    expect('url' in node).toBe(false)
  })
})

describe('buildImportPreview 拦截不安全链接', () => {
  it('拦下 javascript: 并记进 blocked', () => {
    const doc = parsed(treeDoc([{ name: 'Gmail', url: 'javascript:alert(1)' }]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([])
    expect(preview.blocked).toEqual([
      { name: 'Gmail', url: 'javascript:alert(1)', scheme: 'javascript:' },
    ])
  })

  it('拦下 data:', () => {
    const doc = parsed(treeDoc([{ name: 'X', url: 'data:text/html,<h1>hi</h1>' }]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([])
    expect(preview.blocked[0]!.scheme).toBe('data:')
  })

  it('大小写与前导空白都拦得住', () => {
    const doc = parsed(treeDoc([
      { name: 'A', url: 'JavaScript:alert(1)' },
      { name: 'B', url: '   javascript:alert(2)' },
      { name: 'C', url: '\n\tDATA:text/html,x' },
    ]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([])
    expect(preview.blocked).toHaveLength(3)
  })

  it('拦得住藏在 tab/LF/CR 里、绕开单纯 trimStart 的绕过变体', () => {
    const doc = parsed(treeDoc([
      { name: 'A', url: 'java\tscript:alert(1)' },
      { name: 'B', url: 'java\nscript:alert(1)' },
      { name: 'C', url: 'javascript\t:alert(1)' },
      { name: 'D', url: ' javascript:alert(1)' },
      { name: 'E', url: 'da\tta:text/html,x' },
    ]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([])
    expect(preview.blocked).toHaveLength(5)
  })

  it('URL 片段里含 javascript 字样的正常链接不被误拦', () => {
    const doc = parsed(treeDoc([{ name: 'A', url: 'https://x.dev/#javascript:foo' }]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([{ name: 'A', url: 'https://x.dev/#javascript:foo' }])
    expect(preview.blocked).toEqual([])
  })

  it('file:// 与 chrome:// 照常放行', () => {
    const doc = parsed(treeDoc([
      { name: 'A', url: 'file:///Users/me/notes.html' },
      { name: 'B', url: 'chrome://bookmarks' },
      { name: 'C', url: 'ftp://example.com/x' },
    ]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toHaveLength(3)
    expect(preview.blocked).toEqual([])
  })

  it('嵌套深处的不安全链接也拦得住，且不影响同级正常条目', () => {
    const doc = parsed(treeDoc([
      { name: '外', children: [
        { name: '内', children: [
          { name: '坏', url: 'javascript:x' },
          { name: '好', url: 'https://good.dev' },
        ]},
      ]},
    ]))
    const preview = buildImportPreview(doc, tree, AT, 'zh_CN')
    expect(preview.nodes).toEqual([
      { name: '外', children: [{ name: '内', children: [{ name: '好', url: 'https://good.dev' }] }] },
    ])
    expect(preview.blocked).toHaveLength(1)
  })

  it('被拦条目不计入 bookmarkCount', () => {
    const doc = parsed(treeDoc([
      { name: '坏', url: 'javascript:x' },
      { name: '好', url: 'https://good.dev' },
    ]))
    expect(buildImportPreview(doc, tree, AT, 'zh_CN').bookmarkCount).toBe(1)
  })
})

describe('buildImportPreview 重复计数', () => {
  it('数的是已存在于书签库里的条数', () => {
    const doc = parsed(treeDoc([
      { name: '重复1', url: 'https://ui.shadcn.com' },
      { name: '新的', url: 'https://brand.new' },
    ]))
    expect(buildImportPreview(doc, tree, AT, 'zh_CN').duplicateCount).toBe(1)
  })

  it('同一个已有 URL 出现两次算两条，不是一种', () => {
    const doc = parsed(treeDoc([
      { name: 'a', url: 'https://ui.shadcn.com' },
      { name: 'b', url: 'https://ui.shadcn.com' },
    ]))
    expect(buildImportPreview(doc, tree, AT, 'zh_CN').duplicateCount).toBe(2)
  })

  it('一条都不重复时为 0', () => {
    const doc = parsed(treeDoc([{ name: 'x', url: 'https://brand.new' }]))
    expect(buildImportPreview(doc, tree, AT, 'zh_CN').duplicateCount).toBe(0)
  })
})

describe('buildImportPreview 目标位置', () => {
  it('目标文件夹名用本地日期，中文 locale 下前缀为「导入」', () => {
    const doc = parsed(treeDoc([]))
    expect(buildImportPreview(doc, tree, AT, 'zh_CN').targetName).toBe('导入 2026-08-04')
  })

  it('英文 locale 下前缀为 Imported——产出内容要跟着界面语言走，不能写死中文', () => {
    const doc = parsed(treeDoc([]))
    expect(buildImportPreview(doc, tree, AT, 'en').targetName).toBe('Imported 2026-08-04')
  })

  it('barTitle 取自树里的书签栏，不是写死的字符串', () => {
    const renamed: BookmarkNode[] = [
      { id: '0', title: '', children: [{ id: '1', title: 'Bookmarks Bar', children: [] }] },
    ]
    const doc = parsed(treeDoc([]))
    expect(buildImportPreview(doc, renamed, AT, 'zh_CN').barTitle).toBe('Bookmarks Bar')
  })

  it('找不到书签栏时兜底值按 locale 双语', () => {
    const doc = parsed(treeDoc([]))
    expect(buildImportPreview(doc, [], AT, 'zh_CN').barTitle).toBe('书签栏')
    expect(buildImportPreview(doc, [], AT, 'en').barTitle).toBe('Bookmarks Bar')
  })
})

describe('findBookmarksBar', () => {
  it('跳过标题为空的根节点，返回第一个顶层文件夹', () => {
    expect(findBookmarksBar(tree)!.id).toBe('1')
  })

  it('不返回顶层的书签，只返回文件夹', () => {
    const odd: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: '9', title: '一个书签', url: 'https://x.dev' },
        { id: '1', title: '书签栏', children: [] },
      ]},
    ]
    expect(findBookmarksBar(odd)!.id).toBe('1')
  })

  it('空树返回 null', () => {
    expect(findBookmarksBar([])).toBeNull()
  })
})
