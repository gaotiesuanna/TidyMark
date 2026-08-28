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
import { sanitizeUrl } from '@/core/sanitize'
import { faviconSrc } from '../lib/favicons'
import { ensureHistoryPermission, hasHistoryPermission, visitUrls } from '../lib/visits'
import { ChevronDownIcon, FolderIcon, LinkIcon, TrendingUpIcon } from '../components/icons'
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
  'text-sm leading-caption font-medium',
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
          <h2 className="flex items-center gap-1.5 text-base leading-body font-semibold text-neutral-900">
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
                className="h-6 w-11 rounded-md border border-neutral-200 bg-white px-1 text-center text-base leading-body font-semibold tabular-nums text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={(e) => commitTopN(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
              />
            </label>
          </h2>
          <p className="mt-0.5 text-sm leading-caption text-neutral-500">{t('dashTopDomainsSub')}</p>
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
          ? <p className="text-sm leading-caption text-neutral-500">{t('dashEmptyBookmarks')}</p>
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
        <p className="text-xs leading-relaxed text-neutral-500">{t('dashHistoryExplain')}</p>
        <button
          type="button"
          className="inline-flex h-8 cursor-pointer items-center rounded-md bg-neutral-800 px-3 text-sm leading-caption font-medium text-white transition-colors duration-150 hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 motion-reduce:transition-none"
          onClick={onAllow}
        >
          {t('dashHistoryAllow')}
        </button>
      </div>
    )
  }
  if (state.kind === 'denied') {
    return <p className="text-xs leading-relaxed text-neutral-500">{t('dashHistoryDenied')}</p>
  }
  if (state.kind === 'loading' || state.kind === 'idle') {
    return <p className="text-sm leading-caption text-neutral-500">{t('dashHistoryLoading')}</p>
  }
  if (state.kind === 'empty') {
    return <p className="text-sm leading-caption text-neutral-500">{t('dashEmptyVisits')}</p>
  }
  return <DomainList rows={rankDomains(state.items, topN)} visits={state.items} />
}

function DomainList({
  rows,
  tree,
  visits,
}: {
  rows: DomainRank[]
  tree?: BookmarkNode[]
  visits?: WeightedUrl[]
}) {
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
          visits={visits}
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
  visits,
  open,
  onToggle,
}: {
  row: DomainRank
  max: number
  tree?: BookmarkNode[]
  visits?: WeightedUrl[]
  open: boolean
  onToggle: () => void
}) {
  const pct = max === 0 ? 0 : (row.count / max) * 100
  const expandable = tree !== undefined || visits !== undefined
  const shares = open && tree !== undefined ? folderDistribution(tree, row.domain) : []
  const visitedPages = open && visits !== undefined
    ? visits
      .filter((item) => {
        const parsed = sanitizeUrl(item.url)
        return parsed?.domain === row.domain && (item.weight ?? 1) > 0
      })
      .sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1) || a.url.localeCompare(b.url))
    : []
  const summary = (
    <>
      <DomainIcon domain={row.domain} pageUrl={row.sampleUrl} />
      <span className="w-[38%] min-w-0 truncate text-md text-neutral-700" title={row.domain}>
        {row.domain}
      </span>
      <div className="h-2 min-w-0 flex-1 rounded-full bg-neutral-100">
        <div
          className="h-2 rounded-full bg-blue-500"
          style={{ width: `${pct}%`, minWidth: row.count > 0 ? 6 : 0 }}
        />
      </div>
      <span className="min-w-8 shrink-0 text-right text-md tabular-nums text-neutral-800">
        {row.count}
      </span>
    </>
  )
  return (
    <li>
      {expandable ? (
        <button
          type="button"
          className={[
            'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 -mx-1 text-left',
            'transition-colors duration-150 motion-reduce:transition-none',
            'hover:bg-neutral-50 active:bg-neutral-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
          ].join(' ')}
          aria-expanded={open}
          aria-label={tree !== undefined
            ? t(open ? 'dashDomainCollapse' : 'dashDomainExpand', row.domain)
            : t(open ? 'dashVisitDomainCollapse' : 'dashVisitDomainExpand', row.domain)}
          onClick={onToggle}
        >
          {summary}
          <ChevronDownIcon
            className={[
              'h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform duration-150 motion-reduce:transition-none',
              open ? 'rotate-180' : '',
            ].join(' ')}
          />
        </button>
      ) : (
        <div className="flex items-center gap-2.5">{summary}</div>
      )}
      {open && tree !== undefined && (
        <ol className="mt-3 space-y-3 pl-7">
          {shares.map((share) => {
            const label = share.path.join(' / ') || t('dashRootFolder')
            return (
              <li key={share.folderId} className="border-l-2 border-neutral-100 pl-3">
                <div className="flex items-start gap-2">
                  <FolderIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium leading-caption text-neutral-700">
                      {label}
                    </p>
                    <p className="mt-0.5 text-xs leading-caption text-neutral-400">
                      {t('dashFolderBookmarkCount', String(share.count))}
                    </p>
                  </div>
                </div>
                <ul className="mt-2 space-y-2 pl-5">
                  {share.bookmarks.map((bookmark) => {
                    const address = shortAddress(bookmark.url)
                    return (
                      <li key={bookmark.id} className="flex min-w-0 items-start gap-2">
                        <LinkIcon className="mt-0.5 h-3 w-3 shrink-0 text-neutral-300" />
                        <a
                          href={bookmark.url}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                        >
                          <span className="block break-words text-sm leading-caption text-neutral-700">
                            {bookmark.title.trim() || address}
                          </span>
                          <span className="mt-0.5 block break-all text-xs leading-caption text-neutral-400">
                            {address}
                          </span>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ol>
      )}
      {open && visits !== undefined && (
        <ol className="mt-3 space-y-2 pl-7">
          {visitedPages.map((page) => {
            const address = shortAddress(page.url)
            return (
              <li key={page.url} className="flex min-w-0 items-start gap-2 border-l-2 border-neutral-100 pl-3">
                <LinkIcon className="mt-0.5 h-3 w-3 shrink-0 text-neutral-300" />
                <a
                  href={page.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                >
                  <span className="block break-words text-sm leading-caption text-neutral-700">
                    {page.title?.trim() || address}
                  </span>
                  <span className="mt-0.5 block break-all text-xs leading-caption text-neutral-400">
                    {address}
                  </span>
                </a>
                <span className="shrink-0 text-xs leading-caption tabular-nums text-neutral-500">
                  {t('dashVisitCount', String(page.weight ?? 1))}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </li>
  )
}

function shortAddress(raw: string): string {
  const parsed = sanitizeUrl(raw)
  return parsed === null ? raw : `${parsed.domain}${parsed.path === '/' ? '' : parsed.path}`
}

function DomainIcon({ domain, pageUrl }: { domain: string; pageUrl: string }) {
  const [broken, setBroken] = useState(false)
  if (broken) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-neutral-100 text-2xs font-medium text-neutral-500"
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
