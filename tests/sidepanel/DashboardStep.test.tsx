import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { DashboardStep } from '@/sidepanel/steps/DashboardStep'
import { useStore } from '@/sidepanel/store'
import type { BookmarkNode } from '@/core/ports'
import { DEFAULT_SETTINGS } from '@/storage/settings'

const chromeGlobal = globalThis as unknown as { chrome: Record<string, unknown> }
const originalPermissions = chromeGlobal.chrome.permissions
const originalRuntime = chromeGlobal.chrome.runtime
const originalHistory = chromeGlobal.chrome.history

const contains = vi.fn(() => Promise.resolve(false))
const request = vi.fn(() => Promise.resolve(false))
const search = vi.fn((_query?: { startTime?: number }) =>
  Promise.resolve([] as Array<{ url?: string; title?: string; visitCount?: number }>))
const getVisits = vi.fn((_query: { url: string }) =>
  Promise.resolve([] as Array<{ visitTime?: number }>))

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: 'bar', children: [
      { id: '10', title: 'a', url: 'https://github.com/a' },
      { id: '11', title: 'b', url: 'https://github.com/b' },
      { id: '12', title: 'c', url: 'https://github.com/c' },
      { id: '13', title: 'd', url: 'https://bilibili.com/1' },
      { id: '14', title: 'e', url: 'javascript:alert(1)' },
    ]},
  ]},
]

beforeEach(() => {
  contains.mockReset()
  request.mockReset()
  search.mockReset()
  getVisits.mockReset()
  getVisits.mockResolvedValue([])
  contains.mockResolvedValue(false)
  request.mockResolvedValue(false)
  search.mockResolvedValue([])
  chromeGlobal.chrome.runtime = {
    getURL: (path: string) => `chrome-extension://fakeid${path}`,
  }
  chromeGlobal.chrome.permissions = { contains, request }
  chromeGlobal.chrome.history = { search, getVisits }
  useStore.setState({
    tree,
    busy: null,
    settings: { ...DEFAULT_SETTINGS },
    setSettings: async (settings) => { useStore.setState({ settings }) },
  })
})

afterEach(() => {
  chromeGlobal.chrome.permissions = originalPermissions
  chromeGlobal.chrome.runtime = originalRuntime
  chromeGlobal.chrome.history = originalHistory
})

describe('DashboardStep', () => {
  it('按书签数量列出 Top 域名，丢掉非 http 链接', () => {
    render(<DashboardStep />)
    expect(screen.getByText('github.com')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('bilibili.com')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.queryByText('javascript:alert(1)')).toBeNull()
  })

  it('没有可统计的书签时给出空状态，而不是一张空表', () => {
    useStore.setState({ tree: [] })
    render(<DashboardStep />)
    expect(screen.getByText(t('dashEmptyBookmarks'))).toBeTruthy()
  })

  it('切到访问次数时先解释再申请权限，绝不自行弹窗', async () => {
    const user = userEvent.setup()
    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText(t('dashHistoryExplain'))).toBeTruthy()
    expect(request).not.toHaveBeenCalled()
  })

  it('授权之后按 visitCount 排行', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(false)
    request.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'https://github.com/x', visitCount: 20 },
      { url: 'https://bilibili.com/1', visitCount: 4 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    await user.click(await screen.findByRole('button', { name: t('dashHistoryAllow') }))

    expect(await screen.findByText('github.com')).toBeTruthy()
    expect(screen.getByText('20')).toBeTruthy()
    expect(screen.getByText('bilibili.com')).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
  })

  it('改数量后列表按新上限截断，并写进设置', async () => {
    const many: BookmarkNode[] = [{
      id: '0',
      title: '',
      children: Array.from({ length: 18 }, (_, i) => ({
        id: String(i + 1),
        title: `d${i}`,
        url: `https://d${String(i).padStart(2, '0')}.com/`,
      })),
    }]
    useStore.setState({
      tree: many,
      settings: { ...DEFAULT_SETTINGS, topDomainCount: 5 },
    })
    const user = userEvent.setup()
    render(<DashboardStep />)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)

    const input = screen.getByLabelText(t('dashTopCountLabel'))
    await user.clear(input)
    await user.type(input, '8')
    await user.tab()

    expect(useStore.getState().settings.topDomainCount).toBe(8)
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
  })

  it('输入 8.6 四舍五入写成 9', async () => {
    const user = userEvent.setup()
    render(<DashboardStep />)
    const input = screen.getByLabelText(t('dashTopCountLabel'))
    await user.clear(input)
    await user.type(input, '8.6')
    await user.tab()
    expect(useStore.getState().settings.topDomainCount).toBe(9)
  })

  it('书签栏域名行带有展开箭头', () => {
    render(<DashboardStep />)
    const btn = screen.getByRole('button', { name: t('dashDomainExpand', 'github.com') })
    expect(btn.querySelector('svg')).not.toBeNull()
  })

  it('点书签栏域名展开对应路径和条数', async () => {
    const user = userEvent.setup()
    render(<DashboardStep />)
    expect(screen.queryByText('bar')).toBeNull()

    await user.click(screen.getByRole('button', { name: t('dashDomainExpand', 'github.com') }))
    expect(screen.getByText('bar')).toBeTruthy()
    expect(screen.getByRole('button', { name: t('dashDomainCollapse', 'github.com') })).toBeTruthy()
  })

  it('展开域名后按文件夹展示其中的书签标题和地址', async () => {
    const user = userEvent.setup()
    useStore.setState({
      tree: [{ id: '0', title: '', children: [
        { id: 'bar', title: 'Bookmarks Bar', children: [
          { id: 'dev', title: 'Dev tools', children: [
            { id: 'repo', title: 'The AI coding agent', url: 'https://github.com/sst/opencode' },
          ]},
        ]},
      ]}],
    })

    render(<DashboardStep />)
    await user.click(screen.getByRole('button', { name: t('dashDomainExpand', 'github.com') }))

    expect(screen.getByText('Bookmarks Bar / Dev tools')).toBeTruthy()
    expect(screen.getByText('The AI coding agent')).toBeTruthy()
    expect(screen.getByText('github.com/sst/opencode')).toBeTruthy()
  })

  it('再点同一行收起分布', async () => {
    const user = userEvent.setup()
    render(<DashboardStep />)
    await user.click(screen.getByRole('button', { name: t('dashDomainExpand', 'github.com') }))
    expect(screen.getByText('bar')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: t('dashDomainCollapse', 'github.com') }))
    expect(screen.queryByText('bar')).toBeNull()
  })

  it('点另一域名时前一行收起', async () => {
    const user = userEvent.setup()
    render(<DashboardStep />)
    await user.click(screen.getByRole('button', { name: t('dashDomainExpand', 'github.com') }))
    await user.click(screen.getByRole('button', { name: t('dashDomainExpand', 'bilibili.com') }))

    expect(screen.getByRole('button', { name: t('dashDomainExpand', 'github.com') })).toBeTruthy()
    expect(screen.getByRole('button', { name: t('dashDomainCollapse', 'bilibili.com') })).toBeTruthy()
  })

  it('访问栏的域名可展开查看页面标题、地址和访问次数', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(false)
    request.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'https://github.com/sst/opencode', title: 'The AI coding agent', visitCount: 20 },
      { url: 'https://github.com/openai/codex', title: 'Codex', visitCount: 8 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    await user.click(await screen.findByRole('button', { name: t('dashHistoryAllow') }))
    expect(await screen.findByText('github.com')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /github\.com/ }))
    expect(screen.getByText('The AI coding agent')).toBeTruthy()
    expect(screen.getByText('github.com/sst/opencode')).toBeTruthy()
    expect(screen.getByText(t('dashVisitCount', '20'))).toBeTruthy()
    expect(screen.getByText('Codex')).toBeTruthy()
    expect(screen.getByText('github.com/openai/codex')).toBeTruthy()
    expect(screen.getByText(t('dashVisitCount', '8'))).toBeTruthy()
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      'https://github.com/sst/opencode',
      'https://github.com/openai/codex',
    ])
  })

  it('访问栏按 URL 路径展开文件夹', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(false)
    request.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'https://localhost/analysis/library', title: 'Lib', visitCount: 10 },
      { url: 'https://localhost/analysis/library/5', title: 'Lib5', visitCount: 5 },
      { url: 'https://localhost/home', title: 'Home', visitCount: 8 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    await user.click(await screen.findByRole('button', { name: t('dashHistoryAllow') }))
    expect(await screen.findByText('localhost')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /localhost/ }))
    expect(screen.getByText('analysis / library')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /analysis \/ library/ }))
    expect(screen.getByText('Lib')).toBeTruthy()
    // /home 底下没有别的分支，只出页面行，不摆一行叫 home 的目录
    expect(screen.getByText('Home')).toBeTruthy()
    expect(screen.getByText('localhost/home')).toBeTruthy()
    expect(screen.queryByText('home')).toBeNull()
  })

  it('文件夹树深层默认折叠，点父节点才继续展开', async () => {
    const nested: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'bar', title: 'Bar', children: [
          { id: 'a', title: 'A', children: [
            { id: 'a1', title: 'A1', children: [
              { id: 'a1x', title: 'A1X', children: [
                { id: 'p1', title: 'p1', url: 'https://github.com/1' },
              ]},
              { id: 'a1y', title: 'A1Y', children: [
                { id: 'p2', title: 'p2', url: 'https://github.com/2' },
              ]},
            ]},
            { id: 'a2', title: 'A2', children: [
              { id: 'p3', title: 'p3', url: 'https://github.com/3' },
            ]},
          ]},
          { id: 'z', title: 'Z', children: [
            { id: 'p4', title: 'p4', url: 'https://github.com/4' },
          ]},
        ]},
      ]},
    ]
    useStore.setState({ tree: nested })
    const user = userEvent.setup()
    render(<DashboardStep />)
    await user.click(screen.getByRole('button', { name: t('dashDomainExpand', 'github.com') }))

    // 展开来源只露出最外一层，往下每一层都要自己点
    expect(screen.getByText('Bar')).toBeTruthy()
    expect(screen.queryByText('A')).toBeNull()

    await user.click(screen.getByRole('button', { name: /Bar/ }))
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.queryByText('A1')).toBeNull()

    await user.click(screen.getByRole('button', { name: /^A(?!1)/ }))
    expect(screen.getByText('A1')).toBeTruthy()
    expect(screen.queryByText('A1X')).toBeNull()

    await user.click(screen.getByRole('button', { name: /A1/ }))
    expect(screen.getByText('A1X')).toBeTruthy()
    expect(screen.getByText('A1Y')).toBeTruthy()
  })

  it('访问栏把已收藏的页面单列一段并标出文件夹路径', async () => {
    const user = userEvent.setup()
    useStore.setState({
      tree: [{ id: '0', title: '', children: [
        { id: 'bar', title: 'Bookmarks Bar', children: [
          { id: 'dev', title: 'Dev tools', children: [
            { id: 'repo', title: 'The AI coding agent', url: 'https://github.com/sst/opencode' },
          ]},
        ]},
      ]}],
    })
    contains.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'https://github.com/sst/opencode', title: 'opencode', visitCount: 20 },
      { url: 'https://github.com/openai/codex', title: 'Codex', visitCount: 8 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText('github.com')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /github\.com/ }))

    const saved = screen.getByRole('region', { name: t('dashVisitSavedLabel', 'github.com') })
    expect(saved.textContent).toContain('The AI coding agent')
    expect(saved.textContent).toContain('Bookmarks Bar / Dev tools')
    expect(saved.textContent).toContain(t('dashVisitCount', '20'))
    expect(saved.textContent).not.toContain('Codex')

    const unsaved = screen.getByRole('region', { name: t('dashVisitUnsavedLabel', 'github.com') })
    expect(unsaved.textContent).toContain('Codex')
    expect(unsaved.textContent).toContain(t('dashVisitCount', '8'))
    expect(unsaved.textContent).not.toContain('opencode')
  })

  it('访问栏一条都没收藏时仍摆出两段，已收藏那段给空状态', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'https://localhost/home', title: 'Home', visitCount: 8 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText('localhost')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /localhost/ }))

    const saved = screen.getByRole('region', { name: t('dashVisitSavedLabel', 'localhost') })
    expect(saved.textContent).toContain(t('dashVisitNoneSaved'))

    const unsaved = screen.getByRole('region', { name: t('dashVisitUnsavedLabel', 'localhost') })
    expect(unsaved.textContent).toContain('Home')
  })

  it('访问栏全都收藏了时未收藏那段给空状态', async () => {
    const user = userEvent.setup()
    useStore.setState({
      tree: [{ id: '0', title: '', children: [
        { id: 'bar', title: 'Bookmarks Bar', children: [
          { id: 'h', title: '首页', url: 'https://localhost/home' },
        ]},
      ]}],
    })
    contains.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'https://localhost/home', title: 'Home', visitCount: 8 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText('localhost')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /localhost/ }))

    const unsaved = screen.getByRole('region', { name: t('dashVisitUnsavedLabel', 'localhost') })
    expect(unsaved.textContent).toContain(t('dashVisitNoneUnsaved'))
  })

  it('点未收藏那行的标题把整棵路径树收起来，再点展开', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'https://localhost/analysis/library', title: 'Lib', visitCount: 502 },
      { url: 'https://localhost/home', title: 'Home', visitCount: 8 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText('localhost')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /localhost/ }))
    expect(screen.getByText('Lib')).toBeTruthy()

    const toggle = screen.getByRole('button', { name: new RegExp(t('dashVisitUnsaved')) })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Lib')).toBeNull()
    expect(screen.queryByText('Home')).toBeNull()
    // 标题本身还在，数字也还在，收起来的只是树
    expect(screen.getByText(t('dashVisitUnsaved'))).toBeTruthy()
    expect(screen.getByText(t('dashVisitCount', '510'))).toBeTruthy()

    await user.click(toggle)
    expect(screen.getByText('Lib')).toBeTruthy()
  })

  it('已收藏那段也能单独收起', async () => {
    const user = userEvent.setup()
    useStore.setState({
      tree: [{ id: '0', title: '', children: [
        { id: 'bar', title: 'Bookmarks Bar', children: [
          { id: 'h', title: '首页', url: 'https://localhost/home' },
        ]},
      ]}],
    })
    contains.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'https://localhost/home', title: 'Home', visitCount: 8 },
      { url: 'https://localhost/other', title: 'Other', visitCount: 3 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText('localhost')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /localhost/ }))
    expect(screen.getByText('首页')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: new RegExp(t('dashVisitSaved')) }))
    expect(screen.queryByText('首页')).toBeNull()
    // 未收藏那段不受影响
    expect(screen.getByText('Other')).toBeTruthy()
  })

  it('同形 ID 段并成一行，默认收起，点开才露出每个页面', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'https://192.168.5.39/tasks/019fb349-e6f2-7407-a254-1919171a8d4a', title: '任务甲', visitCount: 9 },
      { url: 'https://192.168.5.39/tasks/c69350df521240909ec967c712200cfa', title: '任务乙', visitCount: 8 },
      { url: 'https://192.168.5.39/tasks/bd8c838b055c45dc984b0f28bef6684b', title: '任务丙', visitCount: 7 },
      { url: 'https://192.168.5.39/documents', title: '文档', visitCount: 190 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText('192.168.5.39')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /192\.168\.5\.39/ }))

    // 三个 ID 一行都不占；tasks 自己没有页面，直接顶替合并行成了那一行
    expect(screen.queryByText(/019fb349/)).toBeNull()
    expect(screen.getByText(/documents/)).toBeTruthy()
    expect(screen.getByText(t('dashVisitGroupPages', '3'))).toBeTruthy()

    const group = screen.getByRole('button', { name: /tasks/ })
    expect(group.getAttribute('aria-expanded')).toBe('false')

    await user.click(group)
    expect(group.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/019fb349/)).toBeTruthy()
    expect(screen.getByText(/c69350df/)).toBeTruthy()
    expect(screen.getByText(/bd8c838b/)).toBeTruthy()
  })

  it('合并行标题取这批页面共有的那个，各不相同时用占位名', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'https://192.168.5.39/tasks/019fb349-e6f2-7407-a254-1919171a8d4a', title: '任务甲', visitCount: 9 },
      { url: 'https://192.168.5.39/tasks/c69350df521240909ec967c712200cfa', title: '任务乙', visitCount: 8 },
      { url: 'https://192.168.5.39/tasks/bd8c838b055c45dc984b0f28bef6684b', title: '任务丙', visitCount: 7 },
      // 给 tasks 添个兄弟，合并行才不会被父段顶替，才看得到「连名字都报不出」这一步
      { url: 'https://192.168.5.39/tasks/new', title: '新建', visitCount: 5 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText('192.168.5.39')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /192\.168\.5\.39/ }))
    await user.click(screen.getByRole('button', { name: /tasks/ }))

    expect(screen.getByText(t('dashVisitGroupUnnamed'))).toBeTruthy()
  })

  it('同一台机器上的两个端口排成两行，行内地址带上端口', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'http://localhost:5173/settings', title: '设置', visitCount: 151 },
      { url: 'http://localhost:5173/settings/tasks', title: '任务', visitCount: 210 },
      { url: 'http://localhost:8501/settings/license', title: '授权管理 – TradingAgents-CN', visitCount: 4 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText('localhost:5173')).toBeTruthy()
    expect(screen.getByText('localhost:8501')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /localhost:5173/ }))
    await user.click(screen.getByRole('button', { name: /settings/ }))
    expect(screen.getByText('localhost:5173/settings')).toBeTruthy()
    // 另一个端口的页面不该混进这棵树
    expect(screen.queryByText(/license/)).toBeNull()
  })

  it('域名行报站点名，地址退到下面一行', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'http://localhost:5629/home', title: '墨析 · 小说拆解工作台', visitCount: 242 },
      { url: 'http://localhost:5629/settings', title: '墨析 · 小说拆解工作台', visitCount: 121 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText('墨析 · 小说拆解工作台')).toBeTruthy()
    expect(screen.getByText('localhost:5629')).toBeTruthy()
  })

  it('取不到站点名的照旧只显示域名', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'https://github.com/a', title: 'sst/opencode', visitCount: 20 },
      { url: 'https://github.com/b', title: 'openai/codex', visitCount: 8 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText('github.com')).toBeTruthy()
  })

  it('展开来源只展一层，下一层要自己点', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'http://localhost:5629/analysis/library', title: '书库', visitCount: 502 },
      { url: 'http://localhost:5629/analysis/upload', title: '上传', visitCount: 62 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText('localhost:5629')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /localhost:5629/ }))

    const analysis = screen.getByRole('button', { name: /analysis/ })
    expect(analysis.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(/analysis\/library/)).toBeNull()

    await user.click(analysis)
    expect(screen.getByText('localhost:5629/analysis/library')).toBeTruthy()
  })

  it('同标题的页面收成一夹，默认收起，点开是一串地址', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'http://localhost:5629/analysis/library', title: '墨析 · 小说拆解工作台', visitCount: 502 },
      { url: 'http://localhost:5629/settings/tasks', title: '墨析 · 小说拆解工作台', visitCount: 210 },
      { url: 'http://localhost:5629/home', title: '墨析 · 小说拆解工作台', visitCount: 242 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText('墨析 · 小说拆解工作台')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /localhost:5629/ }))

    // analysis / settings 这些路径层一个都不出现
    expect(screen.queryByText('analysis')).toBeNull()
    expect(screen.queryByText('settings')).toBeNull()

    const folder = screen.getByRole('button', { name: new RegExp(t('dashVisitGroupPages', '3')) })
    expect(folder.getAttribute('aria-expanded')).toBe('false')

    await user.click(folder)
    expect(screen.getByText('localhost:5629/analysis/library')).toBeTruthy()
    expect(screen.getByText('localhost:5629/settings/tasks')).toBeTruthy()
    expect(screen.getByText('localhost:5629/home')).toBeTruthy()
  })

  it('夹里不把同一个标题再抄一遍，页面行只留地址', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'http://localhost:5629/home', title: '墨析 · 小说拆解工作台', visitCount: 242 },
      { url: 'http://localhost:5629/settings', title: '墨析 · 小说拆解工作台', visitCount: 121 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    await user.click(await screen.findByRole('button', { name: /localhost:5629/ }))
    await user.click(screen.getByRole('button', { name: new RegExp(t('dashVisitGroupPages', '2')) }))

    // 域名行一次、夹名一次，页面行不再各来一遍
    expect(screen.getAllByText('墨析 · 小说拆解工作台')).toHaveLength(2)
  })

  it('时间窗只在「访问」那一格出现', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(true)
    render(<DashboardStep />)
    expect(screen.queryByRole('tablist', { name: t('dashWindowLabel') })).toBeNull()

    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(screen.getByRole('tablist', { name: t('dashWindowLabel') })).toBeTruthy()
    expect(screen.getByRole('tab', { name: t('dashWindowAll') }).getAttribute('aria-selected'))
      .toBe('true')
  })

  it('还没授权浏览记录时不摆时间窗——点了也没数可查', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(false)
    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))

    expect(await screen.findByRole('button', { name: t('dashHistoryAllow') })).toBeTruthy()
    expect(screen.queryByRole('tablist', { name: t('dashWindowLabel') })).toBeNull()
  })

  it('选了近三个月就按窗内次数重排，切回去用缓存不再查一遍', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(true)
    // 旧账：github 历史总数 500，但近三个月只碰过一次；kimi 反过来
    search.mockResolvedValue([
      { url: 'https://github.com/a', title: 'A', visitCount: 500 },
      { url: 'https://kimi.com/b', title: 'B', visitCount: 30 },
    ])
    getVisits.mockImplementation((query) =>
      Promise.resolve(query.url.includes('github')
        ? [{ visitTime: Date.now() - 86400000 }]
        : Array.from({ length: 25 }, () => ({ visitTime: Date.now() - 86400000 }))),
    )

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText('github.com')).toBeTruthy()

    await user.click(screen.getByRole('tab', { name: t('dashWindow3m') }))
    // 近三个月里 kimi 才是常客
    expect(await screen.findByText('25')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.queryByText('500')).toBeNull()

    const calls = search.mock.calls.length
    await user.click(screen.getByRole('tab', { name: t('dashWindowAll') }))
    expect(await screen.findByText('500')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: t('dashWindow3m') }))
    expect(await screen.findByText('25')).toBeTruthy()
    expect(search.mock.calls.length).toBe(calls)
  })

  it('空的那段没有收起按钮', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'https://localhost/home', title: 'Home', visitCount: 8 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText('localhost')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /localhost/ }))

    expect(screen.getByText(t('dashVisitNoneSaved'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: new RegExp(t('dashVisitSaved')) })).toBeNull()
    expect(screen.getByRole('button', { name: new RegExp(t('dashVisitUnsaved')) })).toBeTruthy()
  })

  it('访问栏不给只裹着一个页面的路径段单独摆一行目录', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(true)
    search.mockResolvedValue([
      { url: 'https://192.168.5.39/task', title: '任务', visitCount: 741 },
      { url: 'https://192.168.5.39/', title: '首页', visitCount: 343 },
      { url: 'https://192.168.5.39/mailbox', title: '信箱', visitCount: 1 },
      { url: 'https://192.168.5.39/mailbox/inbox', title: '收件', visitCount: 124 },
    ])

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByText('192.168.5.39')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /192\.168\.5\.39/ }))

    // 页面本身还在
    expect(screen.getByText('192.168.5.39/task')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /mailbox/ }))
    expect(screen.getByText('192.168.5.39/mailbox/inbox')).toBeTruthy()
    // 但 task、inbox 不再各自占一行目录
    expect(screen.queryByText('task')).toBeNull()
    expect(screen.queryByText('inbox')).toBeNull()
    // mailbox 底下有别的分支，还是个目录
    expect(screen.getByText('mailbox')).toBeTruthy()
  })

  it('书签栏的单书签文件夹照样成行——那是真的目录名，不能吞', async () => {
    const user = userEvent.setup()
    useStore.setState({
      tree: [{ id: '0', title: '', children: [
        { id: 'bar', title: 'Bookmarks Bar', children: [
          { id: 'dev', title: 'Dev tools', children: [
            { id: 'repo', title: 'opencode', url: 'https://github.com/sst/opencode' },
          ]},
        ]},
      ]}],
    })

    render(<DashboardStep />)
    await user.click(screen.getByRole('button', { name: t('dashDomainExpand', 'github.com') }))

    expect(screen.getByText('Bookmarks Bar / Dev tools')).toBeTruthy()
  })

  it('读取浏览记录时给骨架屏而不是空白', async () => {
    const user = userEvent.setup()
    contains.mockResolvedValue(true)
    let release: (items: Array<{ url?: string; visitCount?: number }>) => void = () => {}
    search.mockReturnValue(new Promise((resolve) => { release = resolve }))

    render(<DashboardStep />)
    await user.click(screen.getByRole('tab', { name: t('dashVisited') }))
    expect(await screen.findByRole('status', { name: t('dashHistoryLoading') })).toBeTruthy()

    release([{ url: 'https://github.com/x', visitCount: 3 }])
    expect(await screen.findByText('github.com')).toBeTruthy()
    expect(screen.queryByRole('status', { name: t('dashHistoryLoading') })).toBeNull()
  })

})
