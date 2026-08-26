import { useMemo, useState } from 'react'
import { t } from '@/i18n'
import { BookmarkTree, filterBookmarkTree, topLevelNodes } from '../components/BookmarkTree'
import { ExportPanel } from '../components/ExportPanel'
import { ImportPanel } from '../components/ImportPanel'
import { segmentActive, segmentButton, segmentTrack } from '../components/buttonStyles'
import { DownloadIcon, UploadIcon } from '../components/icons'
import { collectAllFolderIds, useStore } from '../store'

type TransferPanel = 'export' | 'import'

function initialTransfer(): TransferPanel {
  const { importFile, importError, importDone } = useStore.getState()
  return importFile !== null || importError !== null || importDone !== null ? 'import' : 'export'
}

export function TransferStep() {
  const { tree, checkedIds, toggle, busy } = useStore()
  const [transfer, setTransfer] = useState<TransferPanel>(initialTransfer)
  const [expanded, setExpanded] = useState<Set<string> | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedBeforeSearch, setExpandedBeforeSearch] = useState<Set<string> | null>(null)
  const [searchExpandedIds, setSearchExpandedIds] = useState<Set<string> | null>(null)
  const defaultExpanded = useMemo(
    () => new Set(topLevelNodes(tree).map((node) => node.id)),
    [tree],
  )
  const expandedIds = expanded ?? defaultExpanded
  const searchActive = searchQuery.trim().length > 0
  const searchResult = useMemo(
    () => filterBookmarkTree(tree, searchQuery),
    [tree, searchQuery],
  )
  const visibleNodes = searchActive ? searchResult.nodes : tree
  const visibleExpandedIds = searchActive
    ? (searchExpandedIds ?? searchResult.expandedIds)
    : expandedIds

  function changeSearchQuery(value: string): void {
    const wasActive = searchQuery.trim().length > 0
    const willBeActive = value.trim().length > 0
    if (!wasActive && willBeActive) setExpandedBeforeSearch(new Set(expandedIds))
    if (wasActive && !willBeActive) {
      setExpanded(expandedBeforeSearch ?? expandedIds)
      setExpandedBeforeSearch(null)
    }
    setSearchExpandedIds(null)
    setSearchQuery(value)
  }

  function toggleExpand(id: string): void {
    const next = new Set(visibleExpandedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    if (searchActive) setSearchExpandedIds(next)
    else setExpanded(next)
  }

  function setAllExpanded(ids: string[]): void {
    if (searchActive) setSearchExpandedIds(new Set(ids))
    else setExpanded(new Set(ids))
  }

  return (
    <div>
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-neutral-500">{t('transferIntro')}</p>

        <div className="flex gap-1 text-xs">
          <button
            className="rounded border px-2 py-1 hover:bg-neutral-50"
            onClick={() => setAllExpanded(collectAllFolderIds(visibleNodes))}
          >
            {t('scopeExpandAll')}
          </button>
          <button
            className="rounded border px-2 py-1 hover:bg-neutral-50"
            onClick={() => setAllExpanded([])}
          >
            {t('scopeCollapseAll')}
          </button>
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t('treeSearchLabel')}</span>
            <input
              type="search"
              aria-label={t('treeSearchLabel')}
              value={searchQuery}
              onChange={(event) => changeSearchQuery(event.target.value)}
              placeholder={t('treeSearchPlaceholder')}
              className="w-full min-w-0 rounded border px-2 py-1 outline-none focus:border-neutral-400 focus:ring-1 focus:ring-neutral-300"
            />
          </label>
        </div>

        <div className="rounded border">
          <BookmarkTree
            nodes={visibleNodes}
            checkedIds={checkedIds}
            onToggle={toggle}
            expandedIds={visibleExpandedIds}
            onToggleExpand={toggleExpand}
            showBookmarks={searchActive}
          />
          {searchActive && !searchResult.hasMatches && (
            <p className="px-2 py-3 text-center text-xs text-neutral-500">{t('treeSearchEmpty')}</p>
          )}
        </div>
      </div>
      {/* 操作区钉在底部：书签上千条时目录树很长，导入导出不该被推到要滚半天才看得见的地方。
          负的左右外边距抵掉 <main> 的 p-4，让顶边线和白底铺满整宽。 */}
      <div className="sticky -bottom-4 -mx-4 -mb-4 mt-3 border-t border-neutral-200 bg-white px-4 pb-4 pt-3">
        <section className="rounded-xl border border-neutral-200 bg-neutral-50 p-1.5">
          <div className={segmentTrack} role="group">
            <button
              type="button"
              className={`${segmentButton} ${transfer === 'export' ? segmentActive : ''}`}
              aria-expanded={transfer === 'export'}
              aria-pressed={transfer === 'export'}
              disabled={busy !== null && transfer !== 'export'}
              onClick={() => setTransfer('export')}
            >
              <DownloadIcon className={`h-3.5 w-3.5 shrink-0 ${transfer === 'export' ? 'text-neutral-700' : 'text-neutral-400'}`} />
              {t('exportToggle')}
            </button>
            <button
              type="button"
              className={`${segmentButton} ${transfer === 'import' ? segmentActive : ''}`}
              aria-expanded={transfer === 'import'}
              aria-pressed={transfer === 'import'}
              disabled={busy !== null && transfer !== 'import'}
              onClick={() => setTransfer('import')}
            >
              <UploadIcon className={`h-3.5 w-3.5 shrink-0 ${transfer === 'import' ? 'text-neutral-700' : 'text-neutral-400'}`} />
              {t('importToggle')}
            </button>
          </div>
          <div className="mt-1.5 rounded-lg bg-white p-2.5 shadow-sm ring-1 ring-black/5">
            {transfer === 'export' ? <ExportPanel /> : <ImportPanel />}
          </div>
        </section>
      </div>
    </div>
  )
}
