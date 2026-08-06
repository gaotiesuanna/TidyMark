import { djb2 } from '@/core/hash'
import type { Locale } from '@/core/locale'
import { classifyByRules } from '@/core/rules'
import { resolveByRules } from '@/core/map'
import { sanitizeUrl } from '@/core/sanitize'
import type { BookmarkItem, CategoryCandidate, Classification } from '@/core/types'
import type { LlmClient } from './client'
import { fallbackReason, logBatchDone } from './logs'
import { classifyPrompt } from './prompts'

export interface ClassifyInput {
  items: BookmarkItem[]
  candidates: CategoryCandidate[]
  client: LlmClient
  cache: Map<string, Classification>
  batchSize?: number
  concurrency?: number
  onProgress?: (done: number, total: number) => void
  onLog?: (message: string, level: 'info' | 'warn' | 'error') => void
  /** 每批开始前检查一次，返回 true 就停止派发后续批次。 */
  isCancelled?: () => boolean
  /** 规则表命中的标签走哪种语言。必填——Record<Locale, string> 的强制在调用点这一侧也不能松口。 */
  locale: Locale
}

const MAX_RETRIES = 2

export function cacheKey(item: BookmarkItem, candidates: CategoryCandidate[]): string {
  const version = djb2(candidates.map((c) => c.id).join(','))
  return `${djb2(item.url)}:${version}`
}

export function buildBatchPrompt(
  items: BookmarkItem[],
  candidates: CategoryCandidate[],
  locale: Locale,
): string {
  const folderLabel = locale === 'zh_CN' ? '目录' : 'folder'
  const catalog = candidates.map((c) => `- id=${c.id} ${folderLabel}=${c.path.join(' / ')}`).join('\n')
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
    ...classifyPrompt(locale),
    '',
    locale === 'zh_CN' ? '候选目录：' : 'Candidate folders:',
    catalog,
    '',
    locale === 'zh_CN' ? '待分类书签：' : 'Bookmarks to classify:',
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
  locale: Locale,
): Promise<Classification[]> {
  const validIds = new Set(candidates.map((c) => c.id))
  // 仅用于满足类型初始化：正常执行路径下，走到最终 return 之前必然先经过下面的
  // catch 把它覆盖成真实错误信息，这个初始值实际不会被用户看到，不必双语。
  let lastError = '未知错误'

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = (await client.complete(
        buildBatchPrompt(batch, candidates, locale),
        buildSchema(candidates),
      )) as { results?: RawResult[] }
      const byId = new Map((raw.results ?? []).map((r) => [r.bookmark_id, r]))

      return batch.map((item) => {
        const hit = byId.get(item.id)
        if (!hit) return unclassified(item, fallbackReason(locale, 'noResult'))
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
      // 只进开发者控制台，不进侧栏日志，不必双语。
      console.error('[TidyMark] 分类请求失败：', error)
      const retryable = (error as { retryable?: boolean }).retryable === true
      if (!retryable) break
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500))
      }
    }
  }
  return batch.map((item) => unclassified(item, fallbackReason(locale, 'failed', lastError)))
}

export async function classifyBookmarks(input: ClassifyInput): Promise<Classification[]> {
  const { items, candidates, client, cache, locale } = input
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
    const rule = classifyByRules(item, locale)
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
      if (input.isCancelled?.() === true) return
      const index = cursor++
      const batch = batches[index]!
      const startedAt = Date.now()
      const results = await runBatch(batch, candidates, client, locale)
      const ok = results.filter((r) => r.source === 'llm').length
      const summary = logBatchDone(locale, index, batches.length, batch.length, ok, Date.now() - startedAt)
      // 只进开发者控制台，不必双语。
      console.log(`[TidyMark] ${summary}`)
      if (ok === batch.length) input.onLog?.(summary, 'info')
      else if (ok === 0) {
        const sep = locale === 'zh_CN' ? '。' : '. '
        input.onLog?.(`${summary}${sep}${results[0]?.reason ?? ''}`, 'error')
      } else input.onLog?.(summary, 'warn')
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

  return items.map((item) => resolved.get(item.id) ?? unclassified(item, fallbackReason(locale, 'unprocessed')))
}
