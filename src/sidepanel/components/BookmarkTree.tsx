import type { BookmarkNode } from '@/core/ports'
import { t } from '@/i18n'

interface Props {
  nodes: BookmarkNode[]
  checkedIds: Set<string>
  onToggle: (id: string) => void
  expandedIds: Set<string>
  onToggleExpand: (id: string) => void
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

function Row({
  node, depth, checkedIds, onToggle, expandedIds, onToggleExpand,
}: { node: BookmarkNode; depth: number } & Omit<Props, 'nodes'>) {
  if (node.url !== undefined) return null
  const folders = (node.children ?? []).filter((child) => child.url === undefined)
  const expanded = expandedIds.has(node.id)

  return (
    <div>
      <div className="flex items-center rounded hover:bg-neutral-100" style={{ paddingLeft: `${depth * 14 + 4}px` }}>
        {folders.length > 0 ? (
          <button
            className="h-5 w-5 shrink-0 text-xs text-neutral-400 hover:text-neutral-700"
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
          <span className="ml-auto shrink-0 text-xs text-neutral-400">{countBookmarks(node)}</span>
        </label>
      </div>
      {expanded && folders.map((child) => (
        <Row
          key={child.id}
          node={child}
          depth={depth + 1}
          checkedIds={checkedIds}
          onToggle={onToggle}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </div>
  )
}

export function BookmarkTree({ nodes, checkedIds, onToggle, expandedIds, onToggleExpand }: Props) {
  return (
    <div className="text-sm">
      {topLevelNodes(nodes).map((node) => (
        <Row
          key={node.id}
          node={node}
          depth={0}
          checkedIds={checkedIds}
          onToggle={onToggle}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </div>
  )
}
