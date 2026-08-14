import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setLocale } from '@/i18n'
import { SettingsPanel } from '@/sidepanel/components/SettingsPanel'
import { useStore } from '@/sidepanel/store'
import { DEFAULT_SETTINGS } from '@/storage/settings'

beforeEach(() => {
  useStore.setState({
    settingsOpen: true,
    settings: { ...DEFAULT_SETTINGS, rebuildStructure: true },
  })
})

describe('SettingsPanel 分类参数', () => {
  it('展示当前的一级目录上限', () => {
    render(<SettingsPanel />)
    expect(screen.getByLabelText('一级目录最多几个')).toHaveProperty('value', '12')
  })

  // 受控数字框用 fireEvent.change 一次性赋值。userEvent.type 是逐字符输入，
  // 而被拦下的中间态（清空 -> '' -> 0，越界不写）会让 React 把 DOM 值重置回原值，
  // 下一个字符就拼在原值后面，得到 '126' 这种结果
  it('改上限后写进设置', () => {
    render(<SettingsPanel />)
    fireEvent.change(screen.getByLabelText('一级目录最多几个'), { target: { value: '6' } })
    expect(useStore.getState().settings.maxTopFolders).toBe(6)
  })

  // 越界值写进存储会一路传到 slice(0, 越界值)，必须在入口挡掉。
  // 注意语义是「保持原值」而不是规格里写的「回落默认值」——用户原本设成 6、
  // 手滑输成 99，把他打回 12 比留在 6 更意外。规格那句以此处为准。
  it('越界或非数字的输入不写进设置，保持原值', () => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, rebuildStructure: true, maxTopFolders: 6 },
    })
    render(<SettingsPanel />)
    const input = screen.getByLabelText('一级目录最多几个')
    fireEvent.change(input, { target: { value: '99' } })
    expect(useStore.getState().settings.maxTopFolders).toBe(6)
    fireEvent.change(input, { target: { value: '' } })
    expect(useStore.getState().settings.maxTopFolders).toBe(6)
  })

  it('二级目录开关默认开着，点一下关掉并写进设置', async () => {
    render(<SettingsPanel />)
    const box = screen.getByRole('checkbox', { name: '允许分出二级目录' })
    expect(box).toHaveProperty('checked', true)
    await userEvent.click(box)
    expect(useStore.getState().settings.allowSubfolders).toBe(false)
  })

  // 沿用 PreferencesStep 里 domainGroups 的既有做法
  it('推翻重建关闭时两项都禁用', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, rebuildStructure: false } })
    render(<SettingsPanel />)
    expect(screen.getByLabelText('一级目录最多几个')).toHaveProperty('disabled', true)
    expect(screen.getByRole('checkbox', { name: '允许分出二级目录' })).toHaveProperty('disabled', true)
  })
})

describe('SettingsPanel 语言', () => {
  afterEach(() => setLocale('zh_CN'))

  it('展示当前语言，默认是跟随浏览器', () => {
    render(<SettingsPanel />)
    expect(screen.getByLabelText('语言')).toHaveProperty('value', 'auto')
  })

  it('选中某个语言后写进设置', async () => {
    render(<SettingsPanel />)
    fireEvent.change(screen.getByLabelText('语言'), { target: { value: 'en' } })
    expect(useStore.getState().settings.uiLocale).toBe('en')
  })

  // 分类参数在不推翻重建时会灰掉，语言不该跟着灰——它跟推翻重建没关系
  it('语言不受推翻重建开关影响', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, rebuildStructure: false } })
    render(<SettingsPanel />)
    expect(screen.getByLabelText('语言')).toHaveProperty('disabled', false)
  })

  it('两个语言选项各自用自己的语言写，界面语言变了也不翻译', () => {
    setLocale('en')
    render(<SettingsPanel />)
    expect(screen.getByRole('option', { name: '中文' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'English' })).toBeTruthy()
  })
})
