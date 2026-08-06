import { describe, it, expect, vi } from 'vitest'
import { classifyBookmarks, buildBatchPrompt, cacheKey } from '@/llm/classify'
import type { ClassifyInput } from '@/llm/classify'
import type { BookmarkItem, CategoryCandidate, Classification } from '@/core/types'
import type { LlmClient } from '@/llm/client'

const candidates: CategoryCandidate[] = [
  { id: '10', path: ['书签栏', 'react'] },
  { id: '11', path: ['书签栏', '论文'] },
]

function item(id: string, url: string, title = 'T'): BookmarkItem {
  return { id, title, url, parentId: '1', index: 0, currentPath: ['书签栏'] }
}

/**
 * locale 现在是必填项，但本文件里的用例全部只关心中文分支。
 * 固定传 'zh_CN'，调用点不必逐个重复。
 */
function classify(input: Omit<ClassifyInput, 'locale'>): Promise<Classification[]> {
  return classifyBookmarks({ ...input, locale: 'zh_CN' })
}

function clientReturning(results: unknown): LlmClient {
  return { complete: vi.fn().mockResolvedValue(results) }
}

describe('cacheKey', () => {
  it('URL 相同但候选集不同则 key 不同', () => {
    const a = cacheKey(item('1', 'https://react.dev'), candidates)
    const b = cacheKey(item('1', 'https://react.dev'), [candidates[0]!])
    expect(a).not.toBe(b)
  })
})

describe('buildBatchPrompt', () => {
  it('只包含 title/domain/path/currentPath，绝不含 query', () => {
    const prompt = buildBatchPrompt([item('1', 'https://x.com/a?token=SECRET')], candidates, 'zh_CN')
    expect(prompt).not.toContain('SECRET')
    expect(prompt).toContain('x.com')
    expect(prompt).toContain('书签栏')
  })

  it('列出所有候选目录及其 id', () => {
    const prompt = buildBatchPrompt([item('1', 'https://x.com')], candidates, 'zh_CN')
    expect(prompt).toContain('10')
    expect(prompt).toContain('书签栏 / react')
  })
})

describe('classifyBookmarks', () => {
  it('规则能确定归属的书签不发给模型', async () => {
    const client = clientReturning({ results: [] })
    const results = await classify({
      items: [item('1', 'https://arxiv.org/abs/1')],
      candidates,
      client,
      cache: new Map(),
    })
    expect(client.complete).not.toHaveBeenCalled()
    expect(results[0]!).toMatchObject({ targetCategoryId: '11', source: 'rule' })
  })

  it('规则未命中的书签走模型', async () => {
    const client = clientReturning({
      results: [{ bookmark_id: '1', target_category_id: '10', confidence: 0.9, reason: '与 React 相关' }],
    })
    const results = await classify({
      items: [item('1', 'https://some-blog.dev/react-hooks')],
      candidates,
      client,
      cache: new Map(),
    })
    expect(results[0]!).toMatchObject({ targetCategoryId: '10', confidence: 0.9, source: 'llm' })
  })

  it('模型返回 null 表示无合适目录，保持原位', async () => {
    const client = clientReturning({
      results: [{ bookmark_id: '1', target_category_id: null, confidence: 0.2, reason: '无合适目录' }],
    })
    const results = await classify({
      items: [item('1', 'https://weird.site/x')],
      candidates,
      client,
      cache: new Map(),
    })
    expect(results[0]!.targetCategoryId).toBeNull()
  })

  it('按 batchSize 分批', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    const items = Array.from({ length: 5 }, (_, i) => item(String(i), `https://s${i}.dev/x`))
    await classify({ items, candidates, client: { complete }, cache: new Map(), batchSize: 2 })
    expect(complete).toHaveBeenCalledTimes(3)
  })

  it('命中缓存的条目不再发请求', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    const it1 = item('1', 'https://some-blog.dev/x')
    const cache = new Map([
      [cacheKey(it1, candidates), { bookmarkId: '1', targetCategoryId: '10', confidence: 0.8, reason: '缓存', source: 'llm' as const }],
    ])
    const results = await classify({ items: [it1], candidates, client: { complete }, cache })
    expect(complete).not.toHaveBeenCalled()
    expect(results[0]!.reason).toBe('缓存')
  })

  it('成功的结果写入缓存', async () => {
    const client = clientReturning({
      results: [{ bookmark_id: '1', target_category_id: '10', confidence: 0.9, reason: 'r' }],
    })
    const cache = new Map()
    const it1 = item('1', 'https://some-blog.dev/x')
    await classify({ items: [it1], candidates, client, cache })
    expect(cache.get(cacheKey(it1, candidates))).toMatchObject({ targetCategoryId: '10' })
  })

  it('可重试错误重试 2 次后降级为未分类，流程不崩', async () => {
    const complete = vi.fn().mockRejectedValue(Object.assign(new Error('boom'), { retryable: true }))
    const results = await classify({
      items: [item('1', 'https://some-blog.dev/x')],
      candidates,
      client: { complete },
      cache: new Map(),
    })
    expect(complete).toHaveBeenCalledTimes(3)
    expect(results[0]!).toMatchObject({ targetCategoryId: null, source: 'none' })
  })

  it('不可重试错误立即降级，不重试', async () => {
    const complete = vi.fn().mockRejectedValue(Object.assign(new Error('bad key'), { retryable: false }))
    const results = await classify({
      items: [item('1', 'https://some-blog.dev/x')],
      candidates,
      client: { complete },
      cache: new Map(),
    })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(results[0]!.source).toBe('none')
  })

  it('模型返回未知 category id 时视为无归属', async () => {
    const client = clientReturning({
      results: [{ bookmark_id: '1', target_category_id: '999', confidence: 0.9, reason: 'r' }],
    })
    const results = await classify({
      items: [item('1', 'https://some-blog.dev/x')],
      candidates,
      client,
      cache: new Map(),
    })
    expect(results[0]!.targetCategoryId).toBeNull()
  })

  it('回报进度', async () => {
    const onProgress = vi.fn()
    const items = Array.from({ length: 4 }, (_, i) => item(String(i), `https://s${i}.dev/x`))
    await classify({
      items, candidates, client: clientReturning({ results: [] }),
      cache: new Map(), batchSize: 2, onProgress,
    })
    expect(onProgress).toHaveBeenLastCalledWith(4, 4)
  })

  it('每个输入书签都有且仅有一条结果', async () => {
    const items = Array.from({ length: 3 }, (_, i) => item(String(i), `https://s${i}.dev/x`))
    const results = await classify({
      items, candidates, client: clientReturning({ results: [] }), cache: new Map(),
    })
    expect(results.map((r) => r.bookmarkId).sort()).toEqual(['0', '1', '2'])
  })
})

describe('classifyBookmarks 取消', () => {
  it('取消后不再派发新批次', async () => {
    let cancelled = false
    const complete = vi.fn().mockImplementation(async () => {
      cancelled = true // 第一批跑完就点了取消
      return { results: [] }
    })
    const items = Array.from({ length: 6 }, (_, i) => item(String(i), `https://s${i}.dev/x`))
    await classify({
      items, candidates, client: { complete }, cache: new Map(),
      batchSize: 2, concurrency: 1, isCancelled: () => cancelled,
    })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('已跑完的批次结果仍然保留', async () => {
    let cancelled = false
    const complete = vi.fn().mockImplementation(async () => {
      cancelled = true
      return { results: [{ bookmark_id: '0', target_category_id: '10', confidence: 0.9, reason: 'r' }] }
    })
    const items = Array.from({ length: 4 }, (_, i) => item(String(i), `https://s${i}.dev/x`))
    const results = await classify({
      items, candidates, client: { complete }, cache: new Map(),
      batchSize: 1, concurrency: 1, isCancelled: () => cancelled,
    })
    expect(results.find((r) => r.bookmarkId === '0')!.targetCategoryId).toBe('10')
    expect(results).toHaveLength(4)
  })
})
