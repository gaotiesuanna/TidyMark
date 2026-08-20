import { describe, it, expect, vi } from 'vitest'
import { classifyBookmarks, buildBatchPrompt, cacheKey } from '@/llm/classify'
import type { ClassifyInput } from '@/llm/classify'
import type { BookmarkItem, CachedClassification, CategoryCandidate, Classification } from '@/core/types'
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
function classify(input: Omit<ClassifyInput, 'locale' | 'model'>): Promise<Classification[]> {
  return classifyBookmarks({ ...input, locale: 'zh_CN', model: 'm' })
}

function clientReturning(results: unknown): LlmClient {
  return { complete: vi.fn().mockResolvedValue(results) }
}

describe('cacheKey', () => {
  // 推翻模式下两轮候选的 id 都是 buildCategoryTree 顺序生成的 tmp:N，
  // 数量相同就完全一样——这正是旧版 key 撞车的现场。
  const run1: CategoryCandidate[] = [
    { id: 'tmp:1', path: ['01 前端框架'] },
    { id: 'tmp:2', path: ['02 机器学习'] },
    { id: 'tmp:3', path: ['03 其他'] },
  ]
  const run2: CategoryCandidate[] = [
    { id: 'tmp:1', path: ['01 语音合成'] },
    { id: 'tmp:2', path: ['02 数据竞赛'] },
    { id: 'tmp:3', path: ['03 其他'] },
  ]
  const it1 = item('1', 'https://react.dev')

  it('候选数量相同、id 相同但目录不同则 key 不同', () => {
    expect(cacheKey(it1, run1, 'zh_CN', 'm')).not.toBe(cacheKey(it1, run2, 'zh_CN', 'm'))
  })

  it('路径集合相同、id 不同则 key 相同', () => {
    const renumbered = run1.map((c, i) => ({ ...c, id: `real:${i}` }))
    expect(cacheKey(it1, renumbered, 'zh_CN', 'm')).toBe(cacheKey(it1, run1, 'zh_CN', 'm'))
  })

  it('候选集相同、只是顺序不同则 key 相同', () => {
    expect(cacheKey(it1, [...run1].reverse(), 'zh_CN', 'm')).toBe(cacheKey(it1, run1, 'zh_CN', 'm'))
  })

  it('换界面语言则 key 不同', () => {
    expect(cacheKey(it1, run1, 'en', 'm')).not.toBe(cacheKey(it1, run1, 'zh_CN', 'm'))
  })

  it('换模型则 key 不同', () => {
    expect(cacheKey(it1, run1, 'zh_CN', 'm2')).not.toBe(cacheKey(it1, run1, 'zh_CN', 'm'))
  })

  it('URL 相同但候选集不同则 key 不同', () => {
    const a = cacheKey(item('1', 'https://react.dev'), candidates, 'zh_CN', 'm')
    const b = cacheKey(item('1', 'https://react.dev'), [candidates[0]!], 'zh_CN', 'm')
    expect(a).not.toBe(b)
  })

  it('目录名里含斜杠时不与多层路径混淆', () => {
    const slash: CategoryCandidate[] = [{ id: 'x', path: ['a/b'] }]
    const nested: CategoryCandidate[] = [{ id: 'x', path: ['a', 'b'] }]
    expect(cacheKey(it1, slash, 'zh_CN', 'm')).not.toBe(cacheKey(it1, nested, 'zh_CN', 'm'))
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

  it('省略第四个参数时默认带上 topic 规则', () => {
    const prompt = buildBatchPrompt([item('1', 'https://x.com')], candidates, 'zh_CN')
    expect(prompt).toContain('topic')
  })

  it('includeTopicRule 传 false 时提示词里不出现 topic 规则——推翻模式用这条', () => {
    const prompt = buildBatchPrompt([item('1', 'https://x.com')], candidates, 'zh_CN', false)
    expect(prompt).not.toContain('topic')
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

  it('命中缓存的条目不再发请求，并按路径换回当前的目录 id', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    const it1 = item('1', 'https://some-blog.dev/x')
    const cache = new Map<string, CachedClassification>([
      [cacheKey(it1, candidates, 'zh_CN', 'm'),
        { targetPath: ['书签栏', 'react'], url: it1.url, confidence: 0.8, reason: '缓存' }],
    ])
    const results = await classify({ items: [it1], candidates, client: { complete }, cache })
    expect(complete).not.toHaveBeenCalled()
    expect(results[0]!).toMatchObject({ targetCategoryId: '10', confidence: 0.8, reason: '缓存', source: 'llm' })
  })

  it('同一批目录换了 id，缓存照样命中并换回新 id', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    const it1 = item('1', 'https://some-blog.dev/x')
    const cache = new Map<string, CachedClassification>([
      [cacheKey(it1, candidates, 'zh_CN', 'm'),
        { targetPath: ['书签栏', 'react'], url: it1.url, confidence: 0.8, reason: '缓存' }],
    ])
    // 路径一模一样、id 全换（推翻模式下每轮重新生成 tmp:N 就是这个样子）
    const renumbered: CategoryCandidate[] = candidates.map((c, i) => ({ ...c, id: `tmp:${i + 1}` }))
    const results = await classify({ items: [it1], candidates: renumbered, client: { complete }, cache })
    expect(complete).not.toHaveBeenCalled()
    expect(results[0]!.targetCategoryId).toBe('tmp:1')
  })

  it('缓存里的路径不在当前候选里则当没命中，重新发请求', async () => {
    const complete = vi.fn().mockResolvedValue({
      results: [{ bookmark_id: '1', target_category_id: '11', confidence: 0.7, reason: '重算' }],
    })
    const it1 = item('1', 'https://some-blog.dev/x')
    // 手工塞一条 key 对得上、路径却对不上的脏数据（正常不会出现，
    // 但 djb2 是 32 位，撞了不能把书签送进随便一个目录）
    const cache = new Map<string, CachedClassification>([
      [cacheKey(it1, candidates, 'zh_CN', 'm'),
        { targetPath: ['书签栏', '早就删了的目录'], url: it1.url, confidence: 0.8, reason: '缓存' }],
    ])
    const results = await classify({ items: [it1], candidates, client: { complete }, cache })
    expect(complete).toHaveBeenCalled()
    expect(results[0]!.targetCategoryId).toBe('11')
  })

  it('key 撞了但 url 对不上则当没命中，不套用另一个书签的结果', async () => {
    const complete = vi.fn().mockResolvedValue({
      results: [{ bookmark_id: '1', target_category_id: '11', confidence: 0.7, reason: '重算' }],
    })
    const itA = item('1', 'https://a.example/x')
    // 不去真的找一对 djb2 撞车的 URL：直接在同一个 key 下塞一条 url 不同的
    // 缓存条目，模拟撞车现场——key 相同不代表 url 相同。
    const cache = new Map<string, CachedClassification>([
      [cacheKey(itA, candidates, 'zh_CN', 'm'),
        { targetPath: ['书签栏', 'react'], url: 'https://b.example/y', confidence: 0.8, reason: '别的书签的结果' }],
    ])
    const results = await classify({ items: [itA], candidates, client: { complete }, cache })
    expect(complete).toHaveBeenCalled()
    expect(results[0]!).toMatchObject({ targetCategoryId: '11', reason: '重算' })
  })

  it('缓存里 targetPath 为 null 时命中，结果就是「无合适目录」', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    const it1 = item('1', 'https://some-blog.dev/x')
    const cache = new Map<string, CachedClassification>([
      [cacheKey(it1, candidates, 'zh_CN', 'm'),
        { targetPath: null, url: it1.url, confidence: 0, reason: '没有合适的目录' }],
    ])
    const results = await classify({ items: [it1], candidates, client: { complete }, cache })
    expect(complete).not.toHaveBeenCalled()
    expect(results[0]!).toMatchObject({ targetCategoryId: null, reason: '没有合适的目录' })
  })

  it('成功的结果按路径写入缓存，不写 id', async () => {
    const client = clientReturning({
      results: [{ bookmark_id: '1', target_category_id: '10', confidence: 0.9, reason: 'r' }],
    })
    const cache = new Map<string, CachedClassification>()
    const it1 = item('1', 'https://some-blog.dev/x')
    await classify({ items: [it1], candidates, client, cache })
    expect(cache.get(cacheKey(it1, candidates, 'zh_CN', 'm'))).toEqual({
      targetPath: ['书签栏', 'react'], url: it1.url, confidence: 0.9, reason: 'r',
    })
  })

  it('模型判「无合适目录」也写进缓存，存成 targetPath: null', async () => {
    const client = clientReturning({
      results: [{ bookmark_id: '1', target_category_id: null, confidence: 0.2, reason: '无合适目录' }],
    })
    const cache = new Map<string, CachedClassification>()
    const it1 = item('1', 'https://weird.site/x')
    await classify({ items: [it1], candidates, client, cache })
    expect(cache.get(cacheKey(it1, candidates, 'zh_CN', 'm'))).toEqual({
      targetPath: null, url: it1.url, confidence: 0, reason: '无合适目录',
    })
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
    // detail 是纯错误信息，不含 reason 里「分类失败，保持原位：」这类前缀，
    // 供调用方拼接展示时不必自己剥前缀。
    expect(results[0]!.detail).toBe('Error: boom')
    expect(results[0]!.reason).toContain(results[0]!.detail!)
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

  it('两轮候选数量相同但目录不同时，上一轮的分类不会串到这一轮', async () => {
    const it1 = item('1', 'https://react.dev')
    const run1: CategoryCandidate[] = [
      { id: 'tmp:1', path: ['01 前端框架'] },
      { id: 'tmp:2', path: ['02 机器学习'] },
    ]
    const run2: CategoryCandidate[] = [
      { id: 'tmp:1', path: ['01 语音合成'] },
      { id: 'tmp:2', path: ['02 数据竞赛'] },
    ]
    const cache = new Map<string, CachedClassification>()

    const first = clientReturning({
      results: [{ bookmark_id: '1', target_category_id: 'tmp:1', confidence: 0.9, reason: '前端' }],
    })
    await classify({ items: [it1], candidates: run1, client: first, cache })

    // 第二轮：候选数量与 id 都和第一轮一模一样，只有目录名不同
    const second = clientReturning({
      results: [{ bookmark_id: '1', target_category_id: 'tmp:2', confidence: 0.9, reason: '数据竞赛' }],
    })
    const results = await classify({ items: [it1], candidates: run2, client: second, cache })

    expect(second.complete).toHaveBeenCalled()
    expect(results[0]!.reason).toBe('数据竞赛')
  })

  it('模型判「无合适目录」时带回的 topic 落进 Classification', async () => {
    const client = clientReturning({
      results: [{ bookmark_id: '1', target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成' }],
    })
    const results = await classify({
      items: [item('1', 'https://weird.site/x')], candidates, client, cache: new Map(),
    })
    expect(results[0]!).toMatchObject({ targetCategoryId: null, topic: '语音合成' })
  })

  it('有归属时不带 topic——那个字段只为无家可归的书签存在', async () => {
    const client = clientReturning({
      results: [{ bookmark_id: '1', target_category_id: '10', confidence: 0.9, reason: 'r', topic: '不该出现' }],
    })
    const results = await classify({
      items: [item('1', 'https://weird.site/x')], candidates, client, cache: new Map(),
    })
    expect(results[0]!.targetCategoryId).toBe('10')
    expect(results[0]!.topic).toBeUndefined()
  })

  it('模型没给 topic 时不炸，只是没有主题可聚类', async () => {
    const client = clientReturning({
      results: [{ bookmark_id: '1', target_category_id: null, confidence: 0.2, reason: '无合适目录' }],
    })
    const results = await classify({
      items: [item('1', 'https://weird.site/x')], candidates, client, cache: new Map(),
    })
    expect(results[0]!.topic).toBeUndefined()
  })

  it('topic 一并进缓存——否则第二轮命中缓存的书签会丢掉主题，永远攒不成新目录', async () => {
    const client = clientReturning({
      results: [{ bookmark_id: '1', target_category_id: null, confidence: 0.2, reason: '无合适目录', topic: '语音合成' }],
    })
    const cache = new Map<string, CachedClassification>()
    const it1 = item('1', 'https://weird.site/x')
    await classify({ items: [it1], candidates, client, cache })
    expect(cache.get(cacheKey(it1, candidates, 'zh_CN', 'm'))).toMatchObject({ targetPath: null, topic: '语音合成' })

    // 第二轮命中缓存，topic 必须还在
    const complete = vi.fn().mockResolvedValue({ results: [] })
    const again = await classify({ items: [it1], candidates, client: { complete }, cache })
    expect(complete).not.toHaveBeenCalled()
    expect(again[0]!.topic).toBe('语音合成')
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

/**
 * 同 URL 折叠：cacheKey 里书签那一半是 djb2(item.url)，另一半（locale/model/
 * 候选集）在一轮里是常量——所以同 URL 的两个书签对模型是同一个问题。冷缓存
 * 下它们本来会一起进批次、一起发出去，等于为同一个问题付两遍钱。
 *
 * 折叠的只是「提问」，不是书签：两个书签仍然是两个书签，结果里照常两条。
 */
describe('classifyBookmarks 同 URL 只问一遍', () => {
  it('同 URL 的两个书签只问模型一次，两条都拿到同一个结果', async () => {
    const complete = vi.fn().mockResolvedValue({
      results: [{ bookmark_id: '1', target_category_id: '10', confidence: 0.9, reason: '同一个 URL' }],
    })
    const results = await classify({
      items: [item('1', 'https://dup.example/x'), item('2', 'https://dup.example/x')],
      candidates, client: { complete }, cache: new Map(),
    })

    // 防身：先确认请求真的发出去了、payload 里确实有这条书签，
    // 否则下面那条「只出现一次」在「压根没发请求」的实现下也会绿。
    expect(complete).toHaveBeenCalledTimes(1)
    const prompt = complete.mock.calls.map((c) => String(c[0])).join('\n')
    expect(prompt).toContain('"bookmark_id": "1"')
    expect(prompt.match(/dup\.example/g)).toHaveLength(1)

    expect(results.map((r) => r.bookmarkId)).toEqual(['1', '2'])
    for (const r of results) {
      expect(r).toMatchObject({ targetCategoryId: '10', confidence: 0.9, reason: '同一个 URL', source: 'llm' })
    }
  })

  /**
   * 这条钉的是**既有设计的后果**，不是本次新引入的取舍：cacheKey 不含标题，
   * 所以同 URL 不同标题在缓存眼里就是同一条，模型对第二条也给不出不同答案。
   * 将来 cacheKey 若改成含标题，这条会红——那时它红得对，是提醒折叠的依据
   * 跟着变了，该改的是折叠而不是这条用例。
   */
  it('同 URL、标题不同，仍然只问一遍', async () => {
    const complete = vi.fn().mockResolvedValue({
      results: [{ bookmark_id: '1', target_category_id: '10', confidence: 0.8, reason: 'r' }],
    })
    const results = await classify({
      items: [
        item('1', 'https://dup.example/x', '第一条标题'),
        item('2', 'https://dup.example/x', '第二条标题'),
      ],
      candidates, client: { complete }, cache: new Map(),
    })

    expect(complete).toHaveBeenCalledTimes(1)
    const prompt = String(complete.mock.calls[0]![0])
    // 先断言代表那条的标题确实在 payload 里（证明这个查询有效），再断言另一条不在。
    expect(prompt).toContain('第一条标题')
    expect(prompt).not.toContain('第二条标题')
    expect(results.map((r) => r.targetCategoryId)).toEqual(['10', '10'])
  })

  it('三个同 URL 的书签，结果里三个 id 全都有', async () => {
    const complete = vi.fn().mockResolvedValue({
      results: [{ bookmark_id: '1', target_category_id: '11', confidence: 0.7, reason: '论文' }],
    })
    const results = await classify({
      items: ['1', '2', '3'].map((id) => item(id, 'https://dup.example/paper')),
      candidates, client: { complete }, cache: new Map(),
    })

    expect(complete).toHaveBeenCalledTimes(1)
    expect(String(complete.mock.calls[0]![0]).match(/dup\.example/g)).toHaveLength(1)
    expect(results.map((r) => r.bookmarkId)).toEqual(['1', '2', '3'])
    for (const r of results) {
      expect(r).toMatchObject({ targetCategoryId: '11', reason: '论文', source: 'llm' })
    }
  })

  // 失败的结果同样要扇出：只回填代表那一条的话，同组其余书签会掉到
  // classifyBookmarks 最后那句 unprocessed 兜底里——「一条失败」变成
  // 「一条失败 + 一条凭空消失」。
  it('请求失败时同组其余书签拿到同一条失败结果，不是「未处理」', async () => {
    const complete = vi.fn().mockRejectedValue(Object.assign(new Error('bad key'), { retryable: false }))
    const results = await classify({
      items: ['1', '2', '3'].map((id) => item(id, 'https://dup.example/x')),
      candidates, client: { complete }, cache: new Map(),
    })

    expect(complete).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.bookmarkId)).toEqual(['1', '2', '3'])
    for (const r of results) {
      expect(r).toMatchObject({ targetCategoryId: null, source: 'none', detail: 'Error: bad key' })
      expect(r.reason).toContain('Error: bad key')
      expect(r.reason).not.toBe('未处理')
    }
  })

  it('模型漏返回该 URL 时同组其余书签也拿到同一条「未返回结果」，不是「未处理」', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    const results = await classify({
      items: ['1', '2'].map((id) => item(id, 'https://dup.example/x')),
      candidates, client: { complete }, cache: new Map(),
    })

    expect(complete).toHaveBeenCalledTimes(1)
    for (const r of results) {
      expect(r).toMatchObject({ targetCategoryId: null, source: 'none', reason: '模型未返回该书签的结果' })
    }
  })

  // 对照组：防「把所有东西都折叠成一条」的错误实现。
  it('不同 URL 的书签照常各问各的', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    const items = ['1', '2', '3'].map((id) => item(id, `https://s${id}.dev/x`))
    await classify({ items, candidates, client: { complete }, cache: new Map(), batchSize: 10 })

    expect(complete).toHaveBeenCalledTimes(1)
    const prompt = String(complete.mock.calls[0]![0])
    for (const id of ['1', '2', '3']) expect(prompt).toContain(`"bookmark_id": "${id}"`)
  })

  // 进度报的是 items.length 的进度，折叠后每批「跑完了几条」不再等于批次长度。
  // 按批次长度加会让进度条停在一个比总数小的终值上。
  it('进度终值是书签总数，不是提问次数', async () => {
    const onProgress = vi.fn()
    const items = [
      item('1', 'https://dup.example/x'),
      item('2', 'https://dup.example/x'),
      item('3', 'https://other.dev/y'),
      item('4', 'https://another.dev/z'),
    ]
    await classify({
      items, candidates, client: clientReturning({ results: [] }),
      cache: new Map(), batchSize: 1, onProgress,
    })
    expect(onProgress).toHaveBeenLastCalledWith(4, 4)
    for (const [done, total] of onProgress.mock.calls as [number, number][]) {
      expect(total).toBe(4)
      expect(done).toBeLessThanOrEqual(4)
    }
  })
})
