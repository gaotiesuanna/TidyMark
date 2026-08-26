import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BookmarkTree, filterBookmarkTree } from '@/sidepanel/components/BookmarkTree'
import type { BookmarkNode } from '@/core/ports'

const nodes: BookmarkNode[] = [
  { id: '1', title: '书签栏', children: [
    { id: '10', title: 'react', children: [
      { id: '100', title: 'A', url: 'https://a.dev' },
      { id: '101', title: 'hooks', children: [] },
    ]},
    { id: '11', title: '工作常用', children: [] },
  ]},
]

/** 默认只展开根节点，也就是一级目录可见。 */
const expanded = new Set(['1'])

function renderTree(props: Partial<Parameters<typeof BookmarkTree>[0]> = {}) {
  return render(
    <BookmarkTree
      nodes={nodes}
      checkedIds={new Set()}
      onToggle={vi.fn()}
      expandedIds={expanded}
      onToggleExpand={vi.fn()}
      {...props}
    />,
  )
}

describe('BookmarkTree', () => {
  it('只渲染文件夹，不渲染书签', () => {
    renderTree()
    expect(screen.getByText('react')).toBeDefined()
    expect(screen.queryByText('A')).toBeNull()
  })

  it('显示每个文件夹内的书签数量', () => {
    renderTree()
    expect(screen.getByText('react').closest('label')!.textContent).toContain('1')
  })

  it('点击复选框触发 onToggle 并带上文件夹 id', async () => {
    const onToggle = vi.fn()
    renderTree({ onToggle })
    await userEvent.click(screen.getByRole('checkbox', { name: /react/ }))
    expect(onToggle).toHaveBeenCalledWith('10')
  })

  it('已勾选的文件夹复选框为选中态', () => {
    renderTree({ checkedIds: new Set(['10']) })
    expect((screen.getByRole('checkbox', { name: /react/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: /工作常用/ }) as HTMLInputElement).checked).toBe(false)
  })
})

describe('BookmarkTree 展开收起', () => {
  it('未展开的目录不显示子目录', () => {
    renderTree()
    expect(screen.queryByText('hooks')).toBeNull()
  })

  it('展开后显示子目录', () => {
    renderTree({ expandedIds: new Set(['1', '10']) })
    expect(screen.getByText('hooks')).toBeDefined()
  })

  it('有子目录的目录才有展开按钮', () => {
    renderTree()
    expect(screen.getByRole('button', { name: /react/ })).toBeDefined()
    expect(screen.queryByRole('button', { name: /工作常用/ })).toBeNull()
  })

  it('点击展开按钮触发 onToggleExpand', async () => {
    const onToggleExpand = vi.fn()
    renderTree({ onToggleExpand })
    await userEvent.click(screen.getByRole('button', { name: /react/ }))
    expect(onToggleExpand).toHaveBeenCalledWith('10')
  })

  it('展开按钮不会连带切换勾选状态', async () => {
    const onToggle = vi.fn()
    renderTree({ onToggle })
    await userEvent.click(screen.getByRole('button', { name: /react/ }))
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('根节点收起时，一级目录也不显示', () => {
    renderTree({ expandedIds: new Set() })
    expect(screen.getByText('书签栏')).toBeDefined()
    expect(screen.queryByText('react')).toBeNull()
  })
 
  it('按文件夹名、书签标题或 URL 保留匹配节点和祖先', () => {
    const result = filterBookmarkTree(nodes, 'a.dev')
    expect(result.hasMatches).toBe(true)
    expect(result.nodes[0]?.title).toBe('书签栏')
    expect(result.nodes[0]?.children?.map((node) => node.title)).toEqual(['react'])
    expect(result.nodes[0]?.children?.[0]?.children?.map((node) => node.title)).toEqual(['A'])
    expect(result.expandedIds).toEqual(new Set(['1', '10']))
  })

  it('文件夹名称命中时只保留命中的文件夹，不展开无关后代', () => {
    const result = filterBookmarkTree(nodes, '工作常用')
    expect(result.nodes[0]?.children?.map((node) => node.title)).toEqual(['工作常用'])
    expect(result.nodes[0]?.children?.[0]?.children).toEqual([])
    expect(result.expandedIds).toEqual(new Set(['1']))
  })

  it('搜索渲染书签结果，但默认树仍只渲染文件夹', () => {
    const view = renderTree({ nodes, showBookmarks: true, expandedIds: new Set(['1', '10']) })
    expect(screen.getByText('A')).toBeDefined()
    expect(screen.getByText('https://a.dev')).toBeDefined()
    view.unmount()

    renderTree({ nodes, showBookmarks: false, expandedIds: new Set(['1', '10']) })
    expect(screen.queryByText('A')).toBeNull()
  })

  it('空查询返回原节点且不进入搜索结果模式', () => {
    const result = filterBookmarkTree(nodes, '  ')
    expect(result.nodes).toBe(nodes)
    expect(result.hasMatches).toBe(false)
    expect(result.expandedIds).toEqual(new Set())
  })
})
