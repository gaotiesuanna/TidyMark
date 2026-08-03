import { describe, it, expect, vi } from 'vitest'
import { extractTags } from '@/llm/tags'
import type { BookmarkItem } from '@/core/types'

function item(id: string, url: string): BookmarkItem {
  return { id, title: 'T' + id, url, parentId: '1', index: 0, currentPath: ['书签栏'] }
}

describe('extractTags', () => {
  it('把模型返回的主题映射成 TagResult', async () => {
    const complete = vi.fn().mockResolvedValue({
      results: [{ bookmark_id: '1', primary_topic: '前端', secondary_topic: 'React' }],
    })
    const results = await extractTags([item('1', 'https://react.dev')], { complete })
    expect(results).toEqual([{ bookmarkId: '1', primaryTopic: '前端', secondaryTopic: 'React' }])
  })

  it('缺失 secondary_topic 时为 null', async () => {
    const complete = vi.fn().mockResolvedValue({
      results: [{ bookmark_id: '1', primary_topic: '前端', secondary_topic: null }],
    })
    expect((await extractTags([item('1', 'https://x.dev')], { complete }))[0]!.secondaryTopic).toBeNull()
  })

  it('分批调用', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    const items = Array.from({ length: 5 }, (_, i) => item(String(i), `https://s${i}.dev`))
    await extractTags(items, { complete }, { batchSize: 2 })
    expect(complete).toHaveBeenCalledTimes(3)
  })

  it('失败的批次降级为「未分类」主题，不抛错', async () => {
    const complete = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { retryable: false }))
    const results = await extractTags([item('1', 'https://x.dev')], { complete })
    expect(results[0]!.primaryTopic).toBe('未分类')
  })

  it('提示词中不含 URL 参数', async () => {
    const complete = vi.fn().mockResolvedValue({ results: [] })
    await extractTags([item('1', 'https://x.dev/a?token=SECRET')], { complete })
    expect(complete.mock.calls[0]![0]).not.toContain('SECRET')
  })
})
