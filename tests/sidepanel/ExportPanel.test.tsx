import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportPanel } from '@/sidepanel/components/ExportPanel'
import { useStore } from '@/sidepanel/store'
import { downloadJson } from '@/sidepanel/lib/download'
import type { BookmarkNode } from '@/core/ports'

vi.mock('@/sidepanel/lib/download', () => ({ downloadJson: vi.fn() }))

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
    expect(filename).toMatch(/^tidymark-tree-\d{4}-\d{2}-\d{2}\.json$/)
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
    expect(filename).toMatch(/^tidymark-links-\d{4}-\d{2}-\d{2}\.json$/)
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
