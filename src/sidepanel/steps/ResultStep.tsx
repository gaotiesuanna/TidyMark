import { useMemo } from 'react'
import { buildResultTree } from '@/core/resultTree'
import { plural, t } from '@/i18n'
import { ResultTree } from '../components/ResultTree'
import { useStore } from '../store'

export function ResultStep() {
  const { applyResult, undoResult, undoAvailable, undo, reset, busy, plan, tree: bookmarks } = useStore()
  // 用整理后重新读取的书签树，而不是从方案推导——未接受的书签仍在原处，
  // 只看方案会画出一棵与实际不符的树
  const tree = useMemo(
    () =>
      plan === null || applyResult === null
        ? []
        : buildResultTree(bookmarks, plan.scopeRootIds, applyResult.createdFolderIds),
    [bookmarks, plan, applyResult],
  )
  if (applyResult === null) return null

  const showTree = tree.length > 0
  // 侧栏本身是一个独立文档，关掉它就结束了本次整理；
  // 状态不必手动清，下次打开是全新的页面。
  const finish = (): void => window.close()

  return (
    <div className="space-y-4 text-sm">
      <section className="rounded border p-3">
        <h2 className="mb-2 font-medium">
          {applyResult.status === 'completed' ? t('resultCompleted') : t('resultInterrupted')}
        </h2>
        <dl className="grid grid-cols-2 gap-y-1 text-xs">
          <dt className="text-neutral-500">{t('resultStatExecuted')}</dt><dd>{applyResult.executed}</dd>
          <dt className="text-neutral-500">{t('resultStatCreated')}</dt><dd>{applyResult.createdFolderIds.length}</dd>
          <dt className="text-neutral-500">{t('resultStatRemoved')}</dt><dd>{applyResult.removedFolders.length}</dd>
          <dt className="text-neutral-500">{t('resultStatRenamed')}</dt><dd>{applyResult.renamedBookmarkIds.length}</dd>
          <dt className="text-neutral-500">{t('resultStatSkipped')}</dt><dd>{applyResult.skipped.length}</dd>
        </dl>
        {applyResult.removedFolders.length > 0 && (
          <details className="mt-2 text-xs text-neutral-500">
            <summary className="cursor-pointer">{t('resultRemovedDetails')}</summary>
            <ul className="mt-1 space-y-0.5">
              {applyResult.removedFolders.map((folder) => (
                <li key={folder.id}>{[...folder.path, folder.title].join(' / ')}</li>
              ))}
            </ul>
          </details>
        )}
        {applyResult.error !== null && (
          <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">
            {t('resultFailedAt', String((applyResult.failedAt ?? 0) + 1), applyResult.error ?? '')}
            <br />{t('resultFailedHint')}
          </p>
        )}
        {applyResult.skipped.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-neutral-500">
            {applyResult.skipped.map((each) => (
              <li key={each.bookmarkId}>{t('resultSkippedItem', each.bookmarkId, each.reason)}</li>
            ))}
          </ul>
        )}
      </section>

      {showTree && (
        <section className="rounded border p-3">
          <h2 className="mb-1 font-medium">
            {undoResult === null ? t('resultTreeAfterApply') : t('resultTreeAfterUndo')}
          </h2>
          <p className="mb-2 text-xs text-neutral-500">
            {t('resultTreeHint')}
          </p>
          <ResultTree nodes={tree} />
        </section>
      )}

      {undoResult !== null && (
        <section className="rounded border border-green-200 bg-green-50 p-3 text-xs">
          <p>{plural(undoResult.restored, 'resultUndoneOne', 'resultUndoneOther', String(undoResult.restored), String(undoResult.removedFolders))}</p>
          {undoResult.skipped.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-neutral-600">
              {undoResult.skipped.map((each) => (
                <li key={each.id}>{t('resultUndoneSkippedItem', each.title, each.reason)}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="space-y-2">
        <div className="flex gap-2">
          <button
            className="flex-1 rounded border border-red-300 py-2 text-sm text-red-700 disabled:opacity-40"
            disabled={!undoAvailable || busy !== null}
            onClick={() => void undo()}
          >
            {t('resultUndoButton')}
          </button>
          <button
            className="flex-1 rounded border py-2 text-sm hover:bg-neutral-50"
            onClick={reset}
          >
            {t('resultAgain')}
          </button>
        </div>
        <button
          className="w-full rounded bg-neutral-800 py-2 text-sm text-white"
          onClick={finish}
        >
          {t('resultFinish')}
        </button>
      </div>
    </div>
  )
}
