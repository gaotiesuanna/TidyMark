import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPanel } from '@/sidepanel/components/SettingsPanel'
import { PreferencesStep } from '@/sidepanel/steps/PreferencesStep'
import { ScopeStep } from '@/sidepanel/steps/ScopeStep'
import { useStore } from '@/sidepanel/store'
import { DEFAULT_SETTINGS, activeLlm } from '@/storage/settings'
import type { BookmarkNode } from '@/core/ports'
import type { BookmarkItem, ScanResult } from '@/core/types'

/**
 * 本机 Ollama 那条动线，从头走一遍：全新安装 → 设置页点「本地 Ollama」预设 → 一个字
 * 都不再填 → 回到选范围页与偏好页。
 *
 * 单独成篇，是因为它要验的东西横跨三个组件：预设按钮写下的到底是什么（apiKey 空着），
 * 以及另外两页看到这份设置之后各自怎么表现。分开写在三个文件里，每个文件都得手抄一份
 * 「点完预设之后的 settings」，而这条动线真正会坏的地方恰恰是那份手抄件与实际预设
 * 对不上——比如预设改了端口、或者哪天预设真的开始写 apiKey。
 */
const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'react', children: [] },
    ]},
  ]},
]

function bookmark(id: string, parentId: string): BookmarkItem {
  return { id, title: id, url: `https://example.com/${id}`, parentId, index: 0, currentPath: [] }
}

const scan: ScanResult = {
  folders: [{ id: '1', title: '书签栏', parentId: null, index: 0, path: [], depth: 0, level: 0 }],
  bookmarks: Array.from({ length: 5 }, (_, i) => bookmark(`l${i}`, '1')),
  stats: {
    totalBookmarks: 5, totalFolders: 1, emptyFolders: 0,
    untitledBookmarks: 0, duplicateUrlGroups: 0, duplicateFolderGroups: 0, maxDepth: 0,
  },
}

beforeEach(() => {
  useStore.setState({
    tree, scan, checkedIds: new Set(), busy: null, error: null, modeOverride: null,
    importFile: null, importError: null, importDone: null,
    settingsOpen: true,
    // 全新安装：默认设置，一个 Key 都没有
    settings: { ...DEFAULT_SETTINGS },
    // setSettings 会打 send()，必须替身；替身之外的行为跟真的一致——写进 store
    setSettings: vi.fn(async (settings) => { useStore.setState({ settings }) }),
    analyze: vi.fn(async () => {}),
    openSettings: vi.fn(),
  })
})

describe('本机 Ollama 动线', () => {
  it('点完「本地 Ollama」预设，两页的「还没配」都收回去，「开始 AI 分析」拿得到', async () => {
    // 第一步：全新安装，两页都该催他去配模型——这是下面几条断言的前提，
    // 不先立住的话「提示没了」可能只是从头到尾就没出现过
    const before = render(<ScopeStep />)
    expect(screen.getByRole('button', { name: '去配置模型' })).toBeTruthy()
    before.unmount()

    const beforePrefs = render(<PreferencesStep />)
    expect(screen.getByRole('button', { name: '先去配置模型' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '开始 AI 分析' })).toBeNull()
    beforePrefs.unmount()

    // 第二步：设置页点一下预设，此外一个字都不填
    const settings = render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: '本地 Ollama' }))
    settings.unmount()

    // 预设写下的确实是「本机地址 + 空 Key」——后面两页的表现全挂在这件事上
    const llm = activeLlm(useStore.getState().settings)
    expect(llm.baseUrl).toBe('http://localhost:11434/v1')
    expect(llm.apiKey).toBe('')

    // 第三步：回到选范围页，那条提示该消失了
    const after = render(<ScopeStep />)
    expect(screen.getByText(/勾选你想让 TidyMark 重构的文件夹/)).toBeTruthy()
    expect(screen.queryByText(/挑一个预设/)).toBeNull()
    expect(screen.queryByRole('button', { name: '去配置模型' })).toBeNull()
    after.unmount()

    // 第四步：偏好页给的是能点的「开始 AI 分析」，不是又一次「先去配置模型」
    render(<PreferencesStep />)
    const start = screen.getByRole('button', { name: '开始 AI 分析' }) as HTMLButtonElement
    expect(start.disabled).toBe(false)
    expect(screen.queryByRole('button', { name: '先去配置模型' })).toBeNull()

    await userEvent.click(start)
    expect(useStore.getState().analyze).toHaveBeenCalledTimes(1)
    expect(useStore.getState().openSettings).not.toHaveBeenCalled()
  })
})
