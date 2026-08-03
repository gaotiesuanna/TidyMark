import { djb2 } from '@/core/hash'
import { classifyByRules } from '@/core/rules'
import { resolveByRules } from '@/core/map'
import { sanitizeUrl } from '@/core/sanitize'
import type { BookmarkItem, CategoryCandidate, Classification } from '@/core/types'
import type { LlmClient } from './client'

export interface ClassifyInput {
  items: BookmarkItem[]
  candidates: CategoryCandidate[]
  client: LlmClient
  cache: Map<string, Classification>
  batchSize?: number
  concurrency?: number
  onProgress?: (done: number, total: number) => void
}

const MAX_RETRIES = 2

export function cacheKey(item: BookmarkItem, candidates: CategoryCandidate[]): string {
  const version = djb2(candidates.map((c) => c.id).join(','))
  return `${djb2(item.url)}:${version}`
}

export function buildBatchPrompt(items: BookmarkItem[], candidates: CategoryCandidate[]): string {
  const catalog = candidates.map((c) => `- id=${c.id} 目录=${c.path.join(' / ')}`).join('\n')
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
    '你是一个书签整理助手。为每个书签从下面的候选目录中选择最合适的一个。',
    '',
    '规则：',
    '1. 只能从候选目录里选，绝不能创造新目录。',
    '2. 如果没有任何目录合适，target_category_id 返回 null。',
    '3. confidence 是 0 到 1 之间的数字，表示你的把握程度。',
    '4. reason 用一句中文说明判断依据。',
    '',
    '候选目录：',
    catalog,
    '',
    '待分类书签：',
    JSON.stringify(payload, null, 2),
  ].join('\n')
}

function buildSchema(candidates: CategoryCandidate[]): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['results'],
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['bookmark_id', 'target_category_id', 'confidence', 'reason'],
          properties: {
            bookmark_id: { type: 'string' },
            target_category_id: {
              type: ['string', 'null'],
              enum: [...candidates.map((c) => c.id), null],
            },
            confidence: { type: 'number' },
            reason: { type: 'string' },
          },
        },
      },
    },
  }
}

interface RawResult {
  bookmark_id: string
  target_category_id: string | null
  confidence: number
  reason: string
}

function unclassified(item: BookmarkItem, reason: string): Classification {
  return { bookmarkId: item.id, targetCategoryId: null, confidence: 0, reason, source: 'none' }
}

async function runBatch(
  batch: BookmarkItem[],
  candidates: CategoryCandidate[],
  client: LlmClient,
): Promise<Classification[]> {
  const validIds = new Set(candidates.map((c) => c.id))
  let lastError = '未知错误'

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = (await client.complete(
        buildBatchPrompt(batch, candidates),
        buildSchema(candidates),
      )) as { results?: RawResult[] }
      const byId = new Map((raw.results ?? []).map((r) => [r.bookmark_id, r]))

      return batch.map((item) => {
        const hit = byId.get(item.id)
        if (!hit) return unclassified(item, '模型未返回该书签的结果')
        const target =
          hit.target_category_id !== null && validIds.has(hit.target_category_id)
            ? hit.target_category_id
            : null
        return {
          bookmarkId: item.id,
          targetCategoryId: target,
          confidence: target === null ? 0 : hit.confidence,
          reason: hit.reason,
          source: 'llm',
        }
      })
    } catch (error) {
      lastError = String(error)
      console.error('[TidyMark] 分类请求失败：', error)
      const retryable = (error as { retryable?: boolean }).retryable === true
      if (!retryable) break
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500))
      }
    }
  }
  return batch.map((item) => unclassified(item, `分类失败，保持原位：${lastError}`))
}

export async function classifyBookmarks(input: ClassifyInput): Promise<Classification[]> {
  const { items, candidates, client, cache } = input
  const batchSize = input.batchSize ?? 25
  const concurrency = input.concurrency ?? 4

  const resolved = new Map<string, Classification>()
  const pending: BookmarkItem[] = []

  for (const item of items) {
    const cached = cache.get(cacheKey(item, candidates))
    if (cached) {
      resolved.set(item.id, { ...cached, bookmarkId: item.id })
      continue
    }
    const rule = classifyByRules(item)
    const byRule = rule ? resolveByRules(item, rule, candidates) : null
    if (byRule) {
      resolved.set(item.id, byRule)
      continue
    }
    pending.push(item)
  }

  const batches: BookmarkItem[][] = []
  for (let i = 0; i < pending.length; i += batchSize) batches.push(pending.slice(i, i + batchSize))

  let done = resolved.size
  input.onProgress?.(done, items.length)

  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < batches.length) {
      const batch = batches[cursor++]!
      const results = await runBatch(batch, candidates, client)
      for (let i = 0; i < results.length; i++) {
        const result = results[i]!
        resolved.set(result.bookmarkId, result)
        if (result.source === 'llm') cache.set(cacheKey(batch[i]!, candidates), result)
      }
      done += batch.length
      input.onProgress?.(done, items.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker))

  return items.map((item) => resolved.get(item.id) ?? unclassified(item, '未处理'))
}
