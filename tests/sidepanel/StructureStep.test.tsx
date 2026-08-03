import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StructureStep } from '@/sidepanel/steps/StructureStep'
import { useStore } from '@/sidepanel/store'
import { EMPTY_EDITS } from '@/core/structure'
import { makePlan } from '../fakes/plan'

describe('StructureStep', () => {
  beforeEach(() => {
    useStore.setState({ plan: makePlan(), structureEdits: EMPTY_EDITS, step: 'structure' })
  })

  it('按层级展示目录，编号由位置算出', () => {
    render(<StructureStep />)
    expect(screen.getAllByText('01')).toHaveLength(3) // 01 GitHub、其下 01 AI 工具、02 前端 下的 01 React
    expect(screen.getByText('02')).toBeTruthy()
  })

  it('每个目录显示将移入的书签数', () => {
    render(<StructureStep />)
    // 一级目录的条数含子目录：GitHub 与「前端」各 2 条
    expect(screen.getByDisplayValue('GitHub').closest('div')!.textContent).toContain('2 条将移入')
    expect(screen.getByDisplayValue('AI 工具').closest('li')!.textContent).toContain('2 条将移入')
    expect(screen.getByDisplayValue('前端').closest('div')!.textContent).toContain('2 条将移入')
    expect(screen.getByDisplayValue('React').closest('li')!.textContent).toContain('1 条将移入')
    expect(screen.getByText('其他').closest('div')!.textContent).toContain('1 条将移入')
  })

  it('改名写入 structureEdits', async () => {
    render(<StructureStep />)
    const input = screen.getByDisplayValue('GitHub')
    await userEvent.clear(input)
    await userEvent.type(input, '代码仓库')
    expect(useStore.getState().structureEdits.renames['tmp:1']).toBe('代码仓库')
  })

  it('删除后该目录从界面消失', async () => {
    render(<StructureStep />)
    await userEvent.click(screen.getByRole('button', { name: '删除目录 前端' }))
    expect(screen.queryByDisplayValue('前端')).toBeNull()
  })

  it('删除一级目录后编号重排', async () => {
    render(<StructureStep />)
    await userEvent.click(screen.getByRole('button', { name: '删除目录 GitHub' }))
    // 原本是 02 的「前端」升到 01
    expect(screen.getByDisplayValue('前端').closest('div')!.textContent).toContain('01')
  })

  it('「其他」不可删也不可改名', () => {
    render(<StructureStep />)
    expect(screen.queryByRole('button', { name: '删除目录 其他' })).toBeNull()
    expect(screen.queryByDisplayValue('其他')).toBeNull()
    expect(screen.getByText('其他')).toBeTruthy()
  })

  it('点击继续进入 review', async () => {
    render(<StructureStep />)
    await userEvent.click(screen.getByRole('button', { name: /查看移动清单/ }))
    expect(useStore.getState().step).toBe('review')
  })

  it('点击返回回到偏好页', async () => {
    render(<StructureStep />)
    await userEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(useStore.getState().step).toBe('preferences')
  })
})
