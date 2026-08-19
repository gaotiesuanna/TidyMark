import type { Locale } from '@/core/locale'

/**
 * llm 层自己产生的、会显示在侧栏运行日志里的文案。
 *
 * 不走 _locales：llm/ 要保持零浏览器依赖、能在 node 环境测试，
 * 因此和 core/rules.ts 一样自带双语表，语言由调用方传入。
 */
export function logBatch(locale: Locale, label: string, index: number, total: number, size: number): string {
  return locale === 'zh_CN'
    ? `${label} ${index + 1}/${total}：${size} 条`
    : `${label} ${index + 1}/${total}: ${size} items`
}

export function logBatchDone(
  locale: Locale, index: number, total: number, size: number, ok: number, ms: number,
): string {
  return locale === 'zh_CN'
    ? `分类批次 ${index + 1}/${total}：${size} 条，成功 ${ok} 条，耗时 ${ms}ms`
    : `Classify batch ${index + 1}/${total}: ${size} items, ${ok} succeeded, ${ms}ms`
}

export function logBatchFailed(
  locale: Locale, label: string, index: number, total: number, detail: string,
): string {
  return locale === 'zh_CN'
    ? `${label} ${index + 1}/${total} 失败，这批书签不参与目录设计：${detail}`
    : `${label} ${index + 1}/${total} failed; these bookmarks are excluded from folder design: ${detail}`
}

export function logFoldersDone(locale: Locale, folders: number, merged: number): string {
  return locale === 'zh_CN'
    ? `目录设计完成：${folders} 个目录，归并 ${merged} 个标签`
    : `Folder design done: ${folders} folders, ${merged} labels merged`
}

export function logFoldersFailed(locale: Locale, detail: string): string {
  return locale === 'zh_CN'
    ? `目录设计失败，保留原始标签进入建树：${detail}`
    : `Folder design failed; falling back to raw labels: ${detail}`
}

/**
 * 只在「重问」那次请求失败时打——第一版设计还在，不是退回原始标签，
 * 因此不能沿用 logFoldersFailed 的文案（见 issues review I1：那条文案说反话）。
 */
export function logFoldersRetryFailed(locale: Locale, detail: string): string {
  return locale === 'zh_CN'
    ? `重出目录名失败，沿用上一版：${detail}`
    : `Retry failed; keeping the previous design: ${detail}`
}

export function logDuplicateTopics(locale: Locale, detail: string): string {
  return locale === 'zh_CN'
    ? `模型返回的目录设计中标签重复声明，已保留最后一个：${detail}`
    : `The model declared the same label in several folders; kept the last one: ${detail}`
}

export function logCompoundNames(locale: Locale, detail: string): string {
  return locale === 'zh_CN'
    ? `目录名把两个概念捆在了一起，已要求模型重出一版：${detail}`
    : `Some folder names bundle two concepts; asked the model for another pass: ${detail}`
}

export function logCompoundNamesRemain(locale: Locale, detail: string): string {
  return locale === 'zh_CN'
    ? `重出后仍有目录名捆着两个概念，按现状继续：${detail}`
    : `Folder names still bundle two concepts after the retry; continuing as is: ${detail}`
}

/**
 * 主题那摊设计完之后，有多少标签没能映射到任何目录（`applyDesign` 置成 NO_TOPIC）。
 * 这些书签最终去处由分类阶段决定——多半是「其他」，也可能是某个已有目录的候选。
 * 只在 N > 0 时打，不发明比例阈值（见 issues review I5）。
 */
export function logNoTopicMapped(locale: Locale, count: number): string {
  return locale === 'zh_CN'
    ? `主题设计完成后有 ${count} 个标签没有映射到任何目录，去处由分类阶段决定`
    : `${count} labels were not mapped to any folder after topic design; where they end up is decided by the classification step`
}

export function fallbackReason(
  locale: Locale, kind: 'noResult' | 'failed' | 'unprocessed', detail = '',
): string {
  if (locale === 'zh_CN') {
    if (kind === 'noResult') return '模型未返回该书签的结果'
    if (kind === 'unprocessed') return '未处理'
    return `分类失败，保持原位：${detail}`
  }
  if (kind === 'noResult') return 'The model returned no result for this bookmark'
  if (kind === 'unprocessed') return 'Not processed'
  return `Classification failed, left in place: ${detail}`
}
