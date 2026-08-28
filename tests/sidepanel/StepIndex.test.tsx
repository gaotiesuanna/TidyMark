import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StepIndex, type StepIndexItem } from '@/sidepanel/components/StepIndex'

type StepKey = 'scope' | 'preferences' | 'structure' | 'review' | 'result'

const items: readonly StepIndexItem<StepKey>[] = [
  { key: 'scope', index: '01', label: '选择范围', summary: '已选 3 个文件夹' },
  { key: 'preferences', index: '02', label: '设置偏好', summary: '按主题整理' },
  { key: 'structure', index: '03', label: '确认结构', summary: '8 个目标目录' },
  { key: 'review', index: '04', label: '预览修改', summary: '24 项修改' },
  { key: 'result', index: '05', label: '完成整理', summary: '已完成' },
]

describe('StepIndex', () => {
  it('把当前步骤内容放进当前的纵向条目，并标记当前步骤', () => {
    render(
      <StepIndex items={items} currentKey="structure">
        <div>结构编辑器</div>
      </StepIndex>,
    )

    expect(screen.getByText('结构编辑器')).toBeDefined()
    expect(screen.getByText('03 确认结构').getAttribute('aria-current')).toBe('step')
    expect(screen.getByText('01 选择范围')).toBeDefined()
  })

  it('只给已完成步骤显示摘要，当前与未来步骤保持收起标题', () => {
    render(
      <StepIndex items={items} currentKey="structure">
        <div>结构编辑器</div>
      </StepIndex>,
    )

    expect(screen.getByText('已选 3 个文件夹')).toBeDefined()
    expect(screen.getByText('按主题整理')).toBeDefined()
    expect(screen.queryByText('8 个目标目录')).toBeNull()
    expect(screen.queryByText('24 项修改')).toBeNull()
    expect(screen.queryByText('已完成')).toBeNull()
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
