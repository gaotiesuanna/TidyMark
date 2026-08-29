import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StepIndex, type StepIndexItem } from '@/sidepanel/components/StepIndex'

type StepKey = 'scope' | 'preferences' | 'structure' | 'review' | 'result'

const items: readonly StepIndexItem<StepKey>[] = [
  { key: 'scope', label: '选择范围' },
  { key: 'preferences', label: '设置偏好' },
  { key: 'structure', label: '确认结构' },
  { key: 'review', label: '预览修改' },
  { key: 'result', label: '完成整理' },
]

describe('StepIndex', () => {
  it('渲染当前步骤内容，并把当前步骤标成 aria-current', () => {
    render(
      <StepIndex items={items} currentKey="structure">
        <div>结构编辑器</div>
      </StepIndex>,
    )

    expect(screen.getByText('结构编辑器')).toBeDefined()
    expect(screen.getByText(/确认结构/).getAttribute('aria-current')).toBe('step')
    expect(screen.getByText(/选择范围/).getAttribute('aria-current')).toBeNull()
  })

  it('序号跟着位置走，从 1 开始', () => {
    render(
      <StepIndex items={items} currentKey="scope">
        <div>范围编辑器</div>
      </StepIndex>,
    )

    expect(screen.getByText(/选择范围/).textContent).toBe('1. 选择范围')
    expect(screen.getByText(/完成整理/).textContent).toBe('5. 完成整理')
  })

  it('五个步骤都列出来，标题可见', () => {
    render(
      <StepIndex items={items} currentKey="scope">
        <div>范围编辑器</div>
      </StepIndex>,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    for (const item of items) {
      expect(screen.getByText(new RegExp(item.label))).toBeDefined()
    }
  })

  it('是只读进度而不是可以任意跳转的按钮列表', () => {
    render(
      <StepIndex items={items} currentKey="review">
        <div>修改预览</div>
      </StepIndex>,
    )

    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })
})
