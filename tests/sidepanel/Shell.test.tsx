import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Shell } from '@/sidepanel/components/Shell'
import { useStore } from '@/sidepanel/store'

beforeEach(() => {
  useStore.setState({
    step: 'scope', mode: 'organize', settingsOpen: false, busy: null, busyKind: null,
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

/**
 * 步骤条是只读的进度指示，不是导航——所以它刻意不长成按钮的样子。
 * 代价是「现在在第几步」只剩加粗与下划线在传达，读屏那边什么都收不到，
 * aria-current 是唯一能被程序读到的载体，得有测试守着。
 */
describe('Shell 步骤条', () => {
  it('只有当前步骤带 aria-current', () => {
    useStore.setState({ step: 'review' })
    render(<Shell><div>步骤内容</div></Shell>)
    expect(screen.getByText('3. 预览').getAttribute('aria-current')).toBe('step')
    expect(screen.getByText('1. 选范围').getAttribute('aria-current')).toBeNull()
  })

  it('步骤变了 aria-current 跟着走，不会留在原地', () => {
    useStore.setState({ step: 'scope' })
    const { rerender } = render(<Shell><div>步骤内容</div></Shell>)
    expect(screen.getByText('1. 选范围').getAttribute('aria-current')).toBe('step')

    useStore.setState({ step: 'result' })
    rerender(<Shell><div>步骤内容</div></Shell>)
    expect(screen.getByText('1. 选范围').getAttribute('aria-current')).toBeNull()
    expect(screen.getByText('4. 结果').getAttribute('aria-current')).toBe('step')
  })
})

/**
 * 出错时用户唯一在看的就是这条红条，不该让他自己去页底找「开始 AI 分析」——
 * 所以可重试的错误得在红条里给出按钮；配置类错误（重试一百次也一样）不该给。
 */
describe('Shell 的错误条', () => {
  it('可重试时给出按钮，点了就重跑', async () => {
    const retry = vi.fn()
    useStore.setState({ error: '后台被中断', retryable: 'analyze', retry, busy: null })
    render(<Shell>{null}</Shell>)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalled()
  })

  /**
   * 红条讲的是刚才那轮整理出了什么事，跟正在改的设置无关。跟到设置页来只会挡住正文，
   * 「重试」还会在用户正配模型的时候把分析重新拉起来。但也不能顺手清掉：
   * 点返回回到那一步，该看见的还得看见。
   */
  it('设置页里红条让位，返回后原样回来', async () => {
    useStore.setState({ error: '后台被中断', retryable: 'analyze', busy: null })
    render(<Shell>{null}</Shell>)
    expect(screen.getByText('后台被中断')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.queryByText('后台被中断')).toBeNull()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(screen.getByText('后台被中断')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('不可重试的错误只显示文字，没有按钮', () => {
    useStore.setState({ error: '请先填 API Key', retryable: null, busy: null })
    render(<Shell>{null}</Shell>)
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })
})

/**
 * 三条平行的路，不是一条路上的几步——所以模式切换是并列的 tab 按钮，
 * 不是塞进步骤条里的第五格（那会让前四格点不动、第五格能点，参见 Shell.tsx 的注释）。
 */
describe('Shell 模式切换', () => {
  it('默认停在 AI 整理，三个按钮都在', () => {
    render(<Shell><div>步骤内容</div></Shell>)
    expect(screen.getByRole('tab', { name: 'AI 整理' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: '本地清理' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tab', { name: '导入导出' }).getAttribute('aria-selected')).toBe('false')
  })

  it('点本地清理切到清理模式，步骤条随之让位', async () => {
    render(<Shell><div>步骤内容</div></Shell>)
    await userEvent.click(screen.getByRole('tab', { name: '本地清理' }))
    expect(useStore.getState().mode).toBe('cleanup')
    expect(screen.queryByText('1. 选范围')).toBeNull()
  })

  it('点导入导出切到导入导出模式，步骤条随之让位', async () => {
    render(<Shell><div>步骤内容</div></Shell>)
    await userEvent.click(screen.getByRole('tab', { name: '导入导出' }))
    expect(useStore.getState().mode).toBe('transfer')
    expect(screen.queryByText('1. 选范围')).toBeNull()
  })

  it('清理模式下不展示步骤条，但正文照常渲染', () => {
    useStore.setState({ mode: 'cleanup' })
    render(<Shell><div>步骤内容</div></Shell>)
    expect(screen.queryByText('1. 选范围')).toBeNull()
    expect(screen.getByText('步骤内容')).toBeDefined()
  })

  it('导入导出模式下不展示步骤条，但正文照常渲染', () => {
    useStore.setState({ mode: 'transfer' })
    render(<Shell><div>步骤内容</div></Shell>)
    expect(screen.queryByText('1. 选范围')).toBeNull()
    expect(screen.getByText('步骤内容')).toBeDefined()
  })

  // busy 是单槽，切过去也什么都干不了，还会让人以为切换失灵，所以忙的时候禁用
  it('忙的时候三个模式按钮都禁用', () => {
    useStore.setState({ busy: '正在分析…', busyKind: 'analyze' })
    render(<Shell><div>步骤内容</div></Shell>)
    expect((screen.getByRole('tab', { name: 'AI 整理' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('tab', { name: '本地清理' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('tab', { name: '导入导出' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('设置页打开时模式按钮不显示——那时整个正文是设置', async () => {
    render(<Shell><div>步骤内容</div></Shell>)
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.queryByRole('tab', { name: 'AI 整理' })).toBeNull()
  })

  // 齿轮和返回同占头部右/左两端，设置页里齿轮点了没反应——留着只会让人怀疑自己没点中
  it('设置页里齿轮收起来，只剩返回', async () => {
    render(<Shell><div>步骤内容</div></Shell>)
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.queryByRole('button', { name: '设置' })).toBeNull()
    expect(screen.getByRole('button', { name: '返回' })).toBeTruthy()
  })
})
