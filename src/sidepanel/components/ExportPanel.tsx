import { useMemo, useState } from 'react'
import {
  countScopedBookmarks,
  exportFileName,
  scopedBookmarkUrls,
  toLinksExport,
  toTreeExport,
} from '@/core/export'
import { toHtmlExport } from '@/core/exportHtml'
import { plural, t } from '@/i18n'
import { downloadJson, downloadText } from '../lib/download'
import { loadFavicons } from '../lib/favicons'
import { useStore } from '../store'
import { groupLabel, secondaryButton } from './buttonStyles'
import { DownloadIcon } from './icons'

export function ExportPanel() {
  const { tree, checkedIds, busy } = useStore()
  const scopeRootIds = useMemo(() => [...checkedIds], [checkedIds])
  const count = useMemo(() => countScopedBookmarks(tree, scopeRootIds), [tree, scopeRootIds])
  // 只锁本组按钮，不进 store.busy——取图标不改动书签库，不该把整页锁成任务态
  const [fetchingIcons, setFetchingIcons] = useState(false)

  function exportTree(): void {
    const at = new Date()
    downloadJson(exportFileName('tree', at), toTreeExport(tree, scopeRootIds, at))
  }

  function exportLinks(): void {
    const at = new Date()
    downloadJson(exportFileName('links', at), toLinksExport(tree, scopeRootIds, at))
  }

  async function exportHtml(): Promise<void> {
    setFetchingIcons(true)
    try {
      // 图标是锦上添花，取不到（比如 favicon 权限被撤）也要照常把文件导出去
      const icons = await loadFavicons(scopedBookmarkUrls(tree, scopeRootIds)).catch(
        () => new Map<string, string>(),
      )
      const at = new Date()
      downloadText(
        exportFileName('html', at),
        toHtmlExport(tree, scopeRootIds, icons),
        'text/html;charset=utf-8',
      )
    } finally {
      setFetchingIcons(false)
    }
  }

  const disabled = checkedIds.size === 0 || busy !== null || fetchingIcons

  return (
    <div className="space-y-2">
      {/* 下行箭头标出数据流向，让导出组与下方的导入组一眼分得开 */}
      <p className={groupLabel}>
        <DownloadIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
        {plural(count, 'exportGroupOne', 'exportGroupOther', String(count))}
      </p>
      <div className="flex gap-2">
        <button className={`${secondaryButton} flex-1`} disabled={disabled} onClick={exportTree}>
          {t('exportTree')}
        </button>
        <button className={`${secondaryButton} flex-1`} disabled={disabled} onClick={exportLinks}>
          {t('exportLinks')}
        </button>
      </div>
      {/* 单独一行：这条是给别的浏览器导入用的，与上面两个 TidyMark 自有格式不是一类 */}
      <button className={`${secondaryButton} w-full`} disabled={disabled} onClick={exportHtml}>
        {fetchingIcons ? t('exportHtmlBusy') : t('exportHtml')}
      </button>
    </div>
  )
}
