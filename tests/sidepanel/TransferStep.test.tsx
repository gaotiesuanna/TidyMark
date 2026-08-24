import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferStep } from '@/sidepanel/steps/TransferStep'
import { useStore } from '@/sidepanel/store'
import type { BookmarkNode } from '@/core/ports'

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'react', children: [
        { id: '100', title: 'hooks', children: [
          { id: '1000', title: '更深一层', children: [] },
        ]},
      ]},
      { id: '11', title: '工作常用', children: [] },
    ]},
  ]},
]

beforeEach(() => {
  useStore.setState({
    tree, checkedIds: new Set(), busy: null, error: null,
    importFile: null, importError: null, importDone: null,
  })
})

describe('TransferStep', () => {
  it('是独立页：有目录树和导入导出，没有扫描、也没有整理步骤文案', () => {
    render(<TransferStep />)
    expect(screen.getByText('书签栏')).toBeDefined()
    expect(screen.getByRole('button', { name: '导出' })).toBeDefined()
    expect(screen.getByRole('button', { name: '导入' })).toBeDefined()
    expect(screen.queryByRole('button', { name: /扫描选中的/ })).toBeNull()
    expect(screen.queryByText(/勾选你想让 TidyMark 重构的文件夹/)).toBeNull()
  })

  it('默认展开导出格式', () => {
    render(<TransferStep />)
    expect(screen.getByRole('button', { name: '带文件夹结构' })).toBeDefined()
    expect(screen.getByRole('button', { name: '纯链接清单' })).toBeDefined()
    expect(screen.getByRole('button', { name: '浏览器书签文件' })).toBeDefined()
    expect(screen.queryByText('选择文件…')).toBeNull()
  })

  it('点导入后换成文件选择', async () => {
    render(<TransferStep />)
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    expect(screen.getByText('选择文件…')).toBeDefined()
    expect(screen.queryByRole('button', { name: '带文件夹结构' })).toBeNull()
  })

  it('导出和导入互斥，只展开一边', async () => {
    render(<TransferStep />)
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(screen.getByRole('button', { name: '带文件夹结构' })).toBeDefined()
    expect(screen.queryByText('选择文件…')).toBeNull()
  })

  it('已有导入预览时进页自动展开导入，避免确认界面被收掉', () => {
    useStore.setState({ importError: '这个文件不是有效的 JSON。' })
    render(<TransferStep />)
    expect(screen.getByText('这个文件不是有效的 JSON。')).toBeDefined()
    expect(screen.getByText('重新选择')).toBeDefined()
  })

  it('勾选仍连带子目录，和整理范围共用同一批勾选', async () => {
    render(<TransferStep />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'react' }))
    expect([...useStore.getState().checkedIds].sort()).toEqual(['10', '100', '1000'])
  })
})
