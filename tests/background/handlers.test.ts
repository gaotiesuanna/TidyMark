import { describe, it, expect, vi } from 'vitest'
import { handle } from '@/background/handlers'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'
import { DEFAULT_SETTINGS, loadCache, saveSettings, type Settings } from '@/storage/settings'
import type { LlmClient } from '@/llm/client'
import type { OrganizePlan } from '@/core/types'
import type { ProgressEvent } from '@/background/events'

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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: true,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
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
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: true,
      removeEmptyFolders: false,
      domainGroups: [],
      rewriteGithubTitles: false,
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
    ]},
  ]},
]

/** 按提示词内容分流的 client：合并模式下要应付四轮不同的请求。 */
function mergeClient(nameResponse: () => Promise<{ name: string }>) {
  return vi.fn(async (prompt: string) => {
    // 命名那一轮的提示词由 mergeNamePrompt 生成，措辞以 src/llm/prompts.ts 为准
    if (prompt.includes('合并成一个新文件夹')) return nameResponse()
    const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)]
    if (ids.length > 0) {
      return { results: [
        { bookmark_id: '100', target_category_id: ids[0]![1]!, confidence: 0.9, reason: 'r' },
        { bookmark_id: '101', target_category_id: ids[0]![1]!, confidence: 0.9, reason: 'r' },
      ]}
    }
    if (prompt.includes('标签清单')) {
      return { folders: [{ title: '前端', topics: ['前端'], children: [] }] }
    }
    return { results: [
      { bookmark_id: '100', primary_topic: '前端', secondary_topic: null },
      { bookmark_id: '101', primary_topic: '前端', secondary_topic: null },
    ]}
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
    llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
    rebuildStructure, removeEmptyFolders: false, domainGroups: [], rewriteGithubTitles: false,
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

  it('推翻重建关闭时不合并', async () => {
    expect((await analyzeMerge(['10', '11'], false)).mergeRoot).toBeNull()
  })

  it('命名失败时用源目录名拼接兜底', async () => {
    const plan = await analyzeMerge(['10', '11'], true, async () => { throw new Error('boom') })
    expect(plan.mergeRoot!.title).toBe('NiceG + b_llm')
  })
})
