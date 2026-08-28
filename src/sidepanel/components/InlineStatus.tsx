import type * as React from 'react'

const toneClasses: Record<InlineStatusProps['tone'], string> = {
  neutral: 'border-index-line bg-index-canvas text-index-muted',
  progress: 'border-index-blue bg-index-blue-soft text-index-ink',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-800',
}

type InlineStatusProps = {
  tone: 'neutral' | 'progress' | 'success' | 'warning' | 'error'
  title?: string
  children: React.ReactNode
  action?: React.ReactNode
  live?: 'polite' | 'assertive'
}

export function InlineStatus({
  tone,
  title,
  children,
  action,
  live = 'polite',
}: InlineStatusProps): React.JSX.Element {
  return (
    <div className={`flex items-start gap-2 border px-3 py-2 text-sm leading-body ${toneClasses[tone]}`}>
      <div className="min-w-0 flex-1">
        {title !== undefined && <p className="font-medium">{title}</p>}
        <div className={title !== undefined ? 'mt-0.5' : ''} aria-live={live} aria-atomic="true">{children}</div>
      </div>
      {action !== undefined && <div className="shrink-0">{action}</div>}
    </div>
  )
}
