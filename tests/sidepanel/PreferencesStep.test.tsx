import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreferencesStep } from '@/sidepanel/steps/PreferencesStep'
import { useStore } from '@/sidepanel/store'
import { DEFAULT_SETTINGS, activeLlm } from '@/storage/settings'
import { withLlm } from '../fakes/settings'
import type { OrganizeMode } from '@/core/mode'
import type { BookmarkItem, FolderItem, ScanResult } from '@/core/types'
import type { BookmarkNode } from '@/core/ports'
import type { Endpoint } from '@/storage/settings'

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
      untitledBookmarks: 0, duplicateUrlGroups: 0, duplicateFolderGroups: 0, maxDepth: 0,
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

/**
 * 内容对域名聚合这组用例不重要——模式全靠 modeOverride 钉死，不依赖 detectMode
 * 的阈值。阈值调一下不该让这组无关用例跟着变红（计划 Task 2 Step 7 论证过同一件事，
 * 后台测试已经这么做了，见 handlers.test.ts 的 analyzeWith）。
 */
const anyScan = scanOf([ROOT, folder('10', '目录', '1', 1)], [bookmark('a', '10')])

function setup(scan: ScanResult, modeOverride: OrganizeMode | null = null): void {
  useStore.setState({
    scan,
    settings: { ...DEFAULT_SETTINGS },
    modeOverride,
    busy: null,
    // setSettings 会打 send()，必须替身；setModeOverride 只写 state，用真的那个
    setSettings: vi.fn(async (settings) => { useStore.setState({ settings }) }),
  })
}

// 域名聚合那一组勾选框随 issues/38-source-vs-topic.md 的 D4 删掉了。
// 留一条反向断言：它不该以任何形式再出现在偏好页上。
describe('PreferencesStep 不再有域名聚合', () => {
  beforeEach(() => { setup(anyScan, 'rebuild') })

  it('偏好页上没有域名组的勾选框', () => {
    render(<PreferencesStep />)
    expect(screen.queryByLabelText('GitHub')).toBeNull()
    expect(screen.queryByLabelText('论文')).toBeNull()
  })
})

describe('PreferencesStep 清理空文件夹的说明', () => {
  // 这段说明描述的行为在合并模式下有例外：
  // 源文件夹会被清空删除，而且删不删跟这个开关无关（apply.ts 里是
  // `removeEmptyFolders === true || mergeRootId !== null`）。
  // 界面上唯一一处讲「什么不会被删」的地方说了假话，比不讲更糟。
  async function openCleanDetail(): Promise<HTMLElement> {
    setup(messyScan)
    render(<PreferencesStep />)
    const label = screen.getByText('整理后清理空文件夹').closest('label')
    if (label === null) throw new Error('找不到清理空文件夹那一行')
    await userEvent.click(within(label).getByRole('button', { name: '说明' }))
    return within(label).getByText(/删除范围内不含任何书签的文件夹/)
  }

  it('交代合并时源文件夹会被删除，且不受这个开关约束', async () => {
    const body = await openCleanDetail()
    expect(body.textContent).toMatch(/合并/)
    expect(body.textContent).toMatch(/删除/)
    expect(body.textContent).toMatch(/不受.*开关/)
  })

  it('例外那半句本身要带上「可撤销」——删除很吓人，撤销才是让人敢按的那句', async () => {
    const body = (await openCleanDetail()).textContent ?? ''
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

  it('点了逃生口就按推翻模式渲染', async () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    await userEvent.click(screen.getByRole('button', { name: '不对，重新设计' }))

    expect(useStore.getState().modeOverride).toBe('rebuild')
    // 结论句与理由句里都带着「重新设计整棵目录树」这半句，用 getAllByText 而不是 getByText——
    // 两处都命中才是对的，getByText 在这里天然会因多重匹配而炸
    expect(screen.getAllByText(/重新设计整棵目录树/).length).toBeGreaterThan(0)
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
    // 空断言防身：先证明这一页真渲染了、而且按钮名查询在这一页上确实命中得了东西，
    // 否则「查不到逃生口」可能只是查错了地方
    expect(screen.getAllByText(/重新设计整棵目录树/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '返回' })).toBeTruthy()

    expect(screen.queryByRole('button', { name: '不对，重新设计' })).toBeNull()
  })

  it('统计表里列出重名目录', () => {
    setup(tidyScan)
    render(<PreferencesStep />)
    expect(screen.getByText('重名目录')).toBeTruthy()
  })
})

/**
 * 模型配置与「统一 GitHub 标题」搬进设置页之后的反向守卫：偏好页只留每轮会变的东西。
 *
 * queryBy... 为 null 的断言天生可疑——它绿着，你分不清是真的搬走了，还是查错了地方，
 * 又或者组件压根没渲染（scan 为 null 时 PreferencesStep 直接 return null，那时查什么都是 null）。
 * 所以每条都先断言一件「搬迁之后仍然留在偏好页上」的东西确实查得到，
 * 证明这一页真渲染出来了、这类查询在这一页上确实能命中，再去断言搬走的那些查不到。
 */
describe('PreferencesStep 不再摆配一次就不动的设置', () => {
  beforeEach(() => { setup(messyScan) })

  it('模型配置整段都不在偏好页上——它是配一次就不动的，属于设置页', () => {
    render(<PreferencesStep />)
    // 空断言防身：这一页确实渲染出内容了
    expect(screen.getByText('整理后清理空文件夹')).toBeTruthy()

    expect(screen.queryByPlaceholderText('Base URL')).toBeNull()
    expect(screen.queryByPlaceholderText('API Key')).toBeNull()
    expect(screen.queryByPlaceholderText('Model')).toBeNull()
    expect(screen.queryByRole('button', { name: 'DeepSeek' })).toBeNull()
    expect(screen.queryByText(/API Key 明文保存在本地浏览器存储中/)).toBeNull()
  })

  it('统一 GitHub 标题的开关不在偏好页上——它改的是书签标题，不是这一轮怎么整理', () => {
    render(<PreferencesStep />)
    // 空断言防身：这一页上确实还渲染着别的勾选框，
    // 所以下面那条 null 不是因为查询本身在这一页上什么都查不到
    // （原来拿域名聚合那组的 label 当锚点，它随 issues/38 的 D4 删掉了）
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)

    expect(screen.queryByLabelText(/统一 GitHub 书签标题/)).toBeNull()
    expect(screen.queryByText(/仓库名 \(作者\)/)).toBeNull()
  })
})

/**
 * 模型配置搬进设置页之后，这一页的「开始」按钮是新用户唯一会撞上的墙。
 * 禁用的按钮既不解释为什么、也不给出路，所以没配 Key 时它换成一个能点、点了有去处的按钮。
 */
describe('PreferencesStep 没配模型时的出路', () => {
  function arrange(
    apiKey: string,
    baseUrl: string = activeLlm(DEFAULT_SETTINGS).baseUrl,
  ): { analyze: ReturnType<typeof vi.fn>; openSettings: ReturnType<typeof vi.fn> } {
    setup(messyScan)
    const analyze = vi.fn(async () => {})
    const openSettings = vi.fn()
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, ...withLlm({ ...activeLlm(DEFAULT_SETTINGS), apiKey, baseUrl }) },
      analyze, openSettings,
    })
    return { analyze, openSettings }
  }

  it('apiKey 为空时按钮能点，点了去设置页而不是开始分析', async () => {
    const { analyze, openSettings } = arrange('')
    render(<PreferencesStep />)

    const button = screen.getByRole('button', { name: '先去配置模型' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)

    await userEvent.click(button)
    expect(openSettings).toHaveBeenCalledTimes(1)
    expect(analyze).not.toHaveBeenCalled()
  })

  it('apiKey 为空时不摆「开始 AI 分析」——那一步这会儿走不通', () => {
    arrange('')
    render(<PreferencesStep />)
    // 空断言防身：先证明这一页渲染出来了、这类查询在这一页上确实命中得了按钮
    expect(screen.getByRole('button', { name: '先去配置模型' })).toBeTruthy()

    expect(screen.queryByRole('button', { name: '开始 AI 分析' })).toBeNull()
  })

  it('apiKey 非空时才是「开始 AI 分析」，点了真的开始分析', async () => {
    const { analyze, openSettings } = arrange('sk-already-configured')
    render(<PreferencesStep />)

    const button = screen.getByRole('button', { name: '开始 AI 分析' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)

    await userEvent.click(button)
    expect(analyze).toHaveBeenCalledTimes(1)
    expect(openSettings).not.toHaveBeenCalled()
  })

  it('apiKey 非空时不再摆「先去配置模型」', () => {
    arrange('sk-already-configured')
    render(<PreferencesStep />)
    // 空断言防身：同上，这一页上按钮名查询确实能命中
    expect(screen.getByRole('button', { name: '开始 AI 分析' })).toBeTruthy()

    expect(screen.queryByRole('button', { name: '先去配置模型' })).toBeNull()
  })

  it('本机 Ollama：apiKey 空着也该拿到「开始 AI 分析」，点了真的开始分析', async () => {
    // 设置页点一下「本地 Ollama」预设之后就是这个状态：baseUrl 换了，apiKey 一个字没填。
    // 只认 apiKey 的话这里给的是「先去配置模型」，点它回到他刚配完的设置页——死循环
    const { analyze, openSettings } = arrange('', 'http://localhost:11434/v1')
    render(<PreferencesStep />)

    const button = screen.getByRole('button', { name: '开始 AI 分析' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(screen.queryByRole('button', { name: '先去配置模型' })).toBeNull()

    await userEvent.click(button)
    expect(analyze).toHaveBeenCalledTimes(1)
    expect(openSettings).not.toHaveBeenCalled()
  })

  it('分析在跑时「开始 AI 分析」照旧禁用', () => {
    arrange('sk-already-configured')
    useStore.setState({ busy: '分析中…' })
    render(<PreferencesStep />)
    expect((screen.getByRole('button', { name: '开始 AI 分析' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('已配好时写出当前模型名——设置藏在齿轮后面，点开始前得看见即将用哪一个', () => {
    arrange('sk-already-configured')
    useStore.setState({
      settings: {
        ...useStore.getState().settings,
        ...withLlm({ ...activeLlm(useStore.getState().settings), model: 'deepseek-chat' }),
      },
    })
    render(<PreferencesStep />)
    // 空断言防身：这一页是「开始 AI 分析」那个分支，不是「先去配置」
    expect(screen.getByRole('button', { name: '开始 AI 分析' })).toBeTruthy()
    expect(screen.getByText(/deepseek-chat/)).toBeTruthy()
  })

  it('还没配时提醒还未配置，且不把默认模型名摆出来冒充已选', () => {
    arrange('')
    render(<PreferencesStep />)
    expect(screen.getByRole('button', { name: '先去配置模型' })).toBeTruthy()
    expect(screen.getByText('还没配置模型')).toBeTruthy()
    expect(screen.queryByText(/gpt-4o-mini/)).toBeNull()
  })
})

/**
 * 预告是无条件渲染的，两种按钮状态下都摆着。两条用例分别钉住一种状态——
 * 只守「没配模型」那一种的话，把这段挪进 needModel 分支照样全绿，而那个挪法恰好把
 * 预告从唯一真正需要它的人眼前拿走：权限弹窗只在已经配好、点下「开始 AI 分析」的
 * 那一刻才会出现。
 */
describe('PreferencesStep 的权限预告', () => {
  it('提前说明那一刻会申请哪一个域名的访问权限', () => {
    setup(messyScan)
    render(<PreferencesStep />)
    // 前提：这一条守的是「还没配模型」那个分支
    expect(screen.getByRole('button', { name: '先去配置模型' })).toBeTruthy()

    // 文案改写后不再说「只这一个」——本地清理的失效链接检查另要一项权限，
    // 这条承诺不再是全局唯一的，改按「才会向浏览器申请访问你填的那个模型域名」定位
    const notice = screen.getByText(/才会向浏览器申请访问你填的那个模型域名/)
    expect(notice.textContent).toMatch(/模型/)
    // 关键在「只申请你填的那一个」和「安装时一个都没要」——这是卖点，不是免责声明
    expect(notice.textContent).toMatch(/安装时/)
  })

  it('已经配好模型时照样摆着——真会撞上那个权限弹窗的恰恰是他', () => {
    setup(messyScan)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, ...withLlm({ ...activeLlm(DEFAULT_SETTINGS), apiKey: 'sk-already-configured' }) },
    })
    render(<PreferencesStep />)
    // 前提：这一条守的是「已经配好」那个分支，按钮得真是「开始 AI 分析」
    expect(screen.getByRole('button', { name: '开始 AI 分析' })).toBeTruthy()

    // 文案改写后不再说「只这一个」——本地清理的失效链接检查另要一项权限，
    // 这条承诺不再是全局唯一的，改按「才会向浏览器申请访问你填的那个模型域名」定位
    const notice = screen.getByText(/才会向浏览器申请访问你填的那个模型域名/)
    expect(notice.textContent).toMatch(/模型/)
    expect(notice.textContent).toMatch(/安装时/)
  })
})

/**
 * 扫完范围进偏好页，人已经看不见自己勾了哪几个目录。
 * 扫描结果卡要把路径摆出来，而且是 /书签栏/react/ 这种写法——
 * 只报「react」会跟别处同名目录撞车。
 */
describe('PreferencesStep 显示当前选择的文件夹', () => {
  const tree: BookmarkNode[] = [
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: 'react', children: [] },
        { id: '11', title: '杂项', children: [] },
      ]},
    ]},
  ]

  it('把勾中的深层目录画成 /父/子/ 路径', () => {
    setup(anyScan)
    useStore.setState({ tree, checkedIds: new Set(['10']) })
    render(<PreferencesStep />)
    expect(screen.getByText('/书签栏/react/')).toBeTruthy()
  })

  it('级联勾选只显示真正的范围根', () => {
    setup(anyScan)
    useStore.setState({ tree, checkedIds: new Set(['1', '10', '11']) })
    render(<PreferencesStep />)
    expect(screen.getByText('/书签栏/')).toBeTruthy()
    expect(screen.queryByText('/书签栏/react/')).toBeNull()
  })
})

describe('偏好页的模型下拉', () => {
  const opencode: Endpoint = {
    baseUrl: 'https://opencode.ai/zen/go/v1',
    apiKey: 'sk-x',
    models: ['glm-5.2', 'deepseek-v4-flash'],
  }
  const ollama: Endpoint = { baseUrl: 'http://localhost:11434/v1', apiKey: '', models: ['qwen2.5'] }
  const unconfigured: Endpoint = {
    baseUrl: 'https://api.openai.com/v1', apiKey: '', models: ['gpt-4o-mini'],
  }
  const value = (baseUrl: string, model: string): string => `${baseUrl}\u0000${model}`

  function arrange(endpoints: Endpoint[], active: { baseUrl: string; model: string }) {
    setup(messyScan)
    const openSettings = vi.fn()
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, endpoints, active }, openSettings })
    return { openSettings }
  }

  const picker = () => screen.getByRole('combobox', { name: '将使用' }) as HTMLSelectElement

  it('列出所有可用的「端点 × 模型」，当前那一对是选中项', () => {
    arrange([opencode, ollama], { baseUrl: opencode.baseUrl, model: 'glm-5.2' })
    render(<PreferencesStep />)

    expect([...picker().options].map((o) => o.textContent)).toEqual([
      'glm-5.2 · opencode.ai',
      'deepseek-v4-flash · opencode.ai',
      'qwen2.5 · localhost:11434',
      '在设置页填别的…',
    ])
    expect(picker().value).toBe(value(opencode.baseUrl, 'glm-5.2'))
  })

  // 列出一个用不了的组合是陷阱：选中它这一页立刻翻成「还没配置模型」，
  // 用户得自己想明白刚才那一下干了什么
  it('还没填 Key 的远程端点不进名单', () => {
    arrange([opencode, unconfigured], { baseUrl: opencode.baseUrl, model: 'glm-5.2' })
    render(<PreferencesStep />)

    expect([...picker().options].map((o) => o.textContent))
      .not.toContain('gpt-4o-mini · api.openai.com')
  })

  // 本机端点空 Key 是正常的，那条路 README 明确支持
  it('本机端点空 Key 照样进名单', () => {
    arrange([ollama], { baseUrl: ollama.baseUrl, model: 'qwen2.5' })
    render(<PreferencesStep />)

    expect([...picker().options].map((o) => o.textContent)).toContain('qwen2.5 · localhost:11434')
  })

  it('切到另一个端点的模型，active 连端点一起换过去', async () => {
    arrange([opencode, ollama], { baseUrl: opencode.baseUrl, model: 'glm-5.2' })
    render(<PreferencesStep />)

    await userEvent.selectOptions(picker(), value(ollama.baseUrl, 'qwen2.5'))
    expect(useStore.getState().settings.active)
      .toEqual({ baseUrl: ollama.baseUrl, model: 'qwen2.5' })
  })

  it('选「在设置页填别的…」时开设置页，active 一个字都不改', async () => {
    const { openSettings } = arrange([opencode], { baseUrl: opencode.baseUrl, model: 'glm-5.2' })
    render(<PreferencesStep />)

    await userEvent.selectOptions(picker(), '::open-settings')
    expect(openSettings).toHaveBeenCalledTimes(1)
    expect(useStore.getState().settings.active.model).toBe('glm-5.2')
  })

  it('一个可用的都没有时不摆下拉，整页走「还没配置模型」', () => {
    arrange([unconfigured], { baseUrl: unconfigured.baseUrl, model: 'gpt-4o-mini' })
    render(<PreferencesStep />)
    // 空断言防身：先证明这一页确实渲染在「还没配」那个分支上
    expect(screen.getByRole('button', { name: '先去配置模型' })).toBeTruthy()

    expect(screen.queryByRole('combobox', { name: '将使用' })).toBeNull()
  })
})
