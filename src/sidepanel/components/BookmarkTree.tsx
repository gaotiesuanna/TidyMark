import type { BookmarkNode } from '@/core/ports'

interface Props {
  nodes: BookmarkNode[]
  checkedIds: Set<string>
  onToggle: (id: string) => void
}

function countBookmarks(node: BookmarkNode): number {
  return (node.children ?? []).reduce(
    (sum, child) => sum + (child.url !== undefined ? 1 : countBookmarks(child)),
    0,
  )
}

function Row({ node, depth, checkedIds, onToggle }: { node: BookmarkNode; depth: number } & Omit<Props, 'nodes'>) {
  if (node.url !== undefined) return null
  const folders = (node.children ?? []).filter((child) => child.url === undefined)
  return (
    <div>
      <label
        className="flex cursor-pointer items-center gap-2 rounded py-1 pr-2 hover:bg-neutral-100"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        <input
          type="checkbox"
          aria-label={node.title}
          checked={checkedIds.has(node.id)}
          onChange={() => onToggle(node.id)}
          className="h-3.5 w-3.5"
        />
        <span className="truncate">{node.title}</span>
        <span className="ml-auto shrink-0 text-xs text-neutral-400">{countBookmarks(node)}</span>
      </label>
      {folders.map((child) => (
        <Row key={child.id} node={child} depth={depth + 1} checkedIds={checkedIds} onToggle={onToggle} />
      ))}
    </div>
  )
}

export function BookmarkTree({ nodes, checkedIds, onToggle }: Props) {
  // Chrome 的根节点 id='0' 且标题为空，跳过它直接渲染「书签栏」「其他书签」
  const roots = nodes.flatMap((node) => (node.title === '' ? (node.children ?? []) : [node]))
  return (
    <div className="text-sm">
      {roots.map((node) => (
        <Row key={node.id} node={node} depth={0} checkedIds={checkedIds} onToggle={onToggle} />
      ))}
    </div>
  )
}
