import { t } from '@/i18n'

export type StepIndexItem<K extends string> = {
  key: K
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
              {/* 只读进度，不是导航——刻意不长成按钮。当前步靠字重和底色给视觉，
                  aria-current 给读屏，序号和标题都是真文本，两边读到的是同一句。 */}
              <span
                {...(current ? { 'aria-current': 'step' as const } : {})}
                className={[
                  'block rounded-md px-2 py-1 text-xs leading-none tabular-nums',
                  current
                    ? 'bg-index-ink font-semibold text-white'
                    : completed
                      ? 'bg-neutral-100 font-medium text-index-ink'
                      : 'bg-neutral-100 font-medium text-index-faint',
                ].join(' ')}
              >
                {index + 1}. {item.label}
              </span>
            </li>
          )
        })}
      </ol>
      <div className="mt-4">{children}</div>
    </div>
  )
}
