import { SettingsIcon } from './icons'

export type IndexNavigationItem<K extends string> = {
  key: K
  index: string
  label: string
  shortLabel: string
}

export function IndexNavigation<K extends string>({
  items,
  activeKey,
  disabled = false,
  settingsLabel,
  onSelect,
  onOpenSettings,
}: {
  items: readonly IndexNavigationItem<K>[]
  activeKey: K
  disabled?: boolean
  settingsLabel: string
  onSelect: (key: K) => void
  onOpenSettings: () => void
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-stretch border-b border-index-line">
      <div className="flex min-w-0 flex-1" role="tablist">
        {items.map((item) => {
          const active = item.key === activeKey
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-label={`${item.index} ${item.label}`}
              aria-selected={active}
              disabled={disabled}
              className={[
                'flex h-10 min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden border-b-2 px-1 text-xs',
                'transition-colors duration-150 motion-reduce:transition-none',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-index-blue',
                'disabled:cursor-not-allowed disabled:opacity-40',
                active
                  ? 'border-index-blue font-semibold text-index-blue'
                  : 'border-transparent font-medium text-index-muted hover:text-index-ink',
              ].join(' ')}
              onClick={() => onSelect(item.key)}
            >
              <span className="shrink-0 font-mono text-2xs" aria-hidden>{item.index}</span>
              <span className="hidden min-w-0 truncate min-[400px]:inline" aria-hidden>{item.label}</span>
              <span className="min-w-0 truncate min-[400px]:hidden" aria-hidden>{item.shortLabel}</span>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        className="flex h-10 w-10 shrink-0 items-center justify-center text-index-muted transition-colors duration-150 hover:text-index-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-index-blue motion-reduce:transition-none"
        aria-label={settingsLabel}
        onClick={onOpenSettings}
      >
        <SettingsIcon className="h-4 w-4" />
      </button>
    </div>
  )
}
