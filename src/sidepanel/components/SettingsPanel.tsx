import { t } from '@/i18n'
import { useStore } from '../store'
import { MAX_FOLDER_SIZE, MIN_FOLDER_SIZE, type Settings } from '@/storage/settings'

export function SettingsPanel() {
  const { settings, setSettings } = useStore()

  return (
    <div className="space-y-4">
      {/* 返回按钮在 Shell 的头部那一行，和齿轮同排 */}
      <h2 className="text-sm font-medium">{t('settingsTitle')}</h2>

      <section className="space-y-2 rounded border p-3">
        <h3 className="text-sm font-medium">{t('settingsLangTitle')}</h3>
        <label className="block text-sm">
          <select
            className="w-full rounded border px-2 py-1 text-xs"
            aria-label={t('settingsLangTitle')}
            value={settings.uiLocale}
            onChange={(e) =>
              void setSettings({ ...settings, uiLocale: e.target.value as Settings['uiLocale'] })
            }
          >
            <option value="auto">{t('settingsLangAuto')}</option>
            {/* 语言名用该语言自己的写法，不跟着界面翻译——
                界面正好是用户看不懂的那种语言时，这是他找回来的唯一线索 */}
            <option value="zh_CN">中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <p className="text-[11px] leading-relaxed text-neutral-400">{t('settingsLangBody')}</p>
      </section>

      <section className="space-y-3 rounded border p-3">
        <h3 className="text-sm font-medium">{t('settingsClassifyTitle')}</h3>
        <p className="text-[11px] leading-relaxed text-neutral-400">{t('settingsRebuildOnly')}</p>

        {/* 勾选框沿用 PreferencesStep 里那几个的排版，数字框跟着它的勾选状态走 */}
        <div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-3.5 w-3.5"
              checked={settings.enforceMinFolderSize}
              onChange={(e) =>
                void setSettings({ ...settings, enforceMinFolderSize: e.target.checked })
              }
            />
            <span>{t('settingsMinSizeTitle')}</span>
          </label>
          <input
            type="number"
            className="mt-1 ml-5 w-20 rounded border px-2 py-1 text-xs"
            aria-label={t('settingsMinSizeInput')}
            min={MIN_FOLDER_SIZE}
            max={MAX_FOLDER_SIZE}
            disabled={!settings.enforceMinFolderSize}
            value={settings.minFolderSize}
            onChange={(e) => {
              // 越界值不写进存储，保持原值。
              // 下界是 2 而不是 1——填 1 等于没开，那种意图该去取消勾选
              const next = Number(e.target.value)
              if (!Number.isInteger(next)) return
              if (next < MIN_FOLDER_SIZE || next > MAX_FOLDER_SIZE) return
              void setSettings({ ...settings, minFolderSize: next })
            }}
          />
          <p className="mt-0.5 ml-5 text-[11px] leading-relaxed text-neutral-400">
            {t('settingsMinSizeBody')}
          </p>
        </div>
      </section>
    </div>
  )
}
