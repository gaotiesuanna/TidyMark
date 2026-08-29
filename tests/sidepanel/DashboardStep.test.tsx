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
const search = vi.fn(() => Promise.resolve([] as Array<{ url?: string; title?: string; visitCount?: number }>))

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
  contains.mockResolvedValue(false)
  request.mockResolvedValue(false)
  search.mockResolvedValue([])
  chromeGlobal.chrome.runtime = {
    getURL: (path: string) => `chrome-extension://fakeid${path}`,
  }
  chromeGlobal.chrome.permissions = { contains, request }
  chromeGlobal.chrome.history = { search }
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
    expect(screen.getByText('home')).toBeTruthy()
    expect(screen.getByText('Lib')).toBeTruthy()
    expect(screen.getByText('Home')).toBeTruthy()
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
