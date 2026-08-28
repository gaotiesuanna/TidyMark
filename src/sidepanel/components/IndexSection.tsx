import { useId, type ReactNode } from 'react'

export function IndexSection({
  title,
  count,
  expanded = false,
  onToggle,
  children,
}: {
  title: string
  count?: ReactNode
  expanded?: boolean
  onToggle?: () => void
  children?: ReactNode
}): React.JSX.Element {
  const detailId = useId()
  const hasToggle = onToggle !== undefined
  const showDetails = !hasToggle || expanded

  return (
    <section className="border-b border-index-line">
      <h3 className="flex min-h-index-row items-center gap-2 px-3 py-2 text-sm font-medium text-index-ink">
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {count !== undefined && <span className="shrink-0 text-xs text-index-muted">{count}</span>}
        {hasToggle && (
          <button
            type="button"
            className="shrink-0 text-index-faint hover:text-index-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-index-blue"
            aria-expanded={expanded}
            aria-controls={detailId}
            aria-label={title}
            onClick={onToggle}
          >
            <span aria-hidden>{expanded ? '▾' : '▸'}</span>
          </button>
        )}
      </h3>
      {showDetails && children !== undefined && (
        <div id={detailId} className="px-3 pb-3">
          {children}
        </div>
      )}
    </section>
  )
}
