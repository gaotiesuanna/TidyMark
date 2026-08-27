import type { BookmarkNode } from '@/core/ports'
import { t } from '@/i18n'
import { LinkIcon } from './icons'

interface Props {
  nodes: BookmarkNode[]
  checkedIds: Set<string>
  onToggle: (id: string) => void
  expandedIds: Set<string>
  onToggleExpand: (id: string) => void
  showBookmarks?: boolean
}

function countBookmarks(node: BookmarkNode): number {
  return (node.children ?? []).reduce(
    (sum, child) => sum + (child.url !== undefined ? 1 : countBookmarks(child)),
    0,
  )
}

/** Chrome 的根节点 id='0' 且标题为空，跳过它直接展示「书签栏」「其他书签」。 */
export function topLevelNodes(nodes: BookmarkNode[]): BookmarkNode[] {
  return nodes.flatMap((node) => (node.title === '' ? (node.children ?? []) : [node]))
}

export interface BookmarkTreeFilter {
  nodes: BookmarkNode[]
  expandedIds: Set<string>
  hasMatches: boolean
}

export function filterBookmarkTree(nodes: BookmarkNode[], query: string): BookmarkTreeFilter {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized === '') return { nodes, expandedIds: new Set(), hasMatches: false }

  const expandedIds = new Set<string>()

  function visit(node: BookmarkNode): BookmarkNode | null {
    const selfMatches = node.url !== undefined
      ? node.title.toLocaleLowerCase().includes(normalized)
        || node.url.toLocaleLowerCase().includes(normalized)
      : node.title.toLocaleLowerCase().includes(normalized)
    const children = (node.children ?? []).map(visit).filter((child): child is BookmarkNode => child !== null)
    if (!selfMatches && children.length === 0) return null
    if (node.url === undefined && children.length > 0) expandedIds.add(node.id)
    return node.url === undefined ? { ...node, children } : node
  }

  const filtered = nodes.map(visit).filter((node): node is BookmarkNode => node !== null)
  return { nodes: filtered, expandedIds, hasMatches: filtered.length > 0 }
}


function Row({
  node, depth, checkedIds, onToggle, expandedIds, onToggleExpand, showBookmarks = false,
}: { node: BookmarkNode; depth: number } & Omit<Props, 'nodes'>) {
  if (node.url !== undefined) {
    if (!showBookmarks) return null
    return (
      <div className="flex items-center gap-1.5 py-0.5 pr-2 text-neutral-600" style={{ paddingLeft: `${depth * 14 + 4}px` }}>
        <LinkIcon className="h-3 w-3 shrink-0 text-neutral-300" />
        <span className="truncate">{node.title}</span>
        <span className="ml-auto truncate text-sm leading-caption text-neutral-400">{node.url}</span>
      </div>
    )
  }
  const children = (node.children ?? []).filter((child) => showBookmarks || child.url === undefined)
  const expanded = expandedIds.has(node.id)
  return (
    <div>
      <div className="flex items-center rounded hover:bg-neutral-100" style={{ paddingLeft: `${depth * 14 + 4}px` }}>
        {children.length > 0 ? (
          <button
            className="h-5 w-5 shrink-0 text-sm leading-caption text-neutral-400 hover:text-neutral-700"
            aria-label={expanded ? t('treeCollapse', node.title) : t('treeExpand', node.title)}
            aria-expanded={expanded}
            onClick={() => onToggleExpand(node.id)}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1 pr-2">
          <input
            type="checkbox"
            aria-label={node.title}
            checked={checkedIds.has(node.id)}
            onChange={() => onToggle(node.id)}
            className="h-3.5 w-3.5 shrink-0"
          />
          <span className="truncate">{node.title}</span>
          <span className="ml-auto shrink-0 text-sm leading-caption text-neutral-400">{countBookmarks(node)}</span>
        </label>
      </div>
      {expanded && children.map((child) => (
        <Row
          key={child.id}
          node={child}
          depth={depth + 1}
          checkedIds={checkedIds}
          onToggle={onToggle}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
          showBookmarks={showBookmarks}
        />
      ))}
    </div>
  )
}

export function BookmarkTree({ nodes, checkedIds, onToggle, expandedIds, onToggleExpand, showBookmarks = false }: Props) {
  return (
    <div className="text-base leading-body">
      {topLevelNodes(nodes).map((node) => (
        <Row
          key={node.id}
          node={node}
          depth={0}
          checkedIds={checkedIds}
          onToggle={onToggle}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
          showBookmarks={showBookmarks}
        />
      ))}
    </div>
  )
}
