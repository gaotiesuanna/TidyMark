import { useState } from 'react'
import { t } from '@/i18n'
import { isLocalBaseUrl } from '@/llm/config'
import { endpointKey, type Endpoint } from '@/storage/settings'
import { modelTestKey, useStore, type ModelTestReason } from '../store'

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

/**
 * 保存时的地址校验。合法返回 null。
 *
 * 'full'：填成了完整端点。llm/client.ts 会自己接上 /chat/completions，
 * 照抄官方文档给的完整地址会拼成两遍——storage/settings.ts 里 OpenCode Go
 * 那条预设的注释讲的正是这个坑，在这之前它没有任何执行的地方。
 */
export function checkBaseUrl(baseUrl: string): 'full' | 'empty' | null {
  const trimmed = baseUrl.trim()
  if (trimmed === '') return 'empty'
  if (/\/chat\/completions\/?$/.test(trimmed)) return 'full'
  return null
}

/** 折叠态显示域名——它才是区分端点的那个东西，完整地址在编辑态里看。 */
function domainOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

export interface EndpointCardProps {
  endpoint: Endpoint
  /** 当前在用的那一对；不属于本端点时为 null。 */
  activeModel: string | null
  /** 新建的端点一进来就是草稿态。 */
  initialEditing?: boolean
  onChange: (next: Endpoint) => void
  onDelete: () => void
  onPick: (model: string) => void
}

export function EndpointCard({
  endpoint, activeModel, initialEditing = false, onChange, onDelete, onPick,
}: EndpointCardProps) {
  const { modelTests, testModel } = useStore()
  const [editing, setEditing] = useState(initialEditing)
  // 草稿只包住这两个框：加删模型、点圆点是单次动作不是打字，套一层保存反而多一步
  const [draftUrl, setDraftUrl] = useState(endpoint.baseUrl)
  const [draftKey, setDraftKey] = useState(endpoint.apiKey)
  const [problem, setProblem] = useState<'full' | 'empty' | null>(null)
  const [newModel, setNewModel] = useState('')

  const startEdit = (): void => {
    setDraftUrl(endpoint.baseUrl)
    setDraftKey(endpoint.apiKey)
    setProblem(null)
    setEditing(true)
  }

  const save = (): void => {
    const found = checkBaseUrl(draftUrl)
    if (found !== null) return setProblem(found)
    onChange({ ...endpoint, baseUrl: draftUrl.trim(), apiKey: draftKey })
    setEditing(false)
  }

  const cancel = (): void => {
    setProblem(null)
    setEditing(false)
  }

  const addModel = (): void => {
    const name = newModel.trim()
    if (name === '' || endpoint.models.includes(name)) return
    onChange({ ...endpoint, models: [...endpoint.models, name] })
    setNewModel('')
  }

  const keyNote = isLocalBaseUrl(endpoint.baseUrl)
    ? t('settingsKeyLocal')
    : endpoint.apiKey.trim() === '' ? t('settingsKeyEmpty') : t('settingsKeySet')

  return (
    <div className="space-y-2 rounded border p-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">{domainOf(endpoint.baseUrl)}</span>
        <span className="text-neutral-400">·</span>
        <span className="text-neutral-500">{keyNote}</span>
        <span className="flex-1" />
        {!editing && (
          <button className="rounded border px-2 py-0.5 hover:bg-neutral-50" onClick={startEdit}>
            {t('settingsEndpointEdit')}
          </button>
        )}
        <button className="rounded border px-2 py-0.5 hover:bg-neutral-50" onClick={onDelete}>
          {t('settingsEndpointDelete')}
        </button>
      </div>

      {editing && (
        <div className="space-y-1">
          <input
            className="w-full rounded border px-2 py-1 text-xs"
            placeholder="Base URL"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
          />
          <input
            className="w-full rounded border px-2 py-1 text-xs"
            placeholder="API Key"
            type="password"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
          />
          {problem !== null && (
            <p className="text-[11px] leading-relaxed text-neutral-500">
              {problem === 'full' ? t('settingsBaseUrlFull') : t('settingsBaseUrlEmpty')}
            </p>
          )}
          <div className="flex gap-2">
            <button className="rounded border px-2 py-0.5 text-xs hover:bg-neutral-50" onClick={save}>
              {t('settingsEndpointSave')}
            </button>
            <button className="rounded border px-2 py-0.5 text-xs hover:bg-neutral-50" onClick={cancel}>
              {t('settingsEndpointCancel')}
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-1">
        {endpoint.models.map((model) => {
          const test = modelTests[modelTestKey(endpoint.baseUrl, model)]
          return (
            <li key={model} className="space-y-0.5">
              <div className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  className="h-3 w-3"
                  name={`model-${endpointKey(endpoint.baseUrl)}`}
                  aria-label={model}
                  checked={activeModel === model}
                  onChange={() => onPick(model)}
                />
                <span className="min-w-0 flex-1 break-all">{model}</span>
                {test?.state === 'running' && (
                  <span className="text-[11px] text-neutral-400">{t('settingsTestRunning')}</span>
                )}
                {/* 成功也用这一页通用的次要文字层级，不上绿色勾：整个界面全程没用过状态色 */}
                {test?.state === 'ok' && (
                  <span className="text-[11px] text-neutral-500">
                    {t('settingsTestOk', String(test.ms ?? 0))}
                  </span>
                )}
                <button
                  className="rounded border px-2 py-0.5 hover:bg-neutral-50 disabled:opacity-40"
                  // 草稿还没落盘，这时候测的不是眼前这份；正在测时禁着，别让人连点出好几发请求
                  disabled={editing || test?.state === 'running'}
                  onClick={() => void testModel(endpoint.baseUrl, model)}
                >
                  {t('settingsTestModel')}
                </button>
                <button
                  className="rounded border px-2 py-0.5 hover:bg-neutral-50"
                  onClick={() => onChange({
                    ...endpoint, models: endpoint.models.filter((m) => m !== model),
                  })}
                >
                  {t('settingsModelRemove')}
                </button>
              </div>
              {test?.state === 'fail' && (
                <p className="text-[11px] leading-relaxed text-neutral-500">
                  {describeFailure(test.reason)}
                  {/* 原始报错留着：分类给方向，状态码和响应体才是定位用得上的证据。
                      后台已经把 Key 从这段文本里剥掉了（见 llm/probe.ts 的 stripSecret） */}
                  {test.error !== undefined && test.error !== '' && (
                    <span className="mt-0.5 block break-all text-neutral-400">{test.error}</span>
                  )}
                </p>
              )}
            </li>
          )
        })}
      </ul>

      <input
        className="w-full rounded border px-2 py-1 text-xs"
        placeholder={t('settingsModelAdd')}
        value={newModel}
        onChange={(e) => setNewModel(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') addModel() }}
        onBlur={addModel}
      />
    </div>
  )
}
