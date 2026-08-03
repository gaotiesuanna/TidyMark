import { describe, it, expect, vi } from 'vitest'
import { extractTags, refineGroupTags, NO_TOPIC } from '@/llm/tags'
import type { BookmarkItem } from '@/core/types'

function item(id: string, url: string): BookmarkItem {
  return { id, title: 'T' + id, url, parentId: '1', index: 0, currentPath: ['书签栏'] }
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
