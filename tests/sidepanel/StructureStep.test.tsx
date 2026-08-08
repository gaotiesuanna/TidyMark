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

describe('StructureStep 合并根', () => {
  const withMergeRoot = () => ({
    ...makePlan(),
    mergeRoot: {
      temporaryId: 'tmp:0', title: 'AI 学习',
      sourceRootIds: ['10', '11'], sourceTitles: ['NiceG', 'b_llm'],
    },
  })

  it('显示合并到输入框，预填模型给的名字', () => {
    useStore.setState({ plan: withMergeRoot(), structureEdits: EMPTY_EDITS, step: 'structure' })
    render(<StructureStep />)
    expect(screen.getByDisplayValue('AI 学习')).toBeTruthy()
  })

  it('改名写入 structureEdits，key 是合并根的 temporaryId', async () => {
    useStore.setState({ plan: withMergeRoot(), structureEdits: EMPTY_EDITS, step: 'structure' })
    render(<StructureStep />)
    const input = screen.getByDisplayValue('AI 学习')
    await userEvent.clear(input)
    await userEvent.type(input, '大模型')
    expect(useStore.getState().structureEdits.renames['tmp:0']).toBe('大模型')
  })

  it('该输入框没有删除按钮', () => {
    useStore.setState({ plan: withMergeRoot(), structureEdits: EMPTY_EDITS, step: 'structure' })
    render(<StructureStep />)
    expect(screen.queryByRole('button', { name: '删除目录 AI 学习' })).toBeNull()
  })

  it('非合并模式不显示该输入框', () => {
    useStore.setState({ plan: makePlan(), structureEdits: EMPTY_EDITS, step: 'structure' })
    render(<StructureStep />)
    expect(screen.queryByText('合并到')).toBeNull()
  })
})

describe('StructureStep 合并会删掉哪些文件夹', () => {
  // 应用之前，整条动线没有任何一处告诉用户「你勾的那两个文件夹会消失」：
  // 范围页不说，偏好页说的是反话，日志只报新名字，
  // 结构页的「合并到」讲的是东西去哪儿、不是什么会没掉，评审页只有逐条路径。
  // 第一次听说是结果页——那时已经删完了。这段说明是最后一道能赶在删除之前的门。
  const withMergeRoot = () => ({
    ...makePlan(),
    mergeRoot: {
      temporaryId: 'tmp:0', title: 'AI 学习',
      sourceRootIds: ['10', '11'], sourceTitles: ['NiceG', 'b_llm'],
    },
  })

  it('点名将被清空删除的源文件夹，并说明可一键撤销', () => {
    useStore.setState({ plan: withMergeRoot(), structureEdits: EMPTY_EDITS, step: 'structure' })
    render(<StructureStep />)
    // 必须点到具体名字：抽象地说「源文件夹会被删除」，用户对不上是哪两个
    const notice = screen.getByText(/NiceG、b_llm/)
    expect(notice.textContent).toMatch(/删除/)
    expect(notice.textContent).toMatch(/撤销/)
  })

  it('中文界面下名单用顿号分隔，与结果页同一套写法', () => {
    useStore.setState({ plan: withMergeRoot(), structureEdits: EMPTY_EDITS, step: 'structure' })
    render(<StructureStep />)
    expect(screen.queryByText(/NiceG, b_llm/)).toBeNull()
    expect(screen.getByText(/NiceG、b_llm/)).toBeTruthy()
  })

  it('非合并模式不出现这段说明', () => {
    useStore.setState({ plan: makePlan(), structureEdits: EMPTY_EDITS, step: 'structure' })
    render(<StructureStep />)
    expect(screen.queryByText(/会被清空并删除/)).toBeNull()
  })
})
