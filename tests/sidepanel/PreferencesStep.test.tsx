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
