import { useMemo } from 'react'
import { localDate } from '@/core/export'
import { MARK_CONFIDENCE, renumberPlan, summarize } from '@/core/plan'
import { plural, t } from '@/i18n'
import { downloadJson } from '../lib/download'
import { useStore } from '../store'

export function ReviewStep() {
  const { plan: rawPlan, accepted, toggleAccepted, acceptAll, acceptHighConfidence, rejectAll, apply, busy, reset, settings, scan } = useStore()
  // 显示的编号必须和真正会写进书签栏的一致，所以这里用同一个重排函数
  const plan = useMemo(
    () => (rawPlan === null ? null : renumberPlan(rawPlan, accepted, scan?.folders ?? [])),
    [rawPlan, accepted, scan],
  )
  const summary = useMemo(() => (plan === null ? null : summarize(plan, accepted)), [plan, accepted])
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
        <button className="rounded border px-2 py-1 hover:bg-neutral-50" onClick={() => acceptHighConfidence(MARK_CONFIDENCE)}>{t('reviewAcceptHigh')}</button>
        <button className="rounded border px-2 py-1 hover:bg-neutral-50" onClick={rejectAll}>{t('reviewRejectAll')}</button>
        {/* 勾选无关的一项，靠 ml-auto 推到另一头，不跟左边三个批量操作混成一排 */}
        <button className="ml-auto rounded border px-2 py-1 text-neutral-500 hover:bg-neutral-50" onClick={exportPlan}>
          {t('reviewExportPlan')}
        </button>
      </div>

      <ul className="space-y-1">
        {plan.rows.map((row) => (
          <li key={row.bookmarkId} className="rounded border p-2 text-xs">
            <label className="flex cursor-pointer items-start gap-2">
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
                    <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-700">{t('reviewLowConfidence')}</span>
                  )}
                  <span className="ml-auto shrink-0 text-neutral-400">{Math.round(row.confidence * 100)}%</span>
                </div>
                <div className="mt-1 text-neutral-500">
                  <span className="line-through">{row.fromPath.join(' / ')}</span>
                  <span className="mx-1">→</span>
                  <span className="text-neutral-800">{row.toPath.join(' / ')}</span>
                </div>
                <div className="mt-0.5 text-neutral-400">{row.reason}</div>
              </div>
            </label>
          </li>
        ))}
      </ul>

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
