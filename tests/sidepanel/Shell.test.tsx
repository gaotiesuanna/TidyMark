import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Shell } from '@/sidepanel/components/Shell'
import { useStore } from '@/sidepanel/store'

beforeEach(() => {
  useStore.setState({
    step: 'scope', settingsOpen: false, busy: null, busyKind: null,
    error: null, progress: null, logs: [],
  })
})

describe('Shell 设置入口', () => {
  it('默认展示步骤条与步骤内容，不展示设置页', () => {
    render(<Shell><div>步骤内容</div></Shell>)
    expect(screen.getByText('1. 选范围')).toBeDefined()
    expect(screen.getByText('步骤内容')).toBeDefined()
  })

  it('点齿轮打开设置页，步骤条与步骤内容都让位', async () => {
    render(<Shell><div>步骤内容</div></Shell>)
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.queryByText('步骤内容')).toBeNull()
    expect(screen.queryByText('1. 选范围')).toBeNull()
    expect(screen.getByRole('heading', { name: '设置' })).toBeDefined()
  })

  it('点返回回到原来的步骤，步骤内容原样回来', async () => {
    render(<Shell><div>步骤内容</div></Shell>)
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    await userEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(screen.getByText('步骤内容')).toBeDefined()
    expect(screen.getByText('1. 选范围')).toBeDefined()
  })

  // 分析要跑好几分钟，中途想改设置是常事；关掉设置页后进度必须还在
  it('整理进行中也能开设置，busy 状态不受影响', async () => {
    useStore.setState({ busy: '正在分析…', busyKind: 'analyze' })
    render(<Shell><div>步骤内容</div></Shell>)
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(useStore.getState().busy).toBe('正在分析…')
  })
})
