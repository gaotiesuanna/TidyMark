import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewStep } from '@/sidepanel/steps/ReviewStep'
import { useStore } from '@/sidepanel/store'
import { downloadJson } from '@/sidepanel/lib/download'
import { DEFAULT_SETTINGS } from '@/storage/settings'
import type { CategoryCandidate, OrganizePlan, PlanRow } from '@/core/types'

vi.mock('@/sidepanel/lib/download', () => ({ downloadJson: vi.fn(), downloadText: vi.fn() }))

const plan: OrganizePlan = {
  id: 'p1', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
  candidates: [], operations: [],
  rows: [
    { bookmarkId: '100', title: 'React 官网', url: 'https://react.dev', fromPath: ['书签栏', '杂项'], toPath: ['书签栏', 'react'], confidence: 0.95, reason: '官方文档', source: 'llm' },
    { bookmarkId: '101', title: '不确定的', url: 'https://x.dev', fromPath: ['书签栏', '杂项'], toPath: ['书签栏', 'react'], confidence: 0.4, reason: '可能相关', source: 'llm' },
  ],
  unchanged: [],
  summary: { totalBookmarks: 2, movedBookmarks: 2, unchangedBookmarks: 0, createdFolders: 0, renamedFolders: 0, renamedBookmarks: 0, lowConfidenceItems: 1 },
  warnings: [],
  tags: [],
  mergeRoot: null,
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

  it('置信度低于阈值的条目被标出', () => {
    render(<ReviewStep />)
    expect(screen.getByText('值得看一眼')).toBeDefined()
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

  it('全部拒绝后应用按钮禁用', async () => {
    render(<ReviewStep />)
    await userEvent.click(screen.getByText('全部拒绝'))
    expect(screen.getByRole('button', { name: /应用/ }).hasAttribute('disabled')).toBe(true)
  })

  it('应用按钮显示将要移动的数量', () => {
    render(<ReviewStep />)
    expect(screen.getByRole('button', { name: /应用 1 项修改/ })).toBeDefined()
  })

  it('导出方案带上勾选状态与设置，且不含 apiKey', async () => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, llm: { baseUrl: 'https://api.x.com/v1', apiKey: 'sk-secret', model: 'gpt-4o-mini' } },
    })
    render(<ReviewStep />)
    await userEvent.click(screen.getByText('导出方案'))

    const [filename, payload] = vi.mocked(downloadJson).mock.calls.at(-1)!
    expect(filename).toMatch(/^tidymark-plan-\d{4}-\d{2}-\d{2}\.json$/)
    const body = payload as { settings: { llm: Record<string, unknown> }; accepted: string[]; plan: OrganizePlan }
    expect(body.accepted).toEqual(['100'])
    expect(body.plan.rows).toHaveLength(2)
    expect(body.settings.llm.model).toBe('gpt-4o-mini')
    // 这个文件是要发出去给人看的，密钥一个字符都不能跟着走
    expect(JSON.stringify(payload)).not.toContain('sk-secret')
    expect('apiKey' in body.settings.llm).toBe(false)
  })
})

/**
 * 造一条最简 PlanRow，只暴露测试关心的几个维度：id、目标目录、来源，
 * confidence 缺省时按来源给个合理默认值（rule 必然高、llm 给个中等值）。
 */
function row(id: string, toPath: string[], source: PlanRow['source'], confidence?: number): PlanRow {
  return {
    bookmarkId: id,
    title: `书签 ${id}`,
    url: `https://example.com/${id}`,
    fromPath: ['书签栏', '杂项'],
    toPath,
    confidence: confidence ?? (source === 'rule' ? 1 : 0.9),
    reason: source === 'rule' ? '域名规则命中' : '模型判断',
    source,
  }
}

/**
 * 拿一批行拼出一份最简 plan 塞进 store，rebuildStructure 关着，renumberPlan 就原样直通。
 * candidates 缺省为空数组——只有测试改投下拉时才需要真的传几个候选目录进来。
 */
function setupPlan(rows: PlanRow[], candidates: CategoryCandidate[] = []): void {
  const groupPlan: OrganizePlan = {
    id: 'g1', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
    candidates, operations: [],
    rows,
    unchanged: [],
    summary: {
      totalBookmarks: rows.length, movedBookmarks: rows.length, unchangedBookmarks: 0,
      createdFolders: 0, renamedFolders: 0, renamedBookmarks: 0, lowConfidenceItems: 0,
    },
    warnings: [],
    tags: [],
    mergeRoot: null,
  }
  useStore.setState({ plan: groupPlan, accepted: new Set(rows.map((r) => r.bookmarkId)), busy: null, error: null })
}

describe('ReviewStep 的分组', () => {
  it('按目标目录分组，组标题是目标路径', () => {
    setupPlan([
      row('a', ['01 前端'], 'llm'), row('b', ['01 前端'], 'llm'), row('c', ['02 后端'], 'llm'),
    ])
    render(<ReviewStep />)
    expect(screen.getByText('01 前端')).toBeTruthy()
    expect(screen.getByText('02 后端')).toBeTruthy()
  })

  it('整组都是规则命中时给组级标记，并默认折叠', () => {
    setupPlan([row('a', ['01 GitHub'], 'rule'), row('b', ['01 GitHub'], 'rule')])
    render(<ReviewStep />)
    expect(screen.getByText(/全部来自域名规则/)).toBeTruthy()
    // 折叠：成员的标题不在文档里
    expect(screen.queryByText('书签 a')).toBeNull()
  })

  it('展开之后成员就看得见', async () => {
    setupPlan([row('a', ['01 GitHub'], 'rule'), row('b', ['01 GitHub'], 'rule')])
    render(<ReviewStep />)
    await userEvent.click(screen.getByText(/全部来自域名规则/))
    expect(screen.getByText('书签 a')).toBeTruthy()
  })

  it('混着模型判断的组不折叠——那组里正是要审的东西', () => {
    setupPlan([row('a', ['01 GitHub'], 'rule'), row('b', ['01 GitHub'], 'llm')])
    render(<ReviewStep />)
    expect(screen.getByText('书签 a')).toBeTruthy()
    expect(screen.queryByText(/全部来自域名规则/)).toBeNull()
  })
})

describe('ReviewStep 的改投与标记', () => {
  it('每行给一个改投目录的下拉，选了就改方案并自动勾上', async () => {
    setupPlan([row('a', ['01 前端'], 'llm')], [{ id: 'tmp:1', path: ['01 前端'] }, { id: 'tmp:2', path: ['02 后端'] }])
    render(<ReviewStep />)
    await userEvent.selectOptions(screen.getByLabelText('改投目录：书签 a'), 'tmp:2')

    expect(useStore.getState().plan!.rows[0]!.toPath).toEqual(['02 后端'])
    expect(useStore.getState().accepted.has('a')).toBe(true)
  })

  it('置信度低于阈值只是标一下，不影响勾选', () => {
    setupPlan([row('a', ['01 前端'], 'llm', 0.5)])
    render(<ReviewStep />)
    expect(screen.getByText(/值得看一眼/)).toBeTruthy()
    // 默认全选，标记不改变这一点
    expect(useStore.getState().accepted.has('a')).toBe(true)
  })
})
