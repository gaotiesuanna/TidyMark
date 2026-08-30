import { useMemo, useState } from 'react'
import { t } from '@/i18n'
import { BookmarkTree, filterBookmarkTree, topLevelNodes } from '../components/BookmarkTree'
import { ExportPanel } from '../components/ExportPanel'
import { ImportPanel } from '../components/ImportPanel'
import { segmentActive, segmentButton, segmentTrack } from '../components/buttonStyles'
import { StickyActionBar } from '../components/IndexControls'
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
  const folderIds = collectAllFolderIds(visibleNodes)
  const allOpen = folderIds.length > 0 && folderIds.every((id) => visibleExpandedIds.has(id))

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
        <p className="text-sm leading-relaxed text-neutral-500">{t('transferIntro')}</p>

        <div className="flex gap-1 text-sm leading-caption">
          <button
            className="rounded border px-2 py-1 hover:bg-neutral-50"
            onClick={() => setAllExpanded(allOpen ? [] : folderIds)}
          >
            {t(allOpen ? 'scopeCollapseAll' : 'scopeExpandAll')}
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
            <p className="px-2 py-3 text-center text-sm leading-caption text-neutral-500">{t('treeSearchEmpty')}</p>
          )}
        </div>
      </div>
      {/* 操作区钉在底部：书签上千条时目录树很长，导入导出不该被推到要滚半天才看得见的地方。
          切换条和选项组直接铺在 sticky 栏里，不再套一层灰底卡片——那层 padding
          会把「导出 / 导入」撑得比真按钮还壮。 */}
      <StickyActionBar>
        <div className={segmentTrack} role="group">
          <button
            type="button"
            className={`${segmentButton} ${transfer === 'export' ? segmentActive : ''}`}
            aria-expanded={transfer === 'export'}
            aria-pressed={transfer === 'export'}
            disabled={busy !== null && transfer !== 'export'}
            onClick={() => setTransfer('export')}
          >
            <DownloadIcon className={`h-3.5 w-3.5 shrink-0 ${transfer === 'export' ? 'text-index-ink' : 'text-index-faint'}`} />
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
            <UploadIcon className={`h-3.5 w-3.5 shrink-0 ${transfer === 'import' ? 'text-index-ink' : 'text-index-faint'}`} />
            {t('importToggle')}
          </button>
        </div>
        <div className="mt-2">
          {transfer === 'export' ? <ExportPanel /> : <ImportPanel />}
        </div>
      </StickyActionBar>
    </div>
  )
}
