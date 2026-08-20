import { currentLocale, t } from '@/i18n'
import { useStore } from '../store'
import { PRESETS } from '@/storage/settings'
import type { Settings } from '@/storage/settings'

export function SettingsPanel() {
  const { settings, setSettings } = useStore()
  const locale = currentLocale()

  return (
    <div className="space-y-4">
      {/* 返回按钮在 Shell 的头部那一行，和齿轮同排 */}
      <h2 className="text-sm font-medium">{t('settingsTitle')}</h2>

      {/* 模型配置摆最前：新用户来设置页就是为了它 */}
      <section className="space-y-2 rounded border p-3">
        <h3 className="text-sm font-medium">{t('settingsModelTitle')}</h3>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.baseUrl}
              className="rounded border px-2 py-0.5 text-xs hover:bg-neutral-50"
              onClick={() => void setSettings({
                ...settings,
                llm: { ...settings.llm, baseUrl: preset.baseUrl, model: preset.model },
              })}
            >
              {preset.label[locale]}
            </button>
          ))}
        </div>
        <input
          className="w-full rounded border px-2 py-1 text-xs"
          placeholder="Base URL"
          value={settings.llm.baseUrl}
          onChange={(e) => void setSettings({ ...settings, llm: { ...settings.llm, baseUrl: e.target.value } })}
        />
        <input
          className="w-full rounded border px-2 py-1 text-xs"
          placeholder="API Key"
          type="password"
          value={settings.llm.apiKey}
          onChange={(e) => void setSettings({ ...settings, llm: { ...settings.llm, apiKey: e.target.value } })}
        />
        <input
          className="w-full rounded border px-2 py-1 text-xs"
          placeholder="Model"
          value={settings.llm.model}
          onChange={(e) => void setSettings({ ...settings, llm: { ...settings.llm, model: e.target.value } })}
        />
        <p className="text-[11px] leading-relaxed text-neutral-400">
          {t('settingsPrivacyKey')}
          {' '}
          {t('settingsPrivacyPayload')}
        </p>
      </section>

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

      {/* 统一 GitHub 标题改的是书签自己的名字，不是「这一轮怎么整理」，所以不在偏好页 */}
      <section className="rounded border p-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-3.5 w-3.5"
            checked={settings.rewriteGithubTitles}
            onChange={(e) => void setSettings({ ...settings, rewriteGithubTitles: e.target.checked })}
          />
          <span>
            {t('settingsGithubTitle')}
            <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-400">
              {t('settingsGithubBody')}
            </span>
          </span>
        </label>
      </section>
    </div>
  )
}
