import { afterEach, describe, it, expect, vi } from 'vitest'
import { handle, deepenBudget } from '@/background/handlers'
import { createFakeBookmarks, type TreeSpec } from '../fakes/fake-bookmarks'
import { createFakeHistory } from '../fakes/fake-history'
import { createFakeStorage } from '../fakes/fake-storage'
import { DEFAULT_SETTINGS, SETTINGS_KEY, activeLlm, loadCache, saveSettings, type Settings } from '@/storage/settings'
import { currentLocale, setLocale } from '@/i18n'
import { withLlm } from '../fakes/settings'
import { LlmError, type LlmClient } from '@/llm/client'
import type { OrganizePlan } from '@/core/types'
import type { ProgressEvent } from '@/background/events'
import { MAX_SIBLINGS, stripNumberPrefix } from '@/core/tree'
import type { OrganizeMode } from '@/core/mode'

const tree = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'react', children: [] },
      { id: '11', title: '杂项', children: [
        { id: '100', title: 'React 官网', url: 'https://react.dev' },
      ]},
    ]},
  ]},
]

/**
 * 推翻模式专用夹具。共享的 `tree` 只有 1 个书签，而目录下限已经是恒为 3 的内部常量
 * （core/prune.ts 的 MIN_FOLDER_BOOKMARKS），1 条书签一个目录都建不出来——那样下面几条
 * 用例验的「标签→建树→分类」「目录设计跑没跑」全都无从谈起。所以把书签喂到 3 条，
 * 让目录真的立得住，用例验的仍是原来那件事。
 */
const rebuildTree = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'react', children: [] },
      { id: '11', title: '杂项', children: [
        { id: '100', title: 'React 官网', url: 'https://react.dev' },
        { id: '101', title: 'Vite 官网', url: 'https://vite.dev' },
        { id: '102', title: 'Vitest 官网', url: 'https://vitest.dev' },
      ]},
    ]},
  ]},
]

const REBUILD_IDS = ['100', '101', '102']

function setup(client?: LlmClient) {
  const fake = createFakeBookmarks(tree)
  const ports = { bookmarks: fake.api, storage: createFakeStorage() }
  const deps = { createClient: () => client ?? { complete: vi.fn().mockResolvedValue({ results: [] }) }, now: () => 1 }
  return { fake, ports, deps }
}

describe('handle', () => {
  it('get_tree 返回完整书签树', async () => {
    const { ports, deps } = setup()
    const res = await handle(ports, { kind: 'get_tree' }, deps)
    expect(res).toMatchObject({ ok: true, kind: 'get_tree' })
    expect((res as { tree: unknown[] }).tree).toHaveLength(1)
  })

  it('scan 只统计范围内的书签', async () => {
    const { ports, deps } = setup()
    const res = await handle(ports, { kind: 'scan', scopeRootIds: ['1'] }, deps) as { scan: { stats: { totalBookmarks: number } } }
    expect(res.scan.stats.totalBookmarks).toBe(1)
  })

  it('analyze 在未配置 API Key 时报错', async () => {
    const { ports, deps } = setup()
    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps)
    expect(res).toMatchObject({ ok: false })
    expect((res as { error: string }).error).toContain('API Key')
  })

  it('analyze 在 baseUrl 指向本机时放行空 Key——本机 Ollama 不校验 Key，那道门不该拦他', async () => {
    const { ports, deps } = setup()
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen2.5' }),
    })
    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps)
    // 不断言 ok:true——那要整条分析链路都跑通，跟这道守卫是两件事。要守住的是
    // 「不再被『没有 Key』当场拒掉」
    expect((res as { error?: string }).error ?? '').not.toContain('API Key')

    // 对照：同一份夹具、同样空 Key，只把 baseUrl 换成远程厂商，那道门立刻就拒——
    // 证明上面那条不是因为压根没走到这道门才绿的
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' }),
    })
    const remote = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps)
    expect((remote as { error: string }).error).toContain('API Key')
  })

  it('analyze 返回可 Review 的 Plan', async () => {
    const { ports, deps } = setup({
      complete: vi.fn().mockResolvedValue({
        results: [{ bookmark_id: '100', target_category_id: '10', confidence: 0.9, reason: 'React 官网' }],
      }),
    })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps) as { plan: { rows: unknown[] } }
    expect(res.plan.rows).toHaveLength(1)
  })

  it('范围内有重名目录时说一声——不然用户不知道有一批目录没进候选', async () => {
    const classifyPrompts: string[] = []
    const complete = vi.fn(async (prompt: string) => {
      const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
      if (prompt.includes('候选目录')) {
        classifyPrompts.push(prompt)
        const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)].map((m) => m[1]!)
        return { results: bookmarkIds.map((id) => (
          { bookmark_id: id, target_category_id: ids[0] ?? null, confidence: 0.9, reason: 'r' }
        ))}
      }
      return { results: bookmarkIds.map((id) => (
        { bookmark_id: id, primary_topic: '前端', secondary_topic: null }
      ))}
    })
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: '01 GitHub', children: [
            { id: 'a0', title: '书签 a0', url: 'https://a0.dev' },
            { id: 'a1', title: '书签 a1', url: 'https://a1.dev' },
            { id: 'a2', title: '书签 a2', url: 'https://a2.dev' },
          ]},
          { id: '11', title: '01 GitHub', children: [] },
        ]},
      ]},
    ])
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    })
    const events: ProgressEvent[] = []
    await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' },
      { createClient: () => ({ complete }), now: () => 1, onEvent: (e) => events.push(e) },
    )

    expect(events.some((e) => e.message.includes('重名'))).toBe(true)
    // 光有日志不够——真正要守住的是模型只会收到一行候选，不是两个 id=10/id=11
    // 都发过去让它随机挑（这才是这次改动的全部目的，删掉去重闸门这条要变红）。
    // 只数候选清单那几行（`- id=… 目录=…`），不数书签自带的 current_folder 字段——
    // 后者本来就会给每个躺在 01 GitHub 里的书签各印一遍「书签栏 / 01 GitHub」，
    // 跟候选去重与否无关，混进来数会把断言废掉。
    expect(classifyPrompts).toHaveLength(1)
    const catalogLines = [...classifyPrompts[0]!.matchAll(/^- id=(\S+) 目录=(.+)$/gm)]
    expect(catalogLines.filter((m) => m[2] === '书签栏 / 01 GitHub')).toHaveLength(1)
  })

  it('apply 执行 Plan 并返回结果', async () => {
    const { ports, deps, fake } = setup({
      complete: vi.fn().mockResolvedValue({
        results: [{ bookmark_id: '100', target_category_id: '10', confidence: 0.9, reason: 'r' }],
      }),
    })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    const analyzed = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps) as { plan: { rows: Array<{ bookmarkId: string }> } }
    const res = await handle(
      ports,
      { kind: 'apply', plan: analyzed.plan as never, accepted: ['100'] },
      deps,
    )
    expect(res).toMatchObject({ ok: true, kind: 'apply' })
    expect(fake.structure()).toContain('书签栏/react/React 官网')
  })

  it('apply 按设置清理搬空的目录，撤销后目录回来', async () => {
    const { ports, deps, fake } = setup({
      complete: vi.fn().mockResolvedValue({
        results: [{ bookmark_id: '100', target_category_id: '10', confidence: 0.9, reason: 'r' }],
      }),
    })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: true,
      rewriteGithubTitles: false,
    })
    const analyzed = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps) as { plan: unknown }
    const res = await handle(
      ports,
      { kind: 'apply', plan: analyzed.plan as never, accepted: ['100'] },
      deps,
    ) as { result: { removedFolders: Array<{ title: string }> } }

    expect(res.result.removedFolders.map((f) => f.title)).toEqual(['杂项'])
    expect(fake.structure()).not.toContain('杂项')

    await handle(ports, { kind: 'undo' }, deps)
    expect(fake.structure()).toContain('书签栏/杂项/React 官网')
  })

  it('get_undo_state 在无快照时返回不可撤销', async () => {
    const { ports, deps } = setup()
    const res = await handle(ports, { kind: 'get_undo_state' }, deps)
    expect(res).toMatchObject({ ok: true, available: false, createdAt: null })
  })

  it('设置可保存并读回', async () => {
    const { ports, deps } = setup()
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-d', model: 'deepseek-chat' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    }
    await handle(ports, { kind: 'save_settings', settings }, deps)
    const res = await handle(ports, { kind: 'get_settings' }, deps) as { settings: typeof settings }
    expect(activeLlm(res.settings).model).toBe('deepseek-chat')
  })

  it('处理器内部抛错时转成 ok:false 而不是崩溃', async () => {
    const { ports, deps } = setup()
    ports.bookmarks = {
      ...ports.bookmarks,
      getTree: async () => { throw new Error('boom') },
    }
    const res = await handle(ports, { kind: 'get_tree' }, deps)
    expect(res).toMatchObject({ ok: false })
    expect((res as { error: string }).error).toContain('boom')
  })

  it('推翻模式下先抽标签建树，再把书签分到新目录', async () => {
    // 这条验的是「标签 -> 建树 -> 分类」这条链路本身，用 rebuildTree（3 条书签）
    // 让「前端」这个目录真的撑得过下限
    const fake = createFakeBookmarks(rebuildTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    const complete = vi.fn()
      .mockResolvedValueOnce({ results: REBUILD_IDS.map((id) => (
        { bookmark_id: id, primary_topic: '前端', secondary_topic: 'React' }
      ))})
      .mockResolvedValueOnce({ folders: [{ title: '前端', topics: ['前端'], children: [] }] })
      .mockResolvedValueOnce({ results: REBUILD_IDS.map((id) => (
        { bookmark_id: id, target_category_id: 'tmp:1', confidence: 0.9, reason: 'r' }
      ))})
    const deps = { createClient: () => ({ complete }), now: () => 1 }

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps) as { plan: { operations: Array<{ type: string }> } }
    expect(complete).toHaveBeenCalledTimes(3)
    expect(res.plan.operations.some((o) => o.type === 'create_folder')).toBe(true)
  })

  // review M9：非推翻模式新加的「无归属带回 topic」规则不该悄悄改变推翻模式的分类
  // 提示词——推翻模式的候选是刚设计出来的，用不上这条规则，而推翻模式的分类稳定性
  // 正是这整个工作流存在的理由，提示词不该因为一个它用不上的功能而发生任何变化。
  it('推翻模式下发给模型的分类提示词不带 topic 规则——那条只有非推翻模式用得上', async () => {
    // 同上：换 rebuildTree（3 条书签），目录立得住才走得到分类那一轮
    const fake = createFakeBookmarks(rebuildTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    const classifyPrompts: string[] = []
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.includes('候选目录：')) {
        classifyPrompts.push(prompt)
        return { results: REBUILD_IDS.map((id) => (
          { bookmark_id: id, target_category_id: 'tmp:1', confidence: 0.9, reason: 'r' }
        ))}
      }
      if (prompt.includes('标签清单：')) return { folders: [{ title: '前端', topics: ['前端'], children: [] }] }
      return { results: REBUILD_IDS.map((id) => (
        { bookmark_id: id, primary_topic: '前端', secondary_topic: 'React' }
      ))}
    })
    const deps = { createClient: () => ({ complete }), now: () => 1 }

    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps)
    expect(classifyPrompts).toHaveLength(1)
    expect(classifyPrompts[0]).not.toContain('topic')
  })

  // 「一级目录上限从设置里读」这条旧用例随本任务删掉：一级目录数改由书签总数推导，
  // settings.maxTopFolders 在推翻这条路上已经不再被读取，等价覆盖见下面
  // 「analyze 的目录形状由书签数推导」这个 describe 块。

  // 标题曾经是「嵌套上限设成 1 时，目录设计提示词要求只输出一层」——那时候
  // maxFolderDepth 还管这件事。现在层数只看书签量：这里的夹具只有 1 个书签，
  // 无论 maxFolderDepth 填几都只会推导出一层，下面这个断言能过纯属巧合，
  // 不是 maxFolderDepth 在起作用（真要验证「设置被忽略」见下面
  // 「analyze 的目录形状由书签数推导」describe 块里专门的用例）
  it('单书签场景本就撑不起两层，提示词要求只输出一层（与存量里的 maxFolderDepth 无关，巧合通过）', async () => {
    const { ports } = setup()
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    }
    await saveSettings(ports, settings)
    // maxFolderDepth 已不是设置字段，只能从存储那一侧模拟老用户的存量值
    await ports.storage.set(SETTINGS_KEY, { ...settings, maxFolderDepth: 1 })
    const complete = vi.fn()
      .mockResolvedValueOnce({ results: [{ bookmark_id: '100', primary_topic: '前端' }] })
      .mockResolvedValueOnce({ folders: [{ title: '前端', topics: ['前端'], children: [] }] })
      .mockResolvedValueOnce({ results: [{ bookmark_id: '100', target_category_id: 'tmp:1', confidence: 0.9, reason: 'r' }] })
    const deps = { createClient: () => ({ complete }), now: () => 1 }

    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps)
    const prompts = complete.mock.calls.map((c) => c[0] as string)
    expect(prompts.some((prompt) => prompt.includes('children 一律返回空数组'))).toBe(true)
  })

  it('推翻模式重复整理时复用已有目录，不再新建同名目录', async () => {
    const bookmarks = Array.from({ length: 6 }, (_, i) => ({
      id: `10${i}`, title: `站点${i}`, url: `https://site${i}.dev`,
    }))
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [{ id: '11', title: '杂项', children: bookmarks }] },
      ]},
    ])
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })

    // 标签固定为「前端」，分类时从 prompt 里读出「前端」目录的真实 id
    const complete = vi.fn(async (prompt: string) => {
      const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)]
      if (ids.length === 0) {
        return { results: bookmarks.map((b) => ({ bookmark_id: b.id, primary_topic: '前端', secondary_topic: null })) }
      }
      const target = ids.find((m) => m[2]!.includes('前端'))![1]!
      return {
        results: bookmarks.map((b) => ({
          bookmark_id: b.id, target_category_id: target, confidence: 0.9, reason: 'r',
        })),
      }
    })
    const deps = { createClient: () => ({ complete }), now: () => 1 }

    const first = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps) as {
      plan: { operations: Array<{ type: string; title?: string }> }
    }
    await handle(
      ports,
      { kind: 'apply', plan: first.plan as never, accepted: bookmarks.map((b) => b.id) },
      deps,
    )
    expect(fake.structure()).toContain('书签栏/01 前端/站点0')

    const second = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps) as {
      plan: { operations: Array<{ type: string; title?: string }>; rows: unknown[] }
    }
    const created = second.plan.operations
      .filter((o) => o.type === 'create_folder')
      .map((o) => o.title)
    expect(created).not.toContain('01 前端')
    // 书签已经在正确目录里，第二次整理无事可做
    expect(second.plan.rows).toHaveLength(0)
  })

  it('analyze 在建树前先做一次全局目录设计', async () => {
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.includes('抽取一个具体主题')) {
        return { results: REBUILD_IDS.map((id) => ({ bookmark_id: id, primary_topic: 'React 生态' })) }
      }
      if (prompt.includes('设计目录结构')) {
        return { folders: [{ title: '前端框架', topics: ['React 生态'], children: [] }] }
      }
      return { results: REBUILD_IDS.map((id) => (
        { bookmark_id: id, target_category_id: 'tmp:1', confidence: 0.9, reason: 'r' }
      ))}
    })
    // 这条验的是全局目录设计有没有跑，不是目录该不该建——换 rebuildTree（3 条书签），
    // 让设计出来的「前端框架」撑得过目录下限，断言才落得到实处
    const fake = createFakeBookmarks(rebuildTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const deps = { createClient: () => ({ complete }), now: () => 1 }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps) as { plan: OrganizePlan }
    const tops = res.plan.candidates.filter((c) => c.path.length === 1).map((c) => c.path[0]!)
    expect(tops).toContain('01 前端框架')
    expect(res.plan.tags[0]!.primaryTopic).toBe('前端框架')
  })

  it('目录设计失败时整次分析仍然完成，退回原始标签', async () => {
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.includes('抽取一个具体主题')) {
        return { results: [{ bookmark_id: '100', primary_topic: 'React 生态' }] }
      }
      if (prompt.includes('设计目录结构')) {
        throw Object.assign(new Error('boom'), { retryable: false })
      }
      return { results: [{ bookmark_id: '100', target_category_id: 'tmp:1', confidence: 0.9, reason: 'r' }] }
    })
    const { ports, deps } = setup({ complete })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps)
    expect(res).toMatchObject({ ok: true })
    expect((res as { plan: OrganizePlan }).plan.tags[0]!.primaryTopic).toBe('React 生态')
  })

  it('分析过程中推送阶段进度与批次日志', async () => {
    const bookmarks = Array.from({ length: 3 }, (_, i) => ({
      id: `10${i}`, title: `站点${i}`, url: `https://site${i}.dev`,
    }))
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: 'react', children: [] },
          { id: '11', title: '杂项', children: bookmarks },
        ]},
      ]},
    ])
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    const events: ProgressEvent[] = []
    const complete = vi.fn().mockResolvedValue({
      results: bookmarks.map((b) => ({
        bookmark_id: b.id, target_category_id: '10', confidence: 0.9, reason: 'r',
      })),
    })
    const deps = {
      createClient: () => ({ complete }), now: () => 1, batchSize: 2,
      onEvent: (event: ProgressEvent) => events.push(event),
    }

    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps)

    // 进度事件按批推进，最后一条覆盖全部书签
    const progress = events.filter((e) => e.message === '' && e.phase === 'classify')
    expect(progress.at(-1)).toMatchObject({ done: 3, total: 3 })
    // 每批都有一行日志
    const batchLogs = events.filter((e) => e.message.startsWith('分类批次'))
    expect(batchLogs).toHaveLength(2)
    expect(events.at(-1)!.message).toContain('分析完成')
  })

  it('批次失败时推送 error 级别的日志', async () => {
    const { ports } = setup()
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    const events: ProgressEvent[] = []
    const complete = vi.fn().mockRejectedValue(
      Object.assign(new Error('模型接口返回 400'), { retryable: false }),
    )
    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, {
      createClient: () => ({ complete }), now: () => 1,
      onEvent: (event: ProgressEvent) => events.push(event),
    })

    const errors = events.filter((e) => e.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('400')
  })

  it('取消后停止分析并返回 cancelled 标记', async () => {
    const bookmarks = Array.from({ length: 6 }, (_, i) => ({
      id: `10${i}`, title: `站点${i}`, url: `https://site${i}.dev`,
    }))
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: 'react', children: [] },
          { id: '11', title: '杂项', children: bookmarks },
        ]},
      ]},
    ])
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    let cancelled = false
    const complete = vi.fn().mockImplementation(async () => {
      cancelled = true // 第一批返回后用户点了取消
      return { results: [] }
    })

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, {
      createClient: () => ({ complete }), now: () => 1, batchSize: 1,
      isCancelled: () => cancelled,
    })

    expect(res).toMatchObject({ ok: false, cancelled: true })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('取消前已完成的批次写进缓存，重来时不必再花钱', async () => {
    const { ports } = setup()
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    let cancelled = false
    const complete = vi.fn().mockImplementation(async () => {
      cancelled = true
      return {
        results: [{ bookmark_id: '100', target_category_id: '10', confidence: 0.9, reason: 'r' }],
      }
    })
    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, {
      createClient: () => ({ complete }), now: () => 1, isCancelled: () => cancelled,
    })
    expect(await loadCache(ports)).not.toEqual(new Map())
  })

  it('模型全部失败时返回 ok:false 并带上真实错误，而不是伪装成 0 条建议', async () => {
    const { ports, fake } = setup()
    void fake
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    const complete = vi.fn().mockRejectedValue(
      Object.assign(new Error('模型接口返回 400: This response_format type is unavailable now'), {
        retryable: false,
      }),
    )
    const deps = { createClient: () => ({ complete }), now: () => 1 }

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps)
    expect(res.ok).toBe(false)
    expect((res as { error: string }).error).toContain('response_format')
  })

  // review M2：homelessCount 曾经把请求失败落下的 source: 'none' 也数进「放不进已有
  // 目录」，一批彻底失败时会在真正的错误前面先打一行误导性的日志。这里验部分失败：
  // 3 条模型真判了「无合适目录」，1 条是请求失败，日志只该数前者。
  it('部分批次请求失败时，新目录日志只数模型真正判定的「无处可去」，失败的那条不算', async () => {
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: 'react', children: [] },
          { id: '100', title: '语音合成教程 A', url: 'https://a.dev' },
          { id: '101', title: '语音合成教程 B', url: 'https://b.dev' },
          { id: '102', title: '语音合成教程 C', url: 'https://c.dev' },
          { id: '103', title: '某书签', url: 'https://d.dev' },
        ]},
      ]},
    ])
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    // 批次并发派发，谁先到达 complete() 顺序不定，按 prompt 里的 bookmark_id 路由
    // 而不是按调用顺序写死，才不会因为并发调度偶发翻车
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.includes('将为它们新建目录')) return { names: [{ key: '语音合成', name: '语音与音频' }] }
      if (prompt.includes('"103"')) throw Object.assign(new Error('boom'), { retryable: false })
      const id = /"bookmark_id": "(\d+)"/.exec(prompt)![1]!
      return { results: [{ bookmark_id: id, target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成' }] }
    })
    const events: ProgressEvent[] = []
    const deps = {
      createClient: () => ({ complete }), now: () => 1, batchSize: 1,
      onEvent: (event: ProgressEvent) => events.push(event),
    }

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps) as { ok: boolean; plan: OrganizePlan }
    expect(res.ok).toBe(true)
    const startLog = events.find((e) => e.message.includes('正在为它们起名'))
    expect(startLog?.message).toMatch(/^3 /)
    expect(res.plan.operations.filter((o) => o.type === 'create_folder')).toHaveLength(1)
  })

  // review M4：超过同层上限（MAX_SIBLINGS）被压下的主题此前完全沉默，用户
  // 看不出「怎么少了几个目录」。这里造 15 个都够格的主题，验证只建 12 个、
  // 剩下 3 个被压下时记了一条日志。
  it('簇数超过同层上限时记一条日志，说明有几个主题被压下、没建目录', async () => {
    const bookmarks = []
    for (let c = 0; c < 15; c++) {
      for (let i = 0; i < 3; i++) {
        bookmarks.push({ id: `${c}-${i}`, title: `书签${c}-${i}`, url: `https://x${c}-${i}.dev` })
      }
    }
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: 'react', children: [] },
          ...bookmarks,
        ]},
      ]},
    ])
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.includes('将为它们新建目录')) {
        const keys = [...prompt.matchAll(/"key": "([^"]+)"/g)].map((m) => m[1]!)
        return { names: keys.map((key) => ({ key, name: `主题${key}` })) }
      }
      const ids = [...prompt.matchAll(/"bookmark_id": "(\d+-\d+)"/g)].map((m) => m[1]!)
      return {
        results: ids.map((id) => ({
          bookmark_id: id, target_category_id: null, confidence: 0.2, reason: '无合适目录',
          topic: `T${id.split('-')[0]}`,
        })),
      }
    })
    const events: ProgressEvent[] = []
    const deps = {
      createClient: () => ({ complete }), now: () => 1,
      onEvent: (event: ProgressEvent) => events.push(event),
    }

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps) as { ok: boolean; plan: OrganizePlan }
    expect(res.ok).toBe(true)
    expect(res.plan.operations.filter((o) => o.type === 'create_folder')).toHaveLength(MAX_SIBLINGS)
    const cappedLog = events.find((e) => e.message.includes('超出同层上限'))
    expect(cappedLog?.message).toMatch(/^3 /)
  })

  it('部分书签分类失败时仍返回 Plan，但带上警告', async () => {
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: 'react', children: [] },
          { id: '11', title: '杂项', children: [
            { id: '100', title: 'React 官网', url: 'https://react.dev' },
            { id: '101', title: '另一个', url: 'https://other.dev' },
          ]},
        ]},
      ]},
    ])
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    // 第一批成功、第二批失败
    const complete = vi.fn()
      .mockResolvedValueOnce({
        results: [{ bookmark_id: '100', target_category_id: '10', confidence: 0.9, reason: 'r' }],
      })
      .mockRejectedValue(Object.assign(new Error('boom'), { retryable: false }))
    const deps = { createClient: () => ({ complete }), now: () => 1 }

    const res = await handle(
      ports,
      { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' },
      { ...deps, batchSize: 1 },
    ) as { ok: true; plan: { warnings: string[]; rows: unknown[] } }

    expect(res.ok).toBe(true)
    expect(res.plan.rows.length).toBeGreaterThan(0)
    expect(res.plan.warnings.join()).toContain('1')
  })
})

describe('handle import', () => {
  it('把节点建到书签栏下的目标文件夹里', async () => {
    const { fake, ports, deps } = setup()
    const res = await handle(ports, {
      kind: 'import',
      targetName: '导入 2026-08-04',
      nodes: [
        { name: 'NiceG', children: [{ name: 'shadcn/ui', url: 'https://ui.shadcn.com' }] },
        { name: 'Figma', url: 'https://figma.com' },
      ],
    }, deps)

    expect(res).toMatchObject({ ok: true, kind: 'import' })
    expect(fake.structure()).toContain('书签栏/导入 2026-08-04/NiceG/shadcn/ui')
    expect(fake.structure()).toContain('书签栏/导入 2026-08-04/Figma')
  })

  it('返回导入的统计', async () => {
    const { ports, deps } = setup()
    const res = await handle(ports, {
      kind: 'import',
      targetName: '导入',
      nodes: [{ name: 'A', children: [{ name: 'B', url: 'https://b.dev' }] }],
    }, deps) as { result: { bookmarks: number; folders: number; folderId: string } }

    expect(res.result.bookmarks).toBe(1)
    expect(res.result.folders).toBe(1)
    expect(res.result.folderId).toBeDefined()
  })

  it('找不到书签栏时报错而不是乱建', async () => {
    const empty = createFakeBookmarks([{ id: '0', title: '', children: [] }])
    const ports = { bookmarks: empty.api, storage: createFakeStorage() }
    const res = await handle(ports, { kind: 'import', targetName: '导入', nodes: [] }, { now: () => 1 })
    expect(res).toEqual({ ok: false, error: '找不到书签栏，无法导入。' })
  })

  it('导入完成后写一条日志', async () => {
    const { ports, deps } = setup()
    const events: ProgressEvent[] = []
    await handle(ports, {
      kind: 'import', targetName: '导入', nodes: [{ name: 'A', url: 'https://a.dev' }],
    }, { ...deps, onEvent: (e) => events.push(e) })

    const line = events.find((e) => e.phase === 'import')
    expect(line).toBeDefined()
    expect(line!.message).toContain('1')
  })
})

/**
 * 造一棵只有「书签栏 / 收件箱」的树，收件箱里放指定的书签。
 * 标签阶段与分类阶段共用一个 fake client：按 prompt 里的关键字区分。
 */
function setupAnalyze(urls: Record<string, string>) {
  const fake = createFakeBookmarks([
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '11', title: '收件箱', children: Object.entries(urls).map(([id, url]) => ({
          id, title: `书签 ${id}`, url,
        })) },
      ]},
    ]},
  ])
  const classifyPrompts: string[] = []
  // 标签阶段有两种提示词（通用抽取 + 聚合组细分），分类阶段只有一种，正向识别它
  const complete = vi.fn(async (prompt: string) => {
    if (!prompt.includes('候选目录')) {
      return {
        results: Object.keys(urls).map((id) => ({
          bookmark_id: id, primary_topic: '工具', secondary_topic: null,
        })),
      }
    }
    classifyPrompts.push(prompt)
    // 返回 null 目标而不是空数组：空数组会被判成「模型漏返回」，触发全量失败的短路
    return {
      results: Object.keys(urls).map((id) => ({
        bookmark_id: id, target_category_id: null, confidence: 0, reason: '无合适目录',
      })),
    }
  })
  return {
    ports: { bookmarks: fake.api, storage: createFakeStorage() },
    deps: { createClient: () => ({ complete } as unknown as LlmClient), now: () => 1 },
    classifyPrompts,
  }
}

async function analyzePlan(
  ports: { bookmarks: unknown; storage: unknown },
  deps: unknown,
  // 用例要验的是某条路上的行为，模式必须钉死：让它跟着自动判断走，
  // 会把「阈值调了一下」变成一堆无关用例的红叉
  modeOverride: OrganizeMode,
  scopeRootIds: string[] = ['1'],
): Promise<OrganizePlan> {
  const res = await handle(ports as never, { kind: 'analyze', scopeRootIds, modeOverride }, deps as never)
  if (!res.ok || res.kind !== 'analyze') throw new Error(`analyze 应当成功：${JSON.stringify(res)}`)
  return res.plan
}

describe('analyze 的 plan.tags', () => {
  it('推翻模式下 plan 带上 tags', async () => {
    const { ports, deps } = setupAnalyze({ n0: 'https://a.com/0', n1: 'https://b.com/1' })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    })
    const plan = await analyzePlan(ports, deps, 'rebuild')
    expect(plan.tags.map((t) => t.bookmarkId).sort()).toEqual(['n0', 'n1'])
  })

  it('非推翻模式下 plan.tags 为空数组', async () => {
    const { ports, deps } = setupAnalyze({ n0: 'https://a.com/0' })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    })
    const plan = await analyzePlan(ports, deps, 'additive')
    expect(plan.tags).toEqual([])
  })
})

describe('analyze 统一 GitHub 书签标题', () => {
  it('开关关闭时不产生改名操作', async () => {
    const { ports, deps } = setupAnalyze({ g0: 'https://github.com/sst/opencode' })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    })
    const plan = await analyzePlan(ports, deps, 'additive')
    expect(plan.operations.some((o) => o.type === 'rename_bookmark')).toBe(false)
  })

  it('开关开启时为 GitHub 书签生成改名，非 GitHub 的不动', async () => {
    const { ports, deps } = setupAnalyze({
      g0: 'https://github.com/sst/opencode',
      n0: 'https://example.com/0',
    })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      rewriteGithubTitles: true,
    })
    const plan = await analyzePlan(ports, deps, 'additive')
    const renames = plan.operations.flatMap((o) => (o.type === 'rename_bookmark' ? [o] : []))
    expect(renames).toEqual([
      { type: 'rename_bookmark', bookmarkId: 'g0', oldTitle: '书签 g0', newTitle: 'opencode (sst)' },
    ])
  })
})

const mergeTree = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'NiceG', children: [
        { id: '100', title: 'React 官网', url: 'https://react.dev' },
        // 104/105 是为目录下限补的：勾 '10'+'11' 合并时范围内共 4 条书签，
        // 合并根下那个「前端」才撑得过 MIN_FOLDER_BOOKMARKS，「一级目录挂在合并根下」
        // 这条断言（others.length > 0）才有东西可数。合并根自己不受下限约束
        // （pruneSmallFolders 认 mergeRootTemporaryId），但它下面的主题目录受
        { id: '104', title: 'Vite 官网', url: 'https://vite.dev' },
        { id: '105', title: 'Vitest 官网', url: 'https://vitest.dev' },
        // 非推翻模式下候选目录只能来自范围内的非根目录：'10'、'11' 自己是范围根、
        // 会被 buildCandidatesFromFolders 排除，没有它整个分析会以「没有目标目录」提前返回
        { id: '12', title: '待归档', children: [] },
      ]},
      { id: '11', title: 'b_llm', children: [
        { id: '101', title: 'Claude', url: 'https://claude.ai' },
      ]},
      // 上一轮整理留下的编号，用来盯住兜底名字有没有去掉编号前缀
      { id: '13', title: '01 前端', children: [
        { id: '103', title: 'Vite', url: 'https://vite.dev' },
      ]},
    ]},
    // 「其他书签」也是永久目录：它和「书签栏」是两次独立勾选、互不包含，
    // findScopeRoots 会原样返回两项，只有 hasPermanent 这道闸拦得住合并
    { id: '2', title: '其他书签', children: [
      { id: '20', title: '工具', children: [
        { id: '102', title: 'Raycast', url: 'https://raycast.com' },
      ]},
    ]},
  ]},
]

/** 按提示词内容分流的 client：合并模式下要应付四轮不同的请求。 */
function mergeClient(nameResponse: () => Promise<{ name: string }>) {
  return vi.fn(async (prompt: string) => {
    // 命名那一轮的提示词由 mergeNamePrompt 生成，措辞以 src/llm/prompts.ts 为准
    if (prompt.includes('合并成一个新文件夹')) return nameResponse()
    // 书签 id 从提示词自带的 payload 里读，不写死——各用例的范围不同，
    // 写死会让漏答的书签变成 source: 'none'，掩盖掉真正要断言的东西
    const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
    const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)]
    if (ids.length > 0) {
      return { results: bookmarkIds.map((id) => (
        { bookmark_id: id, target_category_id: ids[0]![1]!, confidence: 0.9, reason: 'r' }
      ))}
    }
    if (prompt.includes('标签清单')) {
      return { folders: [{ title: '前端', topics: ['前端'], children: [] }] }
    }
    return { results: bookmarkIds.map((id) => (
      { bookmark_id: id, primary_topic: '前端', secondary_topic: null }
    ))}
  })
}

async function analyzeMerge(
  scopeRootIds: string[],
  modeOverride: OrganizeMode,
  nameResponse: () => Promise<{ name: string }> = async () => ({ name: 'AI 学习' }),
): Promise<OrganizePlan> {
  const fake = createFakeBookmarks(mergeTree)
  const ports = { bookmarks: fake.api, storage: createFakeStorage() }
  await saveSettings(ports, {
    ...DEFAULT_SETTINGS,
    ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    removeEmptyFolders: false, rewriteGithubTitles: false,
  })
  const deps = { createClient: () => ({ complete: mergeClient(nameResponse) }), now: () => 1 }
  const res = await handle(ports, { kind: 'analyze', scopeRootIds, modeOverride }, deps) as { plan: OrganizePlan }
  return res.plan
}

describe('analyze 合并模式', () => {
  it('勾选多个平级目录时新建合并根，名字来自模型', async () => {
    const plan = await analyzeMerge(['10', '11'], 'rebuild')
    expect(plan.mergeRoot).toMatchObject({ title: 'AI 学习' })
    const create = plan.operations.find(
      (o) => o.type === 'create_folder' && o.temporaryId === plan.mergeRoot!.temporaryId,
    )
    expect(create).toMatchObject({ parentId: '1', parentTemporaryId: null, title: 'AI 学习' })
  })

  it('一级目录挂在合并根下，不再直接挂书签栏', async () => {
    const plan = await analyzeMerge(['10', '11'], 'rebuild')
    const others = plan.operations.filter(
      (o) => o.type === 'create_folder' && o.temporaryId !== plan.mergeRoot!.temporaryId,
    )
    expect(others.length).toBeGreaterThan(0)
    for (const op of others) {
      expect(op).toMatchObject({ parentId: null, parentTemporaryId: plan.mergeRoot!.temporaryId })
    }
  })

  it('只勾选一个目录时不合并', async () => {
    expect((await analyzeMerge(['10'], 'rebuild')).mergeRoot).toBeNull()
  })

  it('勾中永久目录时不合并', async () => {
    expect((await analyzeMerge(['1', '10', '11'], 'rebuild')).mergeRoot).toBeNull()
  })

  // 上一条里 '10'、'11' 是 '1' 的后代，findScopeRoots 只会返回 '1' 一项，
  // roots.length >= 2 自己就把结果定死了，hasPermanent 那半边条件根本没被问到。
  // 「书签栏 + 其他书签」是互不包含的两个永久目录，只有这条能盯住那道闸。
  it('勾中两个永久目录时不合并', async () => {
    expect((await analyzeMerge(['1', '2'], 'rebuild')).mergeRoot).toBeNull()
  })

  it('跨父目录合并时容器落在树序第一个根的父目录下', async () => {
    const plan = await analyzeMerge(['20', '10'], 'rebuild')
    const create = plan.operations.find(
      (o) => o.type === 'create_folder' && o.temporaryId === plan.mergeRoot!.temporaryId,
    )
    // 勾选顺序是「其他书签下的 20」在先，落点仍按书签树顺序取 '10' 的父目录
    expect(create).toMatchObject({ parentId: '1', parentTemporaryId: null })
    expect(plan.mergeRoot!.sourceRootIds).toEqual(['10', '20'])
  })

  it('推翻重建关闭时不合并', async () => {
    expect((await analyzeMerge(['10', '11'], 'additive')).mergeRoot).toBeNull()
  })

  it('命名失败时用源目录名拼接兜底', async () => {
    const plan = await analyzeMerge(['10', '11'], 'rebuild', async () => { throw new Error('boom') })
    expect(plan.mergeRoot!.title).toBe('NiceG + b_llm')
  })

  // 反复整理同一批目录时源目录名上会积编号，兜底名字不去掉的话
  // 会真建出一个叫「NiceG + 01 前端」的目录，下一轮再拼一层
  it('兜底拼接前先去掉源目录名上的编号前缀', async () => {
    const plan = await analyzeMerge(['10', '13'], 'rebuild', async () => { throw new Error('boom') })
    expect(plan.mergeRoot!.title).toBe('NiceG + 前端')
  })
})

describe('后台按用户设置的语言产出文案', () => {
  afterEach(() => setLocale('zh_CN'))

  it("uiLocale 为 'en' 时扫描日志是英文——浏览器仍是中文", async () => {
    const { ports, deps } = setup()
    await saveSettings(ports, { ...DEFAULT_SETTINGS, uiLocale: 'en' })
    const events: ProgressEvent[] = []
    await handle(ports, { kind: 'scan', scopeRootIds: ['1'] }, { ...deps, onEvent: (e) => events.push(e) })
    expect(events[0]?.message).not.toMatch(/[一-鿿]/)
  })

  it('保存设置后当前语言立刻跟着变，不用等下一个请求', async () => {
    const { ports, deps } = setup()
    await handle(ports, {
      kind: 'save_settings',
      settings: { ...DEFAULT_SETTINGS, uiLocale: 'en' },
    }, deps)
    expect(currentLocale()).toBe('en')
  })
})

/**
 * 层级按书签库里的固定位置算，不按勾选点算。这是整件事的要害：
 * 「其他书签」在栏的最右端显示成一个文件夹、跟栏里的目录平级，所以它自己就是一级，
 * 在它里面建的那批是二级。搞错了模型会拿「一级目录要具体」的标准去命名二级目录，
 * 而且嵌套上限会在错误的层级上生效。
 */
describe('推翻模式按绝对层级告知模型', () => {
  function twoRoots() {
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '11', title: '杂项', children: [{ id: '100', title: 'React 官网', url: 'https://react.dev' }] },
        ]},
        { id: '2', title: '其他书签', children: [
          { id: '21', title: '收件箱', children: [{ id: '200', title: 'Vue 官网', url: 'https://vuejs.org' }] },
        ]},
      ]},
    ])
    return { bookmarks: fake.api, storage: createFakeStorage() }
  }

  async function promptsFor(scopeRootIds: string[], settings: Partial<Settings> = {}) {
    const ports = twoRoots()
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      ...settings,
    })
    const complete = vi.fn()
      // 两个根各有一个书签，勾哪边都得有标签落地，否则设计目录那一轮根本不会发生
      .mockResolvedValueOnce({ results: [
        { bookmark_id: '100', primary_topic: '前端' },
        { bookmark_id: '200', primary_topic: '前端' },
      ]})
      .mockResolvedValueOnce({ folders: [{ title: '前端', topics: ['前端'], children: [] }] })
      .mockResolvedValueOnce({ results: [] })
    await handle(
      ports,
      { kind: 'analyze', scopeRootIds, modeOverride: 'rebuild' },
      { createClient: () => ({ complete }), now: () => 1 },
    )
    return complete.mock.calls.map((c) => c[0] as string).join('\n')
  }

  it('勾书签栏时告诉模型这是一级目录', async () => {
    const prompts = await promptsFor(['1'])
    expect(prompts).toContain('一级目录')
    expect(prompts).not.toContain('二级目录不超过')
  })

  it('勾其他书签时告诉模型这是二级目录，并报出容器名', async () => {
    const prompts = await promptsFor(['2'])
    expect(prompts).toContain('二级目录不超过')
    expect(prompts).toContain('其他书签')
  })

  // 标题曾经是「默认上限 2 下，勾其他书签就只建一层」——那时候上限管着要不要分层。
  // 旋钮删掉之后层数只看这次要整理的书签有多少：这里的夹具在「其他书签」下只有
  // 1 个书签（Vue 官网），撑不起两层，下面这个断言能过纯属巧合，不是旧上限「2」
  // 在起作用（那个字段已经无人读取，参见第 262 行同一个道理）
  it('「其他书签」范围内书签数撑不起两层，提示词要求只输出一层（与旧上限无关，巧合通过）', async () => {
    expect(await promptsFor(['2'])).toContain('children 一律返回空数组')
  })

  // 旋钮删掉之后层数不再看「勾选点在第几层」，只看这次要整理的书签有多少：
  // 这里勾书签栏只带出 1 个书签，撑不起两层，跟勾其他书签时结果一致，都只建一层——
  // 不再是「上限管绝对层级，不管从勾选点起算的深度」那一套
  it('层数不再看绝对层级，书签量撑不起两层时勾书签栏也只建一层', async () => {
    expect(await promptsFor(['1'])).toContain('children 一律返回空数组')
  })

  // 用户勾了这里就是要在这里整理，返回「一个目录都不建」看起来像坏了。
  // 标题曾经是「勾中处已经到上限那一层时，仍然建一层，只是不再往下」，还传着
  // { maxFolderDepth: 2 } 这个已经无人读取的字段——删掉它，纯噪声。
  // 「三级目录不超过」这半仍然有效，验的是 startLevel 按绝对层级算对了；
  // 「children 一律返回空数组」这半和上面两条一样，是这里只有 1 个书签、
  // 撑不起两层的巧合，不是任何上限在起作用。
  it('勾中处已在第三层，提示词按 startLevel 报「三级目录」；只建一层是书签数撑不起两层，与旧上限无关（巧合通过）', async () => {
    const prompts = await promptsFor(['21'])
    expect(prompts).toContain('三级目录不超过')
    expect(prompts).toContain('children 一律返回空数组')
  })
})

/**
 * 目录下限有三道：提示词、建树按标签数筛、分类后按真实归属兜底。
 * 前两道各自有单测（llm/prompts、core/tree），这里验的是它们确实接进了 analyze。
 */
describe('handle analyze 目录下限', () => {
  const sixBookmarks = [
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '11', title: '杂项', children: Array.from({ length: 6 }, (_, i) => ({
          id: `20${i}`, title: `站点${i}`, url: `https://site${i}.dev`,
        }))},
      ]},
    ]},
  ]

  function setupSix(complete: LlmClient['complete']) {
    const fake = createFakeBookmarks(sixBookmarks)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    return { fake, ports, deps: { createClient: () => ({ complete }), now: () => 1 } }
  }

  const rebuild = (overrides: Partial<Settings> = {}): Settings => ({
    ...DEFAULT_SETTINGS,
    ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    ...overrides,
  })

  it('下限写进目录设计提示词', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ results: [{ bookmark_id: '200', primary_topic: '前端' }] })
      .mockResolvedValueOnce({ folders: [{ title: '前端', topics: ['前端'], children: [] }] })
      .mockResolvedValueOnce({ results: [] })
    const { ports, deps } = setupSix(complete)
    await saveSettings(ports, rebuild())

    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps)
    const prompts = complete.mock.calls.map((c) => c[0] as string)
    // 原来这里把阈值拧成 4 再验提示词里出现 4。阈值不再可拨，恒为 MIN_FOLDER_BOOKMARKS，
    // 验的仍是同一件事：**下限有没有一路传到目录设计那一轮的提示词里**
    expect(prompts.some((prompt) => prompt.includes('不到 3 个书签'))).toBe(true)
  })

  // 原来验的是「开关关掉时提示词里没有这条」。开关删掉后那条路不存在了，但它问的事
  // 还在：**存量存储里躺着关掉过的开关，这次整理会不会被它带偏。** 答案反过来了，
  // 断言跟着反过来。存量键已经不在 Settings 类型里，只能从存储那一侧写
  it('存量记录里躺着 enforceMinFolderSize=false，下限照样写进目录设计提示词', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ results: [{ bookmark_id: '200', primary_topic: '前端' }] })
      .mockResolvedValueOnce({ folders: [{ title: '前端', topics: ['前端'], children: [] }] })
      .mockResolvedValueOnce({ results: [] })
    const { ports, deps } = setupSix(complete)
    await saveSettings(ports, rebuild())
    await ports.storage.set(SETTINGS_KEY, { ...rebuild(), enforceMinFolderSize: false })

    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps)
    const prompts = complete.mock.calls.map((c) => c[0] as string)
    expect(prompts.some((prompt) => prompt.includes('不到 3 个书签'))).toBe(true)
  })

  // 反向的另一半：旧阈值往上拧过（5）同样没有落点。上一条盯的是「关掉」，
  // 这一条盯的是「拧到别的数」——两个方向都不许把存量值偷偷放回来
  it('存量记录里躺着 minFolderSize=5，提示词里报的仍是 3', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ results: [{ bookmark_id: '200', primary_topic: '前端' }] })
      .mockResolvedValueOnce({ folders: [{ title: '前端', topics: ['前端'], children: [] }] })
      .mockResolvedValueOnce({ results: [] })
    const { ports, deps } = setupSix(complete)
    await saveSettings(ports, rebuild())
    await ports.storage.set(SETTINGS_KEY, { ...rebuild(), minFolderSize: 5 })

    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps)
    const prompts = complete.mock.calls.map((c) => c[0] as string)
    expect(prompts.some((prompt) => prompt.includes('不到 3 个书签'))).toBe(true)
    expect(prompts.some((prompt) => prompt.includes('不到 5 个书签'))).toBe(false)
  })

  /**
   * 二级目录（React/Vue）要建得出来，allowChildren 得是 true——而这现在由书签总数
   * 推导（N > 200 才进两层），不再由「勾选点在第几层」决定，所以这两条子目录下限
   * 的用例不能再用 6 条书签的夹具：203 条里 React 占 200、Vue 占 3，够上两层，
   * Vue 在标签阶段又刚好卡在 minFolderSize=3 的线上，让建树那道拦不住它。
   *
   * 标签数够、真实归属不够：模型把这批书签的两个子主题分成了「几乎全 React、只留
   * 1 条给 Vue」，只有数过分类结果才拦得住那 1 条。
   */
  const REACT_TAG_COUNT = 200
  const VUE_TAG_COUNT = 3
  const skewedBookmarks = Array.from({ length: REACT_TAG_COUNT + VUE_TAG_COUNT }, (_, i) => ({
    id: `s${i}`, title: `站点${i}`, url: `https://site${i}.dev`,
  }))
  // 标签阶段真按 3:200 分（Vue 卡在下限线上），真实分类另有安排：只留最后一条给 Vue
  const loneVueId = skewedBookmarks.at(-1)!.id

  function setupSkewed(complete: LlmClient['complete']) {
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [{ id: '11', title: '杂项', children: skewedBookmarks }] },
      ]},
    ])
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    return { fake, ports, deps: { createClient: () => ({ complete }), now: () => 1 } }
  }

  function skewedComplete(): LlmClient['complete'] {
    return vi.fn(async (prompt: string) => {
      const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
      if (prompt.includes('标签清单')) {
        return { folders: [{ title: '前端', topics: [], children: [
          { title: 'React', topics: ['React'] },
          { title: 'Vue', topics: ['Vue'] },
        ] }] }
      }
      if (prompt.includes('候选目录')) {
        const withLabel = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)]
        const reactId = withLabel.find((m) => m[2]!.includes('React'))![1]!
        const vueId = withLabel.find((m) => m[2]!.includes('Vue'))![1]!
        return { results: bookmarkIds.map((id) => ({
          bookmark_id: id,
          target_category_id: id === loneVueId ? vueId : reactId,
          confidence: 0.9,
          reason: 'r',
        }))}
      }
      // 标签阶段：最后 VUE_TAG_COUNT 条先标成 Vue（够格通过建树那道的下限筛选），
      // 真实分类会把其中大部分改判回 React，只留 loneVueId 那一条
      return { results: bookmarkIds.map((id) => {
        const index = skewedBookmarks.findIndex((b) => b.id === id)
        return { bookmark_id: id, primary_topic: index >= REACT_TAG_COUNT ? 'Vue' : 'React', secondary_topic: null }
      })}
    })
  }

  it('分类后仍不足下限的目录不出现在计划里，书签并进父目录', async () => {
    const complete = skewedComplete()
    const { ports, deps } = setupSkewed(complete)
    // 阈值恒为 3，不必再拧（原来这里写的就是 3）
    await saveSettings(ports, rebuild())

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps) as { plan: OrganizePlan }
    const created = res.plan.operations.flatMap((o) => (o.type === 'create_folder' ? [o.title] : []))
    expect(created.some((title) => title.includes('React'))).toBe(true)
    expect(created.some((title) => title.includes('Vue'))).toBe(false)
    // 那个书签落在父目录，而不是掉进「其他」或原地不动
    const row = res.plan.rows.find((r) => r.bookmarkId === loneVueId)!
    expect(row.toPath.map((p) => p.replace(/^\d+ /, ''))).toEqual(['前端'])
    expect(row.reason).toContain('不足 3 个')
  })

  // 日志里那个数字过去直接印 settings.minFolderSize。存量记录里拧过的值不许再从
  // 这里漏出来——用户看到的解释必须是真正生效的那个下限
  it('撤掉目录时日志报的下限就是 3，不是存量记录里拧过的那个数', async () => {
    const complete = skewedComplete()
    const { ports } = setupSkewed(complete)
    await saveSettings(ports, rebuild())
    await ports.storage.set(SETTINGS_KEY, { ...rebuild(), minFolderSize: 9 })
    const events: ProgressEvent[] = []
    await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' },
      { createClient: () => ({ complete }), now: () => 1, onEvent: (e) => events.push(e) },
    )
    const line = events.find((e) => e.message.includes('装不满'))
    expect(line).toBeDefined()
    expect(line!.message).toContain('装不满 3 个书签')
  })

  // 原来验的是「开关关掉时那个只有一个书签的子目录照建」。开关已经删掉——目录下限
  // 退成 core 里的内部常量，一律生效。那条用例问的事情本身还在：**存量存储里躺着
  // 关掉过的开关时，这次整理会不会被它带偏。** 答案反过来了，所以断言跟着反过来，
  // 而不是把这条用例删掉。存量键只能从存储那一侧写，它已经不在 Settings 类型里
  it('存量记录里躺着 enforceMinFolderSize=false，那个只有一个书签的子目录照样被剪', async () => {
    const complete = skewedComplete()
    const { ports, deps } = setupSkewed(complete)
    await saveSettings(ports, rebuild())
    await ports.storage.set(SETTINGS_KEY, { ...rebuild(), enforceMinFolderSize: false })

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps) as { plan: OrganizePlan }
    const created = res.plan.operations.flatMap((o) => (o.type === 'create_folder' ? [o.title] : []))
    expect(created.some((title) => title.includes('React'))).toBe(true)
    expect(created.some((title) => title.includes('Vue'))).toBe(false)
  })
})

describe('analyze 非推翻模式：新主题无处可去', () => {
  // 已有 react、杂项两个目录，三本关于「语音合成」的书签松散挂在书签栏下——
  // 这才是「真正无处可去」的典型状态：没有一个已有目录能装下它们，也没有人
  // 手工把它们攒在一起过。哪个已有目录都放不进去，模型分类时把它们的
  // target_category_id 判成 null，同时带回同一个 topic。
  //
  // 三本书签不能预先独占同一个非根目录（目录里没有别的书签、也没有子目录）：
  // dropAlreadyGrouped 的「已聚齐」guard（见 core/newTopics.ts）专门拦这种情况——
  // 那正是这条流程自己上一轮建出来的目录会长成的样子，guard 分不清「这是上一轮
  // 建的目录」和「碰巧只有它们独占的旧目录」，保守地一律不碰。松散挂在范围根下
  // 是 guard 明确放行的那一种（其父就是范围根本身），也是「新主题」这个功能本该
  // 覆盖的主场景。
  const homelessTree = [
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: 'react', children: [] },
        { id: '11', title: '杂项', children: [] },
        { id: '100', title: '语音合成教程 A', url: 'https://a.dev' },
        { id: '101', title: '语音合成教程 B', url: 'https://b.dev' },
        { id: '102', title: '语音合成教程 C', url: 'https://c.dev' },
      ]},
    ]},
  ]

  function setupHomeless(complete: LlmClient['complete']) {
    const fake = createFakeBookmarks(homelessTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    return { fake, ports, deps: { createClient: () => ({ complete }), now: () => 1 } }
  }

  async function saveNonRebuild(ports: ReturnType<typeof setupHomeless>['ports']): Promise<void> {
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
  }

  it('非推翻模式：分不进已有目录的书签攒够数就建新目录', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({
        results: [
          { bookmark_id: '100', target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成' },
          { bookmark_id: '101', target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成' },
          { bookmark_id: '102', target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成' },
        ],
      })
      .mockResolvedValueOnce({ names: [{ key: '语音合成', name: '语音与音频' }] })
    const { ports, deps } = setupHomeless(complete)
    await saveNonRebuild(ports)

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps) as { plan: OrganizePlan }
    const created = res.plan.operations.filter((o) => o.type === 'create_folder')
    expect(created.map((o) => o.title)).toContain('语音与音频')
    expect(res.plan.rows).toHaveLength(3)
  })

  it('非推翻模式：攒不够下限就不建目录，书签原地不动', async () => {
    const complete = vi.fn().mockResolvedValue({
      results: [
        { bookmark_id: '100', target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成' },
        { bookmark_id: '101', target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '数据竞赛' },
      ],
    })
    const { ports, deps } = setupHomeless(complete)
    await saveNonRebuild(ports)

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps) as { plan: OrganizePlan }
    expect(res.plan.operations.filter((o) => o.type === 'create_folder')).toHaveLength(0)
    // 起名那一次调用根本不该发出去
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('非推翻模式：新建目录不产生任何改名操作', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({
        results: ['100', '101', '102'].map((id) => ({
          bookmark_id: id, target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成',
        })),
      })
      .mockResolvedValueOnce({ names: [{ key: '语音合成', name: '语音与音频' }] })
    const { ports, deps } = setupHomeless(complete)
    await saveNonRebuild(ports)

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps) as { plan: OrganizePlan }
    expect(res.plan.operations.filter((o) => o.type === 'rename_folder')).toEqual([])
  })

  it('非推翻模式跑两遍：第二遍不新建、不改名、不移动', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({
        results: ['100', '101', '102'].map((id) => ({
          bookmark_id: id, target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成',
        })),
      })
      .mockResolvedValueOnce({ names: [{ key: '语音合成', name: '语音与音频' }] })
    const { ports, deps } = setupHomeless(complete)
    await saveNonRebuild(ports)

    const first = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps) as { ok: boolean; plan: OrganizePlan }
    expect(first.ok).toBe(true)
    await handle(ports, {
      kind: 'apply', plan: first.plan as never, accepted: first.plan.rows.map((r) => r.bookmarkId),
    }, deps)

    // 第二遍：三本书签已经落在「语音与音频」里，从候选目录的提示词里读出它的真实
    // id（第一遍 apply 后由 fake bookmarks 分配，无法静态写死），让模型把它们分回
    // 原地——这才是一次表现良好的分类，也是幂等性要验的东西
    complete.mockImplementationOnce(async (prompt: string) => {
      const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)]
      const target = ids.find((m) => m[2]!.includes('语音与音频'))![1]!
      return {
        results: ['100', '101', '102'].map((id) => ({
          bookmark_id: id, target_category_id: target, confidence: 0.9, reason: '已在此',
        })),
      }
    })
    const second = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps) as { ok: boolean; plan: OrganizePlan }
    expect(second.ok).toBe(true)
    expect(second.plan.operations.filter((o) => o.type === 'create_folder')).toEqual([])
    expect(second.plan.operations.filter((o) => o.type === 'rename_folder')).toEqual([])
    expect(second.plan.rows).toHaveLength(0)
  })

  // review C1：模型一直判定「无处可去」、每轮都带回同一个 topic，是这条分支
  // 唯一会持续触发的场景——表现良好的模型第二轮就会正确归位（上面那条用例），
  // 不会一直触发新建。这里驱动三轮，模型故意「表现不好」，验证 dropAlreadyGrouped
  // 的「已聚齐」guard 单独就能挡住 churn。
  //
  // 起的名字必须跟 topic 不一样（语音与音频 vs 语音合成）：如果两者相同，
  // nameNewTopics 的撞名跳过会在第二轮单独把新建挡下来，这条用例就测不出
  // guard 到底有没有在起作用——原始复现（见二次复核）用的正是这种「名字与
  // topic 不同」的场景，撞名跳过在那种场景下不会命中。
  it('模型持续判定无处可去也不 churn：三轮下来只建一次目录，之后不再新建、不改名、不移动', async () => {
    const complete = vi.fn(async (prompt: string) => {
      // 起名那次调用的提示词固定带着这句开场白；分类调用带的是候选目录清单
      if (prompt.includes('将为它们新建目录')) {
        return { names: [{ key: '语音合成', name: '语音与音频' }] }
      }
      return {
        results: ['100', '101', '102'].map((id) => ({
          bookmark_id: id, target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成',
        })),
      }
    })
    const { ports, deps } = setupHomeless(complete)
    await saveNonRebuild(ports)

    const first = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps) as { ok: boolean; plan: OrganizePlan }
    expect(first.ok).toBe(true)
    expect(first.plan.operations.filter((o) => o.type === 'create_folder')).toHaveLength(1)
    await handle(ports, {
      kind: 'apply', plan: first.plan as never, accepted: first.plan.rows.map((r) => r.bookmarkId),
    }, deps)

    const second = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps) as { ok: boolean; plan: OrganizePlan }
    expect(second.ok).toBe(true)
    expect(second.plan.operations.filter((o) => o.type === 'create_folder')).toEqual([])
    expect(second.plan.operations.filter((o) => o.type === 'rename_folder')).toEqual([])
    expect(second.plan.operations.filter((o) => o.type === 'move_bookmark')).toEqual([])
    await handle(ports, {
      kind: 'apply', plan: second.plan as never, accepted: second.plan.rows.map((r) => r.bookmarkId),
    }, deps)

    const third = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps) as { ok: boolean; plan: OrganizePlan }
    expect(third.ok).toBe(true)
    expect(third.plan.operations.filter((o) => o.type === 'create_folder')).toEqual([])
    expect(third.plan.operations.filter((o) => o.type === 'rename_folder')).toEqual([])
    expect(third.plan.operations.filter((o) => o.type === 'move_bookmark')).toEqual([])
  })

  // review I1：每条新用例都关掉 removeEmptyFolders，谁都没验过默认设置（开启）下
  // 新建目录会不会顺手删掉被搬空的旧目录。这条钉住现状——不改行为，只让它可见：
  // 用户开着清理，旧目录被搬空后就该被清理，这是他自己打开的开关。
  it('removeEmptyFolders 开着时，新建目录搬空的旧目录会被按设置清理掉——钉住现状，不是新引入的行为', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({
        results: ['100', '101', '102'].map((id) => ({
          bookmark_id: id, target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成',
        })),
      })
      .mockResolvedValueOnce({ names: [{ key: '语音合成', name: '语音与音频' }] })
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          // react 本身放一本书签，不然它作为一个本来就空的目录也会被 removeEmpty
          // 顺手扫掉，混淆了「谁是被这次新建搬空的」
          { id: '10', title: 'react', children: [
            { id: '90', title: 'React 官网', url: 'https://react.dev' },
          ]},
          // 102 松散挂在书签栏下，不与 100/101 共享父目录——三本一起共享同一个
          // 父目录会被 dropAlreadyGrouped 的「已聚齐」guard 拦下（见 core/newTopics.ts），
          // 这条用例要验的是清理这一步，不是那道 guard，两者不能混在一起测
          { id: '11', title: '专题', children: [
            { id: '100', title: '语音合成教程 A', url: 'https://a.dev' },
            { id: '101', title: '语音合成教程 B', url: 'https://b.dev' },
          ]},
          { id: '102', title: '语音合成教程 C', url: 'https://c.dev' },
        ]},
      ]},
    ])
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const deps = { createClient: () => ({ complete }), now: () => 1 }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: true,
      rewriteGithubTitles: false,
    })

    const analyzed = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps) as { ok: boolean; plan: OrganizePlan }
    expect(analyzed.ok).toBe(true)
    const res = await handle(ports, {
      kind: 'apply', plan: analyzed.plan as never, accepted: analyzed.plan.rows.map((r) => r.bookmarkId),
    }, deps) as { result: { removedFolders: Array<{ title: string }> } }

    expect(res.result.removedFolders.map((f) => f.title)).toEqual(['专题'])
    expect(fake.structure()).not.toContain('专题')
    expect(fake.structure()).toContain('语音与音频')
  })

  // 「已聚齐」这道闸丢弃的簇不能悄无声息——不然用户看见「N 本书签无处可去」
  // 后面跟着「新建 0 个目录」，猜不出原因（见二次复核）
  it('簇被「已聚齐」guard 丢弃时记一条日志，说明书签已经聚在一起、不用再建', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({
        results: ['100', '101', '102'].map((id) => ({
          bookmark_id: id, target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成',
        })),
      })
      .mockResolvedValueOnce({ names: [{ key: '语音合成', name: '语音与音频' }] })
    const { ports, deps } = setupHomeless(complete)
    await saveNonRebuild(ports)

    const first = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, deps) as { ok: boolean; plan: OrganizePlan }
    expect(first.ok).toBe(true)
    await handle(ports, {
      kind: 'apply', plan: first.plan as never, accepted: first.plan.rows.map((r) => r.bookmarkId),
    }, deps)

    const events: ProgressEvent[] = []
    complete.mockImplementation(async () => ({
      results: ['100', '101', '102'].map((id) => ({
        bookmark_id: id, target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成',
      })),
    }))
    const second = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, {
      ...deps, onEvent: (event: ProgressEvent) => events.push(event),
    }) as { ok: boolean; plan: OrganizePlan }

    expect(second.ok).toBe(true)
    expect(second.plan.operations.filter((o) => o.type === 'create_folder')).toEqual([])
    const groupedLog = events.find((e) => e.message.includes('已经聚在同一个目录'))
    expect(groupedLog?.message).toMatch(/^1 /)
  })

  // nameNewTopics 整簇跳过（模型提议撞了已有目录、退回的主题名也撞）不能悄无声息，
  // 道理跟上面的「已聚齐」guard 一样：不能让「N 本书签无处可去」后面跟着一句
  // 「新建 0 个目录」却不说原因
  it('簇被撞名跳过时记一条日志，说明有几个主题因为撞名没能建目录', async () => {
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: '语音合成', children: [] },
          { id: '100', title: '语音合成教程 A', url: 'https://a.dev' },
          { id: '101', title: '语音合成教程 B', url: 'https://b.dev' },
          { id: '102', title: '语音合成教程 C', url: 'https://c.dev' },
        ]},
      ]},
    ])
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const complete = vi.fn()
      .mockResolvedValueOnce({
        results: ['100', '101', '102'].map((id) => ({
          bookmark_id: id, target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成',
        })),
      })
      // 提议的名字跟主题名一样，都撞了已有目录「语音合成」——两条都堵死，整簇跳过
      .mockResolvedValueOnce({ names: [{ key: '语音合成', name: '语音合成' }] })
    const deps = { createClient: () => ({ complete }), now: () => 1 }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    const events: ProgressEvent[] = []

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, {
      ...deps, onEvent: (event: ProgressEvent) => events.push(event),
    }) as { ok: boolean; plan: OrganizePlan }

    expect(res.ok).toBe(true)
    expect(res.plan.operations.filter((o) => o.type === 'create_folder')).toEqual([])
    const collisionLog = events.find((e) => e.message.includes('和已有目录重名'))
    expect(collisionLog?.message).toMatch(/^1 /)
  })

  it('非推翻模式绝不建「其他」——放不进就原地不动，那个模式的承诺是不动已有结构', async () => {
    const complete = vi.fn(async (prompt: string) => {
      const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
      if (prompt.includes('候选目录')) {
        // 全都判「无合适目录」，且不带 topic：连新目录都攒不出来
        return { results: bookmarkIds.map((id) => (
          { bookmark_id: id, target_category_id: null, confidence: 0, reason: '无合适目录' }
        ))}
      }
      return { results: bookmarkIds.map((id) => (
        { bookmark_id: id, primary_topic: '前端', secondary_topic: null }
      ))}
    })
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: '收件箱', children: [
            { id: 'x0', title: '书签 x0', url: 'https://x0.dev' },
          ]},
        ]},
      ]},
    ])
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    })
    const res = await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' },
      { createClient: () => ({ complete }), now: () => 1 },
    ) as { plan: OrganizePlan }

    const created = res.plan.operations.flatMap((o) => (o.type === 'create_folder' ? [o.title] : []))
    expect(created.some((title) => title.includes('其他'))).toBe(false)
    expect(res.plan.candidates.some((c) => c.path.at(-1)!.includes('其他'))).toBe(false)
  })
})

/**
 * 归入现有模式下，上一轮整理留下的「其他」会原样进候选表交给模型。
 *
 * 而这个模式的提示词带着第 5 条规则（无归属时带回 topic），后面接着
 * clusterHomeless → nameNewTopics → planNewFolders 那条建新目录的链。
 * 「其他」在候选表里就等于给了模型一个合法的出口：它可以答「放这儿」而不是答
 * 「放不进去」，那条链于是永远等不到输入——真实那一遍 109 本书签就是这么进去的。
 *
 * 「顶层」按范围根的直接子目录算，不看 candidate.path 的长度：归入现有模式的候选
 * 路径由 core/scan.ts 拼（含范围根名），一个直属书签栏的「其他」路径长度是 2 而不是 1。
 */
describe('analyze 归入现有模式不拿「其他」当分类候选', () => {
  function setupFallbackCandidate(tree: TreeSpec[]) {
    const fake = createFakeBookmarks(tree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const classifyPrompts: string[] = []
    const complete = vi.fn(async (prompt: string) => {
      if (!prompt.includes('候选目录')) return { results: [] }
      classifyPrompts.push(prompt)
      const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)]
      const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
      return { results: bookmarkIds.map((id) => (
        { bookmark_id: id, target_category_id: ids[0]?.[1] ?? null, confidence: 0.9, reason: 'r' }
      )) }
    })
    return {
      ports,
      deps: { createClient: () => ({ complete } as unknown as LlmClient), now: () => 1 },
      classifyPrompts,
    }
  }

  /** 候选行 `- id=… 目录=A / B` 里的目录路径。 */
  function catalogPaths(prompt: string): string[] {
    return [...prompt.matchAll(/^- id=\S+ 目录=(.+)$/gm)].map((m) => m[1]!)
  }

  const settings = {
    ...DEFAULT_SETTINGS,
    ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    removeEmptyFolders: false,
    rewriteGithubTitles: false,
  }

  const withFallback: TreeSpec[] = [
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '前端', children: [] },
        { id: '11', title: '其他', children: [
          { id: 'b0', title: '书签 0', url: 'https://example.com/0' },
        ]},
        { id: '12', title: '收件箱', children: [
          { id: 'b1', title: '书签 1', url: 'https://example.com/1' },
          { id: 'b2', title: '书签 2', url: 'https://example.com/2' },
        ]},
      ]},
    ]},
  ]

  it('分类提示词的候选目录里没有顶层「其他」', async () => {
    const { ports, deps, classifyPrompts } = setupFallbackCandidate(withFallback)
    await saveSettings(ports, settings)
    await analyzePlan(ports, deps, 'additive')

    expect(classifyPrompts).not.toHaveLength(0)
    const paths = classifyPrompts.flatMap(catalogPaths)
    expect(paths).toContain('书签栏 / 前端')
    expect(paths).not.toContain('书签栏 / 其他')
  })

  it('「其他」不给模型选，但仍留在候选表里——它还要当结构页的回落点', async () => {
    const { ports, deps } = setupFallbackCandidate(withFallback)
    await saveSettings(ports, settings)
    const plan = await analyzePlan(ports, deps, 'additive')

    expect(plan.candidates.some((c) => c.path.at(-1) === '其他')).toBe(true)
  })

  it('只剔范围根下那一个，用户在自己目录里建的「其他」照旧当候选', async () => {
    const { ports, deps, classifyPrompts } = setupFallbackCandidate([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: '前端', children: [
            { id: '13', title: '其他', children: [] },
          ]},
          { id: '11', title: '其他', children: [] },
          { id: '12', title: '收件箱', children: [
            { id: 'b1', title: '书签 1', url: 'https://example.com/1' },
          ]},
        ]},
      ]},
    ])
    await saveSettings(ports, settings)
    await analyzePlan(ports, deps, 'additive')

    const paths = classifyPrompts.flatMap(catalogPaths)
    expect(paths).toContain('书签栏 / 前端 / 其他')
    expect(paths).not.toContain('书签栏 / 其他')
  })

  // 剔光了模型无从作答：一个候选都没有的提示词只会换回一堆 null，
  // 白花一轮钱，还不如让「其他」留着当唯一的去处
  it('除了「其他」没有别的候选时不剔除', async () => {
    const { ports, deps, classifyPrompts } = setupFallbackCandidate([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '11', title: '其他', children: [
            { id: 'b0', title: '书签 0', url: 'https://example.com/0' },
          ]},
        ]},
      ]},
    ])
    await saveSettings(ports, settings)
    await analyzePlan(ports, deps, 'additive')

    expect(classifyPrompts.flatMap(catalogPaths)).toContain('书签栏 / 其他')
  })

  it('推翻重建模式不受影响：那条路的「其他」是刚设计出来的收容所，必须能被选中', async () => {
    const fake = createFakeBookmarks(rebuildTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const classifyPrompts: string[] = []
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.includes('抽取一个具体主题')) {
        return { results: REBUILD_IDS.map((id) => ({ bookmark_id: id, primary_topic: 'React 生态' })) }
      }
      if (prompt.includes('标签清单：')) {
        return { folders: [{ title: '前端框架', topics: ['React 生态'], children: [] }] }
      }
      classifyPrompts.push(prompt)
      return { results: REBUILD_IDS.map((id) => (
        { bookmark_id: id, target_category_id: 'tmp:1', confidence: 0.9, reason: 'r' }
      )) }
    })
    await saveSettings(ports, settings)
    await analyzePlan(ports, { createClient: () => ({ complete }), now: () => 1 }, 'rebuild')

    // 推翻模式的候选路径不含范围根名，「其他」自己就是一整行（带建树期给的编号）
    expect(classifyPrompts.flatMap(catalogPaths)).toContain('02 其他')
  })
})

describe('analyze 非推翻模式：级联勾选（review C2）', () => {
  // 勾选界面会把选中目录的所有子目录 id 一并塞进 scopeRootIds（级联勾选），
  // 而不是只送选中的那一个根。非推翻模式的候选目录如果照单排除 scopeRootIds
  // 里的每一个 id，就会把范围内所有目录都当成「范围根」排除掉，候选表变空，
  // analyze 直接报错——是这条分支在生产环境里彻底不可用的原因。
  it('scopeRootIds 同时带着根与它的子目录时，非推翻模式仍能产出候选而不是报错', async () => {
    const { ports, deps } = setup({
      complete: vi.fn().mockResolvedValue({
        results: [{ bookmark_id: '100', target_category_id: '10', confidence: 0.9, reason: 'r' }],
      }),
    })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    // 用 tree 夹具：书签栏(1) 下有 react(10)、杂项(11)——级联勾选会把三个 id
    // 全部送过来，先勾的是根（1），子目录顺序不定
    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1', '10', '11'], modeOverride: 'additive' }, deps) as {
      ok: boolean
      plan?: OrganizePlan
      error?: string
    }
    expect(res.ok).toBe(true)
    expect(res.plan!.candidates.length).toBeGreaterThan(0)
    expect(res.plan!.rows).toHaveLength(1)
  })
})

describe('analyze 非推翻模式：多个范围根（review I2）', () => {
  // 三本homeless书签松散挂在书签栏下（不共享某个已有子目录），避免撞上
  // dropAlreadyGrouped 的「已聚齐」guard——这里要单独测的是多根场景，不是那道 guard。
  const multiRootTree = [
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '100', title: '语音合成教程 A', url: 'https://a.dev' },
        { id: '101', title: '语音合成教程 B', url: 'https://b.dev' },
        { id: '102', title: '语音合成教程 C', url: 'https://c.dev' },
      ]},
      { id: '2', title: '其他书签', children: [
        // 只挂在「其他书签」下的已有目录：起名这一步如果只看 roots[0]（书签栏）
        // 的直接子目录，就看不到它，可能撞出一个别处已经在用的名字
        { id: '20', title: '语音合成', children: [] },
      ]},
    ]},
  ]

  function setupMultiRoot(complete: LlmClient['complete']) {
    const fake = createFakeBookmarks(multiRootTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    return { fake, ports, deps: { createClient: () => ({ complete }), now: () => 1 } }
  }

  it('起名时把所有范围根的直接子目录都算进已有目录名——不能只看新目录要挂的那个根', async () => {
    const namePrompts: string[] = []
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.includes('将为它们新建目录')) {
        namePrompts.push(prompt)
        return { names: [{ key: '语音合成', name: '语音合成' }] }
      }
      return {
        results: ['100', '101', '102'].map((id) => ({
          bookmark_id: id, target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成',
        })),
      }
    })
    const { ports, deps } = setupMultiRoot(complete)
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1', '2'], modeOverride: 'additive' }, deps) as { ok: boolean; plan: OrganizePlan }
    expect(res.ok).toBe(true)
    expect(namePrompts).toHaveLength(1)
    // 「其他书签」下的「语音合成」目录名出现在了起名提示词里
    expect(namePrompts[0]).toContain('语音合成')
    // 撞了已有目录名，模型的提议（同样是「语音合成」）应当被跳过而不是硬建重名目录
    expect(res.plan.operations.filter((o) => o.type === 'create_folder')).toEqual([])
  })

  it('勾了多个范围根时记一条日志说明新目录固定挂在第一个根下', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({
        results: ['100', '101', '102'].map((id) => ({
          bookmark_id: id, target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '数据竞赛',
        })),
      })
      .mockResolvedValueOnce({ names: [{ key: '数据竞赛', name: '竞赛数据' }] })
    const { ports, deps } = setupMultiRoot(complete)
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })
    const events: ProgressEvent[] = []
    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1', '2'], modeOverride: 'additive' }, {
      ...deps, onEvent: (event: ProgressEvent) => events.push(event),
    }) as { ok: boolean; plan: OrganizePlan }

    expect(res.ok).toBe(true)
    expect(res.plan.operations.filter((o) => o.type === 'create_folder')).toHaveLength(1)
    const multiRootLog = events.find((e) => e.message.includes('书签栏') && e.message.includes('范围根'))
    expect(multiRootLog).toBeDefined()
  })

  // 二次复核发现的回归：dropAlreadyGrouped 曾经只拿 input.rootId（也就是 roots[0]）
  // 跟簇成员的 parentId 比较，而 scan.folders 里装的是全部范围根。三本书签松散挂在
  // 第二个范围根（其他书签）正下方时，它们的 parentId 就是「其他书签」自己的 id——
  // 不等于 roots[0] 的 id，又确实在 scan.folders 里，于是被误判成「已经聚齐在一个
  // 非根目录下」，guard 错误地整簇丢弃，新建目录这条路直接失效。这本该是「书签松散
  // 挂在范围根下」这个大前提放行的情形，只是根不是第一个而已。
  it('三本homeless书签松散挂在第二个范围根（其他书签）正下方——guard 不能把它误判成已聚齐', async () => {
    const secondRootHomelessTree = [
      { id: '0', title: '', children: [
        // 「书签栏」下留一个已有子目录，不然两个范围根都没有子目录，候选表本来
        // 就是空的，还没走到新建目录这一步就会在别处报错，测不出这里要测的东西
        { id: '1', title: '书签栏', children: [
          { id: '10', title: 'react', children: [] },
        ]},
        { id: '2', title: '其他书签', children: [
          { id: '100', title: '语音合成教程 A', url: 'https://a.dev' },
          { id: '101', title: '语音合成教程 B', url: 'https://b.dev' },
          { id: '102', title: '语音合成教程 C', url: 'https://c.dev' },
        ]},
      ]},
    ]
    const fake = createFakeBookmarks(secondRootHomelessTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const complete = vi.fn()
      .mockResolvedValueOnce({
        results: ['100', '101', '102'].map((id) => ({
          bookmark_id: id, target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成',
        })),
      })
      .mockResolvedValueOnce({ names: [{ key: '语音合成', name: '语音与音频' }] })
    const deps = { createClient: () => ({ complete }), now: () => 1 }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
      removeEmptyFolders: false,
      rewriteGithubTitles: false,
    })

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1', '2'], modeOverride: 'additive' }, deps) as { ok: boolean; plan: OrganizePlan }
    expect(res.ok).toBe(true)
    expect(res.plan.operations.filter((o) => o.type === 'create_folder')).toHaveLength(1)
    expect(res.plan.rows).toHaveLength(3)
  })
})

/** 按提示词分流的 client：推翻模式要经过抽标签、设计目录、分类三轮。 */
function modeClient() {
  return vi.fn(async (prompt: string) => {
    const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
    if (prompt.includes('候选目录')) {
      const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)]
      return { results: bookmarkIds.map((id) => (
        { bookmark_id: id, target_category_id: ids[0]?.[1] ?? null, confidence: 0.9, reason: 'r' }
      ))}
    }
    if (prompt.includes('标签清单')) {
      return { folders: [{ title: '前端', topics: ['前端'], children: [] }] }
    }
    return { results: bookmarkIds.map((id) => (
      { bookmark_id: id, primary_topic: '前端', secondary_topic: null }
    ))}
  })
}

async function analyzeWith(tree: TreeSpec[], modeOverride?: OrganizeMode): Promise<OrganizePlan> {
  const fake = createFakeBookmarks(tree)
  const ports = { bookmarks: fake.api, storage: createFakeStorage() }
  await saveSettings(ports, {
    ...DEFAULT_SETTINGS,
    ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    removeEmptyFolders: false,
  })
  const deps = { createClient: () => ({ complete: modeClient() }), now: () => 1 }
  // modeOverride 是可选字段，缺省与显式传 undefined 在这里等价（tsconfig 没开
  // exactOptionalPropertyTypes），直接传下去即可
  const res = await handle(
    ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride }, deps,
  ) as { plan: OrganizePlan }
  return res.plan
}

/** 已整理过的样子：两个带编号的目录，各装 3 条。 */
const tidyTree: TreeSpec[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: '01 前端', children: Array.from({ length: 3 }, (_, i) => (
        { id: `a${i}`, title: `书签 a${i}`, url: `https://a${i}.dev` }
      )) },
      { id: '11', title: '02 后端', children: Array.from({ length: 3 }, (_, i) => (
        { id: `b${i}`, title: `书签 b${i}`, url: `https://b${i}.dev` }
      )) },
    ]},
  ]},
]

/**
 * 一团乱麻的样子：书签全散在书签栏底下，只有一个装了一条的目录。
 * 散落书签给到 9 条、总数凑够 10（= MIN_JUDGED_BOOKMARKS），不然「根下散落比例」
 * 这条规则会被样本量护栏挡住，判不出 rebuild（见 core/mode.ts 的 I2）。
 */
const messyTree: TreeSpec[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      ...Array.from({ length: 9 }, (_, i) => (
        { id: `l${i}`, title: `书签 l${i}`, url: `https://l${i}.dev` }
      )),
      { id: '10', title: '待归档', children: [
        { id: 'x0', title: '书签 x0', url: 'https://x0.dev' },
      ]},
    ]},
  ]},
]

describe('analyze 自己判断走哪条路', () => {
  it('已整理过的书签库走归入现有：plan 记的是非推翻模式', async () => {
    const plan = await analyzeWith(tidyTree)
    expect(plan.rebuildStructure).toBe(false)
  })

  it('一团乱麻走重新设计：plan 记的是推翻模式', async () => {
    const plan = await analyzeWith(messyTree)
    expect(plan.rebuildStructure).toBe(true)
  })

  it('用户推翻自动判断时以他为准', async () => {
    const plan = await analyzeWith(tidyTree, 'rebuild')
    expect(plan.rebuildStructure).toBe(true)
  })

  it('判断理由写进日志，用户看得见凭什么这么判', async () => {
    const fake = createFakeBookmarks(tidyTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    })
    const events: ProgressEvent[] = []
    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, {
      createClient: () => ({ complete: modeClient() }), now: () => 1, onEvent: (e) => events.push(e),
    })

    const line = events.find((e) => e.message.includes('编号前缀'))
    expect(line).toBeDefined()
    // 只认理由、不认结论键的话，把 logModeAdditive 错写成 logModeRebuild 这条用例照样绿——
    // 补上「归进现有目录」这半句，钉死走的确实是非推翻模式的那条日志模板
    expect(line?.message).toContain('归进现有目录')
  })

  it('用户推翻自动判断（改判 rebuild）时，日志跟着实际模式走，并带上原判断的理由', async () => {
    // tidyTree 自己判是 additive（编号前缀过半）；这里用 modeOverride 把它推翻成
    // rebuild——日志不能再说「按你的选择改成归入现有」，得说「改成重新设计」，
    // 且原判断（additive）的理由要缀在后面，方便用户翻日志看出自己否掉了什么
    const fake = createFakeBookmarks(tidyTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    })
    const events: ProgressEvent[] = []
    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, {
      createClient: () => ({ complete: modeClient() }), now: () => 1, onEvent: (e) => events.push(e),
    })

    const line = events.find((e) => e.message.includes('重新设计整棵目录树') && e.message.includes('按你的选择'))
    expect(line).toBeDefined()
    expect(line?.message).toContain('编号前缀')
  })

  it('用户推翻自动判断（改判 additive）时，日志说的是归入现有，不是重新设计', async () => {
    // messyTree 自己判是 rebuild（散落比例过高）；这里用 modeOverride 把它压成
    // additive——I1 修之前，只要带了 modeOverride 就无条件说「重新设计整棵目录树」，
    // 这条用例专门钉住那个方向不会回归
    const fake = createFakeBookmarks(messyTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    })
    const events: ProgressEvent[] = []
    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'additive' }, {
      createClient: () => ({ complete: modeClient() }), now: () => 1, onEvent: (e) => events.push(e),
    })

    const line = events.find((e) => e.message.includes('归进现有目录') && e.message.includes('按你的选择'))
    expect(line).toBeDefined()
    expect(line?.message).not.toContain('重新设计整棵目录树')
  })
})

describe('analyze 的 prune 二次判定', () => {
  /**
   * 23 条书签（a* 17 条、c0-c2、d0-d2 各 3 条），标签阶段「前端」「冷门」都攒够
   * minFolderSize=3 条标签，建树时都活下来；但真实分类另有安排：a* 全进「前端」，
   * c0 进「冷门」、c1/c2 被模型直接分去「前端」，于是「冷门」只剩 1 条会被 prune 撤掉；
   * d* 三条模型直接分进「其他」，让「其他」在合并 c0 之前就已经够数、活了下来——
   * prune 把 c0 并进这个存活的「其他」，二次判定再把它从「其他」捞去更近的「前端」。
   *
   * 这个形状是刻意选的：如果「冷门」在建树阶段就因标签数不够被滤掉（旧夹具正是这样），
   * pending 里的 fromTitle 会是「其他」而不是「冷门」——那是模型直接选了「其他」，不是
   * 被小目录挤出来的，测不到票面真正要盖的那条路（见 final-review.md I1）。
   *
   * 条数是几道约束夹出来的，动之前先读完这一段：
   *
   * - **总数 ≥ 23**：一级目录数由总数推导，9~10 条只推导得出 1 个一级目录，
   *   减去给「其他」留的位子后连「前端」「冷门」都设计不出来。23 条推导出
   *   3 个位子，「前端」「冷门」「其他」都摆得下。
   * - **总数 ≤ 25**：分类批次大小（classifyBookmarks 默认 batchSize=25）的上限。
   *   超过它第一轮分类会被拆成两批，`prompts`/`classifyCalls` 数的就不再是「问了几轮」。
   * - **「前端」最终 ≤ MAX_LEAF**：a* 全进「前端」、c1/c2 也被模型直接分去「前端」、
   *   二次判定又把 c0 从「冷门」捞进「前端」，所以是 a + 3。越界的话「结构自检其二」
   *   会把「前端」再切一层，而这副夹具要测的是二次判定本身，不该被那条无关的
   *   自检路径改写产出的目录形状。
   *
   * MAX_LEAF 从 20 收到 12（issues/38 的 D2）之后，a=17 就把第三条撑破了（17+3=20）。
   * 缺的量挪给 d*：a=9 让「前端」正好落在 12 上，d=11 把总数补回 23。
   * 挪给 d* 而不是别处，是因为 d* 全进「其他」，那一摊与「前端」的容量互不影响。
   * 注意 d=11 必须留在 MAX_LEAF(12) 以内：「其他」曾经豁免下切、涨到多大都不触发自检，
   * 那条豁免已经摘掉（organize-audit-holes 02 票），现在它跟普通目录一样按占用切。
   */
  const rehomeTree = [
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '收件箱', children: [
          ...Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, title: `书签 a${i}`, url: `https://a${i}.dev` })),
          { id: 'c0', title: '书签 c0', url: 'https://c0.dev' },
          { id: 'c1', title: '书签 c1', url: 'https://c1.dev' },
          { id: 'c2', title: '书签 c2', url: 'https://c2.dev' },
          ...Array.from({ length: 11 }, (_, i) => ({ id: `d${i}`, title: `书签 d${i}`, url: `https://d${i}.dev` })),
        ]},
      ]},
    ]},
  ]

  /** 标签阶段：a* 冷门、c* 冷门、d* 一个哪都不映射的话题，好让「其他」保持兜底。 */
  const tagsOf = (id: string): string =>
    id.startsWith('a') ? '前端' : id.startsWith('c') ? '冷门' : '孤单'

  /**
   * 二次判定那组用例共用的假件。收到的分类提示词原样记进 `prompts`，
   * 数它的长度就知道二次判定那一轮跑没跑。
   */
  function rehomeComplete(prompts: string[]): LlmClient['complete'] {
    return vi.fn(async (prompt: string) => {
      if (prompt.includes('标签清单')) {
        return { folders: [
          { title: '前端', topics: ['前端'], children: [] },
          { title: '冷门', topics: ['冷门'], children: [] },
        ]}
      }
      if (prompt.includes('候选目录')) {
        prompts.push(prompt)
        const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)].map((m) => m[1]!)
        const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
        // 第一次分类：a* 全进「前端」，c0 进「冷门」，c1/c2 被模型直接分去「前端」——
        // 「冷门」建树阶段靠 3 条标签活下来，真实分类却只留住 1 条；d* 直接进「其他」
        // 第二次（二次判定）：只剩 c0，把它放进候选里第一个（「前端」）
        return { results: bookmarkIds.map((id) => ({
          bookmark_id: id,
          target_category_id: prompts.length === 1
            ? (id.startsWith('a') ? ids[0]! : id === 'c0' ? ids[1]! : id.startsWith('c') ? ids[0]! : ids[2]!)
            : ids[0]!,
          confidence: prompts.length === 1 ? 0.9 : 0.42,
          reason: 'r',
        }))}
      }
      const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
      return { results: bookmarkIds.map((id) => (
        { bookmark_id: id, primary_topic: tagsOf(id), secondary_topic: null }
      ))}
    })
  }

  it('落进「其他」的书签会带着存活目录再问一次，选中了就改判并重写理由', async () => {
    const prompts: string[] = []
    const complete = rehomeComplete(prompts)

    const fake = createFakeBookmarks(rehomeTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    })
    const res = await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' },
      { createClient: () => ({ complete }), now: () => 1 },
    ) as { plan: OrganizePlan }

    // 二次判定确实发生了：分类提示词出现了两次
    expect(prompts).toHaveLength(2)
    // 第二次只带那一条被撤的书签
    expect(prompts[1]).toContain('"c0"')
    expect(prompts[1]).not.toContain('"a0"')
    // 「其他」这时候还活着（d0/d1/d2 撑着），但候选里必须被剔掉——这才是这条断言
    // 真正要盯住的东西：不剔掉的话，模型会把它当默认答案，「其他」永远也不会真正退场。
    // 候选行是「id=xxx 目录=02 其他」这种带编号的写法，不能拿 '目录=其他' 去匹配——
    // 那个子串永远凑不出来，断言会白转（见 final-review.md I1 的实测教训）
    expect(prompts[1]).not.toContain('其他')
    // 改判后的理由点名的是它真正被挤出来的那个目录「冷门」，不是「其他」（见 I2）
    const row = res.plan.rows.find((r) => r.bookmarkId === 'c0')!
    expect(row.reason).toContain('冷门')
    expect(row.reason).toContain('不足 3 个')
    expect(row.reason).toContain('前端')
    expect(row.toPath.at(-1)).toContain('前端')
    // confidence 用的是二次判定这一次的把握度，不是首次分类那次对「冷门」的把握度（见 I3）
    expect(row.confidence).toBeCloseTo(0.42)
  })

  // 判准 A5 此前全链路一个执行点都没有：真实那一遍「其他」占 34.8%，那个数没有任何人
  // 算过，用户看到的是一棵没有任何警告的树（organize-audit-holes 05 票）。
  // 这条夹具里 d0..d10 共 11 条全落进「其他」，总数 23 条 → 47.8%，远过 10% 红线。
  it('「其他」占比过红线时，复核页警告里带上条数与百分比', async () => {
    const complete = rehomeComplete([])
    const fake = createFakeBookmarks(rehomeTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    })
    const res = await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' },
      { createClient: () => ({ complete }), now: () => 1 },
    ) as { plan: OrganizePlan }

    const warning = res.plan.warnings.find((w) => w.includes('其他') && w.includes('%'))
    expect(warning).toBeDefined()
    // 光说「有点多」没用——用户要靠这两个数才判得出这次整理值不值得应用（判准 C）
    expect(warning).toContain('11')
    expect(warning).toContain('47.8')
    expect(warning).toContain('10')
  })

  // 开关删掉之前，`rebuild && settings.enforceMinFolderSize` 这道闸把**整个二次判定**
  // 一起关掉了：关过开关的人不但小目录不撤，掉进「其他」的书签也不会再问一次模型。
  // 这是删旋钮真正的行为变化里最容易被忽略的一半，单独钉一条
  it('存量记录里躺着 enforceMinFolderSize=false，二次判定那一轮照样会跑', async () => {
    const prompts: string[] = []
    const complete = rehomeComplete(prompts)
    const fake = createFakeBookmarks(rehomeTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const settings = {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    }
    await saveSettings(ports, settings)
    await ports.storage.set(SETTINGS_KEY, { ...settings, enforceMinFolderSize: false })
    const res = await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' },
      { createClient: () => ({ complete }), now: () => 1 },
    ) as { plan: OrganizePlan }

    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('"c0"')
    // c0 真的被改判去了「前端」，不是问过一轮就丢掉结果
    expect(res.plan.rows.find((r) => r.bookmarkId === 'c0')!.toPath.at(-1)).toContain('前端')
  })

  it('模型说没有合适的，就保持 prune 定好的去处，不再改判', async () => {
    let classifyCalls = 0
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.includes('标签清单')) {
        return { folders: [
          { title: '前端', topics: ['前端'], children: [] },
          { title: '冷门', topics: ['冷门'], children: [] },
        ]}
      }
      if (prompt.includes('候选目录')) {
        classifyCalls += 1
        const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)].map((m) => m[1]!)
        const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
        if (classifyCalls === 1) {
          return { results: bookmarkIds.map((id) => ({
            bookmark_id: id,
            target_category_id:
              id.startsWith('a') ? ids[0]! : id === 'c0' ? ids[1]! : id.startsWith('c') ? ids[0]! : ids[2]!,
            confidence: 0.9,
            reason: 'r',
          }))}
        }
        // 二次判定：模型说没有更合适的目录
        return { results: bookmarkIds.map((id) => (
          { bookmark_id: id, target_category_id: null, confidence: 0.5, reason: 'r' }
        ))}
      }
      const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
      return { results: bookmarkIds.map((id) => (
        { bookmark_id: id, primary_topic: tagsOf(id), secondary_topic: null }
      ))}
    })

    const fake = createFakeBookmarks(rehomeTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    })
    const res = await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' },
      { createClient: () => ({ complete }), now: () => 1 },
    ) as { plan: OrganizePlan }

    // 二次判定确实被问过一次，不是压根没进这个分支
    expect(classifyCalls).toBe(2)
    // 没有改判成别的目录，去处仍是 prune 定好的：并进「其他」
    const row = res.plan.rows.find((r) => r.bookmarkId === 'c0')
    expect(row).toBeDefined()
    expect(row!.toPath.at(-1)).toContain('其他')
    expect(row!.reason).toContain('冷门')
  })

  it('二次判定改判之后，「其他」若被抽薄会被再撤一遍，不会建出一个不足下限的目录（钉住 C1）', async () => {
    // 更贴近票面复现场景的最小夹具：min=3，a0..a10（11 条）→ 前端、
    // b0 → 冷门、b1/b2 → 其他；prune 把 b0 并进「其他」使其达标（3 条），
    // 二次判定又把 b0 改判去「前端」，「其他」只剩 b1/b2 两条——
    // 如果没有人在这之后再数一遍，计划里就会凭空出现一个装 2 条、
    // 低于 minFolderSize=3 的「其他」目录。
    //
    // a 组的条数被两头夹着：
    // - **下界**：一级目录数由总数推导，6 条只推导得出 1 个一级目录，减去给「其他」
    //   留的位子后连「前端」都设计不出来。总数要够 13 条才推导得出 2 个位子 + 「其他」。
    // - **上界**：a* 全进「前端」、二次判定又把 b0 从「冷门」捞进「前端」，所以
    //   「前端」最终是 a + 1，必须 ≤ MAX_LEAF。越界的话「结构自检其二」会把「前端」
    //   再切一层，与这条用例要钉住的 C1（「其他」的二次撤销）是两件事。
    // - 另有一条 25 的天花板：分类批次大小上限，超过会被拆成两批、打乱 classifyCalls。
    //
    // MAX_LEAF 从 20 收到 12（issues/38 的 D2）之后上界收紧，a 从 16 降到 11
    // （11+1=12 正好落在线上），总数 14 仍在下界之上
    const minTree = [
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: '收件箱', children: [
            ...Array.from({ length: 11 }, (_, i) => ({ id: `a${i}`, title: `书签 a${i}`, url: `https://a${i}.dev` })),
            { id: 'b0', title: '书签 b0', url: 'https://b0.dev' },
            { id: 'b1', title: '书签 b1', url: 'https://b1.dev' },
            { id: 'b2', title: '书签 b2', url: 'https://b2.dev' },
          ]},
        ]},
      ]},
    ]
    let classifyCalls = 0
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.includes('标签清单')) {
        return { folders: [
          { title: '前端', topics: ['前端'], children: [] },
          { title: '冷门', topics: ['冷门'], children: [] },
        ]}
      }
      if (prompt.includes('候选目录')) {
        classifyCalls += 1
        const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)].map((m) => m[1]!)
        const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
        if (classifyCalls === 1) {
          // a* 全进「前端」，b0 进「冷门」，b1/b2 模型直接分进「其他」
          return { results: bookmarkIds.map((id) => ({
            bookmark_id: id,
            target_category_id: id.startsWith('a') ? ids[0]! : id === 'b0' ? ids[1]! : ids[2]!,
            confidence: 0.9,
            reason: 'r',
          }))}
        }
        // 二次判定：把「冷门」被挤出来的 b0 改判进「前端」
        return { results: bookmarkIds.map((id) => (
          { bookmark_id: id, target_category_id: ids[0]!, confidence: 0.8, reason: 'r' }
        ))}
      }
      const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
      return { results: bookmarkIds.map((id) => (
        { bookmark_id: id, primary_topic: id.startsWith('a') ? '前端' : '冷门', secondary_topic: null }
      ))}
    })

    const fake = createFakeBookmarks(minTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    })
    const res = await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' },
      { createClient: () => ({ complete }), now: () => 1 },
    ) as { plan: OrganizePlan }

    // 不变量：每一个真的会被建出来的目录，落进去的书签数都不低于 minFolderSize——
    // 哪怕它是二次判定改判之后才变薄的
    const createdIds = new Set(
      res.plan.operations.filter((o) => o.type === 'create_folder').map((o) => o.temporaryId),
    )
    const countByFolder = new Map<string, number>()
    for (const op of res.plan.operations) {
      if (op.type !== 'move_bookmark' || op.toTemporaryId === null) continue
      countByFolder.set(op.toTemporaryId, (countByFolder.get(op.toTemporaryId) ?? 0) + 1)
    }
    for (const id of createdIds) {
      expect(countByFolder.get(id) ?? 0).toBeGreaterThanOrEqual(3)
    }
    // 具体到这个场景：「其他」被二次撤销，b1/b2 退回原位，计划里看不到「其他」这个目的地
    expect(res.plan.rows.some((r) => r.toPath.at(-1)?.includes('其他'))).toBe(false)
    expect(res.plan.rows.find((r) => r.bookmarkId === 'b0')?.toPath.at(-1)).toContain('前端')
  })

})

describe('analyze 的目录形状由书签数推导', () => {
  /** 造一棵「书签栏 / 收件箱」的树，收件箱里放 count 条书签。 */
  function treeWith(count: number) {
    return [{ id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '收件箱', children: Array.from({ length: count }, (_, i) => (
          { id: `b${i}`, title: `书签 b${i}`, url: `https://b${i}.dev` }
        )) },
      ]},
    ]}]
  }

  /** 抓住目录设计那一次的提示词。 */
  /**
   * @param legacyKeys 直接写进**存量记录**的旧键。这些键已经不在 Settings 类型里，
   *   只能从存储那一侧模拟「老用户机器上躺着这些值」——这也正是它们唯一还可能出现的地方。
   */
  async function designPromptFor(count: number, legacyKeys: Record<string, unknown> = {}): Promise<string> {
    const prompts: string[] = []
    const complete = vi.fn(async (prompt: string) => {
      const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
      if (prompt.includes('标签清单')) {
        prompts.push(prompt)
        return { folders: [{ title: '前端', topics: ['前端'], children: [] }] }
      }
      if (prompt.includes('候选目录')) {
        const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)].map((m) => m[1]!)
        return { results: bookmarkIds.map((id) => (
          { bookmark_id: id, target_category_id: ids[0] ?? null, confidence: 0.9, reason: 'r' }
        ))}
      }
      return { results: bookmarkIds.map((id) => (
        { bookmark_id: id, primary_topic: '前端', secondary_topic: null }
      ))}
    })
    const fake = createFakeBookmarks(treeWith(count))
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    }
    await saveSettings(ports, settings)
    if (Object.keys(legacyKeys).length > 0) {
      await ports.storage.set(SETTINGS_KEY, { ...settings, ...legacyKeys })
    }
    await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' },
      { createClient: () => ({ complete }), now: () => 1 },
    )
    return prompts[0]!
  }

  it('书签少时提示词要求一层，且目录数按推导给（30 条 → 推导 3 个主题）', async () => {
    const prompt = await designPromptFor(30)
    expect(prompt).toContain('只输出一层')
    // 推导 ceil(30/12) = 3 个主题目录（topWithFallback）。「其他」加在推导值之上，
    // 传给 designTagFolders 的预算是 **topWithFallback + 1 = 4**（final-review.md I1
    // 修复后：「其他」不再从推导值里扣）。写进提示词的是 **4 − 1 = 3**：
    // buildDesignPrompt 在非 oneLevel 时会 `max - 1`，给建树阶段补的「其他」留一个位子
    // （见 src/llm/folders.ts 的 buildDesignPrompt 与 core/tree.ts 的 `slice(0, maxSiblings - 1)`）。
    // 也就是说预算 4 个 = 3 个主题目录（与推导值 topWithFallback 相等）+ 1 个「其他」，
    // 账现在是平的——推导要几个主题就真的留几个，不再被「其他」占掉一格。
    expect(prompt).toMatch(/不超过 3 个/)
  })

  it('小库不会塌成只剩一个「其他」——推导只要 1 个目录时也得留出真目录的位子', async () => {
    const prompt = await designPromptFor(10)
    expect(prompt).toMatch(/不超过 1 个/)
  })

  it('书签多到撑不下一层时才允许二级（250 条）', async () => {
    const prompt = await designPromptFor(250)
    expect(prompt).not.toContain('只输出一层')
  })

  // 这两条原来是把旋钮当成 Settings 字段拧一下，验「handlers 不读它」。字段删掉后
  // 旋钮只可能以一种形态出现：老用户机器上的存量记录。断言的对象因此下沉了一层——
  // 从「读进来了但没人听」变成「连读都不读」，问的仍是同一件事：**装着旧值的那台机器，
  // 这次整理会不会被它带偏。**
  it('存量记录里躺着 maxTopFolders=6，目录数仍按书签数推导', async () => {
    // 旧值说 6，推导仍然按书签数说 3 个主题（预算 3+1=4，提示词里是 4 − 1 = 3）
    const prompt = await designPromptFor(30, { maxTopFolders: 6 })
    expect(prompt).toMatch(/不超过 3 个/)
  })

  it('存量记录里躺着 maxFolderDepth=1，250 条仍然分得出两层', async () => {
    // 旧值说只许一层，但 250 条按推导该有两层
    const prompt = await designPromptFor(250, { maxFolderDepth: 1 })
    expect(prompt).not.toContain('只输出一层')
  })

  // 钉住 I1：「其他」加在推导值之上而不是从里面扣，判准 A1（叶子 ≤ 20）才不会被
  // 顶破。190 条落在复核报告 final-review.md I1 点名的破 A1 区间 [181,200] 内：
  // deriveShape(190) = { top: 10, depth: 1, leaves: 10 }，topWithFallback = 10。
  // 旧账（「其他」从推导值里扣）只留 9 个主题槽位，190/9 ≈ 21.1 条会超过 20；
  // 新账（maxTopFolders = topWithFallback + 1 = 11）留出 10 个主题槽位，
  // 每个 190/10 = 19 条，不超上限。这里造 10 个大小均匀的主题（各 19 条），
  // 让它们都不被 ranked.slice(0, maxSiblings - 1) 截掉，才是真的在验这件事——
  // 少造几个主题，账目问题再大也测不出来。
  it('N=190（落在 I1 点名的 [181,200] 破 A1 区间内）：修复后每个叶子目录不超过 20 条', async () => {
    const TOPIC_COUNT = 10
    const PER_TOPIC = 19
    const total = TOPIC_COUNT * PER_TOPIC // 190
    const topicOf = (id: string): number => Number(id.slice(1)) % TOPIC_COUNT

    const complete = vi.fn(async (prompt: string) => {
      const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
      if (prompt.includes('标签清单')) {
        return { folders: Array.from({ length: TOPIC_COUNT }, (_, i) => ({
          title: `主题${i}`, topics: [`主题${i}`], children: [],
        }))}
      }
      if (prompt.includes('候选目录')) {
        const idByTitle = new Map(
          [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)].map((m) => [m[2]!, m[1]!]),
        )
        return { results: bookmarkIds.map((id) => {
          const target = [...idByTitle.entries()]
            .find(([title]) => title.includes(`主题${topicOf(id)}`))?.[1] ?? null
          return { bookmark_id: id, target_category_id: target, confidence: 0.9, reason: 'r' }
        })}
      }
      return { results: bookmarkIds.map((id) => (
        { bookmark_id: id, primary_topic: `主题${topicOf(id)}`, secondary_topic: null }
      ))}
    })
    const fake = createFakeBookmarks([{ id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '收件箱', children: Array.from({ length: total }, (_, i) => (
          { id: `b${i}`, title: `书签${i}`, url: `https://b${i}.dev` }
        )) },
      ]},
    ]}])
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    })
    const res = await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' },
      { createClient: () => ({ complete }), now: () => 1 },
    ) as { plan: OrganizePlan }

    const createdIds = new Set(
      res.plan.operations.filter((o) => o.type === 'create_folder').map((o) => o.temporaryId),
    )
    const countByFolder = new Map<string, number>()
    for (const op of res.plan.operations) {
      if (op.type !== 'move_bookmark' || op.toTemporaryId === null) continue
      countByFolder.set(op.toTemporaryId, (countByFolder.get(op.toTemporaryId) ?? 0) + 1)
    }
    // 十个主题都真的建出了目录，没有一个被挤进「其他」——这正是修复要保住的那件事
    const topicFolderCounts = [...createdIds].filter((id) => countByFolder.has(id)).map((id) => countByFolder.get(id)!)
    expect(topicFolderCounts).toHaveLength(TOPIC_COUNT)
    for (const count of topicFolderCounts) {
      expect(count).toBeLessThanOrEqual(20)
    }
  })

  it('建完树后把预算与实际并排记进日志——报的是生效值，不是 deriveShape 的原始返回', async () => {
    const complete = vi.fn(async (prompt: string) => {
      const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
      if (prompt.includes('标签清单')) {
        // 只给 1 个主题目录，让 buildCategoryTree 自己补的兜底「其他」目录
        // 凑成实际 2 个（1 主题 + 其他）——预算 4、实际 2 才真正差得出来。
        // 之前这里给两个主题目录，凑巧和旧的推导值一样是 3 个（2 主题 + 其他），
        // 那条用例其实没演示出「差多少」，见 issues/10-shape-from-count.md。
        return { folders: [
          { title: '前端', topics: ['前端'], children: [] },
        ]}
      }
      if (prompt.includes('候选目录')) {
        const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)].map((m) => m[1]!)
        return { results: bookmarkIds.map((id) => (
          { bookmark_id: id, target_category_id: ids[0] ?? null, confidence: 0.9, reason: 'r' }
        ))}
      }
      // 全部打成同一个主题，配合上面只给一个目录的设计结果，
      // 让实际只建出「前端」+ 兜底「其他」两个一级目录
      return { results: bookmarkIds.map((id) => (
        { bookmark_id: id, primary_topic: '前端', secondary_topic: null }
      ))}
    })
    const fake = createFakeBookmarks([{ id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '收件箱', children: Array.from({ length: 30 }, (_, i) => (
          { id: `b${i}`, title: `书签 b${i}`, url: `https://b${i}.dev` }
        )) },
      ]},
    ]}])
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    })
    const events: ProgressEvent[] = []
    await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' },
      { createClient: () => ({ complete }), now: () => 1, onEvent: (e) => events.push(e) },
    )

    const line = events.find((e) => e.message.includes('推导'))
    expect(line).toBeDefined()
    // deriveShape(30) 的原始返回是 { top: 3, depth: 1 }；日志报的不是这两个数，
    // 而是真正传下去、真正生效的那组：maxTopFolders = topWithFallback(3) + 1 = 4，
    // 与实际会建的层数 allowChildren ? 2 : 1 = 1（N=30 撑不起两层）（见 I2）。
    expect(line!.message).toContain('4 个一级目录')
    expect(line!.message).toContain('1 层')
    expect(line!.message).toContain('实际建出 2 个')
  })

  // N > 1200 时 deriveShape 把三层的分配留空（shape.top === 0、shape.depth === 3，
  // 都是占位符，见 core/shape.ts 第 59-63 行）。这条覆盖两件事：
  // 1. 兜底确实生效——topWithFallback 退回 SHAPE_MAX_SIBLINGS，不会塌成 0；
  // 2. I2 修复前，日志在这条路径上会打印「0 个一级目录、3 层」，两个数字都不是
  //    实际发生的事（实际预算 11、实际只建 2 层，allowChildren 只开一层 children，
  //    不会真的递归出第三层）。修复后应报「11 个一级目录、2 层」。
  it('N > 1200 走三层兜底：日志报的是生效值（预算 11、2 层），不是推导原始值（0、3）', async () => {
    const complete = vi.fn(async (prompt: string) => {
      const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
      if (prompt.includes('标签清单')) {
        return { folders: [{ title: '前端', topics: ['前端'], children: [] }] }
      }
      if (prompt.includes('候选目录')) {
        const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)].map((m) => m[1]!)
        return { results: bookmarkIds.map((id) => (
          { bookmark_id: id, target_category_id: ids[0] ?? null, confidence: 0.9, reason: 'r' }
        ))}
      }
      return { results: bookmarkIds.map((id) => (
        { bookmark_id: id, primary_topic: '前端', secondary_topic: null }
      ))}
    })
    const fake = createFakeBookmarks([{ id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '收件箱', children: Array.from({ length: 1300 }, (_, i) => (
          { id: `b${i}`, title: `书签 b${i}`, url: `https://b${i}.dev` }
        )) },
      ]},
    ]}])
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    })
    const events: ProgressEvent[] = []
    await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' },
      { createClient: () => ({ complete }), now: () => 1, onEvent: (e) => events.push(e) },
    )

    const line = events.find((e) => e.message.includes('推导'))
    expect(line).toBeDefined()
    expect(line!.message).toContain('11 个一级目录')
    expect(line!.message).toContain('2 层')
    expect(line!.message).not.toContain('0 个一级目录')
    expect(line!.message).not.toContain('3 层')
  })
})

/**
 * test_model：配好模型之后当场验一次。
 *
 * 这组用例守的核心不是「能不能通」，而是**失败时说不说得清是哪一类**——这个功能
 * 由一次真实故障催生，那次的错误只有一句笼统的「网络请求失败」，分不清是 Key、
 * 模型名、host 权限、代理，还是别的扩展在拦，定位耗了十几轮对话。只报「失败了」
 * 等于没做，所以每一类失败都单独有一条用例钉住。
 */
describe('test_model 当场验一次模型配置', () => {
  /** 没调用 saveSettings 时 loadSettings 落回 DEFAULT_SETTINGS，测的这一对跟着它走。 */
  const { baseUrl: defaultBaseUrl, model: defaultModel } = activeLlm(DEFAULT_SETTINGS)
  const DEFAULT_TEST_REQ = { kind: 'test_model' as const, baseUrl: defaultBaseUrl, apiKey: '', model: defaultModel }

  function setupTest(client: LlmClient, now: () => number = () => 1) {
    const fake = createFakeBookmarks(tree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    return { ports, deps: { createClient: () => client, now } }
  }

  /** 造一个「客户端抛错」的假客户端。消息照 llm/client.ts 的模板拼，形状要真。 */
  function throwing(message: string): LlmClient {
    return { complete: vi.fn().mockRejectedValue(new LlmError(message, false)) }
  }

  it('客户端按 schema 作答时报成功，并带上耗时', async () => {
    const client: LlmClient = { complete: vi.fn().mockResolvedValue({ ok: true }) }
    const { ports, deps } = setupTest(client)
    const res = await handle(ports, DEFAULT_TEST_REQ, deps)
    expect(res).toMatchObject({ ok: true, kind: 'test_model' })
    expect(typeof (res as { ms: number }).ms).toBe('number')
  })

  it('耗时是真的量出来的，不是写死的常数', async () => {
    let clock = 1000
    const client: LlmClient = { complete: vi.fn().mockResolvedValue({ ok: false }) }
    const { ports, deps } = setupTest(client, () => (clock += 40))
    const res = await handle(ports, DEFAULT_TEST_REQ, deps)
    // 模型答 { ok: false } 也算通过：这一步验的是「会不会按格式答」，
    // 不是「它答了什么」
    expect(res).toMatchObject({ ok: true, kind: 'test_model', ms: 40 })
  })

  it('确实是用真客户端的 complete() 发了一个带 schema 的请求，不是只看 HTTP 200', async () => {
    const complete = vi.fn().mockResolvedValue({ ok: true })
    const { ports, deps } = setupTest({ complete })
    await handle(ports, DEFAULT_TEST_REQ, deps)
    expect(complete).toHaveBeenCalledTimes(1)
    const schema = complete.mock.calls[0]![1] as { type?: string; required?: string[] }
    expect(schema.type).toBe('object')
    expect(schema.required).toContain('ok')
  })

  it('401 报 auth：Key 不对', async () => {
    const { ports, deps } = setupTest(throwing('模型接口返回 401: {"error":"Incorrect API key provided"}'))
    const res = await handle(ports, DEFAULT_TEST_REQ, deps)
    expect(res).toMatchObject({ ok: false, reason: 'auth' })
  })

  it('403 报 auth：Key 有效但没权限用', async () => {
    const { ports, deps } = setupTest(throwing('模型接口返回 403: {"error":"Forbidden"}'))
    const res = await handle(ports, DEFAULT_TEST_REQ, deps)
    expect(res).toMatchObject({ ok: false, reason: 'auth' })
  })

  it('404 报 model：模型名不对', async () => {
    const { ports, deps } = setupTest(throwing('模型接口返回 404: {"error":"The model `gpt-9` does not exist"}'))
    const res = await handle(ports, DEFAULT_TEST_REQ, deps)
    expect(res).toMatchObject({ ok: false, reason: 'model' })
  })

  it('400 且响应体提到 model 时报 model', async () => {
    const { ports, deps } = setupTest(throwing('模型接口返回 400: {"error":{"param":"model","message":"invalid model name"}}'))
    const res = await handle(ports, DEFAULT_TEST_REQ, deps)
    expect(res).toMatchObject({ ok: false, reason: 'model' })
  })

  it('英文语境下的 400 不因为模板里那个 Model 字样被误判成模型名不对', async () => {
    // client.ts 的英文模板是「Model API returned 400: <body>」——整条消息天然带 model 字样。
    // 拿整条消息去匹配的实现会把每一个英文 400 都说成「模型名不对」，那是说错，
    // 不是说笼统。判定只能看冒号后面的响应体。
    const { ports, deps } = setupTest(throwing('Model API returned 400: {"error":"temperature must be a number"}'))
    const res = await handle(ports, DEFAULT_TEST_REQ, deps)
    expect(res).toMatchObject({ ok: false, reason: 'network' })
    // 防身：确实走到了失败分支、拿到的是这条错误，不是因为压根没跑起来才绿
    expect((res as { error: string }).error).toContain('temperature')
  })

  it('英文语境下的 404 同样报 model', async () => {
    const { ports, deps } = setupTest(throwing('Model API returned 404: {"error":"model not found"}'))
    const res = await handle(ports, DEFAULT_TEST_REQ, deps)
    expect(res).toMatchObject({ ok: false, reason: 'model' })
  })

  it('Failed to fetch 报 network：请求压根没发出去', async () => {
    const { ports, deps } = setupTest(throwing('网络请求失败（耗时 12ms）: TypeError: Failed to fetch'))
    const res = await handle(ports, DEFAULT_TEST_REQ, deps)
    expect(res).toMatchObject({ ok: false, reason: 'network' })
  })

  it('500 报 network，不因为响应体里出现 unauthorized 就改口说 Key 不对', async () => {
    const { ports, deps } = setupTest(throwing('模型接口返回 500: {"error":"upstream unauthorized"}'))
    const res = await handle(ports, DEFAULT_TEST_REQ, deps)
    expect(res).toMatchObject({ ok: false, reason: 'network' })
  })

  it('客户端抛「返回的不是合法 JSON」时报 format：接口通了但模型不会按格式答', async () => {
    const { ports, deps } = setupTest(throwing('模型返回的不是合法 JSON: 好的，我这就为你检查连接。'))
    const res = await handle(ports, DEFAULT_TEST_REQ, deps)
    expect(res).toMatchObject({ ok: false, reason: 'format' })
  })

  it('客户端答出来的东西不是要的形状时报 format——只看 HTTP 200 会给假绿灯', async () => {
    // 能回 200、能回合法 JSON，但答的不是我们要的 schema。这类厂商测试绿了、真跑照样废。
    const client: LlmClient = { complete: vi.fn().mockResolvedValue({ answer: '连接正常' }) }
    const { ports, deps } = setupTest(client)
    const res = await handle(ports, DEFAULT_TEST_REQ, deps)
    expect(res).toMatchObject({ ok: false, reason: 'format' })
    expect((res as { error: string }).error).not.toBe('')
  })

  it('客户端答出一个字符串时同样报 format', async () => {
    const client: LlmClient = { complete: vi.fn().mockResolvedValue('ok') }
    const { ports, deps } = setupTest(client)
    const res = await handle(ports, DEFAULT_TEST_REQ, deps)
    expect(res).toMatchObject({ ok: false, reason: 'format' })
  })

  it('返回值里一个字节都不带 API Key——上游把 Key 拼进错误消息也一样', async () => {
    const CANARY = 'sk-CANARY-DO-NOT-LEAK'
    // 厂商的错误响应体原样回显请求头是真实存在的行为，所以剥除必须在返回之前自己做，
    // 不能指望上游不拼
    const client = throwing(`模型接口返回 401: {"error":"Incorrect API key provided: ${CANARY}"}`)
    const fake = createFakeBookmarks(tree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'https://api.deepseek.com/v1', apiKey: CANARY, model: 'deepseek-chat' }),
    })
    const res = await handle(
      ports,
      { kind: 'test_model', baseUrl: 'https://api.deepseek.com/v1', apiKey: CANARY, model: 'deepseek-chat' },
      { createClient: () => client, now: () => 1 },
    )

    // 防身：先确认这次确实失败了、确实是那条 401 错误——否则一个「永远返回空字符串」
    // 的实现也会让下面那条断言绿
    expect(res).toMatchObject({ ok: false, reason: 'auth' })
    const error = (res as { error: string }).error
    expect(error).toContain('401')
    expect(error).toContain('Incorrect API key provided')
    // 正题
    expect(error).not.toContain(CANARY)
    expect(JSON.stringify(res)).not.toContain(CANARY)
  })

  it('本机模型服务器的空 Key 不会把整条错误消息剥成星号', async () => {
    // 空串是「没配 Key」，不是一个要剥的秘密。按空串做替换会把消息炸成逐字符插入。
    const fake = createFakeBookmarks(tree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      ...withLlm({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen2.5' }),
    })
    const client = throwing('网络请求失败（耗时 3ms）: TypeError: Failed to fetch')
    const res = await handle(
      ports,
      { kind: 'test_model', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen2.5' },
      { createClient: () => client, now: () => 1 },
    )
    expect(res).toMatchObject({ ok: false, reason: 'network' })
    expect((res as { error: string }).error).toBe('网络请求失败（耗时 3ms）: TypeError: Failed to fetch')
  })

  it('uiLocale 为 en 时错误消息是英文——这一步也走请求级的语言', async () => {
    const fake = createFakeBookmarks(tree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, { ...DEFAULT_SETTINGS, uiLocale: 'en' })
    const client: LlmClient = { complete: vi.fn().mockResolvedValue({ answer: 'fine' }) }
    const res = await handle(ports, DEFAULT_TEST_REQ, { createClient: () => client, now: () => 1 })
    expect(res).toMatchObject({ ok: false, reason: 'format' })
    expect((res as { error: string }).error).not.toMatch(/[一-龥]/)
    setLocale('zh_CN')
  })
})

describe('list_models 列出端点上的模型', () => {
  it('把名单原样带回，Key 跟请求走不从 settings 里找', async () => {
    const listModels = vi.fn(async () => ['glm-5.2', 'deepseek-chat'])
    const fake = createFakeBookmarks(tree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const res = await handle(
      ports,
      { kind: 'list_models', baseUrl: 'https://opencode.ai/zen/go/v1', apiKey: 'sk-draft' },
      { listModels },
    )
    expect(res).toEqual({
      ok: true, kind: 'list_models', models: ['glm-5.2', 'deepseek-chat'],
    })
    expect(listModels).toHaveBeenCalledWith('https://opencode.ai/zen/go/v1', 'sk-draft')
  })

  it('列出失败就报错，不装成空名单', async () => {
    const fake = createFakeBookmarks(tree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const res = await handle(
      ports,
      { kind: 'list_models', baseUrl: 'https://x/v1', apiKey: 'sk' },
      { listModels: async () => { throw new Error('模型列表接口返回 401: ***') } },
    )
    expect(res).toMatchObject({ ok: false, error: '模型列表接口返回 401: ***' })
  })
})


describe('下切预算跟着库规模走', () => {
  // 这个数曾经写死 20。判准 A1 的上限从 20 收到 12 之后（issues/38 的 D2），
  // deriveShape 瞄准的正好是上限，四成叶子必然超标要切——下切从异常路径变成常规路径，
  // 20 这个顶在 N≈454 就会被打满（原型见 tools/deepen-budget.mjs）。
  // 这几条钉住「它跟着规模走」，免得哪天有人把它改回一个常数而没人发现。
  it('小库仍是下限 20，不因为叶子少就把顶压到不够用', () => {
    expect(deepenBudget(1)).toBe(20)
    expect(deepenBudget(10)).toBe(20)   // N≈123 的真实库就是 10 个叶子
    expect(deepenBudget(20)).toBe(20)
  })

  it('叶子多过下限时顶跟着叶子走', () => {
    expect(deepenBudget(42)).toBe(42)    // N≈500
    expect(deepenBudget(100)).toBe(100)  // N≈1200
  })

  it('顶随叶子单调不减——规模变大绝不会让预算变小', () => {
    let prev = 0
    for (let leaves = 1; leaves <= 200; leaves += 1) {
      const cur = deepenBudget(leaves)
      expect(cur).toBeGreaterThanOrEqual(prev)
      prev = cur
    }
  })

  // 实测需要量约 0.5 × leaves（N=1200 时 100 个叶子要 53 次）。留一倍余量是有意的,
  // 这条钉住余量还在——它掉到 1 倍以下就说明有人把公式改紧了。
  it('给的顶至少是实测需要量的两倍', () => {
    for (const leaves of [30, 50, 84, 100]) {
      expect(deepenBudget(leaves)).toBeGreaterThanOrEqual(Math.ceil(leaves * 0.5) * 2)
    }
  })
})

describe('结构自检：撑爆的叶子再切一层', () => {
  const COUNT = 25

  /**
   * @param deepenFolders 第二次（下切那次）目录设计的返回值。
   *   传两个目录 = 切得开；传一个目录 = 模型切不动，验止损与警告那条路。
   */
  function setupOversized(
    deepenFolders: Array<{ title: string; topics: string[]; children: [] }>,
    // 在范围根下预置一个与设计出的目录同名的已有目录，逼 core/tree.ts 走「复用」那条路
    // （findChild(rootId, title) 撞上就不新建）。留空则「前端工具」是本批新建的。
    options: {
      reuseExisting?: boolean
      /** 下切那一次目录设计请求直接失败，验 designFolders 返回 null 那条路。 */
      deepenFails?: boolean
      /** 上一代标签全归到同一个主题，验 topics 不足两个那条路。 */
      singleTopic?: boolean
    } = {},
  ) {
    const fake = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '11', title: '收件箱', children: Array.from({ length: COUNT }, (_, i) => ({
            id: `b${i}`, title: `书签 ${i}`, url: `https://example.com/${i}`,
          })) },
          ...(options.reuseExisting === true
            ? [{ id: '12', title: '前端工具', children: [] }]
            : []),
        ]},
      ]},
    ])
    const designPrompts: string[] = []
    const complete = vi.fn(async (prompt: string) => {
      // 「标签清单：」是 llm/folders.ts 的 buildDesignPrompt 唯一固定拼进提示词的标记，
      // 两种目录设计调用（全局那次用「请据此设计目录结构」、下切 oneLevel 那次改用
      // 「需要为它们设计子目录」）共用它，「设计目录结构」这个字面串只在前者出现，
      // 拿它当判据会漏判下切那一次
      if (prompt.includes('标签清单：')) {
        designPrompts.push(prompt)
        // 下切那一轮的提示词会带上父目录名；全局那一轮只有主题清单，不会出现「前端工具」
        if (!prompt.includes('前端工具')) {
          return { folders: [{ title: '前端工具', topics: ['构建工具', '测试框架'], children: [] }] }
        }
        if (options.deepenFails === true) throw Object.assign(new Error('boom'), { retryable: false })
        return { folders: deepenFolders }
      }
      if (!prompt.includes('候选目录')) {
        // 上一代标签：两种主题，前 13 条构建工具、后 12 条测试框架
        return { results: Array.from({ length: COUNT }, (_, i) => ({
          bookmark_id: `b${i}`,
          primary_topic: options.singleTopic === true ? '构建工具' : (i < 13 ? '构建工具' : '测试框架'),
          secondary_topic: null,
        })) }
      }
      // 分类：全部塞进「前端工具」那个候选，制造一个装 25 条的目录
      const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)]
      const target = ids.find((m) => m[2]!.includes('前端工具'))?.[1] ?? ids[0]?.[1] ?? null
      const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
      return { results: bookmarkIds.map((id) => (
        { bookmark_id: id, target_category_id: target, confidence: 0.9, reason: 'r' }
      )) }
    })
    const events: ProgressEvent[] = []
    return {
      ports: { bookmarks: fake.api, storage: createFakeStorage() },
      deps: {
        createClient: () => ({ complete } as unknown as LlmClient),
        now: () => 1,
        onEvent: (event: ProgressEvent) => events.push(event),
      },
      designPrompts,
      events,
    }
  }

  const settings = {
    ...DEFAULT_SETTINGS,
    ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
    removeEmptyFolders: false,
    rewriteGithubTitles: false,
  }

  it('装 25 条的目录被切成子目录，只多花一次目录设计调用', async () => {
    const { ports, deps, designPrompts } = setupOversized([
      { title: '构建', topics: ['构建工具'], children: [] },
      { title: '测试', topics: ['测试框架'], children: [] },
    ])
    await saveSettings(ports, settings)
    const plan = await analyzePlan(ports, deps, 'rebuild')

    const created = plan.operations.flatMap((o) =>
      o.type === 'create_folder' ? [stripNumberPrefix(o.title)] : [])
    expect(created).toContain('构建')
    expect(created).toContain('测试')
    // 子目录挂在「前端工具」下面，是第 2 层
    expect(plan.candidates.some((c) => c.path.length === 2 && c.path[1]!.endsWith('构建'))).toBe(true)
    // 下切只发起了一次设计请求（全局那次不带父目录名，认得出来）
    expect(designPrompts.filter((p) => p.includes('前端工具'))).toHaveLength(1)
  })

  // 复用的已有目录曾经整条验算链都看不见（findOversizedFolders 默认 scope: 'new'），
  // 于是同一棵树、同一批书签、同一条判准，目录是新建的就切、是复用的就不切。
  // 推翻重建的承诺本来就是重新设计整棵树，这个分裂没有依据（02/03 票定案）。
  it('复用的已有目录撑爆了，推翻模式下同样要切', async () => {
    const { ports, deps, designPrompts } = setupOversized([
      { title: '构建', topics: ['构建工具'], children: [] },
      { title: '测试', topics: ['测试框架'], children: [] },
    ], { reuseExisting: true })
    await saveSettings(ports, settings)
    const plan = await analyzePlan(ports, deps, 'rebuild')

    // 「前端工具」是复用的（id 12，不是本批新建），但它装了 25 条，照样该被切开
    expect(plan.operations.some((o) => o.type === 'create_folder' && o.parentId === '12')).toBe(true)
    const created = plan.operations.flatMap((o) =>
      o.type === 'create_folder' ? [stripNumberPrefix(o.title)] : [])
    expect(created).toContain('构建')
    expect(created).toContain('测试')
    expect(designPrompts.filter((p) => p.includes('前端工具'))).toHaveLength(1)
  })

  it('模型切不动时不空转，改为在 warnings 里点名', async () => {
    const { ports, deps, designPrompts } = setupOversized([
      { title: '全部', topics: ['构建工具', '测试框架'], children: [] },
    ])
    await saveSettings(ports, settings)
    const plan = await analyzePlan(ports, deps, 'rebuild')

    // 两种标签被并进同一个子目录 = 只切得出一个，那一层不承载区分度，整个放弃
    const created = plan.operations.flatMap((o) =>
      o.type === 'create_folder' ? [stripNumberPrefix(o.title)] : [])
    expect(created).not.toContain('全部')
    // 不重复问同一个问题
    expect(designPrompts.filter((p) => p.includes('前端工具'))).toHaveLength(1)
    expect(plan.warnings.some((w) => w.includes('超过建议上限'))).toBe(true)
  })

  it('归入现有模式下一次都不切，只出警告', async () => {
    const { ports, deps, designPrompts } = setupOversized([])
    await saveSettings(ports, settings)
    const plan = await analyzePlan(ports, deps, 'additive')

    expect(designPrompts).toHaveLength(0)
    expect(plan.warnings.some((w) => w.includes('超过建议上限'))).toBe(true)
  })

  // 下面四条治的是同一个病：下切放弃时说不清是为什么放弃的。
  // 真实那一遍「其他」装了 109 条、一刀没切，日志里只有一句含糊的「标签不足以再分」
  // ——而三条放弃路径（主题不够、设计失败、设计了但没分开）里只有一条真是标签的问题。
  it('下切的目录设计失败时，日志点名是哪个目录、并说它保持原样', async () => {
    const { ports, deps, events } = setupOversized([], { deepenFails: true })
    await saveSettings(ports, settings)
    await analyzePlan(ports, deps, 'rebuild')

    const giveUp = events.filter((e) => e.message.includes('前端工具') && e.message.includes('保持原样'))
    expect(giveUp).toHaveLength(1)
    expect(giveUp[0]!.message).toContain('设计')
  })

  // logFoldersFailed 那条文案的尾巴是「保留原始标签进入建树」。下切发生在建树**之后**，
  // 那句话在这条路上是假的：没有任何标签被退回，只是这一个目录没被切开。
  it('下切的目录设计失败时不说「退回原始标签」——建树早就结束了', async () => {
    const { ports, deps, events } = setupOversized([], { deepenFails: true })
    await saveSettings(ports, settings)
    await analyzePlan(ports, deps, 'rebuild')

    expect(events.some((e) => e.message.includes('原始标签'))).toBe(false)
  })

  it('书签只归到一个主题时，日志报出主题数，而不是含糊说「标签不足」', async () => {
    const { ports, deps, events, designPrompts } = setupOversized([], { singleTopic: true })
    await saveSettings(ports, settings)
    await analyzePlan(ports, deps, 'rebuild')

    // 主题只有一个就不该再花一次设计调用
    expect(designPrompts.filter((p) => p.includes('前端工具'))).toHaveLength(0)
    const giveUp = events.filter((e) => e.message.includes('前端工具') && e.message.includes('保持原样'))
    expect(giveUp).toHaveLength(1)
    // 「1 个主题」这个数字是唯一能让用户判断该不该重试的东西
    expect(giveUp[0]!.message).toContain('1')
    expect(giveUp[0]!.message).toContain('主题')
  })

  it('设计出了子目录却没能把书签分开时，日志说的是没分开，不是标签不足', async () => {
    const { ports, deps, events } = setupOversized([
      { title: '全部', topics: ['构建工具', '测试框架'], children: [] },
    ])
    await saveSettings(ports, settings)
    await analyzePlan(ports, deps, 'rebuild')

    const giveUp = events.filter((e) => e.message.includes('前端工具') && e.message.includes('保持原样'))
    expect(giveUp).toHaveLength(1)
    // 这条路上标签是够的（两个主题），怪标签就是甩锅给了无辜的一方
    expect(giveUp[0]!.message).not.toContain('主题')
    expect(giveUp[0]!.message).toContain('分开')
  })
})

describe('cleanup_scan', () => {
  it('不带范围参数，扫的是整棵树', async () => {
    const bookmarks = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: 'a', url: 'https://a' },
        ]},
        { id: '2', title: '其他书签', children: [
          { id: '20', title: 'a 又存了一遍', url: 'https://a' },
        ]},
      ]},
    ])
    const ports = { bookmarks: bookmarks.api, storage: createFakeStorage() }

    const response = await handle(ports, { kind: 'cleanup_scan' })

    expect(response.ok).toBe(true)
    if (!response.ok || response.kind !== 'cleanup_scan') throw new Error('unexpected')
    // stale cleanup has a separate scoped message; the existing full-library request
    // still reports both top-level roots without a scope argument.
    expect(response.scan.scopeRootIds).toEqual(['1', '2'])
    expect(response.scan.duplicates).toHaveLength(1)
    expect(response.scan.duplicates[0]!.items.map((i) => i.id).sort()).toEqual(['10', '20'])
  })
})

describe('cleanup_stale_scan', () => {
  it('routes a scoped request to the stale scan engine', async () => {
    const bookmarks = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '10', title: '范围内', children: [
            { id: '100', title: '旧书签', url: 'https://old.example' },
          ] },
        ] },
        { id: '2', title: '其他书签', children: [
          { id: '20', title: '范围外', url: 'https://outside.example' },
        ] },
      ] },
    ])
    const history = createFakeHistory([
      { url: 'https://old.example', lastVisitTime: 1 },
      { url: 'https://outside.example', lastVisitTime: 1 },
    ])
    const ports = {
      bookmarks: bookmarks.api,
      history: history.api,
      storage: createFakeStorage(),
    }

    const response = await handle(ports, {
      kind: 'cleanup_stale_scan',
      scopeRootIds: ['1', '10'],
    })

    expect(response.ok).toBe(true)
    if (!response.ok || response.kind !== 'cleanup_stale_scan') throw new Error('unexpected')
    expect(response.scan.items.map(({ item }) => item.id)).toEqual(['100'])
    expect(response.scan.scopeRootIdByBookmarkId).toEqual({ '100': '1' })
  })

  it('returns the history query error instead of an empty stale result', async () => {
    const bookmarks = createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '100', title: '旧书签', url: 'https://old.example' },
        ] },
      ] },
    ])
    const history = createFakeHistory()
    history.api.search = vi.fn().mockRejectedValue(new Error('history unavailable'))
    const ports = {
      bookmarks: bookmarks.api,
      history: history.api,
      storage: createFakeStorage(),
    }

    const response = await handle(ports, {
      kind: 'cleanup_stale_scan',
      scopeRootIds: ['1'],
    })

    expect(response.ok).toBe(false)
    if (response.ok) throw new Error('unexpected')
    expect(response.error).toContain('history unavailable')
  })
})

describe('check_links', () => {
  it('把结果原样带回，非 http(s) 的目标不发请求', async () => {
    const calls: string[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
      calls.push(String(input))
      return new Response(null, { status: 404 })
    }) as unknown as typeof fetch

    const ports = { bookmarks: createFakeBookmarks([]).api, storage: createFakeStorage() }
    const response = await handle(ports, {
      kind: 'check_links',
      targets: [
        { bookmarkId: '1', url: 'https://gone.com/p' },
        { bookmarkId: '2', url: 'chrome://extensions' },
      ],
    }, { fetchImpl })

    expect(response.ok).toBe(true)
    if (!response.ok || response.kind !== 'check_links') throw new Error('unexpected')
    expect(response.results).toHaveLength(1)
    expect(response.results[0]!.verdict).toBe('dead')
    expect(calls).toEqual(['https://gone.com/p'])
  })
})
