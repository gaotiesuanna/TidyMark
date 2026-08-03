import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScopeStep } from '@/sidepanel/steps/ScopeStep'
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
  useStore.setState({ tree, checkedIds: new Set(), busy: null, error: null })
})

describe('ScopeStep 目录展开', () => {
  it('默认只展示到一级目录', () => {
    render(<ScopeStep />)
    expect(screen.getByText('书签栏')).toBeDefined()
    expect(screen.getByText('react')).toBeDefined()
    expect(screen.queryByText('hooks')).toBeNull()
  })

  it('点击某个目录的展开按钮只展开它自己', async () => {
    render(<ScopeStep />)
    await userEvent.click(screen.getByRole('button', { name: '展开 react' }))
    expect(screen.getByText('hooks')).toBeDefined()
    expect(screen.queryByText('更深一层')).toBeNull()
  })

  it('再点一次收起', async () => {
    render(<ScopeStep />)
    await userEvent.click(screen.getByRole('button', { name: '展开 react' }))
    await userEvent.click(screen.getByRole('button', { name: '收起 react' }))
    expect(screen.queryByText('hooks')).toBeNull()
  })

  it('全部展开后所有层级都可见', async () => {
    render(<ScopeStep />)
    await userEvent.click(screen.getByText('全部展开'))
    expect(screen.getByText('hooks')).toBeDefined()
    expect(screen.getByText('更深一层')).toBeDefined()
  })

  it('全部收起后只剩根目录', async () => {
    render(<ScopeStep />)
    await userEvent.click(screen.getByText('全部收起'))
    expect(screen.getByText('书签栏')).toBeDefined()
    expect(screen.queryByText('react')).toBeNull()
  })

  it('折叠状态不影响勾选，勾选仍连带子目录', async () => {
    render(<ScopeStep />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'react' }))
    expect([...useStore.getState().checkedIds].sort()).toEqual(['10', '100', '1000'])
  })
})
