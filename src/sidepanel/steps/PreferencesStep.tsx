import { useMemo } from 'react'
import { scopeFolderPaths } from '@/core/scan'
import { detectMode } from '@/core/mode'
import { currentLocale, t } from '@/i18n'
import { isLocalBaseUrl, isModelConfigured } from '@/llm/config'
import { activeLlm, type Endpoint } from '@/storage/settings'
import { useStore } from '../store'
import { Detail, detailLabel } from '../components/Detail'

/**
 * 下拉里那一项「在设置页填别的…」的取值。用一个不可能撞上真实取值的样子：
 * 选中它不是换模型，而是跳去设置页。把「换模型」和「名单里没有我要的」收进
 * 同一个控件，比在旁边再摆一个按钮省一格。
 */
const OPEN_SETTINGS = '::open-settings'

/** 一个可选项的取值。用 \u0000 分隔而不是 `/`——baseUrl 里本来就带斜杠。 */
function optionValue(baseUrl: string, model: string): string {
  return `${baseUrl}\u0000${model}`
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

/**
 * 可切换的「端点 × 模型」组合。
 *
 * **只列配好了的端点**：列出一个用不了的组合是个陷阱——选中它，这一页立刻翻成
 * 「还没配置模型」，用户得自己想明白刚才那一下干了什么。本机端点空 Key 算配好了
 * （isModelConfigured 对 localhost 放行，README 明确支持那条路）。
 */
function pickableModels(endpoints: Endpoint[]): Array<{ baseUrl: string; model: string }> {
  return endpoints
    .filter((e) => e.apiKey.trim() !== '' || isLocalBaseUrl(e.baseUrl))
    .flatMap((e) => e.models.map((model) => ({ baseUrl: e.baseUrl, model })))
}

export function PreferencesStep() {
  const {
    scan, settings, setSettings, analyze, busy, reset, modeOverride, setModeOverride, openSettings,
    tree, checkedIds,
  } = useStore()
  const locale = currentLocale()
  // 与后台是同一个纯函数——但前提是同一份扫描结果：书签在 goScan 之后、这次
  // analyze 之前被外部改动（书签管理器里删了个文件夹、同步来一批新的）时，
  // 后台会用它自己重新 scanTree() 出来的结果再判一次，结论可能不同，那时以后台为准。
  // 全部书签走一遍 filter + 建 Map，输入框每敲一个字符都会触发重渲染，
  // 用 useMemo 避免上万条书签的库里每次击键都白算一遍。
  const decision = useMemo(
    () => (scan === null ? null : detectMode(scan, locale)),
    [scan, locale],
  )
  const scopePaths = useMemo(
    () => scopeFolderPaths(tree, [...checkedIds]),
    [tree, checkedIds],
  )
  if (scan === null || decision === null) return null
  const { stats } = scan
  const rebuild = (modeOverride ?? decision.mode) === 'rebuild'
  // 模型配置在设置页，这里只判断配没配。没配时不禁用按钮：一个禁用的按钮既不解释
  // 为什么，也不给出路；换成一个能点、点了直接落到设置页的按钮永远更好。
  // 判断走共用谓词——只认 apiKey 的话，本机 Ollama 用户永远拿不到「开始 AI 分析」，
  // 点「先去配置模型」又回到他刚配完的设置页，来回打转（见 llm/config.ts）。
  const llm = activeLlm(settings)
  const needModel = !isModelConfigured(llm)

  return (
    <div className="space-y-4">
      <section className="rounded border p-3 text-sm">
        <h2 className="mb-2 font-medium">{t('prefsScanTitle')}</h2>
        {scopePaths.length > 0 && (
          <div className="mb-2">
            <p className="text-xs text-neutral-500">{t('prefsScanScope')}</p>
            <ul>
              {scopePaths.map((path) => (
                <li key={path} className="break-all font-mono text-xs">{path}</li>
              ))}
            </ul>
          </div>
        )}
        <dl className="grid grid-cols-2 gap-y-1 text-xs">
          <dt className="text-neutral-500">{t('prefsStatBookmarks')}</dt><dd>{stats.totalBookmarks}</dd>
          <dt className="text-neutral-500">{t('prefsStatFolders')}</dt><dd>{stats.totalFolders}</dd>
          <dt className="text-neutral-500">{t('prefsStatEmpty')}</dt><dd>{stats.emptyFolders}</dd>
          <dt className="text-neutral-500">{t('prefsStatUntitled')}</dt><dd>{stats.untitledBookmarks}</dd>
          <dt className="text-neutral-500">{t('prefsStatDuplicates')}</dt><dd>{stats.duplicateUrlGroups}</dd>
          <dt className="text-neutral-500">{t('prefsStatDuplicateFolders')}</dt><dd>{stats.duplicateFolderGroups}</dd>
          <dt className="text-neutral-500">{t('prefsStatDepth')}</dt><dd>{stats.maxDepth}</dd>
        </dl>
      </section>

      <section className="rounded border p-3">
        <div className="space-y-1 text-sm">
          <p>{rebuild ? t('prefsModeRebuild') : t('prefsModeAdditive')}</p>
          {/* 摘要常驻、细节折叠：这一段讲的是「你现有的文件夹会被改名」，是对用户
              自己数据的后果，藏起来就不是知情的选择了（issues/22 的原则）。
              而编号规则的边角（名字本身以数字开头的怎么办）读一次就够。 */}
          <p className="text-[11px] leading-relaxed text-neutral-400">
            {rebuild ? t('prefsModeRebuildSummary') : t('prefsModeAdditiveBody')}
          </p>
          {rebuild && (
            <Detail label={detailLabel()}>{t('prefsModeRebuildBody')}</Detail>
          )}
          {/* 推翻之后，那条理由讲的是已经被用户否掉的结论，再摆着只会跟上面那句打架 */}
          <p className="text-[11px] leading-relaxed text-neutral-400">
            {modeOverride === null ? decision.reason : t('prefsModeOverridden')}
          </p>
          {modeOverride === null ? (
            // 逃生口只为「误判成已整理」那一个方向存在，这是产品决定（issues/14 §5），
            // 不是因为反方向的误判在复核页拒得掉——事实上拒不掉：推翻模式下给范围内
            // 既有一级目录改名、加编号前缀，跟用户在复核页接受了几条书签建议无关
            // （见 core/plan.ts 的 participates，对每个既有一级目录恒真）。
            // 误判成 rebuild 时用户能做的是这一轮整个放弃（prefsBack）或者事后撤销。
            decision.mode === 'additive' && (
              <button
                className="text-xs text-neutral-500 underline hover:text-neutral-800"
                onClick={() => setModeOverride('rebuild')}
              >
                {t('prefsModeOverride')}
              </button>
            )
          ) : (
            <button
              className="text-xs text-neutral-500 underline hover:text-neutral-800"
              onClick={() => setModeOverride(null)}
            >
              {t('prefsModeAuto')}
            </button>
          )}
        </div>

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
              {t('prefsCleanSummary')}
            </span>
            <span className="mt-0.5 block">
              <Detail label={detailLabel()}>{t('prefsCleanBody')}</Detail>
            </span>
          </span>
        </label>

      </section>

      <div className="space-y-2">
        {/* 模型状态放在按钮上方：设置藏在齿轮后面，点开始前得看见即将用哪一个；
            没配时也不只靠按钮上那几个字。权限预告仍在两种状态下都摆着。 */}
        {needModel ? (
          <p className="text-xs leading-relaxed text-neutral-600">{t('prefsModelMissing')}</p>
        ) : (
          <div className="flex items-center gap-2 text-xs text-neutral-600">
            <label htmlFor="model-pick">{t('prefsModelLabel')}</label>
            <select
              id="model-pick"
              className="min-w-0 flex-1 rounded border px-1 py-0.5 text-xs"
              value={optionValue(settings.active.baseUrl, settings.active.model)}
              onChange={(e) => {
                if (e.target.value === OPEN_SETTINGS) return openSettings()
                const [baseUrl, model] = e.target.value.split('\u0000')
                void setSettings({ ...settings, active: { baseUrl: baseUrl!, model: model! } })
              }}
            >
              {pickableModels(settings.endpoints).map(({ baseUrl, model }) => (
                <option key={optionValue(baseUrl, model)} value={optionValue(baseUrl, model)}>
                  {`${model} · ${hostOf(baseUrl)}`}
                </option>
              ))}
              <option value={OPEN_SETTINGS}>{t('prefsModelElsewhere')}</option>
            </select>
          </div>
        )}
        {/* 权限预告放在按钮上方：申请只发生在点下去的那一刻（chrome.permissions.request()
            要用户手势，设置页是 onChange 即存，放不了），提前说清楚它只要一个域名。
            两种按钮状态下都摆着——它讲的是这条动线接下来会发生什么，不依赖当前是哪个按钮。 */}
        {/* 试过折叠它，收回了：真会撞上浏览器那个权限弹窗的恰恰是已经配好模型的人
            （见本文件同名用例），藏起来弹窗就成了突袭。改成删掉不属于这一屏的那半句
            ——失效链接检查是本地清理里的功能、另一项权限，讲在这里只是把话拉长。 */}
        <p className="text-[11px] leading-relaxed text-neutral-400">{t('prefsPermissionNotice')}</p>
        <div className="flex gap-2">
          <button className="rounded border px-3 py-2 text-sm" onClick={reset}>{t('prefsBack')}</button>
          {needModel ? (
            <button
              className="flex-1 rounded border border-neutral-800 py-2 text-sm text-neutral-800"
              onClick={openSettings}
            >
              {t('prefsGoConfigure')}
            </button>
          ) : (
            <button
              className="flex-1 rounded bg-neutral-800 py-2 text-sm text-white disabled:opacity-40"
              disabled={busy !== null}
              onClick={() => void analyze()}
            >
              {t('prefsStart')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
