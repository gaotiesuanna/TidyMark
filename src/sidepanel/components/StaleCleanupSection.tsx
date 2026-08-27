import { useMemo, useState } from 'react'
import { currentLocale, t } from '@/i18n'
import { toHtmlLang } from '@/core/locale'
import type { StaleBucket } from '@/core/stale'
import { useStore } from '../store'

type StaleFilter = 'all' | StaleBucket


const FILTERS: Array<{ value: StaleFilter; label: Parameters<typeof t>[0] }> = [
  { value: 'all', label: 'cleanupStaleFilterAll' },
  { value: 'threeToSixMonths', label: 'cleanupStaleFilterThreeToSix' },
  { value: 'sixToTwelveMonths', label: 'cleanupStaleFilterSixToTwelve' },
  { value: 'overOneYear', label: 'cleanupStaleFilterOverOneYear' },
  { value: 'unknown', label: 'cleanupStaleFilterUnknown' },
]

const BUCKET_LABELS: Record<StaleBucket, Parameters<typeof t>[0]> = {
  threeToSixMonths: 'cleanupStaleFilterThreeToSix',
  sixToTwelveMonths: 'cleanupStaleFilterSixToTwelve',
  overOneYear: 'cleanupStaleFilterOverOneYear',
  unknown: 'cleanupStaleFilterUnknown',
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(toHtmlLang(currentLocale()), { dateStyle: 'medium' }).format(timestamp)
}

export function StaleCleanupSection() {
  const {
    staleScan,
    staleState,
    staleError,
    checkedIds,
    cleanupChecked,
    cleanupStaleMove,
    busy,
    runStaleScan,
    toggleStaleDelete,
    toggleStaleMove,
  } = useStore()
  const [filter, setFilter] = useState<StaleFilter>('all')

  const visibleItems = useMemo(
    () => staleScan?.items.filter(({ bucket }) => filter === 'all' || bucket === filter) ?? [],
    [filter, staleScan],
  )

  return (
    <section className="space-y-2" aria-labelledby="cleanup-stale-heading">
      <h2 id="cleanup-stale-heading" className="text-xs font-medium text-neutral-700">
        {t('cleanupSectionStale')}
      </h2>

      {staleState === 'idle' && (
        <>
          <p className="text-[11px] leading-relaxed text-neutral-500">{t('cleanupStaleExplain')}</p>
          <button
            type="button"
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:border-neutral-400 disabled:opacity-40"
            disabled={busy !== null}
            onClick={() => void runStaleScan()}
          >
            {t('cleanupStaleAllow')}
          </button>
        </>
      )}

      {staleState === 'loading' && (
        <p className="text-[11px] leading-relaxed text-neutral-500">{t('cleanupStaleLoading')}</p>
      )}

      {staleState === 'denied' && (
        <p className="text-[11px] leading-relaxed text-neutral-500">{t('cleanupStaleDenied')}</p>
      )}

      {staleState === 'error' && (
        <div className="space-y-1">
          <p className="text-[11px] leading-relaxed text-red-600">{t('cleanupStaleError')}</p>
          {staleError !== null && <p className="break-all text-[11px] text-neutral-500">{staleError}</p>}
          <button
            type="button"
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:border-neutral-400 disabled:opacity-40"
            disabled={busy !== null}
            onClick={() => void runStaleScan()}
          >
            {t('cleanupStaleAllow')}
          </button>
        </div>
      )}

      {staleState === 'empty' && (
        <p className="text-[11px] leading-relaxed text-neutral-500">{t('cleanupStaleEmpty')}</p>
      )}

      {staleState === 'ready' && staleScan !== null && (
        <div className="space-y-3">
          <div className="space-y-1 text-[11px] text-neutral-500">
            <p>{t('cleanupStaleCurrentScope', String(checkedIds.size))}</p>
            <p>{t('cleanupStaleScannedAt', formatDate(staleScan.scannedAt))}</p>
            <p>
              {t('cleanupStaleCutoffs', formatDate(staleScan.cutoff3Months), formatDate(staleScan.cutoff6Months), formatDate(staleScan.cutoff12Months))}
            </p>
          </div>

          <div role="tablist" aria-label={t('cleanupStaleFilterListLabel')} className="flex flex-wrap gap-1">
            {FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                className={`rounded-md border px-2 py-1 text-[11px] ${filter === value ? 'border-neutral-700 bg-neutral-100 text-neutral-800' : 'border-neutral-200 text-neutral-500 hover:border-neutral-400'}`}
                onClick={() => setFilter(value)}
              >
                {t(label)}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]" aria-label={t('cleanupStaleTableLabel')}>
              <caption className="sr-only">{t('cleanupStaleTableLabel')}</caption>
              <thead className="text-neutral-500">
                <tr>
                  <th scope="col" className="pb-1 pr-2 font-medium">{t('cleanupStaleColumnBookmark')}</th>
                  <th scope="col" className="pb-1 pr-2 font-medium">{t('cleanupStaleColumnLastVisit')}</th>
                  <th scope="col" className="pb-1 pr-2 font-medium">{t('cleanupStaleColumnBucket')}</th>
                  <th scope="col" className="pb-1 font-medium">{t('cleanupStaleColumnActions')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map(({ item, bucket, lastVisitedAt }) => (
                  <tr key={item.id} className="border-t border-neutral-100 align-top">
                    <th scope="row" className="max-w-[16rem] py-2 pr-2 font-normal text-neutral-800">
                      <div>{item.title}</div>
                      <a
                        href={item.url}
                        title={item.url}
                        className="block break-all text-neutral-500 underline decoration-neutral-300 underline-offset-2"
                      >
                        {item.url}
                      </a>
                      <div className="break-all text-neutral-400">/{item.currentPath.join('/')}/</div>
                      {bucket === 'unknown' && (
                        <div className="mt-1 text-neutral-400">{t('cleanupStaleUnknownHint')}</div>
                      )}
                    </th>
                    <td className="whitespace-nowrap py-2 pr-2 text-neutral-500">
                      {lastVisitedAt === undefined ? t('cleanupStaleNeverVisited') : formatDate(lastVisitedAt)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-2 text-neutral-500">{t(BUCKET_LABELS[bucket])}</td>
                    <td className="py-2">
                      <div className="flex flex-col gap-1">
                        <label className="flex items-center gap-1 whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={cleanupChecked.has(item.id)}
                            aria-label={`${t('cleanupStaleActionDelete')} ${item.title}`}
                            onChange={() => toggleStaleDelete(item.id)}
                          />
                          {t('cleanupStaleActionDelete')}
                        </label>
                        <label className="flex items-center gap-1 whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={cleanupStaleMove.has(item.id)}
                            aria-label={`${t('cleanupStaleActionMove')} ${item.title}`}
                            onChange={() => toggleStaleMove(item.id)}
                          />
                          {t('cleanupStaleActionMove')}
                        </label>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibleItems.length === 0 && <p className="text-[11px] text-neutral-500">{t('cleanupStaleFilterEmpty')}</p>}
        </div>
      )}
    </section>
  )
}
