import { useId, type ReactNode } from 'react'

export function IndexRow({
  index,
  leading,
  title,
  description,
  measure,
  value,
  expanded = false,
  disclosureLabel,
  onToggle,
  children,
}: {
  index: string
  leading?: ReactNode
  title: ReactNode
  description?: ReactNode
  measure?: ReactNode
  value?: ReactNode
  expanded?: boolean
  disclosureLabel?: string
  onToggle?: () => void
  children?: ReactNode
}): React.JSX.Element {
  const detailId = useId()
  const hasToggle = onToggle !== undefined
  const showDetails = !hasToggle || expanded
  const content = (
    <>
      <span className="font-mono text-xs text-neutral-400">{index}</span>
      {leading !== undefined && <span className="col-start-2 shrink-0">{leading}</span>}
      <span className="col-start-3 min-w-0">
        {title}
        {description !== undefined && <span className="mt-0.5 block break-words text-sm leading-body text-index-muted">{description}</span>}
      </span>
      {measure !== undefined && <span className="col-start-4 shrink-0 text-xs text-index-muted">{measure}</span>}
      {value !== undefined && <span className="col-start-5 shrink-0 text-sm text-index-ink">{value}</span>}
    </>
  )

  const fallbackDisclosureLabel = typeof title === 'string' ? title : 'Toggle details'

  return (
    <div className="border-b border-index-line">
      <div className="grid min-h-index-row grid-cols-[2rem_1.5rem_minmax(0,1fr)_auto_auto_1.5rem] items-center gap-x-2 px-3 py-2 text-left">
        {content}
        {hasToggle ? (
          <button
            type="button"
            className="col-start-6 justify-self-end text-index-faint hover:text-index-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-index-blue"
            aria-expanded={expanded}
            aria-controls={detailId}
            aria-label={disclosureLabel ?? fallbackDisclosureLabel}
            onClick={onToggle}
          >
            <span aria-hidden>{expanded ? '▾' : '▸'}</span>
          </button>
        ) : (
          <span aria-hidden className="col-start-6" />
        )}
      </div>
      {showDetails && children !== undefined && (
        <div id={detailId} className="ml-[3.5rem] border-l border-index-line py-2 pl-3">
          {children}
        </div>
      )}
    </div>
  )
}
