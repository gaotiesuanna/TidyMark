import { t } from '@/i18n'

export type StepIndexItem<K extends string> = {
  key: K
  index: string
  label: string
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
    <div>
      <ol className="flex items-start" aria-label={t('shellStepsLabel')}>
        {items.map((item, index) => {
          const current = index === currentIndex
          const completed = currentIndex >= 0 && index < currentIndex
          const reached = completed || current
          return (
            <li key={item.key} className="flex min-w-0 flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <span
                  aria-hidden
                  className={[
                    'h-0.5 flex-1 rounded-full',
                    index === 0 ? 'invisible' : reached ? 'bg-index-blue' : 'bg-index-line',
                  ].join(' ')}
                />
                <span
                  aria-label={`${item.index} ${item.label}`}
                  {...(current ? { 'aria-current': 'step' as const } : {})}
                  className={[
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-2xs',
                    'transition-colors duration-150 motion-reduce:transition-none',
                    completed
                      ? 'border-index-blue bg-index-blue text-white'
                      : current
                        ? 'border-index-blue font-semibold text-index-blue'
                        : 'border-index-line text-index-faint',
                  ].join(' ')}
                >
                  {item.index}
                </span>
                <span
                  aria-hidden
                  className={[
                    'h-0.5 flex-1 rounded-full',
                    index === items.length - 1 ? 'invisible' : completed ? 'bg-index-blue' : 'bg-index-line',
                  ].join(' ')}
                />
              </div>
              <span
                aria-hidden
                title={item.label}
                className={[
                  'mt-1 max-w-full truncate px-0.5 text-2xs leading-none',
                  current
                    ? 'font-semibold text-index-blue'
                    : completed
                      ? 'text-index-muted'
                      : 'text-index-faint',
                ].join(' ')}
              >
                {item.label}
              </span>
            </li>
          )
        })}
      </ol>
      <div className="mt-4">{children}</div>
    </div>
  )
}
