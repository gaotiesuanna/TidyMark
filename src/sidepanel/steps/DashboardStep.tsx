import { useMemo, useState } from 'react'
import { t } from '@/i18n'
import {
  bookmarkUrls,
  clampTopDomainCount,
  folderDistribution,
  rankDomains,
  TOP_DOMAIN_MAX,
  TOP_DOMAIN_MIN,
  type DomainRank,
  type WeightedUrl,
} from '@/core/domains'
import type { BookmarkNode } from '@/core/ports'
import { faviconSrc } from '../lib/favicons'
import { ensureHistoryPermission, hasHistoryPermission, visitUrls } from '../lib/visits'
import { TrendingUpIcon } from '../components/icons'
import { useStore } from '../store'

type Metric = 'bookmarked' | 'visited'

type VisitState =
  | { kind: 'idle' }
  | { kind: 'need' }
  | { kind: 'loading' }
  | { kind: 'ready'; items: WeightedUrl[] }
  | { kind: 'empty' }
  | { kind: 'denied' }

const toggleTrack = 'flex shrink-0 rounded-full bg-neutral-100 p-0.5'
const toggleBase = [
  'inline-flex h-7 cursor-pointer items-center justify-center rounded-full px-3',
  'text-xs font-medium',
  'transition-colors duration-150 motion-reduce:transition-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
].join(' ')
const toggleOn = `${toggleBase} bg-white text-blue-600 shadow-sm`
const toggleOff = `${toggleBase} text-neutral-500 hover:text-neutral-800`

export function DashboardStep() {
  const tree = useStore((s) => s.tree)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const topN = clampTopDomainCount(settings.topDomainCount)
  const [metric, setMetric] = useState<Metric>('bookmarked')
  const [visits, setVisits] = useState<VisitState>({ kind: 'idle' })
  const [draft, setDraft] = useState<string | null>(null)

  const bookmarked = useMemo(
    () => rankDomains(bookmarkUrls(tree), topN),
    [tree, topN],
  )

  async function selectVisited() {
    setMetric('visited')
    if (visits.kind === 'ready' || visits.kind === 'empty' || visits.kind === 'loading') return
    if (visits.kind === 'denied' || visits.kind === 'need') return
    setVisits({ kind: 'loading' })
    if (!await hasHistoryPermission()) {
      setVisits({ kind: 'need' })
      return
    }
    const items = await visitUrls()
    setVisits(items.length === 0 ? { kind: 'empty' } : { kind: 'ready', items })
  }

  async function allowHistory() {
    if (!await ensureHistoryPermission()) {
      setVisits({ kind: 'denied' })
      return
    }
    await loadVisits()
  }

  async function loadVisits() {
    setVisits({ kind: 'loading' })
    const items = await visitUrls()
    setVisits(items.length === 0 ? { kind: 'empty' } : { kind: 'ready', items })
  }

  function commitTopN(raw: string) {
    setDraft(null)
    const next = clampTopDomainCount(Number(raw))
    if (next === topN) return
    void setSettings({ ...settings, topDomainCount: next })
  }

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
            <TrendingUpIcon className="h-4 w-4 text-blue-500" />
            <label className="flex min-w-0 items-center gap-1">
              <span>{t('dashTopDomainsLead')}</span>
              <input
                type="number"
                min={TOP_DOMAIN_MIN}
                max={TOP_DOMAIN_MAX}
                inputMode="numeric"
                aria-label={t('dashTopCountLabel')}
                value={draft ?? String(topN)}
                className="h-6 w-11 rounded-md border border-neutral-200 bg-white px-1 text-center text-sm font-semibold tabular-nums text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={(e) => commitTopN(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
              />
            </label>
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">{t('dashTopDomainsSub')}</p>
        </div>
        <div className={toggleTrack} role="tablist" aria-label={t('dashTopDomains', String(topN))}>
          <button
            type="button"
            role="tab"
            aria-selected={metric === 'bookmarked'}
            className={metric === 'bookmarked' ? toggleOn : toggleOff}
            onClick={() => setMetric('bookmarked')}
          >
            {t('dashBookmarked')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={metric === 'visited'}
            className={metric === 'visited' ? toggleOn : toggleOff}
            onClick={() => void selectVisited()}
          >
            {t('dashVisited')}
          </button>
        </div>
      </header>
      {metric === 'bookmarked' ? (
        bookmarked.length === 0
          ? <p className="text-xs text-neutral-500">{t('dashEmptyBookmarks')}</p>
          : <DomainList key={String(topN)} rows={bookmarked} tree={tree} />
      ) : (
        <VisitedBody state={visits} topN={topN} onAllow={() => void allowHistory()} />
      )}
    </section>
  )
}

function VisitedBody({
  state,
  topN,
  onAllow,
}: {
  state: VisitState
  topN: number
  onAllow: () => void
}) {
  if (state.kind === 'need') {
    return (
      <div className="space-y-3">
        <p className="text-[11px] leading-relaxed text-neutral-500">{t('dashHistoryExplain')}</p>
        <button
          type="button"
          className="inline-flex h-8 cursor-pointer items-center rounded-md bg-neutral-800 px-3 text-xs font-medium text-white transition-colors duration-150 hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 motion-reduce:transition-none"
          onClick={onAllow}
        >
          {t('dashHistoryAllow')}
        </button>
      </div>
    )
  }
  if (state.kind === 'denied') {
    return <p className="text-[11px] leading-relaxed text-neutral-500">{t('dashHistoryDenied')}</p>
  }
  if (state.kind === 'loading' || state.kind === 'idle') {
    return <p className="text-xs text-neutral-500">{t('dashHistoryLoading')}</p>
  }
  if (state.kind === 'empty') {
    return <p className="text-xs text-neutral-500">{t('dashEmptyVisits')}</p>
  }
  return <DomainList rows={rankDomains(state.items, topN)} />
}

function DomainList({ rows, tree }: { rows: DomainRank[]; tree?: BookmarkNode[] }) {
  const [openDomain, setOpenDomain] = useState<string | null>(null)
  const max = rows[0]?.count ?? 0
  return (
    <ol className="space-y-3" aria-label={t('dashListLabel')}>
      {rows.map((row) => (
        <DomainRow
          key={row.domain}
          row={row}
          max={max}
          tree={tree}
          open={openDomain === row.domain}
          onToggle={() => setOpenDomain((prev) => prev === row.domain ? null : row.domain)}
        />
      ))}
    </ol>
  )
}

function DomainRow({
  row,
  max,
  tree,
  open,
  onToggle,
}: {
  row: DomainRank
  max: number
  tree?: BookmarkNode[]
  open: boolean
  onToggle: () => void
}) {
  const pct = max === 0 ? 0 : (row.count / max) * 100
  const expandable = tree !== undefined
  const shares = open && tree !== undefined ? folderDistribution(tree, row.domain) : []
  const shareMax = shares[0]?.count ?? 0
  const summary = (
    <>
      <DomainIcon domain={row.domain} pageUrl={row.sampleUrl} />
      <span className="w-[38%] min-w-0 truncate text-[13px] text-neutral-700" title={row.domain}>
        {row.domain}
      </span>
      <div className="h-2 min-w-0 flex-1 rounded-full bg-neutral-100">
        <div
          className="h-2 rounded-full bg-blue-500"
          style={{ width: `${pct}%`, minWidth: row.count > 0 ? 6 : 0 }}
        />
      </div>
      <span className="min-w-8 shrink-0 text-right text-[13px] tabular-nums text-neutral-800">
        {row.count}
      </span>
    </>
  )
  return (
    <li>
      {expandable ? (
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          aria-expanded={open}
          aria-label={t(open ? 'dashDomainCollapse' : 'dashDomainExpand', row.domain)}
          onClick={onToggle}
        >
          {summary}
        </button>
      ) : (
        <div className="flex items-center gap-2.5">{summary}</div>
      )}
      {open && (
        <ol className="mt-2 space-y-2 pl-7">
          {shares.map((share) => {
            const sharePct = shareMax === 0 ? 0 : (share.count / shareMax) * 100
            const label = share.path.join(' / ')
            return (
              <li key={share.folderId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-500" title={label}>
                  {label}
                </span>
                <div className="h-1.5 w-16 shrink-0 rounded-full bg-neutral-100">
                  <div
                    className="h-1.5 rounded-full bg-blue-400"
                    style={{ width: `${sharePct}%`, minWidth: share.count > 0 ? 4 : 0 }}
                  />
                </div>
                <span className="min-w-6 shrink-0 text-right text-[12px] tabular-nums text-neutral-600">
                  {share.count}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </li>
  )
}

function DomainIcon({ domain, pageUrl }: { domain: string; pageUrl: string }) {
  const [broken, setBroken] = useState(false)
  if (broken) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-neutral-100 text-[10px] font-medium text-neutral-500"
      >
        {domain.charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={faviconSrc(pageUrl)}
      alt=""
      width={20}
      height={20}
      className="h-5 w-5 shrink-0 rounded"
      onError={() => setBroken(true)}
    />
  )
}
