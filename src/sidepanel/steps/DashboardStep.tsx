import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { t } from '@/i18n'
import {
  bookmarkUrls,
  clampTopDomainCount,
  domainFolderTree,
  visitSplitTree,
  rankDomains,
  TOP_DOMAIN_MAX,
  TOP_DOMAIN_MIN,
  type DomainFolderNode,
  type DomainRank,
  type SavedVisit,
  type WeightedUrl,
} from '@/core/domains'
import type { BookmarkNode } from '@/core/ports'
import { sanitizeUrl } from '@/core/sanitize'
import { faviconSrc } from '../lib/favicons'
import { ensureHistoryPermission, hasHistoryPermission, visitUrls } from '../lib/visits'
import { BookmarkIcon, ChevronDownIcon, FolderIcon, LinkIcon, TrendingUpIcon } from '../components/icons'
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

/** 域名活跃度那排小圆点的格数。 */
const METER_SEGMENTS = 7

/** Flips false→true one frame after mount, driving CSS enter transitions. */
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
        <VisitedBody
          state={visits}
          topN={topN}
          tree={tree}
          onAllow={() => void allowHistory()}
        />
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
  tree,
  onAllow,
}: {
  state: VisitState
  topN: number
  tree: BookmarkNode[]
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
    return <VisitsSkeleton />
  }
  if (state.kind === 'empty') {
    return <EmptyLine text={t('dashEmptyVisits')} />
  }
  return <DomainList rows={rankDomains(state.items, topN)} tree={tree} visits={state.items} />
}

function VisitsSkeleton() {
  return (
    <div role="status" aria-label={t('dashHistoryLoading')}>
      <ol className="space-y-0.5 animate-pulse motion-reduce:animate-none" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="-mx-1.5 flex items-center gap-2.5 px-1.5 py-1.5">
            <span className="h-2.5 w-5 shrink-0 rounded-sm bg-neutral-100" />
            <span className="h-5 w-5 shrink-0 rounded-md bg-neutral-100" />
            <span className="h-3 min-w-0 flex-1 rounded-sm bg-neutral-100" />
            <span className="flex shrink-0 items-center gap-[3px]">
              {Array.from({ length: METER_SEGMENTS }, (_, j) => (
                <span key={j} className="h-1.5 w-1.5 rounded-full bg-neutral-100" />
              ))}
            </span>
            <span className="h-3 w-8 shrink-0 rounded-sm bg-neutral-100" />
          </li>
        ))}
      </ol>
    </div>
  )
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
  rank,
  max,
  grown,
  tree,
  visits,
  open,
  onToggle,
}: {
  row: DomainRank
  rank: number
  max: number
  grown: boolean
  tree?: BookmarkNode[]
  visits?: WeightedUrl[]
  open: boolean
  onToggle: () => void
}) {
  const filled = row.count > 0 && max > 0
    ? Math.max(1, Math.round(Math.sqrt(row.count / max) * METER_SEGMENTS))
    : 0
  const expandable = tree !== undefined || visits !== undefined
  const folders = open && visits === undefined && tree !== undefined
    ? domainFolderTree(tree, row.domain)
    : []
  const summary = (
    <>
      <span
        aria-hidden="true"
        className={[
          'w-5 shrink-0 text-right text-2xs leading-none tabular-nums',
          rank <= 3 ? 'font-semibold text-neutral-700' : 'text-neutral-500',
        ].join(' ')}
      >
        {String(rank).padStart(2, '0')}
      </span>
      <DomainIcon domain={row.domain} pageUrl={row.sampleUrl} />
      <span className="min-w-0 flex-1 truncate text-md text-neutral-700" title={row.domain}>
        {row.domain}
      </span>
      <span className="flex shrink-0 items-center gap-[3px]" aria-hidden="true">
        {Array.from({ length: METER_SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={[
              'h-1.5 w-1.5 rounded-full transition-colors duration-300 motion-reduce:transition-none',
              grown && i < filled ? 'bg-blue-500' : 'bg-neutral-200',
            ].join(' ')}
            style={{ transitionDelay: grown ? `${i * 40}ms` : '0ms' }}
          />
        ))}
      </span>
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
          aria-label={visits === undefined
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
        <div className="-mx-1.5 flex items-center gap-2.5 px-1.5 py-1.5">{summary}</div>
      )}
      {open && visits !== undefined && (
        <VisitBreakdown pages={visits} tree={tree ?? []} domain={row.domain} />
      )}
      {open && folders.length > 0 && (
        <FolderTree
          nodes={folders}
          domain={row.domain}
          depth={0}
          label={t('dashDomainTreeLabel', row.domain)}
        />
      )}
    </li>
  )
}

/**
 * 「访问」栏展开后的两段式内容：先是已经收进书签的页面（带文件夹路径），
 * 再是没收藏的页面（按 URL 路径搭树）。
 *
 * 两段无论空不空都摆出来。空的那半自己就是答案——「这个域名我天天开、一条都没存」
 * 正是这张卡片最该说出口的话；把它藏起来，界面看着就跟没分段一样。
 */
function VisitBreakdown({
  pages,
  tree,
  domain,
}: {
  pages: WeightedUrl[]
  tree: BookmarkNode[]
  domain: string
}) {
  const split = useMemo(() => visitSplitTree(pages, tree, domain), [pages, tree, domain])
  const shown = useGrow()
  const savedVisits = split.saved.reduce((n, page) => n + page.weight, 0)
  const unsavedVisits = split.unsaved.reduce((n, node) => n + node.count, 0)
  return (
    <div
      className={[
        'mt-2 ml-3 space-y-3',
        'transition duration-200 ease-out motion-reduce:transition-none',
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1',
      ].join(' ')}
    >
      <VisitSection
        label={t('dashVisitSavedLabel', domain)}
        icon={<BookmarkIcon className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
        title={t('dashVisitSaved')}
        note={t('dashVisitCount', String(savedVisits))}
        emptyText={split.saved.length === 0 ? t('dashVisitNoneSaved') : undefined}
      >
        <ul className="mt-1 space-y-1.5 border-l border-neutral-200 pl-3">
          {split.saved.map((page) => <SavedVisitRow key={page.id} page={page} />)}
        </ul>
      </VisitSection>
      <VisitSection
        label={t('dashVisitUnsavedLabel', domain)}
        icon={<FolderIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />}
        title={t('dashVisitUnsaved')}
        note={t('dashVisitCount', String(unsavedVisits))}
        emptyText={split.unsaved.length === 0 ? t('dashVisitNoneUnsaved') : undefined}
      >
        <FolderTree nodes={split.unsaved} domain={domain} depth={0} margin="mt-1" />
      </VisitSection>
    </div>
  )
}

/**
 * 「已收藏」「未收藏」各自一段，标题那一行就是收起/展开的按钮。
 *
 * 未收藏那半在开发机上动辄几十行路径树，一路顶出卡片，得能一键折上。
 * 空的那段没东西可折，标题退回不可点的一行——摆个按不动的按钮只会骗手。
 */
function VisitSection({
  label,
  icon,
  title,
  note,
  emptyText,
  children,
}: {
  label: string
  icon: ReactNode
  title: string
  /** 该段的访问次数。空段不显示——「访问 0 次」不如让空状态自己说话。 */
  note: string
  /** 给了就表示这段是空的：标题不可点，正文换成这句话。 */
  emptyText?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  const empty = emptyText !== undefined
  const head = (
    <>
      {empty ? (
        <span aria-hidden="true" className="h-3 w-3 shrink-0" />
      ) : (
        <ChevronDownIcon
          className={[
            'h-3 w-3 shrink-0 text-neutral-400 transition-transform duration-150 motion-reduce:transition-none',
            open ? '' : '-rotate-90',
          ].join(' ')}
        />
      )}
      {icon}
      <span className="text-sm leading-caption font-semibold text-neutral-700">{title}</span>
      {!empty && (
        <span className="text-xs leading-caption tabular-nums text-neutral-400">{note}</span>
      )}
    </>
  )
  return (
    <section aria-label={label}>
      {empty ? (
        <div className="flex items-center gap-1.5">{head}</div>
      ) : (
        <button
          type="button"
          className={[
            '-mx-1.5 flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left',
            'transition-colors duration-150 motion-reduce:transition-none',
            'hover:bg-neutral-50 active:bg-neutral-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
          ].join(' ')}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {head}
        </button>
      )}
      {empty ? (
        <p className="mt-1 pl-4 text-xs leading-caption text-neutral-400">{emptyText}</p>
      ) : (
        open && children
      )}
    </section>
  )
}

/** 已收藏那半的一行：页面本身 + 它躺在哪个书签文件夹里。 */
function SavedVisitRow({ page }: { page: SavedVisit }) {
  const address = shortAddress(page.url)
  const folder = page.folderPath.length === 0
    ? t('dashRootFolder')
    : page.folderPath.join(' / ')
  return (
    <li className="min-w-0">
      <div className="flex min-w-0 items-start gap-2">
        <LinkIcon className="mt-0.5 h-3 w-3 shrink-0 text-neutral-300" />
        <a
          href={page.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
        >
          <span className="block break-words text-sm leading-caption text-neutral-700">
            {page.title.trim() || address}
          </span>
          <span className="mt-0.5 block break-all text-xs leading-caption text-neutral-400">
            {address}
          </span>
        </a>
        <span className="shrink-0 text-xs leading-caption tabular-nums text-neutral-500">
          {t('dashVisitCount', String(page.weight))}
        </span>
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1 pl-5">
        <FolderIcon className="h-3 w-3 shrink-0 text-neutral-300" />
        <span className="min-w-0 truncate text-xs leading-caption text-neutral-400" title={folder}>
          {folder}
        </span>
      </div>
    </li>
  )
}

/** Folders shallower than this open on their own; deeper ones wait for a click. */
const FOLDER_AUTO_OPEN_DEPTH = 2

function FolderTree({
  nodes,
  domain,
  depth,
  label,
  margin = depth === 0 ? 'mt-2 ml-3' : 'mt-1',
}: {
  nodes: DomainFolderNode[]
  domain: string
  depth: number
  /** 读屏抬头。只有自己单独成块的最外层给，分区标题下的树不用重复。 */
  label?: string
  /** 最外层的外边距。分区里的树已经缩进过一次，只留 mt-1。 */
  margin?: string
}) {
  const shown = useGrow()
  return (
    <ol
      aria-label={label}
      className={[
        'space-y-0.5 border-l border-neutral-200 pl-3',
        margin,
        'transition duration-200 ease-out motion-reduce:transition-none',
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1',
      ].join(' ')}
    >
      {nodes.map((node) =>
        node.title === '' ? (
          <FolderBookmarks key={node.id} bookmarks={node.bookmarks} />
        ) : (
          <FolderNode key={node.id} node={node} domain={domain} depth={depth} />
        ),
      )}
    </ol>
  )
}

function FolderNode({
  node,
  domain,
  depth,
}: {
  node: DomainFolderNode
  domain: string
  depth: number
}) {
  const expandable = node.children.length > 0
  const [open, setOpen] = useState(depth < FOLDER_AUTO_OPEN_DEPTH)
  const label = (
    <>
      {expandable ? (
        <ChevronDownIcon
          className={[
            'h-3 w-3 shrink-0 text-neutral-400 transition-transform duration-150 motion-reduce:transition-none',
            open ? '' : '-rotate-90',
          ].join(' ')}
        />
      ) : (
        <span aria-hidden="true" className="h-3 w-3 shrink-0" />
      )}
      <FolderIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
      <span className="min-w-0 flex-1 truncate text-sm text-neutral-500" title={node.title}>
        {node.title}
      </span>
      <span className="shrink-0 text-sm tabular-nums text-neutral-600">{node.count}</span>
    </>
  )
  return (
    <li>
      {expandable ? (
        <button
          type="button"
          className={[
            '-mx-1.5 flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-0.5 text-left',
            'transition-colors duration-150 motion-reduce:transition-none',
            'hover:bg-neutral-50 active:bg-neutral-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
          ].join(' ')}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {label}
        </button>
      ) : (
        <div className="flex items-center gap-2 py-0.5">{label}</div>
      )}
      {node.bookmarks.length > 0 && (!expandable || open) && (
        <ul className="mt-1 space-y-1 pl-5">
          <FolderBookmarks bookmarks={node.bookmarks} />
        </ul>
      )}
      {expandable && open && (
        <FolderTree nodes={node.children} domain={domain} depth={depth + 1} />
      )}
    </li>
  )
}

function FolderBookmarks({ bookmarks }: { bookmarks: DomainFolderNode['bookmarks'] }) {
  return (
    <>
      {bookmarks.map((bookmark) => {
        const address = shortAddress(bookmark.url)
        return (
          <li key={bookmark.id} className="flex min-w-0 items-start gap-2">
            <LinkIcon className="mt-0.5 h-3 w-3 shrink-0 text-neutral-300" />
            <a
              href={bookmark.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
            >
              <span className="block break-words text-sm leading-caption text-neutral-700">
                {bookmark.title.trim() || address}
              </span>
              <span className="mt-0.5 block break-all text-xs leading-caption text-neutral-400">
                {address}
              </span>
            </a>
            {bookmark.weight !== undefined && (
              <span className="shrink-0 text-xs leading-caption tabular-nums text-neutral-500">
                {t('dashVisitCount', String(bookmark.weight))}
              </span>
            )}
          </li>
        )
      })}
    </>
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
