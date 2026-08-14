import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  appendLog, collectDescendantFolderIds, nextStepAfterAnalyze, toggleChecked, useStore,
  MAX_LOGS, MAX_LOG_LENGTH, type LogLine,
} from '@/sidepanel/store'
import { send } from '@/sidepanel/lib/send'
import { currentLocale, setLocale } from '@/i18n'
import { DEFAULT_SETTINGS } from '@/storage/settings'
import { makePlan } from '../fakes/plan'
import type { ProgressEvent } from '@/background/events'
import type { BookmarkNode } from '@/core/ports'

vi.mock('@/sidepanel/lib/send', () => ({ send: vi.fn() }))

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'react', children: [
        { id: '100', title: 'A', url: 'https://a.dev' },
        { id: '101', title: '子文件夹', children: [] },
      ]},
      { id: '11', title: '杂项', children: [] },
    ]},
  ]},
]

describe('collectDescendantFolderIds', () => {
  it('只收集文件夹，不收集书签', () => {
    expect(collectDescendantFolderIds(tree, '1').sort()).toEqual(['10', '101', '11'])
  })
  it('叶子文件夹返回空数组', () => {
    expect(collectDescendantFolderIds(tree, '11')).toEqual([])
  })
})

describe('toggleChecked', () => {
  it('勾选文件夹时级联勾选其所有子文件夹', () => {
    expect([...toggleChecked(new Set(), '1', tree)].sort()).toEqual(['1', '10', '101', '11'])
  })

  it('取消勾选时级联取消其所有子文件夹', () => {
    const checked = toggleChecked(new Set(), '1', tree)
    expect([...toggleChecked(checked, '1', tree)]).toEqual([])
  })

  it('取消子文件夹不影响父文件夹的勾选状态', () => {
    const checked = toggleChecked(new Set(), '1', tree)
    const after = toggleChecked(checked, '10', tree)
    expect(after.has('1')).toBe(true)
    expect(after.has('10')).toBe(false)
    expect(after.has('101')).toBe(false)
  })
})

describe('appendLog', () => {
  const event = (message: string, extra: Partial<ProgressEvent> = {}): ProgressEvent => ({
    phase: 'classify', message, ...extra,
  })

  it('把带 message 的事件追加成一行日志', () => {
    const logs = appendLog([], event('批次 1/2 完成'), 0)
    expect(logs).toEqual([{ id: 0, phase: 'classify', level: 'info', message: '批次 1/2 完成' }])
  })

  it('纯进度事件不写日志', () => {
    expect(appendLog([], event('', { done: 25, total: 100 }), 0)).toEqual([])
  })

  it('保留事件级别', () => {
    expect(appendLog([], event('失败了', { level: 'error' }), 0)[0]!.level).toBe('error')
  })

  it('超过上限时丢弃最旧的几行', () => {
    let logs: LogLine[] = []
    for (let i = 0; i < MAX_LOGS + 5; i++) logs = appendLog(logs, event(`第 ${i} 行`), i)
    expect(logs).toHaveLength(MAX_LOGS)
    expect(logs[0]!.message).toBe('第 5 行')
    expect(logs.at(-1)!.message).toBe(`第 ${MAX_LOGS + 4} 行`)
  })
})

describe('store 的事件累积', () => {
  it('进度事件更新进度条，日志事件追加日志', () => {
    useStore.setState({ logs: [], logSeq: 0, progress: null })
    useStore.getState().pushEvent({ phase: 'tags', message: '', done: 50, total: 100 })
    useStore.getState().pushEvent({ phase: 'tags', message: '标签批次 2/4' })
    expect(useStore.getState().progress).toEqual({ phase: 'tags', done: 50, total: 100 })
    expect(useStore.getState().logs.map((l) => l.message)).toEqual(['标签批次 2/4'])
  })

  it('日志事件不会清掉已有进度', () => {
    useStore.setState({ logs: [], logSeq: 0, progress: { phase: 'tags', done: 50, total: 100 } })
    useStore.getState().pushEvent({ phase: 'tags', message: '某条日志' })
    expect(useStore.getState().progress).toEqual({ phase: 'tags', done: 50, total: 100 })
  })
})

describe('日志长度截断', () => {
  it('过长的接口错误体被截断，界面不会被撑爆', () => {
    const long = 'x'.repeat(MAX_LOG_LENGTH + 50)
    const logs = appendLog([], { phase: 'classify', message: long, level: 'error' }, 0)
    expect(logs[0]!.message).toHaveLength(MAX_LOG_LENGTH + 1) // 含省略号
    expect(logs[0]!.message.endsWith('…')).toBe(true)
  })
})

describe('nextStepAfterAnalyze', () => {
  it('推翻模式先进结构确认页', () => {
    expect(nextStepAfterAnalyze(true)).toBe('structure')
  })

  it('非推翻模式直接进移动清单页', () => {
    expect(nextStepAfterAnalyze(false)).toBe('review')
  })
})

describe('结构确认步骤', () => {
  it('renameNode 与 removeNode 累积到 structureEdits', () => {
    useStore.setState({ plan: makePlan(), structureEdits: { renames: {}, removed: [] } })
    useStore.getState().renameNode('tmp:1', '代码仓库')
    useStore.getState().removeNode('tmp:3')
    expect(useStore.getState().structureEdits).toEqual({
      renames: { 'tmp:1': '代码仓库' }, removed: ['tmp:3'],
    })
  })

  it('confirmStructure 把编辑写进 plan 并进入 review', () => {
    useStore.setState({
      plan: makePlan(),
      structureEdits: { renames: { 'tmp:1': '代码仓库' }, removed: [] },
      step: 'structure',
    })
    useStore.getState().confirmStructure()
    const state = useStore.getState()
    expect(state.step).toBe('review')
    expect(state.plan!.candidates.find((c) => c.id === 'tmp:1')!.path).toEqual(['代码仓库'])
  })

  it('confirmStructure 后按置信度重新预选', () => {
    const plan = makePlan()
    plan.rows[0]!.confidence = 0.3
    useStore.setState({ plan, structureEdits: { renames: {}, removed: [] }, accepted: new Set() })
    useStore.getState().confirmStructure()
    const accepted = useStore.getState().accepted
    expect(accepted.has(plan.rows[0]!.bookmarkId)).toBe(false)
    expect(accepted.has(plan.rows[1]!.bookmarkId)).toBe(true)
  })

  it('backToPreferences 回到偏好页并清空结构编辑', () => {
    useStore.setState({
      step: 'structure',
      structureEdits: { renames: { 'tmp:1': 'x' }, removed: [] },
    })
    useStore.getState().backToPreferences()
    expect(useStore.getState().step).toBe('preferences')
    expect(useStore.getState().structureEdits).toEqual({ renames: {}, removed: [] })
  })
})

describe('readImportFile', () => {
  const good = JSON.stringify({
    format: 'tidymark/v1', kind: 'tree', exportedAt: '',
    roots: [{ name: 'A', children: [{ name: 'a', url: 'https://a.dev' }] }],
  })

  it('解析成功时存下文件名与预览，并清掉旧错误', () => {
    useStore.setState({ tree, importError: '上一次的错误', importFile: null })
    useStore.getState().readImportFile('x.json', good)

    const state = useStore.getState()
    expect(state.importError).toBeNull()
    expect(state.importFile!.name).toBe('x.json')
    expect(state.importFile!.preview.bookmarkCount).toBe(1)
    expect(state.importFile!.preview.folderCount).toBe(1)
  })

  it('解析失败时存下错误，并清掉旧预览', () => {
    useStore.setState({ tree, importError: null })
    useStore.getState().readImportFile('x.json', good)
    useStore.getState().readImportFile('bad.json', '不是 json')

    const state = useStore.getState()
    expect(state.importError).toBe('这个文件不是有效的 JSON。')
    expect(state.importFile).toBeNull()
  })

  it('重复计数用的是 store 里的书签树', () => {
    // 上面的 tree fixture 里有 https://a.dev
    useStore.setState({ tree, importError: null, importFile: null })
    useStore.getState().readImportFile('x.json', good)
    expect(useStore.getState().importFile!.preview.duplicateCount).toBe(1)
  })

  it('归一过程意外抛异常时落到「文件结构损坏。」而不是抛出去（白屏兜底）', () => {
    // 构造一棵 children getter 会抛异常的书签树，模拟解析/归一阶段任何未预见的运行时异常
    const explosiveTree = [{
      id: '0', title: '',
      get children(): BookmarkNode[] { throw new Error('boom') },
    }] as unknown as BookmarkNode[]
    useStore.setState({ tree: explosiveTree, importError: null, importFile: null, importDone: null })

    expect(() => useStore.getState().readImportFile('x.json', good)).not.toThrow()

    const state = useStore.getState()
    expect(state.importError).toBe('文件结构损坏。')
    expect(state.importFile).toBeNull()
    expect(state.importDone).toBeNull()
  })
})

describe('resetImport', () => {
  it('三段状态一起清空', () => {
    useStore.setState({
      importError: '错误',
      importFile: null,
      importDone: {
        result: { folderId: '1', bookmarks: 1, folders: 0, skipped: [] },
        blocked: [], targetName: '导入', barTitle: '书签栏',
      },
    })
    useStore.getState().resetImport()

    const state = useStore.getState()
    expect(state.importError).toBeNull()
    expect(state.importFile).toBeNull()
    expect(state.importDone).toBeNull()
  })
})

describe('语言跟着设置走', () => {
  afterEach(() => setLocale('zh_CN'))

  it('保存 uiLocale 后 store 的 locale 与 i18n 的当前语言一起变', async () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS }, locale: 'zh_CN' })
    await useStore.getState().setSettings({ ...DEFAULT_SETTINGS, uiLocale: 'en' })
    expect(useStore.getState().locale).toBe('en')
    expect(currentLocale()).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it("uiLocale 是 'auto' 时回落浏览器语言（桩是 zh-CN）", async () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, uiLocale: 'en' }, locale: 'en' })
    await useStore.getState().setSettings({ ...DEFAULT_SETTINGS, uiLocale: 'auto' })
    expect(useStore.getState().locale).toBe('zh_CN')
  })
})

describe('refreshTree 剪掉已经不存在的勾选', () => {
  // 合并会删掉被勾中的源目录，撤销又用新 id 把它们重建出来。
  // reset() 有意保留 checkedIds（「再整理一次」时不用重勾），但没人剪过这个集合：
  // 回到范围页会看到「扫描 2 个文件夹」的按钮亮着、树上却一个勾都没有，
  // 点下去扫的是一批死 id，直接撞 errNoScope——本功能自己的回头路被自己堵死了。
  it('树里已经没有的 id 被剪掉', async () => {
    vi.mocked(send).mockResolvedValue({ ok: true, kind: 'get_tree', tree })
    useStore.setState({ checkedIds: new Set(['10', '11', '900', '901']) })

    await useStore.getState().refreshTree()

    expect([...useStore.getState().checkedIds].sort()).toEqual(['10', '11'])
  })

  it('仍然存在的 id 一个不动——跨 reset 记住选择是有意为之，不能一把清空', async () => {
    vi.mocked(send).mockResolvedValue({ ok: true, kind: 'get_tree', tree })
    useStore.setState({ checkedIds: new Set(['1', '10', '101', '11']) })

    await useStore.getState().refreshTree()

    expect([...useStore.getState().checkedIds].sort()).toEqual(['1', '10', '101', '11'])
  })

  it('读树失败时不动勾选——拿不到新树就无从判断谁还活着', async () => {
    vi.mocked(send).mockResolvedValue({ ok: false, error: '后台没了' })
    useStore.setState({ checkedIds: new Set(['900']) })

    await useStore.getState().refreshTree()

    expect([...useStore.getState().checkedIds]).toEqual(['900'])
  })
})
