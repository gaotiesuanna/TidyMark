import { useMemo, useState } from 'react'
import { currentLocale, t } from '@/i18n'
import { toHtmlLang } from '@/core/locale'
import {
  groupStaleByFolder,
  matchesStaleFilter,
  type StaleBucket,
  type StaleFolderGroup,
} from '@/core/stale'
import { useStore } from '../store'
import { ChevronDownIcon, FolderIcon, TrashIcon } from './icons'

type StaleFilter = 'all' | StaleBucket


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

/**
 * 一堆同目录的闲置书签共用一个可展开的文件夹头，路径只写一次。
 * 折叠态只留文件夹名 + 条数 +（有勾选时）已选数；URL、日期、删除/移动都收进展开区。
 * 只有一个组时没有折叠的意义，直接摊开。
 */
function StaleFolderRow({
  group,
  open,
  onToggle,
}: {
  group: StaleFolderGroup
  open: boolean
  onToggle: () => void
}) {
  const { cleanupChecked, cleanupStaleMove, toggleStaleDelete, toggleStaleMove, setStaleDeleteMany } = useStore()
  const fullPath = `/${group.key}/`
  const leaf = group.path[group.path.length - 1] ?? fullPath
  const ids = group.items.map(({ item }) => item.id)
  const selectedCount = group.items.filter(
    ({ item }) => cleanupChecked.has(item.id) || cleanupStaleMove.has(item.id),
  ).length
  const allDeleting = ids.every((id) => cleanupChecked.has(id))

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
            String(group.items.length),
          )}
          onClick={onToggle}
        >
          <FolderIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          <span className="min-w-0 flex-1 truncate text-sm text-neutral-700" title={fullPath}>
            {leaf}
            {group.path.length > 1 && (
              <span className="ml-1 text-xs text-neutral-400">{fullPath}</span>
            )}
          </span>
          {selectedCount > 0 && (
            <span className="shrink-0 text-xs tabular-nums text-blue-600">
              {t('cleanupStaleGroupSelected', String(selectedCount))}
            </span>
          )}
          <span className="shrink-0 text-sm tabular-nums text-neutral-500">{group.items.length}</span>
          <ChevronDownIcon
            className={[
              'h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform duration-150 motion-reduce:transition-none',
              open ? 'rotate-180' : '',
            ].join(' ')}
          />
        </button>
        <button
          type="button"
          className={[
            'ml-0.5 mr-1 shrink-0 cursor-pointer rounded-md p-1.5',
            'transition-colors duration-150 motion-reduce:transition-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
            allDeleting
              ? 'bg-red-50 text-red-600 hover:bg-red-100'
              : 'text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700',
          ].join(' ')}
          aria-pressed={allDeleting}
          aria-label={t(
            allDeleting ? 'cleanupStaleGroupDeleteClear' : 'cleanupStaleGroupDeleteAll',
            fullPath,
          )}
          onClick={() => setStaleDeleteMany(ids, !allDeleting)}
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && (
        <ul className="ml-3 mt-1 space-y-3 border-l border-neutral-200 pl-3">
          {group.items.map(({ item, bucket, lastUsedAt }) => (
            <li key={item.id} className="min-w-0">
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
          ))}
        </ul>
      )}
    </li>
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
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    const visible = staleScan?.items.filter(({ bucket }) => matchesStaleFilter(bucket, filter)) ?? []
    return groupStaleByFolder(visible)
  }, [filter, staleScan])

  function toggleGroup(key: string): void {
    setOpenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <section className="space-y-2" aria-labelledby={showHeading ? 'cleanup-stale-heading' : undefined}>
      {showHeading && (
        <h2 id="cleanup-stale-heading" className="text-sm leading-caption font-medium text-neutral-700">
          {t('cleanupSectionStale')}
        </h2>
      )}

      {staleState === 'idle' && (
        <>
          <p className="text-xs leading-relaxed text-neutral-500">{t('cleanupStaleExplain')}</p>
          <button
            type="button"
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-sm leading-caption hover:border-neutral-400 disabled:opacity-40"
            disabled={busy !== null}
            onClick={() => void runStaleScan()}
          >
            {t('cleanupStaleAllow')}
          </button>
        </>
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

          {groups.length === 0 ? (
            <p className="text-xs text-neutral-500">{t('cleanupStaleFilterEmpty')}</p>
          ) : (
            <ul className="space-y-0.5" aria-label={t('cleanupStaleTableLabel')}>
              {groups.map((group) => (
                <StaleFolderRow
                  key={group.key}
                  group={group}
                  open={groups.length === 1 || openKeys.has(group.key)}
                  onToggle={() => toggleGroup(group.key)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
