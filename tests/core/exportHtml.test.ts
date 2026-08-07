import { describe, it, expect } from 'vitest'
import { toHtmlExport } from '@/core/exportHtml'
import { exportFileName } from '@/core/export'
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
      ]},
      { id: '11', parentId: '1', index: 1, title: '其他', children: [
        { id: '110', parentId: '11', index: 0, title: '不该被导出', url: 'https://secret.internal' },
      ]},
    ]},
  ]},
]

const AT = new Date(2026, 7, 4, 10, 0, 0)
const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('toHtmlExport', () => {
  it('产出浏览器认得的 Netscape 书签文件头', () => {
    const html = toHtmlExport(tree, ['10'], new Map())
    // 缺了 DOCTYPE 这一行，Chrome / Firefox 的导入器会拒收整个文件
    expect(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>\n')).toBe(true)
    expect(html).toContain('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">')
    expect(html).toContain('<H1>Bookmarks</H1>')
  })

  it('文件夹变 H3 + 嵌套 DL，书签变 DT A', () => {
    const html = toHtmlExport(tree, ['10'], new Map())
    expect(html).toContain('<DT><H3>NiceG</H3>')
    expect(html).toContain('<DT><H3>组件库</H3>')
    expect(html).toContain('<DT><A HREF="https://figma.com">Figma</A>')
  })

  it('有图标的书签写 ICON 属性', () => {
    const icons = new Map([['https://figma.com', PNG]])
    const html = toHtmlExport(tree, ['10'], icons)
    expect(html).toContain(`<DT><A HREF="https://figma.com" ICON="${PNG}">Figma</A>`)
  })

  it('取不到图标的书签不写 ICON 属性，而不是写空值', () => {
    const icons = new Map([['https://figma.com', PNG]])
    const html = toHtmlExport(tree, ['10'], icons)
    expect(html).toContain('<DT><A HREF="https://ui.shadcn.com">shadcn/ui</A>')
    expect(html).not.toContain('ICON=""')
  })

  it('空文件夹保留——HTML 导出是结构快照', () => {
    expect(toHtmlExport(tree, ['10'], new Map())).toContain('<DT><H3>空文件夹</H3>')
  })

  it('范围外的书签不会被导出', () => {
    expect(toHtmlExport(tree, ['10'], new Map())).not.toContain('secret.internal')
  })

  it('父子同时勾选时不重复导出同一棵子树', () => {
    const html = toHtmlExport(tree, ['10', '100'], new Map())
    expect(html.match(/<DT><H3>组件库<\/H3>/g)).toHaveLength(1)
  })

  it('多个互不包含的范围根都导出', () => {
    const html = toHtmlExport(tree, ['10', '11'], new Map())
    expect(html).toContain('<DT><H3>NiceG</H3>')
    expect(html).toContain('<DT><H3>其他</H3>')
  })

  it('空范围产出合法的空文件而不是空串', () => {
    const html = toHtmlExport(tree, [], new Map())
    expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>')
    expect(html).not.toContain('<DT>')
  })
})

describe('toHtmlExport 转义', () => {
  const nasty: BookmarkNode[] = [
    { id: '1', title: '根', children: [
      { id: '2', parentId: '1', index: 0, title: 'A & B <script>', children: [
        { id: '3', parentId: '2', index: 0, title: '引号"名字"', url: 'https://x.test/?a=1&b=2' },
      ]},
    ]},
  ]

  it('标题里的 & < > 被转义，不会破坏文档结构', () => {
    const html = toHtmlExport(nasty, ['2'], new Map())
    expect(html).toContain('<DT><H3>A &amp; B &lt;script&gt;</H3>')
    expect(html).not.toContain('<script>')
  })

  it('URL 里的 & 被转义，双引号不会提前闭合属性', () => {
    const html = toHtmlExport(nasty, ['2'], new Map())
    expect(html).toContain('HREF="https://x.test/?a=1&amp;b=2"')
    expect(html).toContain('>引号&quot;名字&quot;</A>')
  })

  it('图标 data URL 也走转义——它进的是属性值', () => {
    const icons = new Map([['https://x.test/?a=1&b=2', 'data:image/png;base64,a"b']])
    const html = toHtmlExport(nasty, ['2'], new Map(icons))
    expect(html).toContain('ICON="data:image/png;base64,a&quot;b"')
  })
})

describe('exportFileName html', () => {
  it('HTML 导出用 .html 后缀，JSON 导出不受影响', () => {
    expect(exportFileName('html', AT)).toBe('tidymark-html-2026-08-04.html')
    expect(exportFileName('tree', AT)).toBe('tidymark-tree-2026-08-04.json')
    expect(exportFileName('links', AT)).toBe('tidymark-links-2026-08-04.json')
  })
})
