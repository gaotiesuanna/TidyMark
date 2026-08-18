import { afterEach, describe, it, expect, vi } from 'vitest'
import { handle } from '@/background/handlers'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'
import { DEFAULT_SETTINGS, loadCache, saveSettings, type Settings } from '@/storage/settings'
import { currentLocale, setLocale } from '@/i18n'
import type { LlmClient } from '@/llm/client'
import type { OrganizePlan } from '@/core/types'
import type { ProgressEvent } from '@/background/events'
import { MAX_SIBLINGS } from '@/core/tree'

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

  it('analyze 返回可 Review 的 Plan', async () => {
    const { ports, deps } = setup({
      complete: vi.fn().mockResolvedValue({
        results: [{ bookmark_id: '100', target_category_id: '10', confidence: 0.9, reason: 'React 官网' }],
      }),
    })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
    })
    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { plan: { rows: unknown[] } }
    expect(res.plan.rows).toHaveLength(1)
  })

  it('apply 执行 Plan 并返回结果', async () => {
    const { ports, deps, fake } = setup({
      complete: vi.fn().mockResolvedValue({
        results: [{ bookmark_id: '100', target_category_id: '10', confidence: 0.9, reason: 'r' }],
      }),
    })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
    })
    const analyzed = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { plan: { rows: Array<{ bookmarkId: string }> } }
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: true,
      domainGroups: [],
      rewriteGithubTitles: false,
    })
    const analyzed = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { plan: unknown }
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
      llm: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-d', model: 'deepseek-chat' },
      rebuildStructure: true,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
    }
    await handle(ports, { kind: 'save_settings', settings }, deps)
    const res = await handle(ports, { kind: 'get_settings' }, deps) as { settings: typeof settings }
    expect(res.settings.llm.model).toBe('deepseek-chat')
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
    const fake = createFakeBookmarks(tree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: true,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
      // 这条验的是「标签 -> 建树 -> 分类」这条链路本身。夹具只有一个书签，
      // 开着目录下限就一个目录都建不出来，验不到想验的东西
      enforceMinFolderSize: false,
    })
    const complete = vi.fn()
      .mockResolvedValueOnce({ results: [{ bookmark_id: '100', primary_topic: '前端', secondary_topic: 'React' }] })
      .mockResolvedValueOnce({ folders: [{ title: '前端', topics: ['前端'], children: [] }] })
      .mockResolvedValueOnce({ results: [{ bookmark_id: '100', target_category_id: 'tmp:1', confidence: 0.9, reason: 'r' }] })
    const deps = { createClient: () => ({ complete }), now: () => 1 }

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { plan: { operations: Array<{ type: string }> } }
    expect(complete).toHaveBeenCalledTimes(3)
    expect(res.plan.operations.some((o) => o.type === 'create_folder')).toBe(true)
  })

  // review M9：非推翻模式新加的「无归属带回 topic」规则不该悄悄改变推翻模式的分类
  // 提示词——推翻模式的候选是刚设计出来的，用不上这条规则，而推翻模式的分类稳定性
  // 正是这整个工作流存在的理由，提示词不该因为一个它用不上的功能而发生任何变化。
  it('推翻模式下发给模型的分类提示词不带 topic 规则——那条只有非推翻模式用得上', async () => {
    const fake = createFakeBookmarks(tree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: true,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
      enforceMinFolderSize: false,
    })
    const classifyPrompts: string[] = []
    const complete = vi.fn(async (prompt: string) => {
      if (prompt.includes('候选目录：')) {
        classifyPrompts.push(prompt)
        return { results: [{ bookmark_id: '100', target_category_id: 'tmp:1', confidence: 0.9, reason: 'r' }] }
      }
      if (prompt.includes('标签清单：')) return { folders: [{ title: '前端', topics: ['前端'], children: [] }] }
      return { results: [{ bookmark_id: '100', primary_topic: '前端', secondary_topic: 'React' }] }
    })
    const deps = { createClient: () => ({ complete }), now: () => 1 }

    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps)
    expect(classifyPrompts).toHaveLength(1)
    expect(classifyPrompts[0]).not.toContain('topic')
  })

  it('一级目录上限从设置里读，并写进发给模型的目录设计提示词', async () => {
    const { ports } = setup()
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: true,
      maxTopFolders: 5,
    })
    const complete = vi.fn()
      .mockResolvedValueOnce({ results: [{ bookmark_id: '100', primary_topic: '前端' }] })
      .mockResolvedValueOnce({ folders: [{ title: '前端', topics: ['前端'], children: [] }] })
      .mockResolvedValueOnce({ results: [{ bookmark_id: '100', target_category_id: 'tmp:1', confidence: 0.9, reason: 'r' }] })
    const deps = { createClient: () => ({ complete }), now: () => 1 }

    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps)
    const prompts = complete.mock.calls.map((c) => c[0] as string)
    // 上限 5 减去给「其他」留的那一位 = 4
    expect(prompts.some((prompt) => prompt.includes('一级目录不超过 4 个'))).toBe(true)
  })

  it('嵌套上限设成 1 时，目录设计提示词要求只输出一层', async () => {
    const { ports } = setup()
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: true,
      maxFolderDepth: 1,
    })
    const complete = vi.fn()
      .mockResolvedValueOnce({ results: [{ bookmark_id: '100', primary_topic: '前端' }] })
      .mockResolvedValueOnce({ folders: [{ title: '前端', topics: ['前端'], children: [] }] })
      .mockResolvedValueOnce({ results: [{ bookmark_id: '100', target_category_id: 'tmp:1', confidence: 0.9, reason: 'r' }] })
    const deps = { createClient: () => ({ complete }), now: () => 1 }

    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps)
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: true,
      removeEmptyFolders: false,
      domainGroups: [],
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

    const first = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as {
      plan: { operations: Array<{ type: string; title?: string }> }
    }
    await handle(
      ports,
      { kind: 'apply', plan: first.plan as never, accepted: bookmarks.map((b) => b.id) },
      deps,
    )
    expect(fake.structure()).toContain('书签栏/01 前端/站点0')

    const second = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as {
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
        return { results: [{ bookmark_id: '100', primary_topic: 'React 生态' }] }
      }
      if (prompt.includes('设计目录结构')) {
        return { folders: [{ title: '前端框架', topics: ['React 生态'], children: [] }] }
      }
      return { results: [{ bookmark_id: '100', target_category_id: 'tmp:1', confidence: 0.9, reason: 'r' }] }
    })
    const { ports, deps } = setup({ complete })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: true,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
      // 同上：单书签夹具，这条验的是全局目录设计有没有跑，不是目录该不该建
      enforceMinFolderSize: false,
    })
    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { plan: OrganizePlan }
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: true,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
    })
    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps)
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: false,
      domainGroups: [],
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

    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps)

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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
    })
    const events: ProgressEvent[] = []
    const complete = vi.fn().mockRejectedValue(
      Object.assign(new Error('模型接口返回 400'), { retryable: false }),
    )
    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, {
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
    })
    let cancelled = false
    const complete = vi.fn().mockImplementation(async () => {
      cancelled = true // 第一批返回后用户点了取消
      return { results: [] }
    })

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, {
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
    })
    let cancelled = false
    const complete = vi.fn().mockImplementation(async () => {
      cancelled = true
      return {
        results: [{ bookmark_id: '100', target_category_id: '10', confidence: 0.9, reason: 'r' }],
      }
    })
    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, {
      createClient: () => ({ complete }), now: () => 1, isCancelled: () => cancelled,
    })
    expect(await loadCache(ports)).not.toEqual(new Map())
  })

  it('模型全部失败时返回 ok:false 并带上真实错误，而不是伪装成 0 条建议', async () => {
    const { ports, fake } = setup()
    void fake
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
    })
    const complete = vi.fn().mockRejectedValue(
      Object.assign(new Error('模型接口返回 400: This response_format type is unavailable now'), {
        retryable: false,
      }),
    )
    const deps = { createClient: () => ({ complete }), now: () => 1 }

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps)
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: false,
      domainGroups: [],
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

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { ok: boolean; plan: OrganizePlan }
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: false,
      domainGroups: [],
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

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { ok: boolean; plan: OrganizePlan }
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: false,
      domainGroups: [],
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
      { kind: 'analyze', scopeRootIds: ['1'] },
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
): Promise<OrganizePlan> {
  const res = await handle(ports as never, { kind: 'analyze', scopeRootIds: ['1'] }, deps as never)
  if (!res.ok || res.kind !== 'analyze') throw new Error(`analyze 应当成功：${JSON.stringify(res)}`)
  return res.plan
}

describe('analyze 的域名聚合', () => {
  const githubUrls = Object.fromEntries(
    Array.from({ length: 3 }, (_, i) => [`g${i}`, `https://github.com/o/r${i}`]),
  )

  it('命中聚合组的书签不进入分类请求', async () => {
    const { ports, deps, classifyPrompts } = setupAnalyze({
      ...githubUrls,
      ...Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`n${i}`, `https://example.com/${i}`])),
    })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: true,
      domainGroups: ['github'],
    })
    await analyzePlan(ports, deps)

    expect(classifyPrompts.length).toBeGreaterThan(0)
    for (const prompt of classifyPrompts) {
      for (const id of Object.keys(githubUrls)) expect(prompt).not.toContain(`"${id}"`)
      // 未命中的书签仍要进分类
      expect(prompt).toContain('"n0"')
    }
  })

  it('pinned 的书签进入 plan 且置信度为 1', async () => {
    const { ports, deps } = setupAnalyze(githubUrls)
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: true,
      domainGroups: ['github'],
    })
    const plan = await analyzePlan(ports, deps)
    expect(plan.rows).toHaveLength(3)
    expect(plan.rows.every((r) => r.confidence === 1)).toBe(true)
    expect(plan.rows.every((r) => r.toPath[0]!.endsWith('GitHub'))).toBe(true)
  })

  it('推翻模式下 plan 带上 tags', async () => {
    const { ports, deps } = setupAnalyze({ n0: 'https://a.com/0', n1: 'https://b.com/1' })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: true,
    })
    const plan = await analyzePlan(ports, deps)
    expect(plan.tags.map((t) => t.bookmarkId).sort()).toEqual(['n0', 'n1'])
  })

  it('非推翻模式下 plan.tags 为空数组', async () => {
    const { ports, deps } = setupAnalyze({ n0: 'https://a.com/0' })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
    })
    const plan = await analyzePlan(ports, deps)
    expect(plan.tags).toEqual([])
  })
})

describe('analyze 对聚合组做细分抽取', () => {
  it('勾选聚合组时会为组内书签单独跑一次功能域抽取', async () => {
    const { ports, deps } = setupAnalyze({ g0: 'https://github.com/o/r0' })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: true,
      domainGroups: ['github'],
    })
    await analyzePlan(ports, deps)
    const prompts = (deps.createClient().complete as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0] as string)
    expect(prompts.some((p) => p.includes('功能域'))).toBe(true)
  })

  it('没勾选聚合组时不多花这次调用', async () => {
    const { ports, deps } = setupAnalyze({ n0: 'https://example.com/0' })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: true,
    })
    await analyzePlan(ports, deps)
    const prompts = (deps.createClient().complete as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0] as string)
    expect(prompts.some((p) => p.includes('功能域'))).toBe(false)
  })
})

describe('analyze 统一 GitHub 书签标题', () => {
  it('开关关闭时不产生改名操作', async () => {
    const { ports, deps } = setupAnalyze({ g0: 'https://github.com/sst/opencode' })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
    })
    const plan = await analyzePlan(ports, deps)
    expect(plan.operations.some((o) => o.type === 'rename_bookmark')).toBe(false)
  })

  it('开关开启时为 GitHub 书签生成改名，非 GitHub 的不动', async () => {
    const { ports, deps } = setupAnalyze({
      g0: 'https://github.com/sst/opencode',
      n0: 'https://example.com/0',
    })
    await saveSettings(ports, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      rewriteGithubTitles: true,
    })
    const plan = await analyzePlan(ports, deps)
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
  rebuildStructure: boolean,
  nameResponse: () => Promise<{ name: string }> = async () => ({ name: 'AI 学习' }),
): Promise<OrganizePlan> {
  const fake = createFakeBookmarks(mergeTree)
  const ports = { bookmarks: fake.api, storage: createFakeStorage() }
  await saveSettings(ports, {
    ...DEFAULT_SETTINGS,
    llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
    rebuildStructure, removeEmptyFolders: false, domainGroups: [], rewriteGithubTitles: false,
    // 合并模式那组用例验的是容器目录的挂载关系，夹具书签数撑不起目录下限
    enforceMinFolderSize: false,
  })
  const deps = { createClient: () => ({ complete: mergeClient(nameResponse) }), now: () => 1 }
  const res = await handle(ports, { kind: 'analyze', scopeRootIds }, deps) as { plan: OrganizePlan }
  return res.plan
}

describe('analyze 合并模式', () => {
  it('勾选多个平级目录时新建合并根，名字来自模型', async () => {
    const plan = await analyzeMerge(['10', '11'], true)
    expect(plan.mergeRoot).toMatchObject({ title: 'AI 学习' })
    const create = plan.operations.find(
      (o) => o.type === 'create_folder' && o.temporaryId === plan.mergeRoot!.temporaryId,
    )
    expect(create).toMatchObject({ parentId: '1', parentTemporaryId: null, title: 'AI 学习' })
  })

  it('一级目录挂在合并根下，不再直接挂书签栏', async () => {
    const plan = await analyzeMerge(['10', '11'], true)
    const others = plan.operations.filter(
      (o) => o.type === 'create_folder' && o.temporaryId !== plan.mergeRoot!.temporaryId,
    )
    expect(others.length).toBeGreaterThan(0)
    for (const op of others) {
      expect(op).toMatchObject({ parentId: null, parentTemporaryId: plan.mergeRoot!.temporaryId })
    }
  })

  it('只勾选一个目录时不合并', async () => {
    expect((await analyzeMerge(['10'], true)).mergeRoot).toBeNull()
  })

  it('勾中永久目录时不合并', async () => {
    expect((await analyzeMerge(['1', '10', '11'], true)).mergeRoot).toBeNull()
  })

  // 上一条里 '10'、'11' 是 '1' 的后代，findScopeRoots 只会返回 '1' 一项，
  // roots.length >= 2 自己就把结果定死了，hasPermanent 那半边条件根本没被问到。
  // 「书签栏 + 其他书签」是互不包含的两个永久目录，只有这条能盯住那道闸。
  it('勾中两个永久目录时不合并', async () => {
    expect((await analyzeMerge(['1', '2'], true)).mergeRoot).toBeNull()
  })

  it('跨父目录合并时容器落在树序第一个根的父目录下', async () => {
    const plan = await analyzeMerge(['20', '10'], true)
    const create = plan.operations.find(
      (o) => o.type === 'create_folder' && o.temporaryId === plan.mergeRoot!.temporaryId,
    )
    // 勾选顺序是「其他书签下的 20」在先，落点仍按书签树顺序取 '10' 的父目录
    expect(create).toMatchObject({ parentId: '1', parentTemporaryId: null })
    expect(plan.mergeRoot!.sourceRootIds).toEqual(['10', '20'])
  })

  it('推翻重建关闭时不合并', async () => {
    expect((await analyzeMerge(['10', '11'], false)).mergeRoot).toBeNull()
  })

  it('命名失败时用源目录名拼接兜底', async () => {
    const plan = await analyzeMerge(['10', '11'], true, async () => { throw new Error('boom') })
    expect(plan.mergeRoot!.title).toBe('NiceG + b_llm')
  })

  // 反复整理同一批目录时源目录名上会积编号，兜底名字不去掉的话
  // 会真建出一个叫「NiceG + 01 前端」的目录，下一轮再拼一层
  it('兜底拼接前先去掉源目录名上的编号前缀', async () => {
    const plan = await analyzeMerge(['10', '13'], true, async () => { throw new Error('boom') })
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: true,
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
    await handle(ports, { kind: 'analyze', scopeRootIds }, { createClient: () => ({ complete }), now: () => 1 })
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

  // 上限 2 + 勾其他书签 = 已经在第二层，不该再往下分
  it('默认上限 2 下，勾其他书签就只建一层', async () => {
    expect(await promptsFor(['2'])).toContain('children 一律返回空数组')
  })

  // 同样是上限 2，勾书签栏时二级还开着——上限管的是绝对层级，不是「再分一层」
  it('同样上限 2，勾书签栏时仍允许分出二级', async () => {
    expect(await promptsFor(['1'])).not.toContain('children 一律返回空数组')
  })

  // 用户勾了这里就是要在这里整理，返回「一个目录都不建」看起来像坏了
  it('勾中处已经到上限那一层时，仍然建一层，只是不再往下', async () => {
    const prompts = await promptsFor(['21'], { maxFolderDepth: 2 })
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
    llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
    rebuildStructure: true,
    ...overrides,
  })

  it('下限写进目录设计提示词', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ results: [{ bookmark_id: '200', primary_topic: '前端' }] })
      .mockResolvedValueOnce({ folders: [{ title: '前端', topics: ['前端'], children: [] }] })
      .mockResolvedValueOnce({ results: [] })
    const { ports, deps } = setupSix(complete)
    await saveSettings(ports, rebuild({ minFolderSize: 4 }))

    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps)
    const prompts = complete.mock.calls.map((c) => c[0] as string)
    expect(prompts.some((prompt) => prompt.includes('不到 4 个书签'))).toBe(true)
  })

  it('开关关掉时提示词里没有这条', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ results: [{ bookmark_id: '200', primary_topic: '前端' }] })
      .mockResolvedValueOnce({ folders: [{ title: '前端', topics: ['前端'], children: [] }] })
      .mockResolvedValueOnce({ results: [] })
    const { ports, deps } = setupSix(complete)
    await saveSettings(ports, rebuild({ enforceMinFolderSize: false }))

    await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps)
    const prompts = complete.mock.calls.map((c) => c[0] as string)
    expect(prompts.some((prompt) => prompt.includes('个书签的目录'))).toBe(false)
  })

  // 标签数够、真实归属不够：模型把 6 个书签的两个子主题分成了 5 : 1，
  // 只有数过分类结果才拦得住那个 1
  it('分类后仍不足下限的目录不出现在计划里，书签并进父目录', async () => {
    const tags = Array.from({ length: 6 }, (_, i) => ({
      bookmark_id: `20${i}`, primary_topic: i < 3 ? 'React' : 'Vue',
    }))
    // 两个子主题各 3 个标签，都撑得起子目录——建树那道拦不住，得靠分类后再数一遍
    const complete = vi.fn()
      .mockResolvedValueOnce({ results: tags })
      .mockResolvedValueOnce({ folders: [{ title: '前端', topics: [], children: [
        { title: 'React', topics: ['React'] },
        { title: 'Vue', topics: ['Vue'] },
      ] }] })
      .mockResolvedValueOnce({ results: Array.from({ length: 6 }, (_, i) => ({
        bookmark_id: `20${i}`,
        target_category_id: i === 5 ? 'tmp:3' : 'tmp:2',
        confidence: 0.9,
        reason: 'r',
      })) })
    const { ports, deps } = setupSix(complete)
    await saveSettings(ports, rebuild({ minFolderSize: 3 }))

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { plan: OrganizePlan }
    const created = res.plan.operations.flatMap((o) => (o.type === 'create_folder' ? [o.title] : []))
    expect(created.some((title) => title.includes('React'))).toBe(true)
    expect(created.some((title) => title.includes('Vue'))).toBe(false)
    // 那个书签落在父目录，而不是掉进「其他」或原地不动
    const row = res.plan.rows.find((r) => r.bookmarkId === '205')!
    expect(row.toPath.map((p) => p.replace(/^\d+ /, ''))).toEqual(['前端'])
    expect(row.reason).toContain('不足 3 个')
  })

  it('开关关掉时那个只有一个书签的子目录照建', async () => {
    const tags = Array.from({ length: 6 }, (_, i) => ({
      bookmark_id: `20${i}`, primary_topic: i < 3 ? 'React' : 'Vue',
    }))
    // 两个子主题各 3 个标签，都撑得起子目录——建树那道拦不住，得靠分类后再数一遍
    const complete = vi.fn()
      .mockResolvedValueOnce({ results: tags })
      .mockResolvedValueOnce({ folders: [{ title: '前端', topics: [], children: [
        { title: 'React', topics: ['React'] },
        { title: 'Vue', topics: ['Vue'] },
      ] }] })
      .mockResolvedValueOnce({ results: Array.from({ length: 6 }, (_, i) => ({
        bookmark_id: `20${i}`,
        target_category_id: i === 5 ? 'tmp:3' : 'tmp:2',
        confidence: 0.9,
        reason: 'r',
      })) })
    const { ports, deps } = setupSix(complete)
    await saveSettings(ports, rebuild({ enforceMinFolderSize: false }))

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { plan: OrganizePlan }
    const created = res.plan.operations.flatMap((o) => (o.type === 'create_folder' ? [o.title] : []))
    expect(created.some((title) => title.includes('Vue'))).toBe(true)
  })
})

describe('analyze 非推翻模式：新主题无处可去', () => {
  // 已有 react、杂项两个目录，三本关于「语音合成」的书签松散挂在书签栏下——
  // 这才是「真正无处可去」的典型状态：没有一个已有目录能装下它们，也没有人
  // 手工把它们攒在一起过。哪个已有目录都放不进去，模型分类时把它们的
  // target_category_id 判成 null，同时带回同一个 topic。
  //
  // 三本书签不能预先挤在同一个非根目录下：planNewFolders 的「已聚齐」guard
  // （见 core/newTopics.ts）专门拦这种情况——不是因为它们不该建目录，而是
  // guard 分不清「凑巧挤在同一个已有目录里」和「上一轮就是为它们建的目录」，
  // 保守地一律不碰。松散挂在范围根下是 guard 明确放行的那一种（其父就是范围
  // 根本身），也是「新主题」这个功能本该覆盖的主场景。
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: false,
      domainGroups: [],
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

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { plan: OrganizePlan }
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

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { plan: OrganizePlan }
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

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { plan: OrganizePlan }
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

    const first = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { ok: boolean; plan: OrganizePlan }
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
    const second = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { ok: boolean; plan: OrganizePlan }
    expect(second.ok).toBe(true)
    expect(second.plan.operations.filter((o) => o.type === 'create_folder')).toEqual([])
    expect(second.plan.operations.filter((o) => o.type === 'rename_folder')).toEqual([])
    expect(second.plan.rows).toHaveLength(0)
  })

  // review C1：模型一直判定「无处可去」、每轮都带回同一个 topic，是这条分支
  // 唯一会持续触发的场景——表现良好的模型第二轮就会正确归位（上面那条用例），
  // 不会一直触发新建。这里驱动三轮，模型故意「表现不好」，验证 planNewFolders
  // 的「已聚齐」guard 与 nameNewTopics 的撞名跳过两道闸联手挡住 churn。
  it('模型持续判定无处可去也不 churn：三轮下来只建一次目录，之后不再新建、不改名、不移动', async () => {
    const complete = vi.fn(async (prompt: string) => {
      // 起名那次调用的提示词固定带着这句开场白；分类调用带的是候选目录清单
      if (prompt.includes('将为它们新建目录')) {
        return { names: [{ key: '语音合成', name: '语音合成' }] }
      }
      return {
        results: ['100', '101', '102'].map((id) => ({
          bookmark_id: id, target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成',
        })),
      }
    })
    const { ports, deps } = setupHomeless(complete)
    await saveNonRebuild(ports)

    const first = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { ok: boolean; plan: OrganizePlan }
    expect(first.ok).toBe(true)
    expect(first.plan.operations.filter((o) => o.type === 'create_folder')).toHaveLength(1)
    await handle(ports, {
      kind: 'apply', plan: first.plan as never, accepted: first.plan.rows.map((r) => r.bookmarkId),
    }, deps)

    const second = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { ok: boolean; plan: OrganizePlan }
    expect(second.ok).toBe(true)
    expect(second.plan.operations.filter((o) => o.type === 'create_folder')).toEqual([])
    expect(second.plan.operations.filter((o) => o.type === 'rename_folder')).toEqual([])
    expect(second.plan.operations.filter((o) => o.type === 'move_bookmark')).toEqual([])
    await handle(ports, {
      kind: 'apply', plan: second.plan as never, accepted: second.plan.rows.map((r) => r.bookmarkId),
    }, deps)

    const third = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { ok: boolean; plan: OrganizePlan }
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
          // 父目录会被 planNewFolders 的「已聚齐」guard 拦下（见 core/newTopics.ts），
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: true,
      domainGroups: [],
      rewriteGithubTitles: false,
    })

    const analyzed = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { ok: boolean; plan: OrganizePlan }
    expect(analyzed.ok).toBe(true)
    const res = await handle(ports, {
      kind: 'apply', plan: analyzed.plan as never, accepted: analyzed.plan.rows.map((r) => r.bookmarkId),
    }, deps) as { result: { removedFolders: Array<{ title: string }> } }

    expect(res.result.removedFolders.map((f) => f.title)).toEqual(['专题'])
    expect(fake.structure()).not.toContain('专题')
    expect(fake.structure()).toContain('语音与音频')
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
    })
    // 用 tree 夹具：书签栏(1) 下有 react(10)、杂项(11)——级联勾选会把三个 id
    // 全部送过来，先勾的是根（1），子目录顺序不定
    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1', '10', '11'] }, deps) as {
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
  // planNewFolders 的「已聚齐」guard——这里要单独测的是多根场景，不是那道 guard。
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
    })

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1', '2'] }, deps) as { ok: boolean; plan: OrganizePlan }
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
    })
    const events: ProgressEvent[] = []
    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1', '2'] }, {
      ...deps, onEvent: (event: ProgressEvent) => events.push(event),
    }) as { ok: boolean; plan: OrganizePlan }

    expect(res.ok).toBe(true)
    expect(res.plan.operations.filter((o) => o.type === 'create_folder')).toHaveLength(1)
    const multiRootLog = events.find((e) => e.message.includes('书签栏') && e.message.includes('范围根'))
    expect(multiRootLog).toBeDefined()
  })
})
