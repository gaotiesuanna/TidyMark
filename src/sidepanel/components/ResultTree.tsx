import type { ResultTreeNode } from '@/core/resultTree'
import { t } from '@/i18n'

interface Props {
  nodes: ResultTreeNode[]
}

function Row({ node, depth }: { node: ResultTreeNode; depth: number }) {
  return (
    <div>
      <div
        className="flex items-center gap-2 rounded py-1 pr-2 text-xs hover:bg-neutral-50"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        <span aria-hidden className="shrink-0 text-neutral-400">📁</span>
        <span className="truncate">{node.title}</span>
        {node.isNew && (
          <span className="shrink-0 rounded bg-green-100 px-1 text-[10px] text-green-700">{t('resultTreeNew')}</span>
        )}
        <span className="ml-auto shrink-0 text-neutral-400">{node.total}</span>
      </div>
      {node.children.map((child) => (
        <Row key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

export function ResultTree({ nodes }: Props) {
  if (nodes.length === 0) return null
  return (
    <div>
      {nodes.map((node) => (
        <Row key={node.id} node={node} depth={0} />
      ))}
    </div>
  )
}
