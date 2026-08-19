import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { setLocale } from '@/i18n'
import { SettingsPanel } from '@/sidepanel/components/SettingsPanel'
import { useStore } from '@/sidepanel/store'
import { DEFAULT_SETTINGS } from '@/storage/settings'

beforeEach(() => {
  useStore.setState({
    settingsOpen: true,
    settings: { ...DEFAULT_SETTINGS },
  })
})

describe('SettingsPanel 分类参数', () => {
  it('不再摆出「同层目录最多几个」——它已经由书签数推导，拨了也不生效', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    render(<SettingsPanel />)
    expect(screen.queryByLabelText('同层目录最多几个')).toBeNull()
  })

  it('不再摆出「目录最深嵌套几层」——同理', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    render(<SettingsPanel />)
    expect(screen.queryByLabelText('目录最深嵌套几层')).toBeNull()
  })

  it('目录下限那两项还在——prune 仍然在读它们', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    render(<SettingsPanel />)
    expect(screen.getByLabelText('不足几个书签的目录就不单独建立')).toBeTruthy()
    expect(screen.getByLabelText('至少几个书签')).toBeTruthy()
  })

  it('分类偏好那几项一直可编辑——走哪条路是每次整理现判的，不该锁住设置', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    render(<SettingsPanel />)
    expect(screen.getByLabelText('不足几个书签的目录就不单独建立')).toHaveProperty('disabled', false)
    // 默认设置下 enforceMinFolderSize 是开着的，这个数字框也该跟着可编辑
    expect(screen.getByLabelText('至少几个书签')).toHaveProperty('disabled', false)
  })

  it('说明文案交代它们只在重新设计目录结构时生效', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    render(<SettingsPanel />)
    expect(screen.getByText(/只在.*重新设计/)).toBeTruthy()
  })
})

describe('SettingsPanel 目录下限', () => {
  it('默认勾着，阈值 3', () => {
    render(<SettingsPanel />)
    expect(screen.getByLabelText('不足几个书签的目录就不单独建立')).toHaveProperty('checked', true)
    expect(screen.getByLabelText('至少几个书签')).toHaveProperty('value', '3')
  })

  it('取消勾选后写进设置', () => {
    render(<SettingsPanel />)
    fireEvent.click(screen.getByLabelText('不足几个书签的目录就不单独建立'))
    expect(useStore.getState().settings.enforceMinFolderSize).toBe(false)
  })

  it('改阈值后写进设置', () => {
    render(<SettingsPanel />)
    fireEvent.change(screen.getByLabelText('至少几个书签'), { target: { value: '5' } })
    expect(useStore.getState().settings.minFolderSize).toBe(5)
  })

  it('阈值越界或非数字的输入不写进设置，保持原值', () => {
    render(<SettingsPanel />)
    const input = screen.getByLabelText('至少几个书签')
    fireEvent.change(input, { target: { value: '11' } })
    expect(useStore.getState().settings.minFolderSize).toBe(3)
    // 填 1 等于没开，那种意图应该去取消勾选，不是把阈值调到 1
    fireEvent.change(input, { target: { value: '1' } })
    expect(useStore.getState().settings.minFolderSize).toBe(3)
    fireEvent.change(input, { target: { value: '' } })
    expect(useStore.getState().settings.minFolderSize).toBe(3)
  })

  // 数字框跟着勾选框走：没勾时那个数字不起作用，还能改就是在骗人
  it('没勾开关时阈值输入框禁用，勾选框自己不禁用', () => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, enforceMinFolderSize: false },
    })
    render(<SettingsPanel />)
    expect(screen.getByLabelText('至少几个书签')).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('不足几个书签的目录就不单独建立')).toHaveProperty('disabled', false)
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

  it('语言输入框不禁用', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
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
