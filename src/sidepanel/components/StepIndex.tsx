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
      <ol className="flex flex-wrap gap-1.5" aria-label={t('shellStepsLabel')}>
        {items.map((item, index) => {
          const current = index === currentIndex
          const completed = currentIndex >= 0 && index < currentIndex
          return (
            <li key={item.key}>
              <span
                aria-label={`${item.index} ${item.label}`}
                {...(current ? { 'aria-current': 'step' as const } : {})}
                className={[
                  'flex items-center gap-1 rounded-md px-2 py-1 text-xs leading-none',
                  current
                    ? 'bg-index-ink font-semibold text-white'
                    : completed
                      ? 'bg-neutral-100 font-medium text-index-ink'
                      : 'bg-neutral-100 font-medium text-index-faint',
                ].join(' ')}
              >
                <span aria-hidden className="font-mono tabular-nums">
                  {String(Number(item.index))}.
                </span>
                <span aria-hidden>{item.label}</span>
              </span>
            </li>
          )
        })}
      </ol>
      <div className="mt-4">{children}</div>
    </div>
  )
}
