import { groupFolderTitle, matchDomainGroup } from '@/core/domainGroups'
import type { Locale } from '@/core/locale'
import { sanitizeUrl } from '@/core/sanitize'
import type { BookmarkItem, TagResult } from '@/core/types'
import type { LlmClient } from './client'
import { logBatch, logBatchFailed, logBatchPartFailed, logBatchSplit } from './logs'
import { groupTagsPrompt, tagsPrompt } from './prompts'

export type { TagResult }

/**
 * 抽取失败或模型漏返回时使用的空主题。
 * 空字符串会被 buildCategoryTree 跳过，这些书签因此不参与目录设计，
 * 既不会凑出一个假目录，也不会污染主题统计。分类阶段仍会正常处理它们。
 */
export const NO_TOPIC = ''

/** 宽泛词黑名单现在按语言分表维护，定义搬去了 prompts.ts，这里只是重新导出，避免两处定义。 */
export { BROAD_WORDS } from './prompts'

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
        required: ['bookmark_id', 'primary_topic'],
        properties: {
          bookmark_id: { type: 'string' },
          primary_topic: { type: 'string' },
        },
      },
    },
  },
}

function payloadOf(items: BookmarkItem[]): unknown[] {
  return items.map((item) => {
    const url = sanitizeUrl(item.url)
    return {
      bookmark_id: item.id,
      title: item.title,
      domain: url?.domain ?? '',
      path: url?.path ?? '',
      current_folder: item.currentPath.join(' / '),
    }
  })
}

function buildPrompt(locale: Locale, items: BookmarkItem[]): string {
  return [
    ...tagsPrompt(locale),
    '',
    locale === 'zh_CN' ? '书签列表：' : 'Bookmark list:',
    JSON.stringify(payloadOf(items), null, 2),
  ].join('\n')
}

/**
 * 聚合组内部的细分提示词。
 *
 * 通用提示词要的是「宽泛的一级主题」，可这批书签的共同点已经写在组名上了：
 * 再抽一次「AI」「开发」毫无区分度，105 个 GitHub 仓库会挤进三四个目录。
 * 这里换成问「它解决什么问题」，并明令禁止那些宽泛词。
 */
function buildGroupPrompt(locale: Locale, groupTitle: string): (items: BookmarkItem[]) => string {
  return (items) =>
    [
      ...groupTagsPrompt(locale, groupTitle),
      '',
      locale === 'zh_CN' ? '书签列表：' : 'Bookmark list:',
      JSON.stringify(payloadOf(items), null, 2),
    ].join('\n')
}

/**
 * 一批的重试次数，与 classify.ts 的 MAX_RETRIES 同一口径。
 *
 * 这条路上原先一次重试都没有：网关抖一下返回 500，整批 25 条书签当场判成
 * NO_TOPIC、退出目录设计，而 client.ts 早就把 5xx / 429 标成了 retryable，
 * 只是没人读那个字段。
 */
const MAX_RETRIES = 2

function flagged(error: unknown, key: 'retryable' | 'truncated'): boolean {
  return (error as Record<string, unknown> | null)?.[key] === true
}

export interface ExtractOptions {
  batchSize?: number
  concurrency?: number
  onProgress?: (done: number, total: number) => void
  onLog?: (message: string, level: 'info' | 'warn' | 'error') => void
  /** 每批开始前检查一次，返回 true 就停止派发后续批次。 */
  isCancelled?: () => boolean
}

async function runExtraction(
  items: BookmarkItem[],
  client: LlmClient,
  buildOnePrompt: (batch: BookmarkItem[]) => string,
  options: ExtractOptions,
  label: string,
  locale: Locale,
): Promise<TagResult[]> {
  const batchSize = options.batchSize ?? 25
  const concurrency = options.concurrency ?? 4

  const batches: BookmarkItem[][] = []
  for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize))

  const resolved = new Map<string, TagResult>()
  let done = 0
  let cursor = 0

  /**
   * 问一批，返回 bookmark_id → primary_topic；这一批彻底没救时抛出最后一个错误。
   *
   * 两种失败分开收场：
   * - 可重试（429 / 5xx / 网络）——退避后原样再问，最多 MAX_RETRIES 次；
   * - 截断（client.ts 的 LlmError.truncated）——不重试，原样再问只会在同一个字上
   *   再断一次，改成对半拆开分别问。拆完仍失败的那一半只丢那一半，同批的另一半
   *   已经拿到手了，没有理由陪葬。
   */
  async function ask(
    batch: BookmarkItem[],
    index: number,
    tally: { attempts: number },
  ): Promise<Map<string, string>> {
    let lastError: unknown
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      tally.attempts++
      try {
        const raw = (await client.complete(buildOnePrompt(batch), SCHEMA)) as {
          results?: Array<{ bookmark_id: string; primary_topic: string }>
        }
        return new Map((raw.results ?? []).map((r) => [r.bookmark_id, r.primary_topic]))
      } catch (error) {
        lastError = error
        // 只进开发者控制台，不必双语。
        console.error('[TidyMark] 标签抽取失败：', error)
        if (!flagged(error, 'retryable')) break
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500))
        }
      }
    }
    if (flagged(lastError, 'truncated') && batch.length > 1) {
      return split(batch, index, lastError, tally)
    }
    throw lastError
  }

  async function split(
    batch: BookmarkItem[],
    index: number,
    cause: unknown,
    tally: { attempts: number },
  ): Promise<Map<string, string>> {
    options.onLog?.(logBatchSplit(locale, label, index, batches.length, batch.length), 'warn')
    const mid = Math.ceil(batch.length / 2)
    const merged = new Map<string, string>()
    const failures: Array<{ size: number; detail: string }> = []
    // 顺序问而不是并发：外层已经有 concurrency 个 worker 在跑，
    // 一批刚被截断说明这条线正吃力，没必要再往上叠一倍请求。
    for (const half of [batch.slice(0, mid), batch.slice(mid)]) {
      try {
        for (const [id, topic] of await ask(half, index, tally)) merged.set(id, topic)
      } catch (error) {
        failures.push({ size: half.length, detail: String(error) })
      }
    }
    // 两半全军覆没就把原错误交回去，由调用方统一记一条「整批失败」——
    // 那种情形下再补两条「拆开后仍失败」只是把同一件事说三遍。
    if (merged.size === 0 && failures.length === 2) throw cause
    for (const failure of failures) {
      options.onLog?.(
        logBatchPartFailed(locale, label, index, batches.length, failure.size, failure.detail),
        'error',
      )
    }
    return merged
  }

  async function worker(): Promise<void> {
    while (cursor < batches.length) {
      if (options.isCancelled?.() === true) return
      const index = cursor++
      const batch = batches[index]!
      // 这一批一共问出去多少次——含重试，也含拆批后每一半各自的尝试。
      const tally = { attempts: 0 }
      try {
        const topics = await ask(batch, index, tally)
        for (const item of batch) {
          resolved.set(item.id, {
            bookmarkId: item.id,
            primaryTopic: topics.get(item.id) ?? NO_TOPIC,
            secondaryTopic: null,
          })
        }
        options.onLog?.(logBatch(locale, label, index, batches.length, batch.length), 'info')
      } catch (error) {
        for (const item of batch) {
          resolved.set(item.id, { bookmarkId: item.id, primaryTopic: NO_TOPIC, secondaryTopic: null })
        }
        options.onLog?.(
          logBatchFailed(locale, label, index, batches.length, String(error), tally.attempts),
          'error',
        )
      }
      done += batch.length
      options.onProgress?.(done, items.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker))

  return items.map(
    (item) =>
      resolved.get(item.id) ?? { bookmarkId: item.id, primaryTopic: NO_TOPIC, secondaryTopic: null },
  )
}

export async function extractTags(
  items: BookmarkItem[],
  client: LlmClient,
  locale: Locale,
  options: ExtractOptions = {},
): Promise<TagResult[]> {
  const label = locale === 'zh_CN' ? '标签批次' : 'Tag batch'
  return runExtraction(items, client, (batch) => buildPrompt(locale, batch), options, label, locale)
}

/**
 * 命中聚合组的书签换一套更细的标签重抽一次。
 *
 * 抽取失败的书签保留原来的宽泛标签——好过让它们彻底失去归属。
 */
export async function refineGroupTags(
  tags: TagResult[],
  bookmarks: BookmarkItem[],
  domainGroups: string[],
  client: LlmClient,
  locale: Locale,
  options: ExtractOptions = {},
): Promise<TagResult[]> {
  if (domainGroups.length === 0) return tags

  const byGroup = new Map<string, { title: string; items: BookmarkItem[] }>()
  for (const item of bookmarks) {
    const group = matchDomainGroup(item, domainGroups)
    if (group === null) continue
    // 这里的 title 只喂给提示词与日志，不是最终目录名——产出层已在 tree.ts 双语化。
    const bucket = byGroup.get(group.key) ?? { title: groupFolderTitle(group, locale), items: [] }
    bucket.items.push(item)
    byGroup.set(group.key, bucket)
  }
  if (byGroup.size === 0) return tags

  const refined = new Map<string, TagResult>()
  for (const { title, items } of byGroup.values()) {
    if (options.isCancelled?.() === true) break
    const groupLabel = locale === 'zh_CN' ? `${title} 功能域` : `${title} domains`
    const results = await runExtraction(
      items, client, buildGroupPrompt(locale, title), options, groupLabel, locale,
    )
    for (const result of results) {
      if (result.primaryTopic !== NO_TOPIC) refined.set(result.bookmarkId, result)
    }
  }

  return tags.map((tag) => refined.get(tag.bookmarkId) ?? tag)
}
