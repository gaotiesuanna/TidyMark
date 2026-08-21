import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { setLocale, t } from '@/i18n'
import { SettingsPanel } from '@/sidepanel/components/SettingsPanel'
import { useStore } from '@/sidepanel/store'
import { send } from '@/sidepanel/lib/send'
import { DEFAULT_SETTINGS, PRESETS } from '@/storage/settings'
import type { TestFailure } from '@/background/messages'

vi.mock('@/sidepanel/lib/send', () => ({ send: vi.fn() }))

const chromeGlobal = globalThis as unknown as { chrome: Record<string, unknown> }
const originalPermissions = chromeGlobal.chrome.permissions

beforeEach(() => {
  vi.mocked(send).mockReset()
  vi.mocked(send).mockResolvedValue({ ok: false, error: '没有桩' })
  chromeGlobal.chrome.permissions = {
    contains: vi.fn(() => Promise.resolve(true)),
    request: vi.fn(() => Promise.resolve(true)),
  }
  useStore.setState({
    settingsOpen: true,
    settings: { ...DEFAULT_SETTINGS },
    modelTest: { state: 'idle' },
  })
})

afterEach(() => {
  chromeGlobal.chrome.permissions = originalPermissions
})

/** 一份「配好了」的模型：非本机域名，走得到申请权限那一步。 */
const CONFIGURED = {
  ...DEFAULT_SETTINGS,
  llm: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-real', model: 'deepseek-chat' },
}

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
  // 摆出来的东西就得能改。写成整页扫一遍，比逐个点名更难失效。
  //
  // 用一份配好的模型来扫，而不是 DEFAULT_SETTINGS：「测试连接」在模型没配好时是禁用的，
  // 那是它本来的样子（没有东西可测），不是一个拨不动的旋钮。断言本身一个字没松——
  // 整页仍然一个 disabled 都不许有，只是把那唯一一个「有理由禁用」的前提排除掉；
  // 那个前提自己由下面「模型还没配好时按钮禁着」那条正面盯着。
  it('设置页里没有任何被禁用的控件——摆出来的旋钮就得能拨', () => {
    useStore.setState({ settings: CONFIGURED })
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

/**
 * 「测试连接」按钮。
 *
 * 它由一次真实故障催生：用户配了模型，跑分析失败在 `TypeError: Failed to fetch`，
 * 定位耗了十几轮对话，因为要分清的可能性有五个——Key 无效、模型名不对、host 权限
 * 没授到、代理/DNS 不通、别的扩展拦截。所以这一组用例盯的不是「有没有报错」，
 * 而是**报的是不是那一类**：只报「失败了」等于没做。
 */
describe('SettingsPanel 测试连接', () => {
  /** send 一共被叫去测过几次模型——absence 断言要数的就是它。 */
  function testModelCalls(): number {
    return vi.mocked(send).mock.calls.filter(([req]) => req.kind === 'test_model').length
  }

  function clickTest(): void {
    fireEvent.click(screen.getByRole('button', { name: t('settingsTestModel') }))
  }

  it('模型还没配好时按钮禁着，配好了就能点——没配的时候没有东西可测', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    const bare = render(<SettingsPanel />)
    expect(screen.getByRole('button', { name: t('settingsTestModel') })).toHaveProperty('disabled', true)
    bare.unmount()

    // 同一条里做对照：禁用不是恒成立的，配好之后必须真的能点
    useStore.setState({ settings: CONFIGURED })
    render(<SettingsPanel />)
    expect(screen.getByRole('button', { name: t('settingsTestModel') })).toHaveProperty('disabled', false)
  })

  it('刚打开时什么结论都不显示——一上来就摆着结果等于凭空断言', () => {
    useStore.setState({ settings: CONFIGURED })
    render(<SettingsPanel />)
    // 防身：这一块确实渲染出来了，不是在一个没有按钮的页面上扫出的空
    expect(screen.getByRole('button', { name: t('settingsTestModel') })).toBeTruthy()
    expect(screen.queryByText(t('settingsTestFailNetwork'))).toBeNull()
    expect(screen.queryByText(t('settingsTestOk', '12'))).toBeNull()
  })

  it('点下去先显示正在测试，按钮同时禁着，别让人连点', async () => {
    let release: (value: { ok: true; kind: 'test_model'; ms: number }) => void = () => {}
    vi.mocked(send).mockReturnValue(new Promise((resolve) => { release = resolve }))
    useStore.setState({ settings: CONFIGURED })
    render(<SettingsPanel />)

    clickTest()
    expect(screen.getByText(t('settingsTestRunning'))).toBeTruthy()
    expect(screen.getByRole('button', { name: t('settingsTestModel') })).toHaveProperty('disabled', true)

    release({ ok: true, kind: 'test_model', ms: 640 })
    expect(await screen.findByText(t('settingsTestOk', '640'))).toBeTruthy()
  })

  it('通了就把耗时一起说出来——「快不快」是这次测试顺带给出的信息', async () => {
    vi.mocked(send).mockResolvedValue({ ok: true, kind: 'test_model', ms: 812 })
    useStore.setState({ settings: CONFIGURED })
    render(<SettingsPanel />)

    clickTest()
    expect(await screen.findByText(t('settingsTestOk', '812'))).toBeTruthy()
    expect(testModelCalls()).toBe(1)
  })

  /**
   * 权限被拒时连消息都不该发：那次请求必然失败，而且会把「权限没授到」这个已经确定的
   * 答案，换成一句笼统的「请求没能发出去」。
   *
   * absence 断言防身：先断言权限那条文案确实显示出来了，再数 send。少了前一句，
   * 一个「点了什么都不干」的实现也会绿。
   */
  it('权限被拒时说是权限问题，而且根本不去打扰后台', async () => {
    chromeGlobal.chrome.permissions = {
      contains: vi.fn(() => Promise.resolve(false)),
      request: vi.fn(() => Promise.resolve(false)),
    }
    useStore.setState({ settings: CONFIGURED })
    render(<SettingsPanel />)

    clickTest()
    expect(await screen.findByText(t('settingsTestFailPermission'))).toBeTruthy()
    expect(testModelCalls()).toBe(0)
  })

  /** 四类失败各说各的话。文案说错一类，会把人推去换 Key、改模型名，白费更多时间。 */
  const CASES: Array<{ reason: TestFailure; key: Parameters<typeof t>[0]; error: string }> = [
    { reason: 'auth', key: 'settingsTestFailAuth', error: '模型接口返回 401: invalid_api_key' },
    { reason: 'model', key: 'settingsTestFailModel', error: '模型接口返回 404: model not found' },
    { reason: 'format', key: 'settingsTestFailFormat', error: '模型返回的不是合法 JSON' },
    { reason: 'network', key: 'settingsTestFailNetwork', error: 'Failed to fetch' },
  ]

  for (const { reason, key, error } of CASES) {
    it(`reason 为 ${reason} 时显示对应的说明，并把原始报错一起摆出来`, async () => {
      vi.mocked(send).mockResolvedValue({ ok: false, error, reason })
      useStore.setState({ settings: CONFIGURED })
      render(<SettingsPanel />)

      clickTest()
      expect(await screen.findByText(t(key))).toBeTruthy()
      // 原始报错是定位的证据（状态码、响应体），分类文案替代不了它
      expect(screen.getByText(error)).toBeTruthy()
      // 别的三类一条都不许同时出现——四条文案挂在同一处，写成「全都显示」也能骗过上面那句
      for (const other of CASES) {
        if (other.reason === reason) continue
        expect(screen.queryByText(t(other.key))).toBeNull()
      }
    })
  }

  /**
   * 后台没带回 reason 的情况是真实存在的：service worker 被回收时 send 自己造的那个失败、
   * 以及 handlers 外层 catch 兜到的失败，都只有 error 没有 reason。
   * 不许把 reason 当必填读——读出 undefined 后什么都不显示，等于又回到「只报失败了」。
   */
  it('后台没说是哪一类时给一条兜底，不是一片空白', async () => {
    vi.mocked(send).mockResolvedValue({ ok: false, error: '后台已被浏览器回收，本次操作中断。' })
    useStore.setState({ settings: CONFIGURED })
    render(<SettingsPanel />)

    clickTest()
    expect(await screen.findByText(t('settingsTestFailUnknown'))).toBeTruthy()
    expect(screen.getByText('后台已被浏览器回收，本次操作中断。')).toBeTruthy()
  })

  /**
   * 这条是本票的核心价值：`TestFailure` 里没有「权限」这一类，是有意的——能不能访问
   * 某个域名要问 `chrome.permissions.contains`，llm 层零浏览器依赖，答不了。
   * 于是必须由这一层在失败之后复查一次，把一句笼统的「请求没能发出去」换成确定的答案。
   *
   * 这里的形状就是那次真实故障的形状：用户在权限弹窗上点了允许（request 返回 true），
   * 实际却没授到（contains 仍然是 false），请求于是死在 `Failed to fetch` 上。
   */
  it('失败后复查权限：真没授到时说权限，而不是笼统的网络不通', async () => {
    chromeGlobal.chrome.permissions = {
      contains: vi.fn(() => Promise.resolve(false)),
      request: vi.fn(() => Promise.resolve(true)),
    }
    vi.mocked(send).mockResolvedValue({ ok: false, error: 'Failed to fetch', reason: 'network' })
    useStore.setState({ settings: CONFIGURED })
    render(<SettingsPanel />)

    clickTest()
    expect(await screen.findByText(t('settingsTestFailPermission'))).toBeTruthy()
    // 后台给的 'network' 必须被盖掉，不能两条一起挂着让人自己挑
    expect(screen.queryByText(t('settingsTestFailNetwork'))).toBeNull()
    // 防身：这一次确实发出去测过了，不是在权限那一步就被挡回来的（那条路另有用例）
    expect(testModelCalls()).toBe(1)
  })

  /**
   * Key 一个字节都不许出现在界面上。后台已经剥过一道，这条从端到端再守一次——
   * 厂商的错误响应体原样回显 Authorization 头是真实存在的行为。
   *
   * 防身：先断言确实显示了那条失败文案，再断言不含 Key。少了前一句，
   * 一个「失败时什么都不显示」的实现也会绿。
   */
  it('失败文案里不含 API Key', async () => {
    const canary = 'sk-CANARY-DO-NOT-LEAK'
    vi.mocked(send).mockResolvedValue({
      ok: false,
      error: '模型接口返回 401: invalid_api_key',
      reason: 'auth',
    })
    useStore.setState({ settings: { ...CONFIGURED, llm: { ...CONFIGURED.llm, apiKey: canary } } })
    const { container } = render(<SettingsPanel />)

    clickTest()
    expect(await screen.findByText(t('settingsTestFailAuth'))).toBeTruthy()
    expect(container.textContent).toContain('401')
    expect(container.textContent).not.toContain(canary)
  })

  /**
   * 结果不持久化。它是一次即时探针，不是状态：重新打开设置页时显示一个上次的结论
   * 会撒谎——配置早就可能改过了。
   */
  it('重新挂载之后回到空白，不留着上一次的结论', async () => {
    vi.mocked(send).mockResolvedValue({ ok: true, kind: 'test_model', ms: 640 })
    useStore.setState({ settings: CONFIGURED })
    const first = render(<SettingsPanel />)

    clickTest()
    expect(await screen.findByText(t('settingsTestOk', '640'))).toBeTruthy()
    first.unmount()

    render(<SettingsPanel />)
    // 防身：这一页确实重新渲染出来了，不是在一个空 DOM 上扫出的 null
    expect(screen.getByRole('button', { name: t('settingsTestModel') })).toBeTruthy()
    expect(screen.queryByText(t('settingsTestOk', '640'))).toBeNull()
  })
})
