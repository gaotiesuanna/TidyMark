import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreferencesStep } from '@/sidepanel/steps/PreferencesStep'
import { useStore } from '@/sidepanel/store'
import { DEFAULT_SETTINGS } from '@/storage/settings'
import type { BookmarkItem, FolderItem, ScanResult } from '@/core/types'

function folder(id: string, title: string, parentId: string | null, depth: number): FolderItem {
  return { id, title, parentId, index: 0, path: [], depth, level: depth }
}

function bookmark(id: string, parentId: string): BookmarkItem {
  return { id, title: id, url: `https://example.com/${id}`, parentId, index: 0, currentPath: [] }
}

function scanOf(folders: FolderItem[], bookmarks: BookmarkItem[]): ScanResult {
  return {
    folders,
    bookmarks,
    stats: {
      totalBookmarks: bookmarks.length, totalFolders: folders.length, emptyFolders: 0,
      untitledBookmarks: 0, duplicateUrlGroups: 0, maxDepth: 0,
    },
  }
}

const ROOT = folder('1', '书签栏', null, 0)

/** 已整理过：两个带编号的目录各装 3 条，detectMode 判 additive。 */
const tidyScan = scanOf(
  [ROOT, folder('10', '01 前端', '1', 1), folder('11', '02 后端', '1', 1)],
  [
    ...Array.from({ length: 3 }, (_, i) => bookmark(`a${i}`, '10')),
    ...Array.from({ length: 3 }, (_, i) => bookmark(`b${i}`, '11')),
  ],
)

/** 一个目录都没有，detectMode 判 rebuild。 */
const messyScan = scanOf([ROOT], Array.from({ length: 5 }, (_, i) => bookmark(`l${i}`, '1')))

function setup(scan: ScanResult, domainGroups: string[] = []): void {
  useStore.setState({
    scan,
    settings: { ...DEFAULT_SETTINGS, domainGroups },
    modeOverride: null,
    busy: null,
    // setSettings 会打 send()，必须替身；setModeOverride 只写 state，用真的那个
    setSettings: vi.fn(async (settings) => { useStore.setState({ settings }) }),
  })
}

describe('PreferencesStep 域名聚合', () => {
  beforeEach(() => { setup(messyScan) })

  it('列出所有可选的域名组', () => {
    expect(screen.queryByLabelText('GitHub')).toBeNull()
    render(<PreferencesStep />)
    expect(screen.getByLabelText('GitHub')).toBeTruthy()
    expect(screen.getByLabelText('论文')).toBeTruthy()
  })

  it('推翻模式关闭时复选框禁用', () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    expect((screen.getByLabelText('GitHub') as HTMLInputElement).disabled).toBe(true)
  })

  it('推翻模式开启时复选框可用', () => {
    render(<PreferencesStep />)
    expect((screen.getByLabelText('GitHub') as HTMLInputElement).disabled).toBe(false)
  })

  it('勾选后写入 settings.domainGroups', async () => {
    render(<PreferencesStep />)
    await userEvent.click(screen.getByLabelText('GitHub'))
    expect(useStore.getState().settings.domainGroups).toEqual(['github'])
  })

  it('取消勾选后从 settings.domainGroups 移除', async () => {
    setup(messyScan, ['github', 'paper'])
    render(<PreferencesStep />)
    await userEvent.click(screen.getByLabelText('GitHub'))
    expect(useStore.getState().settings.domainGroups).toEqual(['paper'])
  })
})

describe('PreferencesStep 清理空文件夹的说明', () => {
  // 这段说明是无条件渲染的，可它描述的行为在合并模式下并不成立：
  // 源文件夹会被清空删除，而且删不删跟这个开关无关（apply.ts 里是
  // `removeEmptyFolders === true || mergeRootId !== null`）。
  // 界面上唯一一处讲「什么不会被删」的地方说了假话，比不讲更糟。
  it('交代合并时源文件夹会被删除，且不受这个开关约束', () => {
    setup(messyScan)
    render(<PreferencesStep />)
    const body = screen.getByText(/删除范围内不含任何书签的文件夹/)
    expect(body.textContent).toMatch(/合并/)
    expect(body.textContent).toMatch(/删除/)
    expect(body.textContent).toMatch(/不受.*开关/)
  })

  it('例外那半句本身要带上「可撤销」——删除很吓人，撤销才是让人敢按的那句', () => {
    setup(messyScan)
    render(<PreferencesStep />)
    const body = screen.getByText(/删除范围内不含任何书签的文件夹/).textContent ?? ''
    // 只查整段里有没有「撤销」是查不出东西的：原文早就有「撤销时会连同目录一起还原」，
    // 那句讲的是别的事。要看的是「合并」之后那半句自己有没有交代可撤销。
    const exception = body.slice(body.indexOf('合并'))
    expect(exception).toMatch(/删除|清理/)
    expect(exception).toMatch(/撤销/)
  })
})

describe('PreferencesStep 的模式判断', () => {
  it('判已整理时先讲结论，再讲凭什么这么判', () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    expect(screen.getByText(/已经整理过/)).toBeTruthy()
    // 理由来自 core/mode.ts，带着实际数字
    expect(screen.getByText(/带编号前缀/)).toBeTruthy()
  })

  it('判已整理时给出逃生口', () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    expect(screen.getByRole('button', { name: '不对，重新设计' })).toBeTruthy()
  })

  it('点了逃生口就按推翻模式渲染，域名聚合也跟着可用', async () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    await userEvent.click(screen.getByRole('button', { name: '不对，重新设计' }))

    expect(useStore.getState().modeOverride).toBe('rebuild')
    // 结论句与理由句里都带着「重新设计整棵目录树」这半句，用 getAllByText 而不是 getByText——
    // 两处都命中才是对的，getByText 在这里天然会因多重匹配而炸
    expect(screen.getAllByText(/重新设计整棵目录树/).length).toBeGreaterThan(0)
    expect((screen.getByLabelText('GitHub') as HTMLInputElement).disabled).toBe(false)
  })

  it('推翻之后能改回自动判断', async () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    await userEvent.click(screen.getByRole('button', { name: '不对，重新设计' }))
    await userEvent.click(screen.getByRole('button', { name: '恢复自动判断' }))

    expect(useStore.getState().modeOverride).toBeNull()
    expect(screen.getByText(/已经整理过/)).toBeTruthy()
  })

  it('判一团乱麻时不给逃生口——逃生口只为「误判成已整理」那一个方向存在', () => {
    setup(messyScan)
    render(<PreferencesStep />)
    expect(screen.queryByRole('button', { name: '不对，重新设计' })).toBeNull()
  })
})
