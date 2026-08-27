import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '@/i18n'
import { isLocalBaseUrl } from '@/llm/config'
import { endpointKey, type Endpoint } from '@/storage/settings'
import { modelTestKey, useStore, type ModelTestReason } from '../store'
import { ActivityIcon, CloseIcon, PencilIcon, PlusIcon, SaveIcon, TrashIcon } from './icons'

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

/**
 * 折叠态显示域名——它才是区分端点的那个东西，完整地址在编辑态里看。
 * 设置页的预设卡片也拿它当副标题，所以导出而不是各写一份。
 */
export function domainOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

const btn =
  'inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-neutral-200 bg-white px-2.5 text-sm text-neutral-700 transition-colors duration-150 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40'
const iconBtn =
  'inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-neutral-500 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed disabled:opacity-40'
/**
 * 删除保留红色，但只落在图标上、不上红边框：一整圈红把这张卡上最不该被误点的东西
 * 变成了最抢眼的东西（原来的样子见 issues 里那两张截图）。红字 + 垃圾桶图标 + 中文
 * aria-label，三重信号已经够，不需要再加一圈框来喊。
 */
const iconBtnDanger =
  'inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-red-600 transition-colors duration-150 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 motion-reduce:transition-none'
const field =
  'w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400'

function IconAction({
  label, danger, disabled, onClick, children,
}: {
  label: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={danger === true ? iconBtnDanger : iconBtn}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
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
  const { modelTests, testModel, listModels } = useStore()
  const [editing, setEditing] = useState(initialEditing)
  // 草稿只包住这两个框：加删模型、点圆点是单次动作不是打字，套一层保存反而多一步
  const [draftUrl, setDraftUrl] = useState(endpoint.baseUrl)
  const [draftKey, setDraftKey] = useState(endpoint.apiKey)
  const [problem, setProblem] = useState<'full' | 'empty' | null>(null)
  const [newModel, setNewModel] = useState('')
  const [adding, setAdding] = useState(false)
  const [catalog, setCatalog] = useState<
    { state: 'idle' } | { state: 'loading' } | { state: 'ok'; models: string[] } | { state: 'fail' }
  >({ state: 'idle' })
  const urlRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)

  const loadCatalog = (url: string, key: string): void => {
    if (checkBaseUrl(url) !== null) {
      setCatalog({ state: 'idle' })
      return
    }
    setCatalog({ state: 'loading' })
    void listModels(url.trim(), key).then((models) => {
      if (models === null) setCatalog({ state: 'fail' })
      else setCatalog({ state: 'ok', models })
    })
  }

  useEffect(() => {
    if (!editing) {
      setCatalog({ state: 'idle' })
      setAdding(false)
      return
    }
    loadCatalog(draftUrl, draftKey)
    // 光标落在第一个还空着的框上。点预设加进来的端点地址是现成的、Key 是空的，
    // 所以点完预设直接就能打 Key——不然用户得在一张刚冒出来的卡上再找一次输入框。
    // 两个都填好了（点铅笔改已有端点）就回到地址那格，从头看起。
    const target = draftUrl.trim() === '' || draftKey !== '' ? urlRef.current : keyRef.current
    target?.focus()
    // 只在进入编辑时拉一次。改地址或 Key 后由输入框 blur 再拉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])


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

  const addModel = (name: string): void => {
    const trimmed = name.trim()
    if (trimmed === '' || endpoint.models.includes(trimmed)) return
    onChange({ ...endpoint, models: [...endpoint.models, trimmed] })
    setNewModel('')
    setAdding(false)
  }



  const keyNote = isLocalBaseUrl(endpoint.baseUrl)
    ? t('settingsKeyLocal')
    : endpoint.apiKey.trim() === '' ? t('settingsKeyEmpty') : t('settingsKeySet')
  const pickable = catalog.state === 'ok'
    ? catalog.models.filter((name) => !endpoint.models.includes(name))
    : []
  const showSelect = adding && (catalog.state === 'loading' || pickable.length > 0)
  const showInput = adding && !showSelect



  return (
    <article className="space-y-3 rounded-lg border border-neutral-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {domainOf(endpoint.baseUrl)}
          </span>
          <span className="mt-0.5 block text-xs text-neutral-500">
            {keyNote}
          </span>
        </div>
        <div className="flex shrink-0 gap-1">
          {editing ? (
            <>
              <IconAction label={t('settingsEndpointCancel')} onClick={cancel}>
                <CloseIcon />
              </IconAction>
              <IconAction label={t('settingsEndpointSave')} onClick={save}>
                <SaveIcon />
              </IconAction>
            </>
          ) : (
            <IconAction label={t('settingsEndpointEdit')} onClick={startEdit}>
              <PencilIcon />
            </IconAction>
          )}
          <IconAction danger label={t('settingsEndpointDelete')} onClick={onDelete}>
            <TrashIcon />
          </IconAction>
        </div>
      </div>

      {editing && (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-neutral-600">Base URL</span>
            <input
              ref={urlRef}
              className={field}
              placeholder="Base URL"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              onBlur={() => loadCatalog(draftUrl, draftKey)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-neutral-600">API Key</span>
            <input
              ref={keyRef}
              className={field}
              placeholder="API Key"
              type="password"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              onBlur={() => loadCatalog(draftUrl, draftKey)}
            />
          </label>
          {problem !== null && (
            <p className="text-xs leading-relaxed text-neutral-600">
              {problem === 'full' ? t('settingsBaseUrlFull') : t('settingsBaseUrlEmpty')}
            </p>
          )}
        </div>
      )}

      <ul className="space-y-2">
        {endpoint.models.map((model) => {
          const test = modelTests[modelTestKey(endpoint.baseUrl, model)]
          return (
            <li key={model} className="space-y-1">
              <div className="flex items-center gap-0.5">
                <label className="flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    className="h-4 w-4 shrink-0 accent-neutral-800"
                    name={`model-${endpointKey(endpoint.baseUrl)}`}
                    aria-label={model}
                    checked={activeModel === model}
                    onChange={() => onPick(model)}
                  />
                  {/* 模型名一行放不下就截断，不换行：它是个不该被拆开的标识符。
                      break-all 会把 glm-5.2 竖着码成一列字母——尤其是右边还站着
                      「连接正常，往返 4916 毫秒」把这一格挤到只剩一个字宽的时候。
                      完整的名字给 title，鼠标停一下就能看全。 */}
                  <span className="min-w-0 flex-1 truncate" title={model}>{model}</span>
                </label>
                <IconAction
                  label={t('settingsTestModel')}
                  disabled={test?.state === 'running'}
                  onClick={() => void testModel(
                    editing ? draftUrl.trim() : endpoint.baseUrl,
                    editing ? draftKey : endpoint.apiKey,
                    model,
                  )}
                >
                  <ActivityIcon />
                </IconAction>
                <IconAction
                  label={t('settingsModelRemove')}
                  onClick={() => onChange({
                    ...endpoint, models: endpoint.models.filter((m) => m !== model),
                  })}
                >
                  <CloseIcon />
                </IconAction>
              </div>
              {/* 结论一律走模型名底下这一行，不挤在同一行里：往返毫秒数、失败原因长度都不定，
                  同一行意味着它们要跟模型名抢宽度，而抢输的总是模型名 */}
              {test?.state === 'running' && (
                <p className="pl-6 text-xs text-neutral-500">{t('settingsTestRunning')}</p>
              )}
              {/* 成功也用这一页通用的次要文字层级，不上绿色勾：整个界面全程没用过状态色 */}
              {test?.state === 'ok' && (
                <p className="pl-6 text-xs text-neutral-500">
                  {t('settingsTestOk', String(test.ms ?? 0))}
                </p>
              )}
              {test?.state === 'fail' && (
                <p className="pl-6 text-xs leading-relaxed text-neutral-600">
                  {describeFailure(test.reason)}
                  {/* 原始报错留着：分类给方向，状态码和响应体才是定位用得上的证据。
                      后台已经把 Key 从这段文本里剥掉了（见 llm/probe.ts 的 stripSecret） */}
                  {test.error !== undefined && test.error !== '' && (
                    <span className="mt-0.5 block break-all text-neutral-500">{test.error}</span>
                  )}
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {/* 一个模型都没有时说清楚下一步：空列表本身只是「什么都没有」，
          它不会告诉人「先填 Key、再从服务商的清单里挑」 */}
      {endpoint.models.length === 0 && (
        <p className="text-xs leading-relaxed text-neutral-500">{t('settingsModelNone')}</p>
      )}

      {editing && !adding && (
        <button type="button" className={btn} onClick={() => setAdding(true)}>
          <PlusIcon className="h-3.5 w-3.5" />
          {t('settingsModelAdd')}
        </button>
      )}
      {showSelect && (
        <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white py-0.5 pl-2 pr-1">
          <select
            aria-label={t('settingsModelAdd')}
            className="min-h-8 min-w-0 flex-1 cursor-pointer border-0 bg-transparent text-sm focus-visible:outline-none"
            value=""
            disabled={catalog.state === 'loading'}
            onChange={(e) => addModel(e.target.value)}
          >
            <option value="">
              {catalog.state === 'loading' ? t('settingsModelListing') : t('settingsModelAdd')}
            </option>
            {pickable.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <IconAction label={t('settingsEndpointCancel')} onClick={() => setAdding(false)}>
            <CloseIcon />
          </IconAction>
        </div>
      )}
      {showInput && (
        <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white py-0.5 pl-2 pr-1">
          <input
            className="min-h-8 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm focus-visible:outline-none"
            aria-label={t('settingsModelAdd')}
            placeholder={t('settingsModelAdd')}
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addModel(newModel) }}
            onBlur={() => addModel(newModel)}
          />
          <IconAction label={t('settingsEndpointCancel')} onClick={() => setAdding(false)}>
            <CloseIcon />
          </IconAction>
        </div>
      )}


    </article>
  )
}
