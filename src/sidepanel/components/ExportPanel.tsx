import { useMemo } from 'react'
import {
  countScopedBookmarks,
  exportFileName,
  toLinksExport,
  toTreeExport,
} from '@/core/export'
import { downloadJson } from '../lib/download'
import { useStore } from '../store'

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

  return (
    <div className="space-y-1">
      {/* 箭头标出数据流向，让导出组与下方的导入组一眼分得开；对读屏无意义故隐藏 */}
      <p className="text-xs text-neutral-500">
        <span aria-hidden="true">↓ </span>导出选中的 {count} 条书签
      </p>
      <div className="flex gap-1 text-xs">
        <button
          className="flex-1 rounded border py-1.5 hover:bg-neutral-50 disabled:opacity-40"
          disabled={checkedIds.size === 0 || busy !== null}
          onClick={exportTree}
        >
          带文件夹结构
        </button>
        <button
          className="flex-1 rounded border py-1.5 hover:bg-neutral-50 disabled:opacity-40"
          disabled={checkedIds.size === 0 || busy !== null}
          onClick={exportLinks}
        >
          纯链接清单
        </button>
      </div>
    </div>
  )
}
