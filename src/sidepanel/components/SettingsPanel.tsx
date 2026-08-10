import { t } from '@/i18n'
import { useStore } from '../store'

export function SettingsPanel() {
  const { closeSettings } = useStore()

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          className="rounded border px-2 py-1 text-xs hover:bg-neutral-50"
          onClick={closeSettings}
        >
          {t('settingsBack')}
        </button>
        <h2 className="text-sm font-medium">{t('settingsTitle')}</h2>
      </div>
    </div>
  )
}
