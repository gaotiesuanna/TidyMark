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
import { choiceList, choiceRow } from './buttonStyles'
import { FileIcon, FolderIcon, LinkIcon } from './icons'

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
      <p className="px-0.5 text-sm leading-caption tabular-nums text-neutral-500">
        {plural(count, 'exportGroupOne', 'exportGroupOther', String(count))}
      </p>
      <div className={choiceList}>
        <button className={choiceRow} disabled={disabled} onClick={exportTree}>
          <FolderIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          {t('exportTree')}
        </button>
        <button className={choiceRow} disabled={disabled} onClick={exportLinks}>
          <LinkIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          {t('exportLinks')}
        </button>
        <button className={choiceRow} disabled={disabled} onClick={() => void exportHtml()}>
          <FileIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          {fetchingIcons ? t('exportHtmlBusy') : t('exportHtml')}
        </button>
      </div>
    </div>
  )
}
