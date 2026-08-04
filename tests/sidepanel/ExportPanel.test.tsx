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
  useStore.setState({ tree, checkedIds: new Set() })
})

describe('ExportPanel', () => {
  it('未勾选时两个按钮都禁用', () => {
    render(<ExportPanel />)
    expect(screen.getByRole('button', { name: '带文件夹结构' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '纯链接清单' })).toHaveProperty('disabled', true)
  })

  it('提示的条数与勾选范围一致', () => {
    useStore.setState({ checkedIds: new Set(['10', '100']) })
    render(<ExportPanel />)
    expect(screen.getByText('导出选中的 2 条书签')).toBeDefined()
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
})
