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

export function logDuplicateTopics(locale: Locale, detail: string): string {
  return locale === 'zh_CN'
    ? `模型返回的目录设计中标签重复声明，已保留最后一个：${detail}`
    : `The model declared the same label in several folders; kept the last one: ${detail}`
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
