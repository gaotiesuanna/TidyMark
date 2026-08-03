import { useMemo } from 'react'
import { buildResultTree } from '@/core/resultTree'
import { ResultTree } from '../components/ResultTree'
import { useStore } from '../store'

export function ResultStep() {
  const { applyResult, undoResult, undoAvailable, undo, reset, busy, plan, accepted } = useStore()
  const tree = useMemo(
    () => (plan === null ? [] : buildResultTree(plan, accepted)),
    [plan, accepted],
  )
  if (applyResult === null) return null

  // 撤销之后树里的结构已经不存在了，不再展示
  const showTree = tree.length > 0 && undoResult === null

  return (
    <div className="space-y-4 text-sm">
      <section className="rounded border p-3">
        <h2 className="mb-2 font-medium">
          {applyResult.status === 'completed' ? '整理完成' : '整理中断'}
        </h2>
        <dl className="grid grid-cols-2 gap-y-1 text-xs">
          <dt className="text-neutral-500">已执行操作</dt><dd>{applyResult.executed}</dd>
          <dt className="text-neutral-500">新建文件夹</dt><dd>{applyResult.createdFolderIds.length}</dd>
          <dt className="text-neutral-500">跳过</dt><dd>{applyResult.skipped.length}</dd>
        </dl>
        {applyResult.error !== null && (
          <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">
            在第 {(applyResult.failedAt ?? 0) + 1} 步失败：{applyResult.error}
            <br />已执行的部分可以通过下方按钮完整撤销。
          </p>
        )}
        {applyResult.skipped.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-neutral-500">
            {applyResult.skipped.map((each) => (
              <li key={each.bookmarkId}>书签 {each.bookmarkId}：{each.reason}</li>
            ))}
          </ul>
        )}
      </section>

      {showTree && (
        <section className="rounded border p-3">
          <h2 className="mb-1 font-medium">整理后的结构</h2>
          <p className="mb-2 text-xs text-neutral-500">
            {applyResult.status === 'completed'
              ? '右侧数字为该目录下本次归入的书签数。'
              : '整理在中途失败，以下是原计划的结构，实际只完成了前 ' + applyResult.executed + ' 步。'}
          </p>
          <ResultTree nodes={tree} />
        </section>
      )}

      {undoResult !== null && (
        <section className="rounded border border-green-200 bg-green-50 p-3 text-xs">
          <p>撤销完成：还原 {undoResult.restored} 项，删除新建文件夹 {undoResult.removedFolders} 个。</p>
          {undoResult.skipped.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-neutral-600">
              {undoResult.skipped.map((each) => (
                <li key={each.id}>{each.title}：{each.reason}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="flex gap-2">
        <button
          className="flex-1 rounded border border-red-300 py-2 text-sm text-red-700 disabled:opacity-40"
          disabled={!undoAvailable || busy !== null}
          onClick={() => void undo()}
        >
          撤销本次整理
        </button>
        <button className="flex-1 rounded bg-neutral-800 py-2 text-sm text-white" onClick={reset}>
          再整理一次
        </button>
      </div>
    </div>
  )
}
