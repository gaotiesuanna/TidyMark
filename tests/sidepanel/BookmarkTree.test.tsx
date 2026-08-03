import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BookmarkTree } from '@/sidepanel/components/BookmarkTree'
import type { BookmarkNode } from '@/core/ports'

const nodes: BookmarkNode[] = [
  { id: '1', title: '书签栏', children: [
    { id: '10', title: 'react', children: [{ id: '100', title: 'A', url: 'https://a.dev' }] },
    { id: '11', title: '工作常用', children: [] },
  ]},
]

describe('BookmarkTree', () => {
  it('只渲染文件夹，不渲染书签', () => {
    render(<BookmarkTree nodes={nodes} checkedIds={new Set()} onToggle={vi.fn()} />)
    expect(screen.getByText('react')).toBeDefined()
    expect(screen.queryByText('A')).toBeNull()
  })

  it('显示每个文件夹内的书签数量', () => {
    render(<BookmarkTree nodes={nodes} checkedIds={new Set()} onToggle={vi.fn()} />)
    expect(screen.getByText('react').closest('label')!.textContent).toContain('1')
  })

  it('点击复选框触发 onToggle 并带上文件夹 id', async () => {
    const onToggle = vi.fn()
    render(<BookmarkTree nodes={nodes} checkedIds={new Set()} onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /react/ }))
    expect(onToggle).toHaveBeenCalledWith('10')
  })

  it('已勾选的文件夹复选框为选中态', () => {
    render(<BookmarkTree nodes={nodes} checkedIds={new Set(['10'])} onToggle={vi.fn()} />)
    expect((screen.getByRole('checkbox', { name: /react/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: /工作常用/ }) as HTMLInputElement).checked).toBe(false)
  })
})
