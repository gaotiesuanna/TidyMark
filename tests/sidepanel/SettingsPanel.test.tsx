import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { setLocale, t } from '@/i18n'
import { SettingsPanel } from '@/sidepanel/components/SettingsPanel'
import { useStore } from '@/sidepanel/store'
import { DEFAULT_SETTINGS, PRESETS } from '@/storage/settings'

beforeEach(() => {
  useStore.setState({
    settingsOpen: true,
    settings: { ...DEFAULT_SETTINGS },
  })
})

/**
 * 分类参数（同层目录最多几个、最深几层、目录下限）已经全部退成程序自己推导的东西，
 * 设置页上一个都不该再摆。
 *
 * 不逐条点名查 label：那些文案连同 _locales 里的词条一起删掉了，字符串在任何走
 * i18n 的实现下都不可能再命中——`queryByLabelText('至少几个书签')` 恒为 null，
 * 把整个 section 原样加回去（文案走英文词条）也照样绿，等于没测。
 * 改成扫结构：还剩几块 section、标题是哪两个、还有没有数字旋钮，都跟叫什么名字无关。
 *
 * 光扫 h3 和数字框不够——同一个文件里就摆着反例：「统一 GitHub 标题」那块 section
 * 既没有 h3 也没有 input[type=number]，一个复选框形态的分类参数照这个样子加回来，
 * 两条断言都抓不住。所以还要数 section：这一页应当恰好三块，多一块就是有东西回来了。
 */
describe('SettingsPanel 分类参数', () => {
  it('设置页恰好三块、标题只剩模型配置与语言——分类参数整段撤走了', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    const { container } = render(<SettingsPanel />)
    // 恰好三块：模型配置、语言、统一 GitHub 标题。数它是为了挡住「没有 h3、也没有数字框」
    // 的形态——比如一个光杆复选框，那正是被撤掉的 enforceMinFolderSize 的样子
    expect(container.querySelectorAll('section')).toHaveLength(3)
    const headings = [...container.querySelectorAll('h3')].map((h) => h.textContent)
    expect(headings).toEqual([t('settingsModelTitle'), t('settingsLangTitle')])
  })

  it('设置页里一个数字旋钮都没有——这几个数字用户无从判断，一律由书签量推导', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    const { container } = render(<SettingsPanel />)
    // 空断言防身：这一页确实渲染出输入控件了，不是在一个空壳上扫出的零
    expect(container.querySelectorAll('input').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(0)
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

/**
 * 模型配置从偏好页搬进设置页：它是「配一次就不动的」，不属于「这一轮怎么整理」。
 * 每条都查到具体控件并且真的动它一下——只查文案在不在，搬迁时把 onChange 漏掉也照样绿。
 */
describe('SettingsPanel 模型配置', () => {
  it('摆出 Base URL / API Key / Model 三个输入框', () => {
    render(<SettingsPanel />)
    expect(screen.getByPlaceholderText('Base URL')).toBeTruthy()
    expect(screen.getByPlaceholderText('API Key')).toBeTruthy()
    expect(screen.getByPlaceholderText('Model')).toBeTruthy()
  })

  it('API Key 输入框是密码框——侧栏是常开的，明文摆着等于给旁边的人看', () => {
    render(<SettingsPanel />)
    expect(screen.getByPlaceholderText('API Key')).toHaveProperty('type', 'password')
  })

  it('改 API Key 写进 settings.llm', () => {
    render(<SettingsPanel />)
    fireEvent.change(screen.getByPlaceholderText('API Key'), { target: { value: 'sk-x' } })
    expect(useStore.getState().settings.llm.apiKey).toBe('sk-x')
  })

  it('列出全部供应商预设，点一下同时写 baseUrl 与 model', () => {
    render(<SettingsPanel />)
    for (const preset of PRESETS) {
      expect(screen.getByRole('button', { name: preset.label.zh_CN })).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek' }))
    const llm = useStore.getState().settings.llm
    expect(llm.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(llm.model).toBe('deepseek-chat')
  })

  it('隐私说明跟着模型配置一起来——填 Key 的地方才是该讲这件事的地方', () => {
    render(<SettingsPanel />)
    expect(screen.getByText(/API Key 明文保存在本地浏览器存储中/)).toBeTruthy()
    expect(screen.getByText(/不含 URL 参数与网页正文/)).toBeTruthy()
  })
})

describe('SettingsPanel 统一 GitHub 标题', () => {
  it('摆出开关，勾了写进 settings.rewriteGithubTitles', () => {
    render(<SettingsPanel />)
    const box = screen.getByLabelText(/统一 GitHub 书签标题/) as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(useStore.getState().settings.rewriteGithubTitles).toBe(true)
  })
})
