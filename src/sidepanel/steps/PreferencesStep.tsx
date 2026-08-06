import { PRESETS } from '@/storage/settings'
import { DOMAIN_GROUPS, groupFolderTitle } from '@/core/domainGroups'
import { resolveLocale, t } from '@/i18n'
import { useStore } from '../store'

export function PreferencesStep() {
  const { scan, settings, setSettings, analyze, busy, reset } = useStore()
  if (scan === null) return null
  const { stats } = scan
  const locale = resolveLocale()

  return (
    <div className="space-y-4">
      <section className="rounded border p-3 text-sm">
        <h2 className="mb-2 font-medium">{t('prefsScanTitle')}</h2>
        <dl className="grid grid-cols-2 gap-y-1 text-xs">
          <dt className="text-neutral-500">{t('prefsStatBookmarks')}</dt><dd>{stats.totalBookmarks}</dd>
          <dt className="text-neutral-500">{t('prefsStatFolders')}</dt><dd>{stats.totalFolders}</dd>
          <dt className="text-neutral-500">{t('prefsStatEmpty')}</dt><dd>{stats.emptyFolders}</dd>
          <dt className="text-neutral-500">{t('prefsStatUntitled')}</dt><dd>{stats.untitledBookmarks}</dd>
          <dt className="text-neutral-500">{t('prefsStatDuplicates')}</dt><dd>{stats.duplicateUrlGroups}</dd>
          <dt className="text-neutral-500">{t('prefsStatDepth')}</dt><dd>{stats.maxDepth}</dd>
        </dl>
      </section>

      <section className="space-y-2 rounded border p-3">
        <h2 className="text-sm font-medium">{t('prefsModelTitle')}</h2>
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
          {t('prefsPrivacyKey')}
          {' '}
          {t('prefsPrivacyPayload')}
        </p>
      </section>

      <section className="rounded border p-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-3.5 w-3.5"
            checked={settings.rebuildStructure}
            onChange={(e) => void setSettings({ ...settings, rebuildStructure: e.target.checked })}
          />
          <span>
            {t('prefsRebuildTitle')}
            <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-400">
              {t('prefsRebuildOn')}
              <br />
              {t('prefsRebuildOff')}
            </span>
          </span>
        </label>

        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-3.5 w-3.5"
            checked={settings.removeEmptyFolders}
            onChange={(e) => void setSettings({ ...settings, removeEmptyFolders: e.target.checked })}
          />
          <span>
            {t('prefsCleanTitle')}
            <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-400">
              {t('prefsCleanBody')}
            </span>
          </span>
        </label>

        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-3.5 w-3.5"
            checked={settings.rewriteGithubTitles}
            onChange={(e) => void setSettings({ ...settings, rewriteGithubTitles: e.target.checked })}
          />
          <span>
            {t('prefsGithubTitle')}
            <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-400">
              {t('prefsGithubBody')}
            </span>
          </span>
        </label>

        <div className="mt-3 border-t pt-3">
          <p className="text-sm">
            {t('prefsGroupTitle')}
            <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-400">
              {t('prefsGroupBody')}
            </span>
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {DOMAIN_GROUPS.map((group) => (
              <label
                key={group.key}
                className={`flex items-center gap-1.5 text-xs ${
                  settings.rebuildStructure ? '' : 'text-neutral-300'
                }`}
              >
                <input
                  type="checkbox"
                  aria-label={groupFolderTitle(group, locale)}
                  className="h-3.5 w-3.5"
                  disabled={!settings.rebuildStructure}
                  checked={settings.domainGroups.includes(group.key)}
                  onChange={(e) => void setSettings({
                    ...settings,
                    domainGroups: e.target.checked
                      ? [...settings.domainGroups, group.key]
                      : settings.domainGroups.filter((key) => key !== group.key),
                  })}
                />
                {groupFolderTitle(group, locale)}
              </label>
            ))}
          </div>
        </div>
      </section>

      <div className="flex gap-2">
        <button className="rounded border px-3 py-2 text-sm" onClick={reset}>{t('prefsBack')}</button>
        <button
          className="flex-1 rounded bg-neutral-800 py-2 text-sm text-white disabled:opacity-40"
          disabled={busy !== null || settings.llm.apiKey.trim() === ''}
          onClick={() => void analyze()}
        >
          {t('prefsStart')}
        </button>
      </div>
    </div>
  )
}
