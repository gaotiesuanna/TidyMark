import type * as React from 'react'

export function PageHeader({ title, description, meta }: {
  title: string
  description?: string
  meta?: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="border-b border-index-line pb-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-index-ink">{title}</h2>
        {meta !== undefined && <div className="shrink-0 text-sm text-index-muted">{meta}</div>}
      </div>
      {description !== undefined && <p className="mt-1 text-sm leading-body text-index-muted">{description}</p>}
    </header>
  )
}
