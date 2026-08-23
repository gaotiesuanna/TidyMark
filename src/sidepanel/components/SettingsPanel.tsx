import { useEffect } from 'react'
import { currentLocale, t } from '@/i18n'
import { modelTestKey, useStore, type ModelTestReason } from '../store'
import { isModelConfigured } from '@/llm/config'
import { PRESETS } from '@/storage/settings'
import type { Settings } from '@/storage/settings'

/**
 * 一类失败说一句话，每一句都带着「下一步能做什么」——只报「失败了」等于没做，
 * 这个按钮的全部价值就在这张表上（见 issues/37-test-model-button.md）。
 *
 * undefined 走兜底：后台不是每一次失败都给得出 reason（service worker 被回收、
 * 外层 catch 兜底），把 reason 当必填读会在那些情况下显示一片空白。
 */
function describeFailure(reason: ModelTestReason | undefined): string {
  switch (reason) {
    case 'permission': return t('settingsTestFailPermission')
    case 'auth': return t('settingsTestFailAuth')
    case 'model': return t('settingsTestFailModel')
    case 'format': return t('settingsTestFailFormat')
    case 'network': return t('settingsTestFailNetwork')
    default: return t('settingsTestFailUnknown')
  }
}

export function SettingsPanel() {
  const { settings, setSettings, modelTests, resetModelTest, testModel } = useStore()
  const locale = currentLocale()

  // 每次挂载都清回空白：测试结果是一次即时探针，不是状态。上次那个结论摆在这里会撒谎——
  // 中间可能已经换过 Key、换过模型（见 issues/37-test-model-button.md）。
  useEffect(() => resetModelTest(), [resetModelTest])

  // 过渡期写法：Task 5 会把这一节整个换成端点列表。这里只让它按老样子读写第一条端点，
  // 保证类型改完之后这一屏的行为一个字都没变。
  const first = settings.endpoints[0] ?? { baseUrl: '', apiKey: '', models: [] }
  const llm = { baseUrl: first.baseUrl, apiKey: first.apiKey, model: first.models[0] ?? '' }
  const modelTest = modelTests[modelTestKey(llm.baseUrl, llm.model)] ?? { state: 'idle' as const }
  const setLlm = (next: { baseUrl: string; apiKey: string; model: string }): void => {
    void setSettings({
      ...settings,
      endpoints: [{ baseUrl: next.baseUrl, apiKey: next.apiKey, models: [next.model] }],
      active: { baseUrl: next.baseUrl, model: next.model },
    })
  }

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
              onClick={() => setLlm({ ...llm, baseUrl: preset.baseUrl, model: preset.model })}
            >
              {preset.label[locale]}
            </button>
          ))}
        </div>
        <input
          className="w-full rounded border px-2 py-1 text-xs"
          placeholder="Base URL"
          value={llm.baseUrl}
          onChange={(e) => setLlm({ ...llm, baseUrl: e.target.value })}
        />
        <input
          className="w-full rounded border px-2 py-1 text-xs"
          placeholder="API Key"
          type="password"
          value={llm.apiKey}
          onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })}
        />
        <input
          className="w-full rounded border px-2 py-1 text-xs"
          placeholder="Model"
          value={llm.model}
          onChange={(e) => setLlm({ ...llm, model: e.target.value })}
        />
        {/* 配置的正确性在配置的地方验证，而不是等到流程深处才暴露：
            按钮紧跟着那三个输入框，填完就能当场按一下 */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded border px-2 py-0.5 text-xs hover:bg-neutral-50 disabled:opacity-40"
            // 没配好就没有东西可测；正在测时禁着，别让人连点出好几发请求
            disabled={!isModelConfigured(llm) || modelTest.state === 'running'}
            onClick={() => void testModel(llm.baseUrl, llm.model)}
          >
            {t('settingsTestModel')}
          </button>
          {modelTest.state === 'running' && (
            <span className="text-[11px] text-neutral-400">{t('settingsTestRunning')}</span>
          )}
          {/* 成功也用这一页通用的次要文字层级，不上绿色勾：整个界面全程没用过状态色 */}
          {modelTest.state === 'ok' && (
            <span className="text-[11px] text-neutral-500">
              {t('settingsTestOk', String(modelTest.ms ?? 0))}
            </span>
          )}
        </div>
        {modelTest.state === 'fail' && (
          <p className="text-[11px] leading-relaxed text-neutral-500">
            {describeFailure(modelTest.reason)}
            {/* 原始报错留着：分类给方向，状态码和响应体才是定位用得上的证据。
                后台已经把 Key 从这段文本里剥掉了（见 llm/probe.ts 的 stripSecret） */}
            {modelTest.error !== undefined && modelTest.error !== '' && (
              <span className="mt-0.5 block break-all text-neutral-400">{modelTest.error}</span>
            )}
          </p>
        )}
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
