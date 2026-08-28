import { useEffect, useMemo, useState } from 'react'
import { t } from '@/i18n'
import {
  bookmarkUrls,
  clampTopDomainCount,
  domainFolderTree,
  rankDomains,
  TOP_DOMAIN_MAX,
  TOP_DOMAIN_MIN,
  type DomainFolderNode,
  type DomainRank,
  type WeightedUrl,
} from '@/core/domains'
import type { BookmarkNode } from '@/core/ports'
import { faviconSrc } from '../lib/favicons'
import { ensureHistoryPermission, hasHistoryPermission, visitUrls } from '../lib/visits'
import { ChevronDownIcon, FolderIcon, TrendingUpIcon } from '../components/icons'
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

const countInput = [
  'h-6 w-11 rounded-md border border-transparent bg-neutral-100 px-1 text-center',
  'text-base leading-body font-semibold tabular-nums text-neutral-900',
  'transition-colors duration-150 hover:bg-neutral-200 motion-reduce:transition-none',
  'focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
].join(' ')

/** Animates the bars from zero on first paint (and on every remount). */
function useGrow() {
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return grown
}

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
    <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
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
                className={countInput}
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
          ? <EmptyLine text={t('dashEmptyBookmarks')} />
          : <DomainList key={String(topN)} rows={bookmarked} tree={tree} />
      ) : (
        <VisitedBody state={visits} topN={topN} onAllow={() => void allowHistory()} />
      )}
    </section>
  )
}

function EmptyLine({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-1.5 text-sm leading-caption text-neutral-500">
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-300" />
      {text}
    </p>
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
    return <EmptyLine text={t('dashHistoryLoading')} />
  }
  if (state.kind === 'empty') {
    return <EmptyLine text={t('dashEmptyVisits')} />
  }
  return <DomainList rows={rankDomains(state.items, topN)} />
}

function DomainList({ rows, tree }: { rows: DomainRank[]; tree?: BookmarkNode[] }) {
  const [openDomain, setOpenDomain] = useState<string | null>(null)
  const grown = useGrow()
  const max = rows[0]?.count ?? 0
  return (
    <ol className="space-y-0.5" aria-label={t('dashListLabel')}>
      {rows.map((row, i) => (
        <DomainRow
          key={row.domain}
          row={row}
          rank={i + 1}
          max={max}
          grown={grown}
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
  rank,
  max,
  grown,
  tree,
  open,
  onToggle,
}: {
  row: DomainRank
  rank: number
  max: number
  grown: boolean
  tree?: BookmarkNode[]
  open: boolean
  onToggle: () => void
}) {
  const pct = max === 0 ? 0 : (row.count / max) * 100
  const expandable = tree !== undefined
  const folders = open && tree !== undefined ? domainFolderTree(tree, row.domain) : []
  const leader = rank === 1
  const summary = (
    <>
      <span
        aria-hidden="true"
        className={[
          'w-5 shrink-0 text-right text-2xs leading-none tabular-nums',
          rank <= 3 ? 'font-semibold text-neutral-500' : 'text-neutral-400',
        ].join(' ')}
      >
        {String(rank).padStart(2, '0')}
      </span>
      <DomainIcon domain={row.domain} pageUrl={row.sampleUrl} />
      <span className="w-[34%] min-w-0 truncate text-md text-neutral-700" title={row.domain}>
        {row.domain}
      </span>
      <div className="h-2 min-w-0 flex-1 rounded-full bg-neutral-100">
        <div
          className={[
            'h-2 rounded-full bg-gradient-to-r transition-[width] duration-500 ease-out motion-reduce:transition-none',
            leader ? 'from-blue-500 to-blue-600' : 'from-blue-400 to-blue-500',
          ].join(' ')}
          style={{ width: `${grown ? pct : 0}%`, minWidth: grown && row.count > 0 ? 6 : 0 }}
        />
      </div>
      <span className="min-w-8 shrink-0 text-right text-md font-semibold tabular-nums text-neutral-900">
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
            'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 -mx-1.5 text-left',
            'transition-colors duration-150 motion-reduce:transition-none',
            'hover:bg-neutral-50 active:bg-neutral-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
          ].join(' ')}
          aria-expanded={open}
          aria-label={t(open ? 'dashDomainCollapse' : 'dashDomainExpand', row.domain)}
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
        <div className="-mx-1.5 flex items-center gap-2.5 px-1.5 py-1.5">{summary}</div>
      )}
      {open && tree !== undefined && (
        <FolderTree nodes={folders} total={row.count} domain={row.domain} depth={0} />
      )}
    </li>
  )
}

function FolderTree({
  nodes,
  total,
  domain,
  depth,
}: {
  nodes: DomainFolderNode[]
  total: number
  domain: string
  depth: number
}) {
  const grown = useGrow()
  return (
    <ol
      aria-label={depth === 0 ? t('dashDomainTreeLabel', domain) : undefined}
      className={[
        'space-y-1.5 border-l border-neutral-200 pl-3',
        depth === 0 ? 'mt-2 ml-3' : 'mt-1.5',
      ].join(' ')}
    >
      {nodes.map((node) => {
        const pct = total === 0 ? 0 : (node.count / total) * 100
        const mixed = node.directCount > 0 && node.children.length > 0
        return (
          <li key={node.id}>
            <div className="flex items-center gap-2">
              <FolderIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-500" title={node.title}>
                {node.title}
              </span>
              <div className="h-1.5 w-16 shrink-0 rounded-full bg-neutral-100">
                <div
                  className="h-1.5 rounded-full bg-gradient-to-r from-blue-300 to-blue-400 transition-[width] duration-500 ease-out motion-reduce:transition-none"
                  style={{ width: `${grown ? pct : 0}%`, minWidth: grown && node.count > 0 ? 4 : 0 }}
                />
              </div>
              <span className="min-w-12 shrink-0 text-right text-sm tabular-nums text-neutral-600">
                {mixed && <span className="mr-0.5 text-neutral-400">·{node.directCount}</span>}
                {node.count}
              </span>
            </div>
            {node.children.length > 0 && (
              <FolderTree nodes={node.children} total={total} domain={domain} depth={depth + 1} />
            )}
          </li>
        )
      })}
    </ol>
  )
}

function DomainIcon({ domain, pageUrl }: { domain: string; pageUrl: string }) {
  const [broken, setBroken] = useState(false)
  if (broken) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white text-2xs font-medium text-neutral-500 ring-1 ring-neutral-200/70"
      >
        {domain.charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-neutral-200/70">
      <img
        src={faviconSrc(pageUrl)}
        alt=""
        width={16}
        height={16}
        className="h-4 w-4 rounded-sm"
        onError={() => setBroken(true)}
      />
    </span>
  )
}
