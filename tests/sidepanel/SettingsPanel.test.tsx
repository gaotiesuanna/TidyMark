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

  // 原来验的是「目录下限那两项还在——prune 仍然在读它们」。它们已经退成 core 里的
  // 内部常量 MIN_FOLDER_BOOKMARKS，设置页不该再摆出来：摆着就等于告诉用户他能拨
  it('不再摆出目录下限那两项——阈值已经退成 core 里的内部常量', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    render(<SettingsPanel />)
    expect(screen.queryByLabelText('不足几个书签的目录就不单独建立')).toBeNull()
    expect(screen.queryByLabelText('至少几个书签')).toBeNull()
  })

  // 原来验的是「分类偏好那几项一直可编辑」。那几项没了，但它守的规矩没变——设置页里
  // 摆出来的东西就得能改。写成整页扫一遍，比逐个点名更难失效
  it('设置页里没有任何被禁用的控件——摆出来的旋钮就得能拨', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    const { container } = render(<SettingsPanel />)
    expect(container.querySelectorAll('[disabled]')).toHaveLength(0)
    // 空断言防身：页面里确实有控件可查，不是扫了个空壳
    expect(container.querySelectorAll('input, select, button').length).toBeGreaterThan(0)
  })

  // 原来验的是那段「以下几项只在重新设计目录结构时生效」的说明。段里最后一个旋钮
  // 撤走之后，说明本身也没有指代对象了——连同整个 section 一起删掉，不留空壳
  it('分类偏好那一整段连同说明文案一起没了——里面已经一个旋钮都不剩', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    render(<SettingsPanel />)
    expect(screen.queryByText(/只在.*重新设计/)).toBeNull()
    expect(screen.queryByText('分类偏好')).toBeNull()
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
