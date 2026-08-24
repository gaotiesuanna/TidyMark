import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setLocale, t } from '@/i18n'
import { SettingsPanel } from '@/sidepanel/components/SettingsPanel'
import { useStore } from '@/sidepanel/store'
import { send } from '@/sidepanel/lib/send'
import { DEFAULT_SETTINGS, PRESETS, activeLlm } from '@/storage/settings'
import type { Endpoint, Settings } from '@/storage/settings'
import { withLlm } from '../fakes/settings'
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
    modelTests: {},
  })
})

afterEach(() => {
  chromeGlobal.chrome.permissions = originalPermissions
})

/** 一份「配好了」的模型：非本机域名，走得到申请权限那一步。 */
const CONFIGURED = {
  ...DEFAULT_SETTINGS,
  ...withLlm({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-real', model: 'deepseek-chat' }),
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
  // 用一份配好的模型来扫，而不是 DEFAULT_SETTINGS：默认端点一进来就是空 Key 的折叠卡，
  // 这里要的是「配好了、没在编辑」时整页一个 disabled 都没有。

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
 *
 * 这一节原本测的是三个常开输入框，Task 5 把它换成了端点卡片（折叠态只看域名，
 * 编辑才露出 Base URL / API Key）——折叠/编辑本身以及 Key 是不是密码框，
 * EndpointCard.test.tsx 已经守住了；这里只留 SettingsPanel 独有的装配责任：
 * 编辑-保存这条链路真的通到 store，以及预设列表、隐私说明还摆在这一节里。
 */
describe('SettingsPanel 模型配置', () => {
  it('默认端点折叠展示域名，点编辑才露出 Base URL / API Key 输入框', async () => {
    render(<SettingsPanel />)
    expect(screen.getByText('api.openai.com')).toBeTruthy()
    expect(screen.queryByPlaceholderText('Base URL')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: t('settingsEndpointEdit') }))
    expect(screen.getByPlaceholderText('Base URL')).toBeTruthy()
    expect(screen.getByPlaceholderText('API Key')).toHaveProperty('type', 'password')
  })

  it('编辑态改 API Key 并保存，写进当前端点', async () => {
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: t('settingsEndpointEdit') }))
    fireEvent.change(screen.getByPlaceholderText('API Key'), { target: { value: 'sk-x' } })
    await userEvent.click(screen.getByRole('button', { name: t('settingsEndpointSave') }))
    expect(useStore.getState().settings.endpoints[0]!.apiKey).toBe('sk-x')
  })

  // 覆盖语义在能存多条的世界里没有意义（见「端点列表」那组用例）：这里只守
  // 「全部预设都摆出来了」，新增语义已经在那边守住，不重复断言。
  it('列出全部供应商预设，点一下会新增一个端点', async () => {
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: t('settingsEndpointAdd') }))
    for (const preset of PRESETS) {
      expect(screen.getByRole('button', { name: new RegExp(`^${preset.label.zh_CN}`) })).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: /^DeepSeek/ }))
    const { endpoints } = useStore.getState().settings
    expect(endpoints).toHaveLength(2)
    // 模型列表是空的：Key 还没填，摆一个模型名等于摆一个点了必然 401 的选项
    expect(endpoints[1]).toEqual({ baseUrl: 'https://api.deepseek.com/v1', apiKey: '', models: [] })
  })

  // 本机端点不要 Key，它一加进来就是能用的——这条路上预设自带的模型名照旧写进去，
  // 否则 README 明确支持的「点一下本地 Ollama 就能开跑」会断在这里
  it('本机预设不要 Key，模型名照旧带进来', async () => {
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: '加一个端点' }))
    fireEvent.click(screen.getByRole('button', { name: /^本地 Ollama/ }))
    const added = useStore.getState().settings.endpoints.at(-1)!
    expect(added.baseUrl).toBe('http://localhost:11434/v1')
    expect(added.models).toEqual(['qwen2.5'])
  })

  // Key 已经填好的端点上再点一次同一个预设，模型名该并进去——那条端点当下就能用
  it('Key 填好的端点上点预设，模型名照并不误', async () => {
    const filled: Endpoint = {
      baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-mine', models: [],
    }
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, endpoints: [filled], active: { baseUrl: filled.baseUrl, model: '' } },
    })
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('button', { name: '加一个端点' }))
    fireEvent.click(screen.getByRole('button', { name: /^DeepSeek/ }))
    expect(useStore.getState().settings.endpoints[0]!.models).toEqual(['deepseek-chat'])
  })


  it('隐私说明跟着模型配置一起来——填 Key 的地方才是该讲这件事的地方', () => {
    render(<SettingsPanel />)
    expect(screen.getByText(/API Key 都明文保存在本地浏览器存储中/)).toBeTruthy()
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

  // 按钮不再因为「Key 没填」而禁用——它现在挂在端点里已经存在的每一个模型上，
  // Key 配没配对由测试本身给出结果，不用界面提前猜。编辑态同样能点：测的是框里
  // 还没保存的那份地址和 Key。
  it('测试连接按钮平时能点，编辑草稿态时也能点', async () => {
    // 空 Key + 一个已经存在的模型：正是「Key 没填也该能点」要守的那个形态
    useStore.setState({ settings: {
      ...DEFAULT_SETTINGS,
      endpoints: [{ baseUrl: 'https://api.deepseek.com/v1', apiKey: '', models: ['deepseek-chat'] }],
    } })
    render(<SettingsPanel />)
    expect(screen.getByRole('button', { name: t('settingsTestModel') })).toHaveProperty('disabled', false)

    await userEvent.click(screen.getByRole('button', { name: t('settingsEndpointEdit') }))
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
    useStore.setState({ settings: { ...CONFIGURED, ...withLlm({ ...activeLlm(CONFIGURED), apiKey: canary }) } })
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

describe('端点列表', () => {
  const two: Endpoint[] = [
    { baseUrl: 'https://opencode.ai/zen/go/v1', apiKey: 'sk-x', models: ['glm-5.2'] },
    { baseUrl: 'http://localhost:11434/v1', apiKey: '', models: ['qwen2.5'] },
  ]

  function arrange(endpoints: Endpoint[], active: { baseUrl: string; model: string }) {
    const setSettings = vi.fn(async (settings: Settings) => { useStore.setState({ settings }) })
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, endpoints, active },
      setSettings, modelTests: {}, testModel: vi.fn(async () => {}),
    })
    render(<SettingsPanel />)
    return { setSettings }
  }

  const lastSaved = (setSettings: ReturnType<typeof vi.fn>): Settings =>
    setSettings.mock.calls.at(-1)![0] as Settings

  it('每个端点各一块', () => {
    arrange(two, { baseUrl: two[0]!.baseUrl, model: 'glm-5.2' })
    expect(screen.getByText('opencode.ai')).toBeTruthy()
    expect(screen.getByText('localhost:11434')).toBeTruthy()
  })

  // 加端点是「再来一张卡」，位置就该在端点队尾；预设平时不占地方
  it('加一个端点排在最后一个端点之后，预设平时不出现', () => {
    arrange(two, { baseUrl: two[0]!.baseUrl, model: 'glm-5.2' })
    const cards = document.querySelectorAll('article')
    const add = screen.getByRole('button', { name: '加一个端点' })
    expect(cards).toHaveLength(2)
    expect(cards[1]!.nextElementSibling).toBe(add)
    expect(screen.queryByRole('button', { name: /^DeepSeek/ })).toBeNull()
  })

  it('点加一个端点才出现预设，选完就收起', async () => {
    arrange(two, { baseUrl: two[0]!.baseUrl, model: 'glm-5.2' })
    await userEvent.click(screen.getByRole('button', { name: '加一个端点' }))
    expect(screen.getByRole('button', { name: /^DeepSeek/ })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^DeepSeek/ }))
    expect(screen.queryByRole('button', { name: /^DeepSeek/ })).toBeNull()
  })

  // 挑选面板是原地展开的，关掉就该原地变回那张「加一个端点」的卡，不是留一片空白
  it('关掉挑选面板，加一个端点的卡片回来', async () => {
    arrange(two, { baseUrl: two[0]!.baseUrl, model: 'glm-5.2' })
    await userEvent.click(screen.getByRole('button', { name: '加一个端点' }))
    expect(screen.queryByRole('button', { name: '加一个端点' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('button', { name: '加一个端点' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^DeepSeek/ })).toBeNull()
  })

  /**
   * 预设给得出地址和模型名，唯独给不出 Key——那是这条端点唯一还缺、又非填不可的东西。
   * 点完预设把卡片收起来，等于把「还差一步」藏进一个看不出还差一步的界面。
   */
  it('点预设后那张卡直接是草稿态，光标就落在 Key 上', async () => {
    arrange([two[0]!], { baseUrl: two[0]!.baseUrl, model: 'glm-5.2' })
    await userEvent.click(screen.getByRole('button', { name: '加一个端点' }))
    await userEvent.click(screen.getByRole('button', { name: /^DeepSeek/ }))

    const keyInput = screen.getByPlaceholderText('API Key')
    expect(keyInput).toBeTruthy()
    expect(document.activeElement).toBe(keyInput)
    // 地址预设已经填好了，不该再让人从头打一遍
    expect((screen.getByPlaceholderText('Base URL') as HTMLInputElement).value)
      .toBe('https://api.deepseek.com/v1')
  })

  // 命中已有端点时卡片不会换 key，光记 key 的话第二次点同一个预设就没反应了
  it('同一个预设连点两次，第二次照样展开成草稿态', async () => {
    arrange([two[0]!], { baseUrl: two[0]!.baseUrl, model: 'glm-5.2' })
    await userEvent.click(screen.getByRole('button', { name: '加一个端点' }))
    await userEvent.click(screen.getByRole('button', { name: /^DeepSeek/ }))
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByPlaceholderText('API Key')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '加一个端点' }))
    await userEvent.click(screen.getByRole('button', { name: /^DeepSeek/ }))
    expect(screen.getByPlaceholderText('API Key')).toBeTruthy()
  })

  it('加一个端点后点自定义，新的那块一进来就是草稿态', async () => {
    arrange(two, { baseUrl: two[0]!.baseUrl, model: 'glm-5.2' })
    await userEvent.click(screen.getByRole('button', { name: '加一个端点' }))
    await userEvent.click(screen.getByRole('button', { name: /^自定义/ }))
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy()
  })

  // 覆盖语义在能存多条的世界里没有意义
  it('点预设是新增一个端点，不是覆盖当前这个', async () => {
    const { setSettings } = arrange([two[0]!], { baseUrl: two[0]!.baseUrl, model: 'glm-5.2' })
    await userEvent.click(screen.getByRole('button', { name: '加一个端点' }))
    await userEvent.click(screen.getByRole('button', { name: /^DeepSeek/ }))

    const saved = lastSaved(setSettings)
    expect(saved.endpoints).toHaveLength(2)
    expect(saved.endpoints[0]!.apiKey).toBe('sk-x')
  })

  // 预设不带 Key，拿它覆盖用户已经填好的那把是纯粹的破坏
  it('预设命中已有端点时只并模型名，Key 一个字都不动', async () => {
    const existing: Endpoint = {
      baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-mine', models: ['deepseek-reasoner'],
    }
    const { setSettings } = arrange([existing], { baseUrl: existing.baseUrl, model: 'deepseek-reasoner' })
    await userEvent.click(screen.getByRole('button', { name: '加一个端点' }))
    await userEvent.click(screen.getByRole('button', { name: /^DeepSeek/ }))

    const saved = lastSaved(setSettings)
    expect(saved.endpoints).toHaveLength(1)
    expect(saved.endpoints[0]!.apiKey).toBe('sk-mine')
    expect(saved.endpoints[0]!.models).toEqual(['deepseek-reasoner', 'deepseek-chat'])
  })


  it('删掉当前在用的那个端点后，active 落到剩下第一条的第一个模型', async () => {
    const { setSettings } = arrange(two, { baseUrl: two[0]!.baseUrl, model: 'glm-5.2' })
    await userEvent.click(screen.getAllByRole('button', { name: '删除端点' })[0]!)

    const saved = lastSaved(setSettings)
    expect(saved.endpoints).toHaveLength(1)
    expect(saved.active).toEqual({ baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' })
  })

  it('删光之后 active 清空，界面回到「还没配」那条路', async () => {
    const { setSettings } = arrange([two[0]!], { baseUrl: two[0]!.baseUrl, model: 'glm-5.2' })
    await userEvent.click(screen.getByRole('button', { name: '删除端点' }))

    const saved = lastSaved(setSettings)
    expect(saved.endpoints).toEqual([])
    expect(saved.active).toEqual({ baseUrl: '', model: '' })
  })

  it('删掉的不是在用的那个时，active 不动', async () => {
    const { setSettings } = arrange(two, { baseUrl: two[0]!.baseUrl, model: 'glm-5.2' })
    await userEvent.click(screen.getAllByRole('button', { name: '删除端点' })[1]!)

    expect(lastSaved(setSettings).active).toEqual({ baseUrl: two[0]!.baseUrl, model: 'glm-5.2' })
  })

  it('点另一个端点里的模型，active 连端点一起换过去', async () => {
    const { setSettings } = arrange(two, { baseUrl: two[0]!.baseUrl, model: 'glm-5.2' })
    await userEvent.click(screen.getByRole('radio', { name: 'qwen2.5' }))

    expect(lastSaved(setSettings).active)
      .toEqual({ baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' })
  })
})
