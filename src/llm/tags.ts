import { sanitizeUrl } from '@/core/sanitize'
import type { BookmarkItem, TagResult } from '@/core/types'
import type { LlmClient } from './client'

export type { TagResult }

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['bookmark_id', 'primary_topic', 'secondary_topic'],
        properties: {
          bookmark_id: { type: 'string' },
          primary_topic: { type: 'string' },
          secondary_topic: { type: ['string', 'null'] },
        },
      },
    },
  },
}

function buildPrompt(items: BookmarkItem[]): string {
  const payload = items.map((item) => {
    const url = sanitizeUrl(item.url)
    return {
      bookmark_id: item.id,
      title: item.title,
      domain: url?.domain ?? '',
      path: url?.path ?? '',
      current_folder: item.currentPath.join(' / '),
    }
  })
  return [
    '为每个书签抽取主题标签，用于后续统计并设计目录结构。',
    '',
    '规则：',
    '1. primary_topic 是宽泛的一级主题，如「开发」「AI」「设计」「阅读」。',
    '2. secondary_topic 是更具体的二级主题，如「React」「LLM」；无法确定时返回 null。',
    '3. 主题名统一使用中文，除非是专有技术名词（React、TypeScript、LLM 等）。',
    '4. 尽量复用已出现过的主题名，不要为同一概念创造多个说法。',
    '',
    '书签列表：',
    JSON.stringify(payload, null, 2),
  ].join('\n')
}

export interface ExtractOptions {
  batchSize?: number
  concurrency?: number
  onProgress?: (done: number, total: number) => void
}

export async function extractTags(
  items: BookmarkItem[],
  client: LlmClient,
  options: ExtractOptions = {},
): Promise<TagResult[]> {
  const batchSize = options.batchSize ?? 25
  const concurrency = options.concurrency ?? 4

  const batches: BookmarkItem[][] = []
  for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize))

  const resolved = new Map<string, TagResult>()
  let done = 0
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < batches.length) {
      const batch = batches[cursor++]!
      try {
        const raw = (await client.complete(buildPrompt(batch), SCHEMA)) as {
          results?: Array<{ bookmark_id: string; primary_topic: string; secondary_topic: string | null }>
        }
        const byId = new Map((raw.results ?? []).map((r) => [r.bookmark_id, r]))
        for (const item of batch) {
          const hit = byId.get(item.id)
          resolved.set(item.id, {
            bookmarkId: item.id,
            primaryTopic: hit?.primary_topic ?? '未分类',
            secondaryTopic: hit?.secondary_topic ?? null,
          })
        }
      } catch {
        for (const item of batch) {
          resolved.set(item.id, { bookmarkId: item.id, primaryTopic: '未分类', secondaryTopic: null })
        }
      }
      done += batch.length
      options.onProgress?.(done, items.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker))

  return items.map(
    (item) =>
      resolved.get(item.id) ?? { bookmarkId: item.id, primaryTopic: '未分类', secondaryTopic: null },
  )
}
