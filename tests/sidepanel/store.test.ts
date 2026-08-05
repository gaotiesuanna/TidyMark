import { describe, it, expect } from 'vitest'
import {
  appendLog, collectDescendantFolderIds, nextStepAfterAnalyze, toggleChecked, useStore,
  MAX_LOGS, MAX_LOG_LENGTH, type LogLine,
} from '@/sidepanel/store'
import { makePlan } from '../fakes/plan'
import type { ProgressEvent } from '@/background/events'
import type { BookmarkNode } from '@/core/ports'

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
