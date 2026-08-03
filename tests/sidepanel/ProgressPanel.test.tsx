import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProgressPanel } from '@/sidepanel/components/ProgressPanel'
import type { LogLine } from '@/sidepanel/store'

const logs: LogLine[] = [
  { id: 1, phase: 'tags', level: 'info', message: '标签批次 1/2：25 条' },
  { id: 2, phase: 'classify', level: 'info', message: '分类批次 1/2：25 条，成功 25 条' },
]

describe('ProgressPanel', () => {
  it('空闲且没有日志时不渲染', () => {
    const { container } = render(<ProgressPanel busy={null} progress={null} logs={[]} />)
    expect(container.textContent).toBe('')
  })

  it('显示当前阶段与进度数字', () => {
    render(
      <ProgressPanel
        busy="正在分析…"
        progress={{ phase: 'classify', done: 320, total: 923 }}
        logs={logs}
      />,
    )
    expect(screen.getByText('正在分析…')).toBeDefined()
    expect(screen.getByText('分类 320/923')).toBeDefined()
  })

  it('默认折叠，只显示最新一行日志', () => {
    render(<ProgressPanel busy="正在分析…" progress={null} logs={logs} />)
    expect(screen.getByText('分类批次 1/2：25 条，成功 25 条')).toBeDefined()
    expect(screen.queryByText('标签批次 1/2：25 条')).toBeNull()
  })

  it('展开后显示全部日志', async () => {
    render(<ProgressPanel busy="正在分析…" progress={null} logs={logs} />)
    await userEvent.click(screen.getByRole('button', { name: '展开运行日志' }))
    expect(screen.getByText(/标签批次 1\/2/)).toBeDefined()
    expect(screen.getByText('运行日志（2 条）')).toBeDefined()
  })

  it('有 error 级别日志时自动展开', () => {
    render(
      <ProgressPanel
        busy="正在分析…"
        progress={null}
        logs={[...logs, { id: 3, phase: 'classify', level: 'error', message: '批次失败：400' }]}
      />,
    )
    expect(screen.getByText(/标签批次 1\/2/)).toBeDefined()
  })

  it('传入 onCancel 时显示取消按钮并回调', async () => {
    const onCancel = vi.fn()
    render(<ProgressPanel busy="正在分析…" progress={null} logs={logs} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('不可取消的步骤没有取消按钮', () => {
    render(<ProgressPanel busy="正在应用…" progress={null} logs={logs} />)
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
  })

  it('分析结束后日志仍然保留', () => {
    render(<ProgressPanel busy={null} progress={null} logs={logs} />)
    expect(screen.getByText('分类批次 1/2：25 条，成功 25 条')).toBeDefined()
  })
})
