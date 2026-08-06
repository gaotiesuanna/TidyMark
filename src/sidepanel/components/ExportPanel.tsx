import { useMemo } from 'react'
import {
  countScopedBookmarks,
  exportFileName,
  toLinksExport,
  toTreeExport,
} from '@/core/export'
import { plural, t } from '@/i18n'
import { downloadJson } from '../lib/download'
import { useStore } from '../store'
import { groupLabel, secondaryButton } from './buttonStyles'
import { DownloadIcon } from './icons'

export function ExportPanel() {
  const { tree, checkedIds, busy } = useStore()
  const scopeRootIds = useMemo(() => [...checkedIds], [checkedIds])
  const count = useMemo(() => countScopedBookmarks(tree, scopeRootIds), [tree, scopeRootIds])

  function exportTree(): void {
    const at = new Date()
    downloadJson(exportFileName('tree', at), toTreeExport(tree, scopeRootIds, at))
  }

  function exportLinks(): void {
    const at = new Date()
    downloadJson(exportFileName('links', at), toLinksExport(tree, scopeRootIds, at))
  }

  const disabled = checkedIds.size === 0 || busy !== null

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
    </div>
  )
}
