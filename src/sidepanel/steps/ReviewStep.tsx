import { useEffect, useMemo, useRef, useState } from 'react'
import { localDate } from '@/core/export'
import { MARK_CONFIDENCE, renumberPlan, summarize } from '@/core/plan'
import type { PlanRow, UnchangedRow } from '@/core/types'
import { plural, t } from '@/i18n'
import { downloadJson } from '../lib/download'
import { useStore } from '../store'

/**
 * 一组：目标目录相同的建议。allRule 决定要不要给组级「全部来自域名规则」标记与默认折叠。
 *
 * key 是 toCategoryId，组的身份；label 是组内第一行的 toPath 拼出来的字符串，只用于显示。
 */
interface ReviewGroup {
  key: string
  label: string
  rows: PlanRow[]
  allRule: boolean
}

/** 未变动区三段的固定顺序：好消息在前，两种问题在后。 */
const UNCHANGED_KINDS = ['inPlace', 'noTarget', 'failed'] as const satisfies readonly UnchangedRow['kind'][]

function unchangedKindLabel(kind: UnchangedRow['kind']): string {
  switch (kind) {
    case 'inPlace':
      return t('reviewUnchangedInPlace')
    case 'noTarget':
      return t('reviewUnchangedNoTarget')
    case 'failed':
      return t('reviewUnchangedFailed')
  }
}

export function ReviewStep() {
  const { plan: rawPlan, accepted, toggleAccepted, setRowTarget, acceptAll, rejectAll, apply, busy, reset, settings, scan } = useStore()
  // 显示的编号必须和真正会写进书签栏的一致，所以这里用同一个重排函数
  const plan = useMemo(
    () => (rawPlan === null ? null : renumberPlan(rawPlan, accepted, scan?.folders ?? [])),
    [rawPlan, accepted, scan],
  )
  const summary = useMemo(() => (plan === null ? null : summarize(plan, accepted)), [plan, accepted])
  /**
   * 按目标目录分组，保持首次出现顺序——不按字母或条数重排，
   * 不然同一份方案每次看起来都不一样。
   *
   * 分组键是 row.toCategoryId，不是 toPath 拼出来的字符串——渲染出来的字符串
   * 是给人看的，不是身份：编号平移（推翻重建模式下 `01 前端` 可能变成 `02 前端`）、
   * 合并根前缀、同名不同目录，任何一个都能让字符串变而身份没变（见 issues/26）。
   * 组标题仍取组内第一行的 toPath，只用于显示。
   *
   * 用 Map 是因为它天然按插入顺序迭代，比额外记一份顺序数组省事。
   */
  const groups = useMemo<ReviewGroup[]>(() => {
    if (plan === null) return []
    const byTarget = new Map<string, PlanRow[]>()
    for (const row of plan.rows) {
      const key = row.toCategoryId
      const rows = byTarget.get(key)
      if (rows) rows.push(row)
      else byTarget.set(key, [row])
    }
    return [...byTarget.entries()].map(([key, rows]) => ({
      key,
      label: rows[0]!.toPath.join(' / '),
      rows,
      allRule: rows.every((row) => row.source === 'rule'),
    }))
  }, [plan])
  /**
   * 折叠是纯粹的展示态，不进 store——没有别的地方需要知道它，
   * 塞进 store 只会多一份要同步的东西。
   *
   * 只记「用户手动切换过」的组；没记录的组，折叠与否由 allRule 兜底决定，
   * 所以规则命中的组一进来就是折叠的，不用在这里预填初值。
   */
  const [collapsedOverride, setCollapsedOverride] = useState<Record<string, boolean>>({})
  function toggleGroup(group: ReviewGroup): void {
    setCollapsedOverride((prev) => ({ ...prev, [group.key]: !(prev[group.key] ?? group.allRule) }))
  }
  /**
   * 改投目录或取消勾选会让一行换到另一个组；那个组如果正被用户手动折叠着，
   * 这一行就会当场从文档里消失，没有任何反馈说明它去了哪（见 I4）。
   *
   * 这里记着每个书签上一次渲染时所在的组，一旦发现换组了就强制展开新组。
   * 「目标组跳到列表最前」这半边不修——那是首次出现顺序的固有结果，接受它。
   */
  const prevGroupKeyRef = useRef<Record<string, string>>({})
  useEffect(() => {
    const prev = prevGroupKeyRef.current
    const nextGroupKey: Record<string, string> = {}
    const toExpand = new Set<string>()
    for (const group of groups) {
      for (const row of group.rows) {
        nextGroupKey[row.bookmarkId] = group.key
        if (prev[row.bookmarkId] !== undefined && prev[row.bookmarkId] !== group.key) {
          toExpand.add(group.key)
        }
      }
    }
    prevGroupKeyRef.current = nextGroupKey
    if (toExpand.size === 0) return
    setCollapsedOverride((current) => {
      const updated = { ...current }
      for (const key of toExpand) updated[key] = false
      return updated
    })
  }, [groups])
  /**
   * 未变动区不是待办，默认折叠——用户点开一次只是想确认「这次盖到了多少」，
   * 不像上面按组分的折叠态那样需要按规则命中与否分别决定初值。
   */
  const [unchangedCollapsed, setUnchangedCollapsed] = useState(true)
  /**
   * 两个纯展示态的筛选开关：只看模型判的（排除规则命中）、只看被标记的（排除高置信度）。
   * 不进 store——跟折叠态一样，没有别的地方需要知道它。筛掉的行只是不渲染，
   * 不碰 accepted，也不影响上面「换组自动展开」的判断（那个判断看的是未筛选的 groups）。
   */
  const [modelOnly, setModelOnly] = useState(false)
  const [markedOnly, setMarkedOnly] = useState(false)
  const visibleGroups = useMemo<ReviewGroup[]>(
    () =>
      groups
        .map((group) => ({
          ...group,
          rows: group.rows.filter(
            (row) => (!modelOnly || row.source !== 'rule') && (!markedOnly || row.confidence < MARK_CONFIDENCE),
          ),
        }))
        .filter((group) => group.rows.length > 0),
    [groups, modelOnly, markedOnly],
  )
  if (plan === null || summary === null) return null

  /**
   * 把这一轮的完整方案倒成 JSON，供离线排查整理效果。
   *
   * 导出的是 renumberPlan 之后的 plan，也就是界面上这一刻显示的那份——
   * 拿它去对照结果树时编号才对得上。
   *
   * apiKey 必须剥掉：这个文件是要发给别人看的，而 baseUrl 与 model 留着有用，
   * 一份方案好不好，很大程度取决于它是哪个模型产出的。
   */
  function exportPlan(): void {
    const at = new Date()
    const { apiKey: _apiKey, ...llm } = settings.llm
    downloadJson(`tidymark-plan-${localDate(at)}.json`, {
      exportedAt: at.toISOString(),
      settings: { ...settings, llm },
      accepted: [...accepted],
      plan,
    })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">
        {plural(plan.rows.length, 'reviewSummaryOne', 'reviewSummaryOther', String(plan.rows.length), String(accepted.size))}
      </p>

      {(summary.createdFolders > 0 || summary.renamedFolders > 0) && (
        <p className="text-xs text-neutral-500">
          {plural(summary.createdFolders, 'reviewCreateFoldersOne', 'reviewCreateFoldersOther', String(summary.createdFolders))}
          {summary.renamedFolders > 0 && plural(summary.renamedFolders, 'reviewRenameFoldersOne', 'reviewRenameFoldersOther', String(summary.renamedFolders))}
          {t('reviewSummaryPeriod')}
        </p>
      )}

      {summary.renamedBookmarks > 0 && (
        <p className="text-xs text-neutral-500">
          {plural(summary.renamedBookmarks, 'reviewRenameBookmarksOne', 'reviewRenameBookmarksOther', String(summary.renamedBookmarks))}
        </p>
      )}

      {settings.removeEmptyFolders && (
        <p className="text-xs text-neutral-500">{t('reviewCleanNote')}</p>
      )}

      {plan.warnings.length > 0 && (
        <ul className="space-y-1 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {plan.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {plan.rows.length === 0 && (
        <p className="rounded border bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-500">
          {t('reviewEmpty')}
        </p>
      )}

      <div className="flex gap-1 text-xs">
        <button className="rounded border px-2 py-1 hover:bg-neutral-50" onClick={acceptAll}>{t('reviewAcceptAll')}</button>
        <button className="rounded border px-2 py-1 hover:bg-neutral-50" onClick={rejectAll}>{t('reviewRejectAll')}</button>
        {/* 两个筛选开关：只管看得见看不见，不碰 accepted，可以叠加 */}
        <button
          type="button"
          aria-pressed={modelOnly}
          className={`rounded border px-2 py-1 hover:bg-neutral-50 ${modelOnly ? 'border-neutral-800 bg-neutral-800 text-white' : ''}`}
          onClick={() => setModelOnly((prev) => !prev)}
        >
          {t('reviewFilterModelOnly')}
        </button>
        <button
          type="button"
          aria-pressed={markedOnly}
          className={`rounded border px-2 py-1 hover:bg-neutral-50 ${markedOnly ? 'border-neutral-800 bg-neutral-800 text-white' : ''}`}
          onClick={() => setMarkedOnly((prev) => !prev)}
        >
          {t('reviewFilterMarkedOnly')}
        </button>
        {/* 勾选无关的一项，靠 ml-auto 推到另一头，不跟左边几个混成一排 */}
        <button className="ml-auto rounded border px-2 py-1 text-neutral-500 hover:bg-neutral-50" onClick={exportPlan}>
          {t('reviewExportPlan')}
        </button>
      </div>

      {/* 两个筛选开关叠加把所有行筛没时不能直接留白——那读起来像「一条建议都没有」，
          而顶部摘要仍是非零总数，等于用沉默说了一件不成立的事。plan.rows.length > 0
          这个前置条件把它跟上面「这次真的没有建议」的 reviewEmpty 分开：那句话在
          没有任何筛选时也成立，这句只在筛选把本来存在的行藏起来时才成立，不能混。
          不把「筛掉了多少」写进来——按钮已经把话说完了，没必要让用户自己做减法。 */}
      {plan.rows.length > 0 && visibleGroups.length === 0 && (
        <div className="rounded border bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-500">
          <p>{t('reviewFilterEmpty')}</p>
          <button
            type="button"
            className="mt-2 rounded border px-2 py-1 hover:bg-white"
            onClick={() => {
              setModelOnly(false)
              setMarkedOnly(false)
            }}
          >
            {t('reviewFilterClear')}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {visibleGroups.map((group) => {
          const collapsed = collapsedOverride[group.key] ?? group.allRule
          return (
            <div key={group.key} className="space-y-1">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded bg-neutral-100 px-2 py-1 text-left text-xs font-medium hover:bg-neutral-200"
                onClick={() => toggleGroup(group)}
              >
                <span className="truncate">{group.label}</span>
                <span className="shrink-0 text-neutral-400">{t('reviewGroupCount', String(group.rows.length))}</span>
                {group.allRule && (
                  <span className="shrink-0 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700">{t('reviewGroupAllRule')}</span>
                )}
              </button>

              {!collapsed && (
                <ul className="space-y-1">
                  {group.rows.map((row) => (
                    <li key={row.bookmarkId} className="rounded border p-2 text-xs">
                      <div className="flex items-start gap-2">
                        <label className="flex flex-1 cursor-pointer items-start gap-2">
                          <input
                            type="checkbox"
                            aria-label={row.title}
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            checked={accepted.has(row.bookmarkId)}
                            onChange={() => toggleAccepted(row.bookmarkId)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium">{row.title}</span>
                              {row.confidence < MARK_CONFIDENCE && (
                                <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-700">{t('reviewMarked')}</span>
                              )}
                              <span className="ml-auto shrink-0 text-neutral-400">{Math.round(row.confidence * 100)}%</span>
                            </div>
                            {/* 目标路径已经是组标题，组内每条只用再交代它原来在哪，不重复目标——
                                重复的话会跟组标题撞出同一段文字，人扫起来也是噪音。 */}
                            <div className="mt-1 text-neutral-500">
                              <span className="line-through">{row.fromPath.join(' / ')}</span>
                            </div>
                            <div className="mt-0.5 text-neutral-400">{row.reason}</div>
                          </div>
                        </label>
                      </div>
                      {/* 下拉放在 label 外面：label 已经隐式关联了勾选框，选它内部若再塞一个
                          <select>，点下拉时那次点击会顺带把勾选框的点击也代发一遍
                          （label 找的是「第一个可关联控件」，不会因为点的是别的控件就放过）。
                          拒绝之外的第二条路：不满意这条建议，不必只能弃之不用，
                          可以当场改投到另一个候选目录——选了即改方案、自动勾上（见 setRowTarget）。 */}
                      <select
                        aria-label={t('reviewRetarget', row.title)}
                        className="mt-1 w-full rounded border px-1 py-0.5 text-neutral-700"
                        // 直接用 row.toCategoryId，不拿 toPath 反查候选——反查在推翻模式下
                        // 部分取消勾选、以及合并模式两种常见状态下都会落空，落空后浏览器会
                        // 退回第一个 option，下拉就会理直气壮地显示成另一个目录（见 I2）。
                        value={row.toCategoryId}
                        onChange={(e) => setRowTarget(row.bookmarkId, e.target.value)}
                      >
                        {plan.candidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>{candidate.path.join(' / ')}</option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {/* 末尾、默认折叠：这不是待办，用户不需要对它做任何操作，只需要知道整理盖到了多少——
          放前面会挤占真正要审的东西。三种原因分开列，是因为「已经在合适的目录里」是好消息，
          「没找到合适目录」与「这次没能分类」是两种完全不同的问题，不能混在同一条路上。
          这里的书签不带勾选框：给个勾选框会让用户以为能对它们做什么。 */}
      {plan.unchanged.length > 0 && (
        <div className="space-y-1">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded bg-neutral-100 px-2 py-1 text-left text-xs font-medium hover:bg-neutral-200"
            onClick={() => setUnchangedCollapsed((prev) => !prev)}
          >
            <span className="truncate">{t('reviewUnchangedTitle', String(plan.unchanged.length))}</span>
          </button>

          {!unchangedCollapsed && (
            <div className="space-y-2">
              {UNCHANGED_KINDS.map((kind) => {
                const rows = plan.unchanged.filter((row) => row.kind === kind)
                if (rows.length === 0) return null
                return (
                  <div key={kind} className="space-y-1">
                    <p className="text-[10px] font-medium text-neutral-500">{unchangedKindLabel(kind)}</p>
                    <ul className="space-y-1">
                      {rows.map((row) => (
                        <li key={row.bookmarkId} className="rounded border p-2 text-xs">
                          <div className="truncate font-medium">{row.title}</div>
                          <div className="mt-1 text-neutral-500">{row.currentPath.join(' / ')}</div>
                          {row.reason !== '' && <div className="mt-0.5 text-neutral-400">{row.reason}</div>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="sticky bottom-0 flex gap-2 bg-white pt-2">
        <button className="rounded border px-3 py-2 text-sm" onClick={reset}>{t('reviewDiscard')}</button>
        <button
          className="flex-1 rounded bg-neutral-800 py-2 text-sm text-white disabled:opacity-40"
          disabled={accepted.size === 0 || busy !== null}
          onClick={() => void apply()}
        >
          {plural(accepted.size, 'reviewApplyOne', 'reviewApplyOther', String(accepted.size))}
        </button>
      </div>
    </div>
  )
}
