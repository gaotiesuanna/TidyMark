import { useMemo } from 'react'
import { LOW_CONFIDENCE, renumberPlan, summarize } from '@/core/plan'
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

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">
        共 {plan.rows.length} 条移动建议，已选中 {accepted.size} 条。未选中的书签保持原位。
      </p>

      {(summary.createdFolders > 0 || summary.renamedFolders > 0) && (
        <p className="text-xs text-neutral-500">
          将新建 {summary.createdFolders} 个目录
          {summary.renamedFolders > 0 && (
            <>，并给 {summary.renamedFolders} 个已有目录加上编号前缀（可一键撤销）</>
          )}
          。
        </p>
      )}

      {settings.removeEmptyFolders && (
        <p className="text-xs text-neutral-500">整理后会清理范围内的空文件夹（可撤销）。</p>
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
          AI 认为所选范围内的书签都已在合适的位置，没有需要移动的。
          可以试试换一个更乱的文件夹，或开启「推翻现有文件夹结构」重新设计目录。
        </p>
      )}

      <div className="flex gap-1 text-xs">
        <button className="rounded border px-2 py-1 hover:bg-neutral-50" onClick={acceptAll}>全部接受</button>
        <button className="rounded border px-2 py-1 hover:bg-neutral-50" onClick={() => acceptHighConfidence(LOW_CONFIDENCE)}>仅高置信度</button>
        <button className="rounded border px-2 py-1 hover:bg-neutral-50" onClick={rejectAll}>全部拒绝</button>
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
                  {row.confidence < LOW_CONFIDENCE && (
                    <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-700">低置信度</span>
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
        <button className="rounded border px-3 py-2 text-sm" onClick={reset}>放弃</button>
        <button
          className="flex-1 rounded bg-neutral-800 py-2 text-sm text-white disabled:opacity-40"
          disabled={accepted.size === 0 || busy !== null}
          onClick={() => void apply()}
        >
          应用 {accepted.size} 项修改
        </button>
      </div>
    </div>
  )
}
