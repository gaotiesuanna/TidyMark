import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreferencesStep } from '@/sidepanel/steps/PreferencesStep'
import { useStore } from '@/sidepanel/store'
import { DEFAULT_SETTINGS } from '@/storage/settings'

const scan = {
  bookmarks: [],
  folders: [],
  stats: {
    totalBookmarks: 0, totalFolders: 0, emptyFolders: 0,
    untitledBookmarks: 0, duplicateUrlGroups: 0, maxDepth: 0,
  },
}

function setup(rebuildStructure: boolean, domainGroups: string[] = []): void {
  useStore.setState({
    scan,
    settings: { ...DEFAULT_SETTINGS, rebuildStructure, domainGroups },
    busy: null,
    setSettings: vi.fn(async (settings) => { useStore.setState({ settings }) }),
  })
}

describe('PreferencesStep 域名聚合', () => {
  beforeEach(() => { setup(true) })

  it('列出所有可选的域名组', () => {
    expect(screen.queryByLabelText('GitHub')).toBeNull()
    render(<PreferencesStep />)
    expect(screen.getByLabelText('GitHub')).toBeTruthy()
    expect(screen.getByLabelText('论文')).toBeTruthy()
  })

  it('推翻模式关闭时复选框禁用', () => {
    setup(false)
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
    setup(true, ['github', 'paper'])
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
    setup(true)
    render(<PreferencesStep />)
    const body = screen.getByText(/删除范围内不含任何书签的文件夹/)
    expect(body.textContent).toMatch(/合并/)
    expect(body.textContent).toMatch(/删除/)
    expect(body.textContent).toMatch(/不受.*开关/)
  })

  it('例外那半句本身要带上「可撤销」——删除很吓人，撤销才是让人敢按的那句', () => {
    setup(true)
    render(<PreferencesStep />)
    const body = screen.getByText(/删除范围内不含任何书签的文件夹/).textContent ?? ''
    // 只查整段里有没有「撤销」是查不出东西的：原文早就有「撤销时会连同目录一起还原」，
    // 那句讲的是别的事。要看的是「合并」之后那半句自己有没有交代可撤销。
    const exception = body.slice(body.indexOf('合并'))
    expect(exception).toMatch(/删除|清理/)
    expect(exception).toMatch(/撤销/)
  })
})
