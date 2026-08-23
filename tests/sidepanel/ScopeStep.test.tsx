import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScopeStep } from '@/sidepanel/steps/ScopeStep'
import { useStore } from '@/sidepanel/store'
import { DEFAULT_SETTINGS } from '@/storage/settings'
import type { BookmarkNode } from '@/core/ports'

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'react', children: [
        { id: '100', title: 'hooks', children: [
          { id: '1000', title: '更深一层', children: [] },
        ]},
      ]},
      { id: '11', title: '工作常用', children: [] },
    ]},
  ]},
]

beforeEach(() => {
  useStore.setState({
    tree, checkedIds: new Set(), busy: null, error: null,
    importFile: null, importError: null, importDone: null,
  })
})

describe('ScopeStep 目录展开', () => {
  it('默认只展示到一级目录', () => {
    render(<ScopeStep />)
    expect(screen.getByText('书签栏')).toBeDefined()
    expect(screen.getByText('react')).toBeDefined()
    expect(screen.queryByText('hooks')).toBeNull()
  })

  it('点击某个目录的展开按钮只展开它自己', async () => {
    render(<ScopeStep />)
    await userEvent.click(screen.getByRole('button', { name: '展开 react' }))
    expect(screen.getByText('hooks')).toBeDefined()
    expect(screen.queryByText('更深一层')).toBeNull()
  })

  it('再点一次收起', async () => {
    render(<ScopeStep />)
    await userEvent.click(screen.getByRole('button', { name: '展开 react' }))
    await userEvent.click(screen.getByRole('button', { name: '收起 react' }))
    expect(screen.queryByText('hooks')).toBeNull()
  })

  it('全部展开后所有层级都可见', async () => {
    render(<ScopeStep />)
    await userEvent.click(screen.getByText('全部展开'))
    expect(screen.getByText('hooks')).toBeDefined()
    expect(screen.getByText('更深一层')).toBeDefined()
  })

  it('全部收起后只剩根目录', async () => {
    render(<ScopeStep />)
    await userEvent.click(screen.getByText('全部收起'))
    expect(screen.getByText('书签栏')).toBeDefined()
    expect(screen.queryByText('react')).toBeNull()
  })

  it('折叠状态不影响勾选，勾选仍连带子目录', async () => {
    render(<ScopeStep />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'react' }))
    expect([...useStore.getState().checkedIds].sort()).toEqual(['10', '100', '1000'])
  })
})

describe('ScopeStep 导出入口', () => {
  it('选范围页上挂着导出面板', () => {
    render(<ScopeStep />)
    expect(screen.getByRole('button', { name: '带文件夹结构' })).toBeDefined()
    expect(screen.getByRole('button', { name: '纯链接清单' })).toBeDefined()
  })
})

describe('ScopeStep 导入入口', () => {
  it('选范围页上挂着导入面板', () => {
    render(<ScopeStep />)
    expect(screen.getByText('选择文件…')).toBeDefined()
  })
})

/**
 * 没配模型时的提前告知。模型配置搬进设置页之后，新用户在这一页没有任何线索，
 * 而扫描根本不需要 Key——他会一路顺畅走到偏好页才撞墙，那时已经投入了。
 */
describe('ScopeStep 还没配模型时的提示', () => {
  /**
   * 默认 baseUrl 是远程厂商（api.openai.com），那条路上「配好了没有」只由 apiKey 决定。
   * baseUrl 指向本机时是另一回事，单独一条用例守着。
   */
  function setKey(apiKey: string, openSettings = vi.fn()): ReturnType<typeof vi.fn> {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm, apiKey } },
      openSettings,
    })
    return openSettings
  }

  it('apiKey 为空时顶部给出提示，点那个按钮就去设置页', async () => {
    const openSettings = setKey('')
    render(<ScopeStep />)

    expect(screen.getByText(/挑一个预设/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '去配置模型' }))
    expect(openSettings).toHaveBeenCalledTimes(1)
  })

  it('apiKey 非空时没有这条提示', () => {
    setKey('sk-already-configured')
    render(<ScopeStep />)

    // 空断言防身：先证明这一页真渲染出来了，而且下面两种查询在这一页上确实命中得了东西，
    // 否则「查不到」可能只是查错了地方
    expect(screen.getByText(/勾选你想让 TidyMark 重构的文件夹/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '全部展开' })).toBeTruthy()

    expect(screen.queryByText(/挑一个预设/)).toBeNull()
    expect(screen.queryByRole('button', { name: '去配置模型' })).toBeNull()
  })

  it('本机 Ollama 配好之后这条提示就消失了——它压根不要 API Key', () => {
    useStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        // 设置页点一下「本地 Ollama」预设写进来的就是这两个字段，apiKey 一个字都没动
        llm: { ...DEFAULT_SETTINGS.llm, baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' },
      },
      openSettings: vi.fn(),
    })
    render(<ScopeStep />)
    // 空断言防身：先证明这一页真渲染了、这两种查询在这一页上确实命中得了东西
    expect(screen.getByText(/勾选你想让 TidyMark 重构的文件夹/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '全部展开' })).toBeTruthy()
    // 前提：apiKey 确实还是空的——真填了 Key 的话这条用例守的就不是本机那条路了
    expect(useStore.getState().settings.llm.apiKey).toBe('')

    expect(screen.queryByText(/挑一个预设/)).toBeNull()
    expect(screen.queryByRole('button', { name: '去配置模型' })).toBeNull()
  })

  it('提示在场也不挡路：目录树照常勾得动，扫描照常开得了，导出导入也照常在', async () => {
    setKey('')
    render(<ScopeStep />)
    // 前提：这条用例要验的是「提示在场时」，提示不在场就什么也没证明
    expect(screen.getByRole('button', { name: '去配置模型' })).toBeTruthy()

    await userEvent.click(screen.getByRole('checkbox', { name: 'react' }))
    expect([...useStore.getState().checkedIds].sort()).toEqual(['10', '100', '1000'])

    const scan = screen.getByRole('button', { name: /扫描选中的/ }) as HTMLButtonElement
    expect(scan.disabled).toBe(false)

    // 导出与导入这两条支线跟模型无关，提示在场时同样得在。上面「导出入口」「导入入口」
    // 两个 describe 不设 settings，靠 store 初值恰好让提示在场，那是用例顺序说了算的；
    // 这里显式钉死了 apiKey，「不挡路」的三件事在同一条用例里一起守住
    expect(screen.getByRole('button', { name: '带文件夹结构' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '纯链接清单' })).toBeTruthy()
    expect(screen.getByText('选择文件…')).toBeTruthy()
  })
})

/**
 * 扫描按钮此前只报勾中的文件夹数，而下面紧挨着的导出行报的是书签数，两个数字口径不同。
 * 一个「01 GitHub」里有 10 个子目录、另外 123 条链接直接散在它底下时，按钮说
 * 「扫描选中的 11 个文件夹」，看着像是那 123 条散链不在范围里——它们其实一直都在
 * （core/scan.ts 与 core/export.ts 走的是同一个 findScopeRoots + 整棵子树遍历）。
 * 按钮要报的是这次真正要处理的东西：书签数。
 */
describe('ScopeStep 扫描按钮报的数', () => {
  const withLoose: BookmarkNode[] = [
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: 'react', children: [
          { id: '100', title: 'hooks', children: [
            { id: '1000', title: 'a', url: 'https://a.test' },
          ]},
          { id: '101', title: 'router', children: [
            { id: '1010', title: 'b', url: 'https://b.test' },
          ]},
          // 直接散在 react 底下、没进任何子目录的三条
          { id: '1020', title: 'c', url: 'https://c.test' },
          { id: '1021', title: 'd', url: 'https://d.test' },
          { id: '1022', title: 'e', url: 'https://e.test' },
        ]},
      ]},
    ]},
  ]

  it('报书签数，并把文件夹数降为附注——散在目录下的书签也算在内', async () => {
    useStore.setState({ tree: withLoose, checkedIds: new Set(), busy: null, error: null })
    render(<ScopeStep />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'react' }))
    expect(screen.getByRole('button', { name: '扫描选中的 5 条书签（3 个文件夹）' })).toBeTruthy()
  })

  it('单数也说得通', async () => {
    const one: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: 'react', children: [
            { id: '1000', title: 'a', url: 'https://a.test' },
          ]},
        ]},
      ]},
    ]
    useStore.setState({ tree: one, checkedIds: new Set(), busy: null, error: null })
    render(<ScopeStep />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'react' }))
    expect(screen.getByRole('button', { name: '扫描选中的 1 条书签（1 个文件夹）' })).toBeTruthy()
  })
})
