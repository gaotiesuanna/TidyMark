import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewStep } from '@/sidepanel/steps/ReviewStep'
import { useStore } from '@/sidepanel/store'
import type { OrganizePlan } from '@/core/types'

const plan: OrganizePlan = {
  id: 'p1', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
  candidates: [], operations: [],
  rows: [
    { bookmarkId: '100', title: 'React 官网', url: 'https://react.dev', fromPath: ['书签栏', '杂项'], toPath: ['书签栏', 'react'], confidence: 0.95, reason: '官方文档' },
    { bookmarkId: '101', title: '不确定的', url: 'https://x.dev', fromPath: ['书签栏', '杂项'], toPath: ['书签栏', 'react'], confidence: 0.4, reason: '可能相关' },
  ],
  summary: { totalBookmarks: 2, movedBookmarks: 2, unchangedBookmarks: 0, createdFolders: 0, renamedFolders: 0, lowConfidenceItems: 1 },
  warnings: [],
  tags: [],
}

beforeEach(() => {
  useStore.setState({ plan, accepted: new Set(['100']), busy: null, error: null })
})

describe('ReviewStep', () => {
  it('列出每条建议的前后路径与理由', () => {
    render(<ReviewStep />)
    expect(screen.getByText('React 官网')).toBeDefined()
    expect(screen.getAllByText(/书签栏 \/ 杂项/).length).toBeGreaterThan(0)
    expect(screen.getByText(/官方文档/)).toBeDefined()
  })

  it('低置信度条目被标出', () => {
    render(<ReviewStep />)
    expect(screen.getByText('低置信度')).toBeDefined()
  })

  it('复选框反映已接受状态', () => {
    render(<ReviewStep />)
    expect((screen.getByRole('checkbox', { name: 'React 官网' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: '不确定的' }) as HTMLInputElement).checked).toBe(false)
  })

  it('点击复选框切换接受状态', async () => {
    render(<ReviewStep />)
    await userEvent.click(screen.getByRole('checkbox', { name: '不确定的' }))
    expect(useStore.getState().accepted.has('101')).toBe(true)
  })

  it('全部接受按钮接受所有条目', async () => {
    render(<ReviewStep />)
    await userEvent.click(screen.getByText('全部接受'))
    expect(useStore.getState().accepted.size).toBe(2)
  })

  it('仅接受高置信度按钮剔除低置信度条目', async () => {
    useStore.setState({ accepted: new Set(['100', '101']) })
    render(<ReviewStep />)
    await userEvent.click(screen.getByText('仅高置信度'))
    expect([...useStore.getState().accepted]).toEqual(['100'])
  })

  it('全部拒绝后应用按钮禁用', async () => {
    render(<ReviewStep />)
    await userEvent.click(screen.getByText('全部拒绝'))
    expect(screen.getByRole('button', { name: /应用/ }).hasAttribute('disabled')).toBe(true)
  })

  it('应用按钮显示将要移动的数量', () => {
    render(<ReviewStep />)
    expect(screen.getByRole('button', { name: /应用 1 项修改/ })).toBeDefined()
  })
})
