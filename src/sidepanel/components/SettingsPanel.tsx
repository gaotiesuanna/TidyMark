import { t } from '@/i18n'
import { useStore } from '../store'
import type { Settings } from '@/storage/settings'

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
    </div>
  )
}
