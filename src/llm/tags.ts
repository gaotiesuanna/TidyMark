import { matchDomainGroup } from '@/core/domainGroups'
import { sanitizeUrl } from '@/core/sanitize'
import type { BookmarkItem, TagResult } from '@/core/types'
import type { LlmClient } from './client'

export type { TagResult }

/**
 * 抽取失败或模型漏返回时使用的空主题。
 * 空字符串会被 buildCategoryTree 跳过，这些书签因此不参与目录设计，
 * 既不会凑出一个假目录，也不会污染主题统计。分类阶段仍会正常处理它们。
 */
export const NO_TOPIC = ''

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

function buildPrompt(items: BookmarkItem[]): string {
  return [
    '为每个书签抽取一个具体主题，供后续归并使用。',
    '',
    '规则：',
    '1. 主题回答「这个书签讲什么、解决什么问题」，要具体。',
    '2. 禁止使用这些宽泛词：AI、人工智能、开发、编程、技术、工具、学习、资源、其他。',
    '3. 例如「Claude Code」「KV Cache」「终端工具」「提示工程」，而不是「AI」「开发」。',
    '4. 主题名用中文，2 到 8 个字；专有技术名词（React、RAG、MCP）可直接用原文。',
    '5. 尽量复用已出现过的主题名，不要为同一概念创造多个说法。',
    '',
    '书签列表：',
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
function buildGroupPrompt(groupTitle: string): (items: BookmarkItem[]) => string {
  return (items) =>
    [
      `下面这些书签全部来自「${groupTitle}」。这个共同点已经体现在目录名上，不要再拿它当分类依据。`,
      '为每个书签抽取一个「功能域」标签，回答「它解决什么问题」。',
      '',
      '规则：',
      '1. 禁止使用这些宽泛词：AI、人工智能、开发、编程、技术、工具、学习、资源、其他。',
      '2. 用具体的问题域，例如「文档解析」「RAG 检索」「模型微调」「语音合成」「Agent 框架」「可观测性」。',
      '3. title 通常是「作者/仓库名: 一句话简介」，简介是判断用途最可靠的依据。',
      '4. 标签用中文，2 到 6 个字；专有技术名词（RAG、MCP、TTS）可直接用原文。',
      '5. 尽量复用已出现过的标签名，不要为同一概念创造多个说法。',
      '',
      '书签列表：',
      JSON.stringify(payloadOf(items), null, 2),
    ].join('\n')
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
      if (options.isCancelled?.() === true) return
      const index = cursor++
      const batch = batches[index]!
      try {
        const raw = (await client.complete(buildOnePrompt(batch), SCHEMA)) as {
          results?: Array<{ bookmark_id: string; primary_topic: string }>
        }
        const byId = new Map((raw.results ?? []).map((r) => [r.bookmark_id, r]))
        for (const item of batch) {
          const hit = byId.get(item.id)
          resolved.set(item.id, {
            bookmarkId: item.id,
            primaryTopic: hit?.primary_topic ?? NO_TOPIC,
            secondaryTopic: null,
          })
        }
        options.onLog?.(`${label} ${index + 1}/${batches.length}：${batch.length} 条`, 'info')
      } catch (error) {
        console.error('[TidyMark] 标签抽取失败：', error)
        for (const item of batch) {
          resolved.set(item.id, { bookmarkId: item.id, primaryTopic: NO_TOPIC, secondaryTopic: null })
        }
        options.onLog?.(
          `${label} ${index + 1}/${batches.length} 失败，这批书签不参与目录设计：${String(error)}`,
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
  options: ExtractOptions = {},
): Promise<TagResult[]> {
  return runExtraction(items, client, buildPrompt, options, '标签批次')
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
  options: ExtractOptions = {},
): Promise<TagResult[]> {
  if (domainGroups.length === 0) return tags

  const byGroup = new Map<string, { title: string; items: BookmarkItem[] }>()
  for (const item of bookmarks) {
    const group = matchDomainGroup(item, domainGroups)
    if (group === null) continue
    const bucket = byGroup.get(group.key) ?? { title: group.folderTitle, items: [] }
    bucket.items.push(item)
    byGroup.set(group.key, bucket)
  }
  if (byGroup.size === 0) return tags

  const refined = new Map<string, TagResult>()
  for (const { title, items } of byGroup.values()) {
    if (options.isCancelled?.() === true) break
    const results = await runExtraction(
      items, client, buildGroupPrompt(title), options, `${title} 功能域`,
    )
    for (const result of results) {
      if (result.primaryTopic !== NO_TOPIC) refined.set(result.bookmarkId, result)
    }
  }

  return tags.map((tag) => refined.get(tag.bookmarkId) ?? tag)
}
