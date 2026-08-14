import { useMemo } from 'react'
import { buildResultTree } from '@/core/resultTree'
import { currentLocale, plural, t } from '@/i18n'
import { ResultTree } from '../components/ResultTree'
import { joinTitles } from '../lib/listText'
import { useStore } from '../store'

export function ResultStep() {
  const { applyResult, undoResult, undoAvailable, undo, reset, busy, plan, tree: bookmarks } = useStore()
  // 用整理后重新读取的书签树，而不是从方案推导——未接受的书签仍在原处，
  // 只看方案会画出一棵与实际不符的树
  const tree = useMemo(() => {
    if (plan === null || applyResult === null) return []
    // 合并后源根已被删除，合并根又不在 scopeRootIds 里，不带上它结果树会是空的。
    // 撤销之后这两个 id 一起作废：源根是用新 id 重建的，合并根则被删掉了——
    // 只有 undoResult 手里那份新 id 还指得到东西，不接上，「撤销后的结构」
    // 会整块消失在刚被删过文件夹的人面前。
    const extraRootIds =
      undoResult !== null && undoResult.rebuiltRootIds.length > 0
        ? undoResult.rebuiltRootIds
        : applyResult.mergeRootId === null ? [] : [applyResult.mergeRootId]
    return buildResultTree(
      bookmarks,
      [...plan.scopeRootIds, ...extraRootIds],
      applyResult.createdFolderIds,
    )
  }, [bookmarks, plan, applyResult, undoResult])
  if (applyResult === null) return null

  const showTree = tree.length > 0
  // 合并流程会把源根本身清空后删除，那些 id 混在 removedFolders 里，
  // 但它们不是「清理空文件夹」的战果，是合并本身的必然结果——
  // 两者不加区分，用户会读到「NiceG 是个空文件夹被清理了」这种误导性描述。
  const mergedSourceIds = new Set(plan?.mergeRoot?.sourceRootIds ?? [])
  const cleanedEmptyFolders = applyResult.removedFolders.filter((folder) => !mergedSourceIds.has(folder.id))
  // 源目录只有真被删掉（子树被清空、进了 removedFolders）才能说"已删除"——
  // 用户在复核页取消勾选，源目录里还留着书签，它就没资格上这份名单，
  // 哪怕它在 sourceTitles 里。名单要报的是「实际发生了什么」，不是「打算合并谁」。
  const removedMergeSources = applyResult.removedFolders.filter((folder) => mergedSourceIds.has(folder.id))
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
          <dt className="text-neutral-500">{t('resultStatRemoved')}</dt><dd>{cleanedEmptyFolders.length}</dd>
          <dt className="text-neutral-500">{t('resultStatRenamed')}</dt><dd>{applyResult.renamedBookmarkIds.length}</dd>
          <dt className="text-neutral-500">{t('resultStatSkipped')}</dt><dd>{applyResult.skipped.length}</dd>
        </dl>
        {cleanedEmptyFolders.length > 0 && (
          <details className="mt-2 text-xs text-neutral-500">
            <summary className="cursor-pointer">{t('resultRemovedDetails')}</summary>
            <ul className="mt-1 space-y-0.5">
              {cleanedEmptyFolders.map((folder) => (
                <li key={folder.id}>{[...folder.path, folder.title].join(' / ')}</li>
              ))}
            </ul>
          </details>
        )}
        {/* 撤销已经把这些目录重建回来了，合并说明再讲"已合并/已删除"就是在骗用户——
           撤销结果区（undoResult !== null）接管了叙事，这里整段让路，
           与下面结果树标题按 undoResult 切换标题的做法是同一个道理。 */}
        {undoResult === null && plan !== null && plan.mergeRoot !== null && applyResult.mergeRootId !== null && (
          <div className="mt-2 text-xs text-neutral-500">
            {/* 个数取 sourceTitles.length，不用 scopeRootIds.length——后者是级联勾选的全集，会把子目录也算进去。
               这句说的是"这次合并涉及几个源目录"，是合并操作本身的规模，不是"删了几个"，
               所以哪怕下面那行一个源目录都没删掉，这个数字也不用跟着变。 */}
            <p>{t('resultMergedInto', String(plan.mergeRoot.sourceTitles.length), plan.mergeRoot.title)}</p>
            {/* 源目录去哪儿了不能语焉不详，但也不能说错——名单只能取真被删掉的那些
               （removedMergeSources，即 removedFolders 里属于源根的部分)。sourceTitles
               是"打算合并谁"，用户在复核页取消勾选会让某个源目录留着书签、根本没被删，
               直接把 sourceTitles 全量报成"已删除"就是结果树里明明还在的目录，说明区却说它没了。
               一个没删的都没有时，这行连带不渲染——没有"已删除：（空）"这种半吊子说法。 */}
            {removedMergeSources.length > 0 && (
              <p>
                {t(
                  'resultMergeSourcesRemoved',
                  joinTitles(removedMergeSources.map((folder) => folder.title), currentLocale()),
                )}
              </p>
            )}
          </div>
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
