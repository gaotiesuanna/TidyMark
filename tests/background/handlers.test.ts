import { describe, it, expect, vi } from 'vitest'
import { handle } from '@/background/handlers'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'
import { saveSettings } from '@/storage/settings'
import type { LlmClient } from '@/llm/client'

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

  it('get_undo_state 在无快照时返回不可撤销', async () => {
    const { ports, deps } = setup()
    const res = await handle(ports, { kind: 'get_undo_state' }, deps)
    expect(res).toMatchObject({ ok: true, available: false, createdAt: null })
  })

  it('设置可保存并读回', async () => {
    const { ports, deps } = setup()
    const settings = {
      llm: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-d', model: 'deepseek-chat' },
      rebuildStructure: true,
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
    })
    const complete = vi.fn()
      .mockResolvedValueOnce({ results: [{ bookmark_id: '100', primary_topic: '前端', secondary_topic: 'React' }] })
      .mockResolvedValueOnce({ results: [{ bookmark_id: '100', target_category_id: 'tmp:1', confidence: 0.9, reason: 'r' }] })
    const deps = { createClient: () => ({ complete }), now: () => 1 }

    const res = await handle(ports, { kind: 'analyze', scopeRootIds: ['1'] }, deps) as { plan: { operations: Array<{ type: string }> } }
    expect(complete).toHaveBeenCalledTimes(2)
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

  it('模型全部失败时返回 ok:false 并带上真实错误，而不是伪装成 0 条建议', async () => {
    const { ports, fake } = setup()
    void fake
    await saveSettings(ports, {
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' },
      rebuildStructure: false,
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
