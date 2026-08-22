import { describe, it, expect, vi } from 'vitest'
import { extractTags as extractTagsRaw, refineGroupTags as refineGroupTagsRaw, NO_TOPIC } from '@/llm/tags'
import type { BookmarkItem, TagResult } from '@/core/types'
import type { LlmClient } from '@/llm/client'
import type { ExtractOptions } from '@/llm/tags'

function item(id: string, url: string): BookmarkItem {
  return { id, title: 'T' + id, url, parentId: '1', index: 0, currentPath: ['书签栏'] }
}

/**
 * locale 现在是必填项，但本文件里的用例全部只关心中文分支。
 * 固定传 'zh_CN'，调用点不必逐个重复。
 */
function extractTags(
  items: BookmarkItem[],
  client: LlmClient,
  options?: ExtractOptions,
): Promise<TagResult[]> {
  return extractTagsRaw(items, client, 'zh_CN', options)
}

function refineGroupTags(
  tags: TagResult[],
  bookmarks: BookmarkItem[],
  domainGroups: string[],
  client: LlmClient,
  options?: ExtractOptions,
): Promise<TagResult[]> {
  return refineGroupTagsRaw(tags, bookmarks, domainGroups, client, 'zh_CN', options)
}

describe('extractTags', () => {
  it('把模型返回的主题映射成 TagResult', async () => {
    const complete = vi.fn().mockResolvedValue({
      results: [{ bookmark_id: '1', primary_topic: 'React' }],
    })
    const results = await extractTags([item('1', 'https://react.dev')], { complete })
    expect(results).toEqual([{ bookmarkId: '1', primaryTopic: 'React', secondaryTopic: null }])
  })

  it('不再向模型索要二级主题，层级由目录设计阶段决定', async () => {
    const complete = vi.fn().mockResolvedValue({
      results: [{ bookmark_id: '1', primary_topic: 'React', secondary_topic: '组件' }],
    })
    const results = await extractTags([item('1', 'https://react.dev')], { complete })
    expect(results[0]!.secondaryTopic).toBeNull()
    expect(JSON.stringify(complete.mock.calls[0]![1])).not.toContain('secondary_topic')
  })

  it('提示词要求具体主题并禁用宽泛词', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    await extractTags([item('1', 'https://x.dev')], { complete })
    const prompt = complete.mock.calls[0]![0] as string
    expect(prompt).toContain('禁止使用')
    expect(prompt).not.toContain('宽泛的一级主题')
  })

  it('分批调用', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    const items = Array.from({ length: 5 }, (_, i) => item(String(i), `https://s${i}.dev`))
    await extractTags(items, { complete }, { batchSize: 2 })
    expect(complete).toHaveBeenCalledTimes(3)
  })

  it('失败的批次不抛错，主题留空，不参与目录设计', async () => {
    const complete = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { retryable: false }))
    const results = await extractTags([item('1', 'https://x.dev')], { complete })
    expect(results[0]!.primaryTopic).toBe(NO_TOPIC)
  })

  it('模型漏返回某个书签时同样留空，而不是编一个主题出来', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    const results = await extractTags([item('1', 'https://x.dev')], { complete })
    expect(results[0]!.primaryTopic).toBe(NO_TOPIC)
  })

  it('提示词中不含 URL 参数', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    await extractTags([item('1', 'https://x.dev/a?token=SECRET')], { complete })
    expect(complete.mock.calls[0]![0]).not.toContain('SECRET')
  })
})

describe('refineGroupTags', () => {
  const gh = (id: string) => item(id, `https://github.com/o/r${id}`)
  const other = (id: string) => item(id, `https://example.com/${id}`)
  const broad = (id: string) => ({ bookmarkId: id, primaryTopic: 'AI', secondaryTopic: null })

  it('聚合组内的书签换成更细的功能域标签', async () => {
    const complete = vi.fn().mockResolvedValue({
      results: [{ bookmark_id: '1', primary_topic: '文档解析', secondary_topic: null }],
    })
    const result = await refineGroupTags(
      [broad('1')], [gh('1')], ['github'], { complete },
    )
    expect(result).toEqual([{ bookmarkId: '1', primaryTopic: '文档解析', secondaryTopic: null }])
  })

  it('没命中聚合组的书签保持原标签，也不进请求', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    const result = await refineGroupTags(
      [broad('1'), broad('2')], [gh('1'), other('2')], ['github'], { complete },
    )
    expect(result[1]).toEqual(broad('2'))
    expect(complete.mock.calls[0]![0]).not.toContain('"2"')
  })

  it('没勾选任何聚合组时原样返回，不发请求', async () => {
    const complete = vi.fn()
    expect(await refineGroupTags([broad('1')], [gh('1')], [], { complete })).toEqual([broad('1')])
    expect(complete).not.toHaveBeenCalled()
  })

  it('细分失败时保留原来的宽泛标签，不让书签失去归属', async () => {
    const complete = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { retryable: false }))
    const result = await refineGroupTags([broad('1')], [gh('1')], ['github'], { complete })
    expect(result).toEqual([broad('1')])
  })

  it('提示词点名组名并禁用宽泛词', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    await refineGroupTags([broad('1')], [gh('1')], ['github'], { complete })
    const prompt = complete.mock.calls[0]![0] as string
    expect(prompt).toContain('GitHub')
    expect(prompt).toContain('禁止使用')
  })

  it('多个聚合组各自单独抽取', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    await refineGroupTags(
      [broad('1'), broad('2')],
      [gh('1'), item('2', 'https://arxiv.org/abs/1')],
      ['github', 'paper'],
      { complete },
    )
    expect(complete).toHaveBeenCalledTimes(2)
  })
})

describe('extractTags 的失败收场', () => {
  const serverError = (): Error => Object.assign(new Error('500'), { retryable: true })
  const badKeyError = (): Error => Object.assign(new Error('bad key'), { retryable: false })
  const truncatedError = (): Error =>
    Object.assign(new Error('truncated'), { retryable: false, truncated: true })

  /** 从提示词里读出这次问的是哪几条书签——mock 靠它区分整批与拆开后的半批。 */
  function idsIn(prompt: string): string[] {
    return [...prompt.matchAll(/"bookmark_id": "([^"]+)"/g)].map((m) => m[1]!)
  }

  const four = ['1', '2', '3', '4'].map((id) => item(id, `https://x${id}.dev`))

  it('可重试错误退避重试，下一次成功就不丢这一批', async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(serverError())
      .mockResolvedValueOnce({ results: [{ bookmark_id: '1', primary_topic: 'React' }] })
    const results = await extractTags([item('1', 'https://react.dev')], { complete })
    expect(complete).toHaveBeenCalledTimes(2)
    expect(results[0]!.primaryTopic).toBe('React')
  })

  it('可重试错误重试 2 次后才整批降级为空主题', async () => {
    const complete = vi.fn().mockRejectedValue(serverError())
    const results = await extractTags([item('1', 'https://a.dev')], { complete })
    expect(complete).toHaveBeenCalledTimes(3)
    expect(results[0]!.primaryTopic).toBe(NO_TOPIC)
  })

  it('不可重试错误立即放弃，不重试', async () => {
    const complete = vi.fn().mockRejectedValue(badKeyError())
    await extractTags([item('1', 'https://a.dev')], { complete })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('截断时拆成两半分别重问，两半的结果都保住', async () => {
    const complete = vi.fn().mockImplementation((prompt: string) => {
      const ids = idsIn(prompt)
      if (ids.length === 4) return Promise.reject(truncatedError())
      return Promise.resolve({ results: ids.map((id) => ({ bookmark_id: id, primary_topic: 'T' + id })) })
    })
    const results = await extractTags(four, { complete })
    expect(results.map((r) => r.primaryTopic)).toEqual(['T1', 'T2', 'T3', 'T4'])
    // 整批 1 次 + 两半各 1 次：截断不走重试，原样再问只会再截断一次
    expect(complete).toHaveBeenCalledTimes(3)
  })

  it('拆开后仍失败的那一半只丢那一半', async () => {
    const complete = vi.fn().mockImplementation((prompt: string) => {
      const ids = idsIn(prompt)
      if (ids.length === 4) return Promise.reject(truncatedError())
      if (ids.includes('3')) return Promise.reject(badKeyError())
      return Promise.resolve({ results: ids.map((id) => ({ bookmark_id: id, primary_topic: 'T' + id })) })
    })
    const results = await extractTags(four, { complete })
    expect(results.map((r) => r.primaryTopic)).toEqual(['T1', 'T2', NO_TOPIC, NO_TOPIC])
  })

  it('拆到一条还截断就放弃，不无限拆下去', async () => {
    const complete = vi.fn().mockRejectedValue(truncatedError())
    const results = await extractTags([item('1', 'https://a.dev'), item('2', 'https://b.dev')], {
      complete,
    })
    expect(results.every((r) => r.primaryTopic === NO_TOPIC)).toBe(true)
    expect(complete).toHaveBeenCalledTimes(3)
  })

  it('拆批记 warn、半批失败记 error，两条日志分得开', async () => {
    const logs: Array<{ message: string; level: string }> = []
    const complete = vi.fn().mockImplementation((prompt: string) => {
      const ids = idsIn(prompt)
      if (ids.length === 4) return Promise.reject(truncatedError())
      if (ids.includes('3')) return Promise.reject(badKeyError())
      return Promise.resolve({ results: ids.map((id) => ({ bookmark_id: id, primary_topic: 'T' + id })) })
    })
    await extractTags(four, { complete }, { onLog: (message, level) => logs.push({ message, level }) })
    expect(logs.some((l) => l.level === 'warn' && l.message.includes('输出被截断'))).toBe(true)
    expect(logs.some((l) => l.level === 'error' && l.message.includes('拆开后仍有 2 条失败'))).toBe(true)
  })

  it('整批失败的日志带上一共问了几次', async () => {
    const logs: string[] = []
    const complete = vi.fn().mockRejectedValue(serverError())
    await extractTags([item('1', 'https://a.dev')], { complete }, { onLog: (m) => logs.push(m) })
    expect(logs.some((m) => m.includes('问了 3 次'))).toBe(true)
  })

  it('拆开后两半各自的尝试都算进这一批的次数', async () => {
    const logs: string[] = []
    const complete = vi.fn().mockRejectedValue(truncatedError())
    await extractTags(four, { complete }, { onLog: (m) => logs.push(m) })
    // 整批 1 次 + 两半各 1 次 + 再拆成四份各 1 次 = 7
    expect(logs.some((m) => m.includes('问了 7 次'))).toBe(true)
  })

  it('两半都失败时只记一条整批失败，不再重复记两条半批失败', async () => {
    const logs: Array<{ message: string; level: string }> = []
    const complete = vi.fn().mockRejectedValue(truncatedError())
    await extractTags(four, { complete }, { onLog: (message, level) => logs.push({ message, level }) })
    expect(logs.filter((l) => l.message.includes('拆开后仍有'))).toHaveLength(0)
    expect(logs.filter((l) => l.message.includes('不参与目录设计'))).toHaveLength(1)
  })
})
