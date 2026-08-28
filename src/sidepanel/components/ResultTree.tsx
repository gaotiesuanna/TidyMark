import type { ResultTreeNode } from '@/core/resultTree'
import { t } from '@/i18n'
import { FolderIcon } from './icons'

interface Props {
  nodes: ResultTreeNode[]
}

function Row({ node, index }: { node: ResultTreeNode; index: string }) {
  return (
    <li data-index={index} className="relative">
      <div
        className="grid min-h-index-row grid-cols-[2.75rem_1rem_minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-index-line px-2 py-2 text-sm leading-caption"
      >
        <span aria-hidden className="font-mono text-xs text-neutral-400">{index}.</span>
        <FolderIcon className="h-3.5 w-3.5 text-index-faint" />
        <span className="min-w-0 break-words text-index-ink">{node.title}</span>
        {node.isNew && (
          <span className="shrink-0 text-2xs font-medium text-emerald-700">{t('resultTreeNew')}</span>
        )}
        <span className="shrink-0 font-mono text-xs text-index-muted">{node.total}</span>
      </div>
      {node.children.length > 0 && (
        <ol className="ml-5 border-l border-index-line pl-2">
          {node.children.map((child, childIndex) => (
            <Row
              key={child.id}
              node={child}
              index={`${index}.${String(childIndex + 1).padStart(2, '0')}`}
            />
          ))}
        </ol>
      )}
    </li>
  )
}

export function ResultTree({ nodes }: Props) {
  if (nodes.length === 0) return null
  return (
    <ol className="border-t border-index-line">
      {nodes.map((node, index) => (
        <Row key={node.id} node={node} index={String(index + 1).padStart(2, '0')} />
      ))}
    </ol>
  )
}
