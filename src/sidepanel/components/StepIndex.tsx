export type StepIndexItem<K extends string> = {
  key: K
  index: string
  label: string
  summary?: React.ReactNode
}

export function StepIndex<K extends string>({
  items,
  currentKey,
  children,
}: {
  items: readonly StepIndexItem<K>[]
  currentKey: K
  children: React.ReactNode
}): React.JSX.Element {
  const currentIndex = items.findIndex((item) => item.key === currentKey)

  return (
    <ol className="border-t border-index-line">
      {items.map((item, index) => {
        const current = index === currentIndex
        const completed = currentIndex >= 0 && index < currentIndex
        return (
          <li key={item.key} className="border-b border-index-line">
            <div className="flex min-h-index-row items-center gap-3 px-3 py-2">
              <span
                {...(current ? { 'aria-current': 'step' as const } : {})}
                className={[
                  'text-sm leading-body',
                  current
                    ? 'font-semibold text-index-blue'
                    : completed
                      ? 'font-medium text-index-ink'
                      : 'font-medium text-index-faint',
                ].join(' ')}
              >
                {item.index} {item.label}
              </span>
            </div>
            {completed && item.summary !== undefined && (
              <div className="ml-8 border-l border-index-line px-3 pb-3 text-sm leading-body text-index-muted">
                {item.summary}
              </div>
            )}
            {current && (
              <div className="ml-8 border-l-2 border-index-blue py-3 pl-3">
                {children}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
