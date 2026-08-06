import type { Locale } from '@/core/locale'

/**
 * engine 层自己产生的、会显示在结果页/撤销日志里的文案。
 *
 * 不走 _locales：engine/ 要保持零浏览器依赖、能在 node 环境测试，
 * 因此和 core/rules.ts、llm/logs.ts 一样自带双语表，语言由调用方传入。
 */

// ---- applyPlan ----

export function msgEmptyFolderRemoveFailed(locale: Locale, detail: string): string {
  return locale === 'zh_CN' ? `空文件夹删除失败：${detail}` : `Failed to remove empty folder: ${detail}`
}

export function msgFolderSortFailed(locale: Locale, detail: string): string {
  return locale === 'zh_CN' ? `目录排序失败：${detail}` : `Failed to sort folder: ${detail}`
}

export function msgBookmarkGone(locale: Locale): string {
  return locale === 'zh_CN' ? '书签已不存在' : 'Bookmark no longer exists'
}

export function msgParentUnresolved(locale: Locale, title: string): string {
  return locale === 'zh_CN'
    ? `无法解析文件夹 ${title} 的父目录`
    : `Could not resolve the parent folder for ${title}`
}

export function msgTargetUnresolved(locale: Locale, categoryId: string): string {
  return locale === 'zh_CN'
    ? `无法解析目标目录 ${categoryId}`
    : `Could not resolve target folder ${categoryId}`
}

// ---- undoLast ----

export function msgFolderRebuildFailed(locale: Locale, detail: string): string {
  return locale === 'zh_CN' ? `目录重建失败：${detail}` : `Failed to rebuild folder: ${detail}`
}

export function msgNodeGone(locale: Locale): string {
  return locale === 'zh_CN' ? '节点已不存在' : 'Node no longer exists'
}

export function msgTitleRestoreFailed(locale: Locale, detail: string): string {
  return locale === 'zh_CN' ? `标题恢复失败：${detail}` : `Failed to restore title: ${detail}`
}

export function msgTitleManuallyChanged(locale: Locale): string {
  return locale === 'zh_CN'
    ? '标题已被手动修改，跳过以免覆盖'
    : 'Title was manually changed; skipped to avoid overwriting it'
}

export function msgRepositionFailed(locale: Locale, detail: string): string {
  return locale === 'zh_CN' ? `归位失败：${detail}` : `Failed to reposition: ${detail}`
}

export function msgReorderFailed(locale: Locale, detail: string): string {
  return locale === 'zh_CN' ? `排序失败：${detail}` : `Failed to reorder: ${detail}`
}
