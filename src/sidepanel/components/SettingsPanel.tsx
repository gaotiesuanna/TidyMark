import { useEffect, useState } from 'react'

import { currentLocale, t } from '@/i18n'
import { useStore } from '../store'
import { EndpointCard } from './EndpointCard'
import { PRESETS, endpointKey } from '@/storage/settings'
import type { Endpoint, Settings } from '@/storage/settings'

function replaceEndpoint(settings: Settings, index: number, next: Endpoint): Settings {
  const endpoints = settings.endpoints.map((e, i) => (i === index ? next : e))
  const old = settings.endpoints[index]!
  // 改地址时把 active 一起跟过去，否则改完地址当前那一对就指空了
  const active = endpointKey(old.baseUrl) === endpointKey(settings.active.baseUrl)
    ? { baseUrl: next.baseUrl, model: settings.active.model }
    : settings.active
  return { ...settings, endpoints, active }
}

/**
 * 删端点连 Key 一起从数组里真删掉，不做标记——留着标记等于 Key 还躺在存储里。
 * 删掉的正好是在用的那条时，active 落到剩下第一条的第一个模型；一条不剩就清空，
 * 于是 activeLlm 走兜底、界面回到「还没配置模型」。
 */
function removeEndpoint(settings: Settings, index: number): Settings {
  const endpoints = settings.endpoints.filter((_, i) => i !== index)
  const removed = settings.endpoints[index]!
  if (endpointKey(removed.baseUrl) !== endpointKey(settings.active.baseUrl)) {
    return { ...settings, endpoints }
  }
  const first = endpoints[0]
  const model = first?.models[0]
  const active = first === undefined || model === undefined
    ? { baseUrl: '', model: '' }
    : { baseUrl: first.baseUrl, model }
  return { ...settings, endpoints, active }
}

/**
 * 点预设 = 新增一个端点，不是覆盖当前这个——覆盖语义在能存多条的世界里没有意义。
 * 已有同 baseUrl 时只把模型名并进去，**Key 一个字都不动**：预设本来就不带 Key，
 * 拿它去盖用户已经填好的那把是纯粹的破坏。
 */
function applyPreset(settings: Settings, preset: { baseUrl: string; model: string }): Settings {
  const key = endpointKey(preset.baseUrl)
  const hit = settings.endpoints.findIndex((e) => endpointKey(e.baseUrl) === key)
  if (hit === -1) {
    return {
      ...settings,
      endpoints: [
        ...settings.endpoints,
        { baseUrl: preset.baseUrl, apiKey: '', models: [preset.model] },
      ],
    }
  }
  const endpoints = settings.endpoints.map((e, i) => (
    i !== hit || e.models.includes(preset.model)
      ? e
      : { ...e, models: [...e.models, preset.model] }
  ))
  return { ...settings, endpoints }
}

export function SettingsPanel() {
  const { settings, setSettings, resetModelTest } = useStore()
  const locale = currentLocale()
  const [picking, setPicking] = useState(false)

  // 每次挂载都清回空白：测试结果是一次即时探针，不是状态。上次那个结论摆在这里会撒谎——
  // 中间可能已经换过 Key、换过模型（见 issues/37-test-model-button.md）。
  useEffect(() => resetModelTest(), [resetModelTest])

  const addBlank = (): void => {
    void setSettings({
      ...settings,
      endpoints: [...settings.endpoints, { baseUrl: '', apiKey: '', models: [] }],
    })
    setPicking(false)
  }

  const pickPreset = (preset: (typeof PRESETS)[number]): void => {
    void setSettings(applyPreset(settings, preset))
    setPicking(false)
  }

  return (
    <div className="space-y-4">
      {/* 返回按钮在 Shell 的头部那一行，和齿轮同排 */}
      <h2 className="text-sm font-medium">{t('settingsTitle')}</h2>

      {/* 模型配置摆最前：新用户来设置页就是为了它 */}
      <section className="space-y-3 rounded-lg border border-neutral-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t('settingsModelTitle')}</h3>
          <button
            className="inline-flex min-h-8 shrink-0 cursor-pointer items-center whitespace-nowrap rounded border border-neutral-200 bg-white px-2.5 text-xs text-neutral-700 transition-colors duration-150 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1"
            onClick={() => setPicking((open) => !open)}
          >
            {t('settingsEndpointAdd')}
          </button>
        </div>

        {settings.endpoints.map((endpoint, index) => (
          <EndpointCard
            key={endpointKey(endpoint.baseUrl) === '' ? `new-${index}` : endpointKey(endpoint.baseUrl)}
            endpoint={endpoint}
            activeModel={
              endpointKey(endpoint.baseUrl) === endpointKey(settings.active.baseUrl)
                ? settings.active.model
                : null
            }
            initialEditing={endpoint.baseUrl === ''}
            onChange={(next) => void setSettings(replaceEndpoint(settings, index, next))}
            onDelete={() => void setSettings(removeEndpoint(settings, index))}
            onPick={(model) => void setSettings({
              ...settings, active: { baseUrl: endpoint.baseUrl, model },
            })}
          />
        ))}

        {picking && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-neutral-600">{t('settingsPresetHint')}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex min-h-8 cursor-pointer items-center whitespace-nowrap rounded border border-neutral-200 bg-white px-2.5 text-xs text-neutral-700 transition-colors duration-150 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1"
                onClick={addBlank}
              >
                {t('settingsEndpointCustom')}
              </button>
              {PRESETS.map((preset) => (
                <button
                  key={preset.baseUrl}
                  type="button"
                  className="inline-flex min-h-8 cursor-pointer items-center whitespace-nowrap rounded border border-neutral-200 bg-white px-2.5 text-xs text-neutral-700 transition-colors duration-150 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1"
                  onClick={() => pickPreset(preset)}
                >
                  {preset.label[locale]}
                </button>
              ))}
            </div>
          </div>
        )}


        <p className="text-[11px] leading-relaxed text-neutral-500">
          {t('settingsPrivacyKey')}
          {' '}
          {t('settingsPrivacyPayload')}
        </p>
      </section>

      <section className="space-y-2 rounded-lg border border-neutral-200 p-3">
        <h3 className="text-sm font-medium">{t('settingsLangTitle')}</h3>
        <label className="block text-sm">
          <select
            className="w-full min-h-8 cursor-pointer rounded border border-neutral-200 bg-white px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
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
        <p className="text-[11px] leading-relaxed text-neutral-500">{t('settingsLangBody')}</p>
      </section>

      {/* 统一 GitHub 标题改的是书签自己的名字，不是「这一轮怎么整理」，所以不在偏好页 */}
      <section className="rounded-lg border border-neutral-200 p-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-3.5 w-3.5"
            checked={settings.rewriteGithubTitles}
            onChange={(e) => void setSettings({ ...settings, rewriteGithubTitles: e.target.checked })}
          />
          <span>
            {t('settingsGithubTitle')}
            <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-500">
              {t('settingsGithubBody')}
            </span>
          </span>
        </label>
      </section>
    </div>
  )
}
