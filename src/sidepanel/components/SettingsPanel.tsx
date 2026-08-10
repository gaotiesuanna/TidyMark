import { t } from '@/i18n'
import { useStore } from '../store'

/** 上限的合法区间。低于 4 没有分类意义，高于 20 在书签栏里也找不着。 */
const MIN_TOP_FOLDERS = 4
const MAX_TOP_FOLDERS = 20

export function SettingsPanel() {
  const { closeSettings, settings, setSettings } = useStore()
  const enabled = settings.rebuildStructure

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

      <section className="space-y-3 rounded border p-3">
        <h3 className="text-sm font-medium">{t('settingsClassifyTitle')}</h3>
        <p className="text-[11px] leading-relaxed text-neutral-400">{t('settingsRebuildOnly')}</p>

        <label className={`block text-sm ${enabled ? '' : 'text-neutral-300'}`}>
          {t('settingsMaxFoldersTitle')}
          <input
            type="number"
            className="mt-1 w-20 rounded border px-2 py-1 text-xs"
            aria-label={t('settingsMaxFoldersTitle')}
            min={MIN_TOP_FOLDERS}
            max={MAX_TOP_FOLDERS}
            disabled={!enabled}
            value={settings.maxTopFolders}
            onChange={(e) => {
              // 越界或空输入不写进存储：它会一路传到 slice(0, 越界值)，
              // 在这里挡掉比在建树那头兜底更早、更好解释
              const next = Number(e.target.value)
              if (!Number.isInteger(next)) return
              if (next < MIN_TOP_FOLDERS || next > MAX_TOP_FOLDERS) return
              void setSettings({ ...settings, maxTopFolders: next })
            }}
          />
          <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-400">
            {t('settingsMaxFoldersBody')}
          </span>
        </label>

        <label className={`flex items-start gap-2 text-sm ${enabled ? '' : 'text-neutral-300'}`}>
          <input
            type="checkbox"
            className="mt-1 h-3.5 w-3.5"
            aria-label={t('settingsSubfoldersTitle')}
            disabled={!enabled}
            checked={settings.allowSubfolders}
            onChange={(e) => void setSettings({ ...settings, allowSubfolders: e.target.checked })}
          />
          <span>
            {t('settingsSubfoldersTitle')}
            <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-400">
              {t('settingsSubfoldersBody')}
            </span>
          </span>
        </label>
      </section>
    </div>
  )
}
