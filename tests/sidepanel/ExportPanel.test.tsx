import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportPanel } from '@/sidepanel/components/ExportPanel'
import { useStore } from '@/sidepanel/store'
import { downloadJson, downloadText } from '@/sidepanel/lib/download'
import { loadFavicons } from '@/sidepanel/lib/favicons'
import type { BookmarkNode } from '@/core/ports'

vi.mock('@/sidepanel/lib/download', () => ({ downloadJson: vi.fn(), downloadText: vi.fn() }))
vi.mock('@/sidepanel/lib/favicons', () => ({ loadFavicons: vi.fn(async () => new Map()) }))

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'NiceG', children: [
        { id: '100', title: '组件库', children: [
          { id: '1000', title: 'shadcn/ui', url: 'https://ui.shadcn.com' },
        ]},
        { id: '101', title: 'Figma', url: 'https://figma.com' },
      ]},
      { id: '11', title: '其他', children: [
        { id: '110', title: '不该被导出', url: 'https://secret.internal' },
      ]},
    ]},
  ]},
]

beforeEach(() => {
  vi.mocked(downloadJson).mockClear()
  vi.mocked(downloadText).mockClear()
  vi.mocked(loadFavicons).mockClear()
  vi.mocked(loadFavicons).mockResolvedValue(new Map())
  // busy 显式带上，避免前一条用例设置的 busy 污染到下一条
  useStore.setState({ tree, checkedIds: new Set(), busy: null })
})

describe('ExportPanel', () => {
  it('未勾选时两个按钮都禁用', () => {
    render(<ExportPanel />)
    expect(screen.getByRole('button', { name: '带文件夹结构' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '纯链接清单' })).toHaveProperty('disabled', true)
    expect(screen.getByText(/导出选中的 0 条书签/)).toBeDefined()
  })

  it('busy 非 null 时按钮禁用，即使已勾选——整页锁定态下导出也不该可点', () => {
    useStore.setState({ checkedIds: new Set(['10', '100']), busy: '正在扫描…' })
    render(<ExportPanel />)
    expect(screen.getByRole('button', { name: '带文件夹结构' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '纯链接清单' })).toHaveProperty('disabled', true)
  })

  it('提示的条数与勾选范围一致', () => {
    useStore.setState({ checkedIds: new Set(['10', '100']) })
    render(<ExportPanel />)
    expect(screen.getByText(/导出选中的 2 条书签/)).toBeDefined()
  })

  it('勾选后按钮启用', () => {
    useStore.setState({ checkedIds: new Set(['10', '100']) })
    render(<ExportPanel />)
    expect(screen.getByRole('button', { name: '带文件夹结构' })).toHaveProperty('disabled', false)
  })

  it('点「带文件夹结构」下载嵌套树，文件名带 tree', async () => {
    useStore.setState({ checkedIds: new Set(['10', '100']) })
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('button', { name: '带文件夹结构' }))

    expect(downloadJson).toHaveBeenCalledTimes(1)
    // tsconfig 开了 noUncheckedIndexedAccess，下标访问要显式断言非空
    const [filename, data] = vi.mocked(downloadJson).mock.calls[0]!
    expect(filename).toMatch(/^reshelve-tree-\d{4}-\d{2}-\d{2}\.json$/)
    expect(data).toMatchObject({
      format: 'tidymark/v1',
      kind: 'tree',
      roots: [
        { name: 'NiceG', children: [
          { name: '组件库', children: [{ name: 'shadcn/ui', url: 'https://ui.shadcn.com' }] },
          { name: 'Figma', url: 'https://figma.com' },
        ]},
      ],
    })
  })

  it('点「纯链接清单」下载展平列表，文件名带 links', async () => {
    useStore.setState({ checkedIds: new Set(['10', '100']) })
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('button', { name: '纯链接清单' }))

    expect(downloadJson).toHaveBeenCalledTimes(1)
    const [filename, data] = vi.mocked(downloadJson).mock.calls[0]!
    expect(filename).toMatch(/^reshelve-links-\d{4}-\d{2}-\d{2}\.json$/)
    expect(data).toMatchObject({
      format: 'tidymark/v1',
      kind: 'links',
      bookmarks: [
        { name: 'shadcn/ui', url: 'https://ui.shadcn.com' },
        { name: 'Figma', url: 'https://figma.com' },
      ],
    })
  })

  it('未勾选的文件夹不会被导出', async () => {
    useStore.setState({ checkedIds: new Set(['10', '100']) })
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('button', { name: '纯链接清单' }))

    const [, data] = vi.mocked(downloadJson).mock.calls[0]!
    expect(JSON.stringify(data)).not.toContain('secret.internal')
  })

  it('点「浏览器书签文件」下载带图标的 HTML，文件名带 html', async () => {
    vi.mocked(loadFavicons).mockResolvedValue(
      new Map([['https://figma.com', 'data:image/png;base64,AAAA']]),
    )
    useStore.setState({ checkedIds: new Set(['10', '100']) })
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('button', { name: '浏览器书签文件' }))

    await waitFor(() => expect(downloadText).toHaveBeenCalledTimes(1))
    const [filename, text, mime] = vi.mocked(downloadText).mock.calls[0]!
    expect(filename).toMatch(/^reshelve-html-\d{4}-\d{2}-\d{2}\.html$/)
    expect(mime).toContain('text/html')
    expect(text).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>')
    expect(text).toContain('<DT><A HREF="https://figma.com" ICON="data:image/png;base64,AAAA">Figma</A>')
    // 没取到图标的那条不写 ICON
    expect(text).toContain('<DT><A HREF="https://ui.shadcn.com">shadcn/ui</A>')
    expect(text).not.toContain('secret.internal')
  })

  it('只把范围内的 URL 送去查图标，范围外的不查——查图标本身就是一次范围泄漏', async () => {
    useStore.setState({ checkedIds: new Set(['10', '100']) })
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('button', { name: '浏览器书签文件' }))

    await waitFor(() => expect(loadFavicons).toHaveBeenCalledTimes(1))
    expect(vi.mocked(loadFavicons).mock.calls[0]![0]).toEqual([
      'https://ui.shadcn.com',
      'https://figma.com',
    ])
  })

  it('取图标期间三个按钮都禁用，结束后恢复——避免重复触发', async () => {
    let release: (icons: Map<string, string>) => void = () => {}
    vi.mocked(loadFavicons).mockReturnValue(new Promise((resolve) => { release = resolve }))
    useStore.setState({ checkedIds: new Set(['10', '100']) })
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('button', { name: '浏览器书签文件' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '带文件夹结构' })).toHaveProperty('disabled', true),
    )
    expect(screen.getByRole('button', { name: '正在取图标…' })).toHaveProperty('disabled', true)

    release(new Map())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '带文件夹结构' })).toHaveProperty('disabled', false),
    )
  })

  it('取图标整个失败时仍导出，只是不带图标——不能让导出彻底做不成', async () => {
    vi.mocked(loadFavicons).mockRejectedValue(new Error('favicon permission missing'))
    useStore.setState({ checkedIds: new Set(['10', '100']) })
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('button', { name: '浏览器书签文件' }))

    await waitFor(() => expect(downloadText).toHaveBeenCalledTimes(1))
    const [, text] = vi.mocked(downloadText).mock.calls[0]!
    expect(text).toContain('<DT><A HREF="https://figma.com">Figma</A>')
    expect(text).not.toContain('ICON=')
    // 按钮要恢复可点，不能卡在「正在取图标…」
    expect(screen.getByRole('button', { name: '浏览器书签文件' })).toHaveProperty('disabled', false)
  })

  it('未勾选时「浏览器书签文件」也禁用', () => {
    render(<ExportPanel />)
    expect(screen.getByRole('button', { name: '浏览器书签文件' })).toHaveProperty('disabled', true)
  })

  it('文件名与 exportedAt 同源——组件内 const at 只 new 一次，跨午夜也不会对不上', async () => {
    useStore.setState({ checkedIds: new Set(['10', '100']) })
    render(<ExportPanel />)
    await userEvent.click(screen.getByRole('button', { name: '带文件夹结构' }))

    const [filename, data] = vi.mocked(downloadJson).mock.calls[0]!
    // tsconfig 开了 noUncheckedIndexedAccess，下标访问要显式断言非空
    const dateInFilename = filename.match(/(\d{4}-\d{2}-\d{2})\.json$/)![1]!
    const exportedAt = (data as { exportedAt: string }).exportedAt
    const pad = (n: number): string => String(n).padStart(2, '0')
    const localOfExportedAt = new Date(exportedAt)
    const dateFromExportedAt = `${localOfExportedAt.getFullYear()}-${pad(localOfExportedAt.getMonth() + 1)}-${pad(localOfExportedAt.getDate())}`
    expect(dateFromExportedAt).toBe(dateInFilename)
  })
})
