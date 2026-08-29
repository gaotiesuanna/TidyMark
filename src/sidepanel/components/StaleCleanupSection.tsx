import { useEffect, useMemo, useState } from 'react'
import { currentLocale, t } from '@/i18n'
import { toHtmlLang } from '@/core/locale'
import {
  matchesStaleFilter,
  staleFolderTree,
  type StaleBucket,
  type StaleBookmark,
  type StaleFolderNode,
} from '@/core/stale'
import { useStore } from '../store'
import { ChevronDownIcon, FolderIcon } from './icons'

type StaleFilter = 'all' | StaleBucket

/** Folders shallower than this open on their own; deeper ones wait for a click. */
const FOLDER_AUTO_OPEN_DEPTH = 2

const FILTERS: Array<{ value: StaleFilter; label: Parameters<typeof t>[0] }> = [
  { value: 'all', label: 'cleanupStaleFilterAll' },
  { value: 'threeToSixMonths', label: 'cleanupStaleFilterThreeToSix' },
  { value: 'sixToTwelveMonths', label: 'cleanupStaleFilterSixToTwelve' },
  { value: 'oneToTwoYears', label: 'cleanupStaleFilterOverOneYear' },
  { value: 'overTwoYears', label: 'cleanupStaleFilterOverTwoYears' },
  { value: 'unknown', label: 'cleanupStaleFilterUnknown' },
]

const BUCKET_LABELS: Record<StaleBucket, Parameters<typeof t>[0]> = {
  threeToSixMonths: 'cleanupStaleFilterThreeToSix',
  sixToTwelveMonths: 'cleanupStaleFilterSixToTwelve',
  oneToTwoYears: 'cleanupStaleFilterOverOneYear',
  overTwoYears: 'cleanupStaleFilterOverTwoYears',
  unknown: 'cleanupStaleFilterUnknown',
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(toHtmlLang(currentLocale()), { dateStyle: 'medium' }).format(timestamp)
}

function staleFolderIds(node: StaleFolderNode): string[] {
  return [
    ...node.items.map(({ item }) => item.id),
    ...node.children.flatMap(staleFolderIds),
  ]
}

function StaleBookmarkRow({ entry }: { entry: StaleBookmark }) {
  const { cleanupChecked, cleanupStaleMove, toggleStaleDelete, toggleStaleMove } = useStore()
  const { item, bucket, lastUsedAt } = entry
  return (
    <li className="min-w-0">
      <div className="break-words text-sm leading-caption text-neutral-800">
        {item.title.trim() === '' ? item.url : item.title}
      </div>
      <a
        href={item.url}
        title={item.url}
        target="_blank"
        rel="noreferrer"
        className="block break-all text-xs leading-snug text-neutral-500 underline decoration-neutral-300 underline-offset-2"
      >
        {item.url}
      </a>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutral-400">
        <span>
          {lastUsedAt === undefined
            ? t('cleanupStaleNoLastUsed')
            : t('cleanupStaleLastVisit', formatDate(lastUsedAt))}
        </span>
        <span aria-hidden="true">·</span>
        <span>{t(BUCKET_LABELS[bucket])}</span>
      </div>
      {bucket === 'unknown' && (
        <div className="text-xs leading-snug text-neutral-400">{t('cleanupStaleUnknownHint')}</div>
      )}
      <div className="mt-1 flex gap-4">
        <label className="flex items-center gap-1 text-xs leading-caption text-neutral-600">
          <input
            type="checkbox"
            checked={cleanupChecked.has(item.id)}
            aria-label={`${t('cleanupStaleActionDelete')} ${item.title}`}
            onChange={() => toggleStaleDelete(item.id)}
          />
          {t('cleanupStaleActionDelete')}
        </label>
        <label className="flex items-center gap-1 text-xs leading-caption text-neutral-600">
          <input
            type="checkbox"
            checked={cleanupStaleMove.has(item.id)}
            aria-label={`${t('cleanupStaleActionMove')} ${item.title}`}
            onChange={() => toggleStaleMove(item.id)}
          />
          {t('cleanupStaleActionMove')}
        </label>
      </div>
    </li>
  )
}

/**
 * 看板域名树同一套：缩进 + 祖先单独成行。折叠态只留文件夹名和条数，
 * 完整路径不再跟在标题后面。URL、日期、删除/移动都收进展开区。
 */
function StaleFolderRow({ node, depth }: { node: StaleFolderNode; depth: number }) {
  const { cleanupChecked, cleanupStaleMove, setStaleDeleteMany } = useStore()
  const [open, setOpen] = useState(depth < FOLDER_AUTO_OPEN_DEPTH)
  const fullPath = `/${node.path.join('/')}/`
  const ids = staleFolderIds(node)
  const selectedCount = ids.filter((id) => cleanupChecked.has(id) || cleanupStaleMove.has(id)).length
  const someDeleting = ids.some((id) => cleanupChecked.has(id))
  const allDeleting = ids.length > 0 && ids.every((id) => cleanupChecked.has(id))

  return (
    <li>
      <div
        className={[
          '-mx-1.5 flex items-center rounded-md',
          'transition-colors duration-150 motion-reduce:transition-none hover:bg-neutral-50',
        ].join(' ')}
      >
        <button
          type="button"
          className={[
            'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-left',
            'active:bg-neutral-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
          ].join(' ')}
          aria-expanded={open}
          aria-label={t(
            open ? 'cleanupStaleGroupCollapse' : 'cleanupStaleGroupExpand',
            fullPath,
            String(node.count),
          )}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDownIcon
            className={[
              'h-3 w-3 shrink-0 text-neutral-400 transition-transform duration-150 motion-reduce:transition-none',
              open ? '' : '-rotate-90',
            ].join(' ')}
          />
          <FolderIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          <span className="min-w-0 flex-1 truncate text-sm text-neutral-700" title={fullPath}>
            {node.title}
          </span>
          {selectedCount > 0 && (
            <span className="shrink-0 text-xs tabular-nums text-blue-600">
              {t('cleanupStaleGroupSelected', String(selectedCount))}
            </span>
          )}
          <span className="shrink-0 text-sm tabular-nums text-neutral-500">{node.count}</span>
        </button>
        <label
          className={[
            'ml-0.5 mr-1 flex shrink-0 cursor-pointer items-center rounded-md p-1.5',
            'transition-colors duration-150 motion-reduce:transition-none',
            'hover:bg-neutral-100',
            'focus-within:outline-none focus-within:ring-2 focus-within:ring-neutral-400',
          ].join(' ')}
        >
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={allDeleting}
            aria-label={t('cleanupStaleGroupDeleteAll', fullPath)}
            ref={(el) => {
              if (el !== null) el.indeterminate = someDeleting && !allDeleting
            }}
            onChange={() => setStaleDeleteMany(ids, !allDeleting)}
          />
        </label>
      </div>

      {open && node.items.length > 0 && (
        <ul className="ml-3 mt-1 space-y-3 border-l border-neutral-200 pl-3">
          {node.items.map((entry) => (
            <StaleBookmarkRow key={entry.item.id} entry={entry} />
          ))}
        </ul>
      )}
      {open && node.children.length > 0 && (
        <StaleFolderTree nodes={node.children} depth={depth + 1} />
      )}
    </li>
  )
}

function StaleFolderTree({ nodes, depth }: { nodes: StaleFolderNode[]; depth: number }) {
  return (
    <ul
      aria-label={depth === 0 ? t('cleanupStaleTableLabel') : undefined}
      className={depth === 0 ? 'space-y-0.5' : 'mt-1 space-y-0.5 border-l border-neutral-200 pl-3'}
    >
      {nodes.map((node) => (
        <StaleFolderRow key={node.key} node={node} depth={depth} />
      ))}
    </ul>
  )
}

export function StaleCleanupSection({ showHeading = true }: { showHeading?: boolean } = {}) {
  const {
    staleScan,
    staleState,
    staleError,
    cleanupScan,
    busy,
    runStaleScan,
  } = useStore()
  const [filter, setFilter] = useState<StaleFilter>('all')

  useEffect(() => {
    if (staleState !== 'idle') return
    if ((cleanupScan?.scopeRootIds.length ?? 0) === 0) return
    void runStaleScan()
  }, [staleState, cleanupScan, runStaleScan])

  const tree = useMemo(() => {
    const visible = staleScan?.items.filter(({ bucket }) => matchesStaleFilter(bucket, filter)) ?? []
    return staleFolderTree(visible)
  }, [filter, staleScan])

  return (
    <section className="space-y-2" aria-labelledby={showHeading ? 'cleanup-stale-heading' : undefined}>
      {showHeading && (
        <h2 id="cleanup-stale-heading" className="text-sm leading-caption font-medium text-neutral-700">
          {t('cleanupSectionStale')}
        </h2>
      )}

      {(staleState === 'idle' || staleState === 'loading') && (
        <p className="text-xs leading-relaxed text-neutral-500">{t('cleanupStaleExplain')}</p>
      )}

      {staleState === 'loading' && (
        <p className="text-xs leading-relaxed text-neutral-500">{t('cleanupStaleLoading')}</p>
      )}

      {staleState === 'error' && (
        <div className="space-y-1">
          <p className="text-xs leading-relaxed text-red-600">{t('cleanupStaleError')}</p>
          {staleError !== null && <p className="break-all text-xs text-neutral-500">{staleError}</p>}
          <button
            type="button"
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-sm leading-caption hover:border-neutral-400 disabled:opacity-40"
            disabled={busy !== null}
            onClick={() => void runStaleScan()}
          >
            {t('cleanupStaleAllow')}
          </button>
        </div>
      )}

      {staleState === 'empty' && (
        <p className="text-xs leading-relaxed text-neutral-500">{t('cleanupStaleEmpty')}</p>
      )}

      {staleState === 'ready' && staleScan !== null && (
        <div className="space-y-3">
          <div className="space-y-1 text-xs text-neutral-500">
            <p>{t('cleanupStaleCurrentScope', String(cleanupScan?.scopeRootIds.length ?? 0))}</p>
            <p>{t('cleanupStaleScannedAt', formatDate(staleScan.scannedAt))}</p>
            <p>
              {t(
                'cleanupStaleCutoffs',
                formatDate(staleScan.cutoff3Months),
                formatDate(staleScan.cutoff6Months),
                formatDate(staleScan.cutoff12Months),
                formatDate(staleScan.cutoff24Months),
              )}
            </p>
          </div>

          <div role="tablist" aria-label={t('cleanupStaleFilterListLabel')} className="flex flex-wrap gap-1">
            {FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                className={`rounded-md border px-2 py-1 text-xs ${filter === value ? 'border-neutral-700 bg-neutral-100 text-neutral-800' : 'border-neutral-200 text-neutral-500 hover:border-neutral-400'}`}
                onClick={() => setFilter(value)}
              >
                {t(label)}
              </button>
            ))}
          </div>

          {tree.length === 0 ? (
            <p className="text-xs text-neutral-500">{t('cleanupStaleFilterEmpty')}</p>
          ) : (
            <StaleFolderTree nodes={tree} depth={0} />
          )}
        </div>
      )}
    </section>
  )
}
