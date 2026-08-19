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
  it('展示当前的一级目录上限', () => {
    render(<SettingsPanel />)
    expect(screen.getByLabelText('同层目录最多几个')).toHaveProperty('value', '12')
  })

  // 受控数字框用 fireEvent.change 一次性赋值。userEvent.type 是逐字符输入，
  // 而被拦下的中间态（清空 -> '' -> 0，越界不写）会让 React 把 DOM 值重置回原值，
  // 下一个字符就拼在原值后面，得到 '126' 这种结果
  it('改上限后写进设置', () => {
    render(<SettingsPanel />)
    fireEvent.change(screen.getByLabelText('同层目录最多几个'), { target: { value: '6' } })
    expect(useStore.getState().settings.maxTopFolders).toBe(6)
  })

  // 越界值写进存储会一路传到 slice(0, 越界值)，必须在入口挡掉。
  // 注意语义是「保持原值」而不是规格里写的「回落默认值」——用户原本设成 6、
  // 手滑输成 99，把他打回 12 比留在 6 更意外。规格那句以此处为准。
  it('越界或非数字的输入不写进设置，保持原值', () => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, maxTopFolders: 6 },
    })
    render(<SettingsPanel />)
    const input = screen.getByLabelText('同层目录最多几个')
    fireEvent.change(input, { target: { value: '99' } })
    expect(useStore.getState().settings.maxTopFolders).toBe(6)
    fireEvent.change(input, { target: { value: '' } })
    expect(useStore.getState().settings.maxTopFolders).toBe(6)
  })

  it('嵌套层数默认两层，改了写进设置', () => {
    render(<SettingsPanel />)
    const input = screen.getByLabelText('目录最深嵌套几层')
    expect(input).toHaveProperty('value', '2')
    fireEvent.change(input, { target: { value: '1' } })
    expect(useStore.getState().settings.maxFolderDepth).toBe(1)
  })

  // 与同层上限那个框同样的把关，理由见那条测试
  it('嵌套层数越界或非数字的输入不写进设置，保持原值', () => {
    render(<SettingsPanel />)
    const input = screen.getByLabelText('目录最深嵌套几层')
    fireEvent.change(input, { target: { value: '9' } })
    expect(useStore.getState().settings.maxFolderDepth).toBe(2)
    fireEvent.change(input, { target: { value: '0' } })
    expect(useStore.getState().settings.maxFolderDepth).toBe(2)
    fireEvent.change(input, { target: { value: '' } })
    expect(useStore.getState().settings.maxFolderDepth).toBe(2)
  })

  it('分类偏好那几项一直可编辑——走哪条路是每次整理现判的，不该锁住设置', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    render(<SettingsPanel />)
    expect(screen.getByLabelText('同层目录最多几个')).toHaveProperty('disabled', false)
    expect(screen.getByLabelText('目录最深嵌套几层')).toHaveProperty('disabled', false)
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

  // 与另外两个数字框同样的把关，理由见上面那条测试
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
