import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StructureStep } from '@/sidepanel/steps/StructureStep'
import { useStore } from '@/sidepanel/store'
import { EMPTY_EDITS } from '@/core/structure'
import type { CategoryCandidate, OrganizePlan } from '@/core/types'
import { makePlan } from '../fakes/plan'

/** 只列一级/二级两层的最小 plan：给「合并到」下拉的用例专用，不牵扯书签计数与移动操作。 */
interface NodeSpec {
  id: string
  title: string
  children?: NodeSpec[]
}

function setupPlan(specs: NodeSpec[]): void {
  const candidates: CategoryCandidate[] = []
  for (const spec of specs) {
    candidates.push({ id: spec.id, path: [spec.title] })
    for (const child of spec.children ?? []) {
      candidates.push({ id: child.id, path: [spec.title, child.title] })
    }
  }
  const plan: OrganizePlan = {
    id: 'p', createdAt: 0, scopeRootIds: ['1'], rebuildStructure: true,
    candidates, operations: [], rows: [], unchanged: [], warnings: [], tags: [], mergeRoot: null,
    summary: {
      totalBookmarks: 0, movedBookmarks: 0, unchangedBookmarks: 0,
      createdFolders: candidates.length, renamedFolders: 0, renamedBookmarks: 0, lowConfidenceItems: 0,
    },
  }
  useStore.setState({ plan, structureEdits: EMPTY_EDITS, step: 'structure' })
}

describe('StructureStep', () => {
  beforeEach(() => {
    useStore.setState({ plan: makePlan(), structureEdits: EMPTY_EDITS, step: 'structure' })
  })

  it('渲染目录区，返回与查看清单按钮都在', () => {
    render(<StructureStep />)

    expect(screen.getByTestId('structure-section')).toBeTruthy()
    expect(screen.getByRole('button', { name: '返回' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /查看移动清单/ })).toBeTruthy()
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
    // 「合并到」下拉现在也会把「其他」列成选项文本，getByText('其他') 会歧义——
    // 用 selector 精确定位「其他」那一行本身的 <span>（不可删节点用 span 渲染标题，不是 <option>）
    expect(screen.getByText('其他', { selector: 'span' }).closest('div')!.textContent).toContain('1 条将移入')
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
    // 「其他」现在也会出现在别的目录「合并到」下拉的 <option> 里，getByText('其他') 会歧义——
    // 用 selector 精确定位它自己那一行的 <span>
    expect(screen.getByText('其他', { selector: 'span' })).toBeTruthy()
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

describe('StructureStep 合并到', () => {
  it('每个可删节点旁给一个「合并到」的下拉，选了就合并', async () => {
    setupPlan([{ id: 'tmp:1', title: '前端' }, { id: 'tmp:2', title: '后端' }])
    render(<StructureStep />)
    await userEvent.selectOptions(screen.getByLabelText('把「前端」合并到…'), 'tmp:2')

    const edits = useStore.getState().structureEdits
    expect(edits.removed).toContain('tmp:1')
    expect(edits.mergedInto['tmp:1']).toBe('tmp:2')
  })

  it('下拉里不出现自己', () => {
    setupPlan([{ id: 'tmp:1', title: '前端' }, { id: 'tmp:2', title: '后端' }])
    render(<StructureStep />)
    const select = screen.getByLabelText('把「前端」合并到…') as HTMLSelectElement
    const values = [...select.options].map((o) => o.value)
    expect(values).not.toContain('tmp:1')
    expect(values).toContain('tmp:2')
  })

  it('只列同层的——跨层等于移动，本轮不做', () => {
    setupPlan([
      { id: 'tmp:1', title: '前端', children: [{ id: 'tmp:9', title: '构建工具' }] },
      { id: 'tmp:2', title: '后端' },
    ])
    render(<StructureStep />)
    const select = screen.getByLabelText('把「前端」合并到…') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).not.toContain('tmp:9')
  })

  // 票 07 §3：「其他」不能被合并走（removable: false 已经挡住），但可以当接收方——
  // 把一个碎目录并进「其他」，效果与「删除」一致（对聚合目录还不止如此，见 structure.ts 的回落链）。
  // 这条守住「一级下拉排除 removable === false」不会被悄悄改回去。
  it('「其他」不可被合并走，但可以被选为合并目标', () => {
    setupPlan([{ id: 'tmp:1', title: '前端' }, { id: 'tmp:9', title: '其他' }])
    render(<StructureStep />)
    // 「其他」自己那一行不可删，也就没有自己的「合并到」下拉
    expect(screen.queryByLabelText('把「其他」合并到…')).toBeNull()
    // 但「前端」的下拉里能选到「其他」
    const select = screen.getByLabelText('把「前端」合并到…') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toContain('tmp:9')
  })
})

describe('StructureStep 合并到（二级下拉）', () => {
  /** 两个一级目录各带两个二级子目录，专门测「只允许同层合并」在二级这一半是否也被守住（票 07）。 */
  const twoParentsWithChildren = () => setupPlan([
    {
      id: 'tmp:1', title: '前端',
      children: [{ id: 'tmp:9', title: '构建工具' }, { id: 'tmp:10', title: 'React' }],
    },
    {
      id: 'tmp:2', title: '后端',
      children: [{ id: 'tmp:11', title: '框架' }],
    },
  ])

  it('二级节点的下拉里只出现同一个父目录下的其他二级节点', () => {
    twoParentsWithChildren()
    render(<StructureStep />)
    const select = screen.getByLabelText('把「构建工具」合并到…') as HTMLSelectElement
    const values = [...select.options].map((o) => o.value)
    // 同父兄弟必须在
    expect(values).toContain('tmp:10')
  })

  it('二级节点的下拉里不出现自己', () => {
    twoParentsWithChildren()
    render(<StructureStep />)
    const select = screen.getByLabelText('把「构建工具」合并到…') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).not.toContain('tmp:9')
  })

  it('二级节点的下拉里不出现任何一级节点', () => {
    twoParentsWithChildren()
    render(<StructureStep />)
    const select = screen.getByLabelText('把「构建工具」合并到…') as HTMLSelectElement
    const values = [...select.options].map((o) => o.value)
    expect(values).not.toContain('tmp:1')
    expect(values).not.toContain('tmp:2')
  })

  it('二级节点的下拉里不出现别的父目录下的二级节点', () => {
    twoParentsWithChildren()
    render(<StructureStep />)
    const select = screen.getByLabelText('把「构建工具」合并到…') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).not.toContain('tmp:11')
  })
})
