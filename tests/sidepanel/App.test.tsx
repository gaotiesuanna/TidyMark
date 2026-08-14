import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import App from '@/sidepanel/App'
import { useStore } from '@/sidepanel/store'
import { setLocale } from '@/i18n'
import { DEFAULT_SETTINGS } from '@/storage/settings'
import { send } from '@/sidepanel/lib/send'
import type { Request, Response } from '@/background/messages'
import type { BookmarkNode } from '@/core/ports'

vi.mock('@/sidepanel/lib/send', () => ({ send: vi.fn() }))

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'react', children: [
        { id: '100', title: 'hooks', children: [] },
      ]},
      { id: '11', title: '杂项', children: [] },
    ]},
  ]},
]

/** init() 会连着发三条请求，全部按中文界面兜住，语言只由用例自己改。 */
function stubSend(): void {
  vi.mocked(send).mockImplementation(async (request: Request): Promise<Response> => {
    if (request.kind === 'get_tree') return { ok: true, kind: 'get_tree', tree }
    if (request.kind === 'get_settings') {
      return { ok: true, kind: 'get_settings', settings: { ...DEFAULT_SETTINGS, uiLocale: 'zh_CN' } }
    }
    if (request.kind === 'get_undo_state') {
      return { ok: true, kind: 'get_undo_state', available: false, createdAt: null }
    }
    return { ok: true, kind: 'save_settings' }
  })
}

describe('切语言后界面立刻跟着变', () => {
  afterEach(() => setLocale('zh_CN'))

  it('在设置页选英文后，标题当场从「设置」变成 Settings', async () => {
    stubSend()
    setLocale('zh_CN')
    useStore.setState({ settingsOpen: true, locale: 'zh_CN' })

    render(<App />)
    await screen.findByRole('heading', { name: '设置' })

    fireEvent.change(screen.getByLabelText('语言'), { target: { value: 'en' } })

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: '设置' })).toBeNull()
  })

  /**
   * 上面那条只证明了 t() 的取词跟着变，证明不了 key={locale}：
   * 组件订阅的是整个 store，setSettings 本身就会让它们重渲染一次，
   * 把 key 删掉那条用例照样绿。
   *
   * 真正只有重挂载才做得到的是「组件内部状态被丢弃」——App 里那段注释把它
   * 记成了代价，可它同时也是这条机制唯一的可观察证据：范围页的展开状态存在
   * ScopeStep 自己的 useState 里，不重挂载就不会回到默认。删掉 key={locale}
   * 这条用例必红。
   */
  it('切语言会重挂载整棵树：范围页手动展开的层级回到默认', async () => {
    stubSend()
    setLocale('zh_CN')
    useStore.setState({
      settingsOpen: false, step: 'scope', locale: 'zh_CN',
      settings: { ...DEFAULT_SETTINGS, uiLocale: 'zh_CN' },
      tree, checkedIds: new Set(), busy: null, error: null,
      importFile: null, importError: null, importDone: null,
    })

    render(<App />)
    await screen.findByText('全部展开')

    fireEvent.click(screen.getByText('全部展开'))
    expect(screen.getByLabelText('hooks')).toBeDefined()

    await act(async () => {
      await useStore.getState().setSettings({ ...DEFAULT_SETTINGS, uiLocale: 'en' })
    })

    expect(screen.getByText('Expand all')).toBeDefined()
    // 默认只展开「书签栏」这一层，二级目录 hooks 只有手动展开过才看得见
    expect(screen.queryByLabelText('hooks')).toBeNull()
  })
})
