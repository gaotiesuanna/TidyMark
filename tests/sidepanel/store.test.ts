import { describe, it, expect } from 'vitest'
import {
  appendLog, collectDescendantFolderIds, toggleChecked, useStore, MAX_LOGS, MAX_LOG_LENGTH, type LogLine,
} from '@/sidepanel/store'
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
