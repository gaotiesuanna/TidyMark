import { describe, it, expect, vi } from 'vitest'
import { handle } from '@/background/handlers'
import { DEFAULT_SETTINGS, saveSettings } from '@/storage/settings'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'
import { withLlm } from '../fakes/settings'
import type { LlmClient } from '@/llm/client'
import type { OrganizePlan } from '@/core/types'

/**
 * 16 条书签，标签分两族（构建工具 8 / 测试框架 8），但全局目录设计**一个都不映射**，
 * 于是 16 条整批落进「其他」。02 票摘掉豁免之后「其他」会被下切成两个子目录，
 * 07 票再把这两族提到一级。
 */
function setup() {
  const fake = createFakeBookmarks([
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '11', title: '收件箱', children: Array.from({ length: 16 }, (_, i) => ({
          id: `b${i}`, title: `书签 ${i}`, url: `https://example.com/${i}`,
        })) },
      ]},
    ]},
  ])
  const complete = vi.fn(async (prompt: string) => {
    if (prompt.includes('标签清单：')) {
      // 下切那一轮的提示词带着父目录名「其他」
      return prompt.includes('其他')
        ? { folders: [
            { title: '构建', topics: ['构建工具'], children: [] },
            { title: '测试', topics: ['测试框架'], children: [] },
          ] }
        // 全局那一轮：设计出的目录一个标签都不认，16 条全成未映射
        : { folders: [{ title: '甲', topics: ['无人认领'], children: [] }] }
    }
    if (!prompt.includes('候选目录')) {
      return { results: Array.from({ length: 16 }, (_, i) => ({
        bookmark_id: `b${i}`,
        primary_topic: i < 8 ? '构建工具' : '测试框架',
        secondary_topic: null,
      })) }
    }
    const ids = [...prompt.matchAll(/^- id=(\S+) 目录=(.+)$/gm)]
    const target = ids.find((m) => m[2]!.includes('其他'))?.[1] ?? ids[0]?.[1] ?? null
    const bookmarkIds = [...prompt.matchAll(/"bookmark_id":\s*"([^"]+)"/g)].map((m) => m[1]!)
    return { results: bookmarkIds.map((id) => (
      { bookmark_id: id, target_category_id: target, confidence: 0.9, reason: 'r' }
    )) }
  })
  return {
    ports: { bookmarks: fake.api, storage: createFakeStorage() },
    deps: { createClient: () => ({ complete } as unknown as LlmClient), now: () => 1 },
  }
}

const settings = {
  ...DEFAULT_SETTINGS,
  ...withLlm({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'm' }),
  removeEmptyFolders: false,
  rewriteGithubTitles: false,
}

describe('「其他」切出来的族提到一级', () => {
  it('推翻模式下提上一级，父指针不再指向「其他」', async () => {
    const { ports, deps } = setup()
    await saveSettings(ports, settings)
    const res = await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps,
    ) as { plan: OrganizePlan }

    const created = res.plan.operations.filter((o) => o.type === 'create_folder')
    const promoted = created.filter((o) => /构建|测试/.test(o.title))
    expect(promoted).toHaveLength(2)
    // 提到一级 = 直接挂在范围根上，不再挂在「其他」这个临时目录下
    for (const op of promoted) {
      expect(op.parentTemporaryId).toBeNull()
      expect(op.parentId).toBe('1')
    }
  })

  it('理由改写成「本来要落进其他」，并带上这一族的条数', async () => {
    const { ports, deps } = setup()
    await saveSettings(ports, settings)
    const res = await handle(
      ports, { kind: 'analyze', scopeRootIds: ['1'], modeOverride: 'rebuild' }, deps,
    ) as { plan: OrganizePlan }

    const row = res.plan.rows.find((r) => /构建|测试/.test(r.toPath.at(-1) ?? ''))
    expect(row).toBeDefined()
    expect(row!.reason).toContain('其他')
    expect(row!.reason).toContain('8')
  })
})
