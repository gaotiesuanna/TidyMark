import { useMemo } from 'react'
import { buildResultTree } from '@/core/resultTree'
import { currentLocale, plural, t } from '@/i18n'
import { ResultTree } from '../components/ResultTree'
import { joinTitles } from '../lib/listText'
import { useStore } from '../store'
import { IndexSection } from '../components/IndexSection'
import { InlineStatus } from '../components/InlineStatus'
import { PageHeader } from '../components/PageHeader'
import { DangerButton, PrimaryButton, SecondaryButton, StickyActionBar } from '../components/IndexControls'

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
    // 不传任何排序开关：这棵树是整理后重新读回的真实树，照原样显示就是「真实结构」。
    // 推翻模式下 sortFolders 已经把编号序落进了书签栏，读回来本就是编号序
    return buildResultTree(bookmarks, [...plan.scopeRootIds, ...extraRootIds], applyResult.createdFolderIds)
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
    <div className="text-base leading-body">
      <PageHeader title={t('shellStepResult')} />

      <div className="mt-3">
        <InlineStatus tone={applyResult.status === 'completed' ? 'success' : 'warning'}>
          {applyResult.status === 'completed' ? t('resultCompleted') : t('resultInterrupted')}
        </InlineStatus>
      </div>

      <div data-testid="result-section" data-index="01">
        <IndexSection index="01" title={t('resultStatExecuted')} count={applyResult.executed}>
        <dl className="grid grid-cols-2 gap-y-1 text-sm leading-caption">
          <dt className="text-index-muted">{t('resultStatExecuted')}</dt><dd>{applyResult.executed}</dd>
          <dt className="text-index-muted">{t('resultStatCreated')}</dt><dd>{applyResult.createdFolderIds.length}</dd>
          <dt className="text-index-muted">{t('resultStatRemoved')}</dt><dd>{cleanedEmptyFolders.length}</dd>
          <dt className="text-index-muted">{t('resultStatRenamed')}</dt><dd>{applyResult.renamedBookmarkIds.length}</dd>
          <dt className="text-index-muted">{t('resultStatSkipped')}</dt><dd>{applyResult.skipped.length}</dd>
        </dl>
        {cleanedEmptyFolders.length > 0 && (
          <details className="mt-2 border-t border-index-line pt-2 text-sm leading-caption text-index-muted">
            <summary className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-index-blue">{t('resultRemovedDetails')}</summary>
            <ul className="mt-1 border-l border-index-line pl-3">
              {cleanedEmptyFolders.map((folder) => (
                <li key={folder.id} className="break-words [overflow-wrap:anywhere]">{[...folder.path, folder.title].join(' / ')}</li>
              ))}
            </ul>
          </details>
        )}
        {/* 撤销已经把这些目录重建回来了，合并说明再讲"已合并/已删除"就是在骗用户——
           撤销结果区（undoResult !== null）接管了叙事，这里整段让路，
           与下面结果树标题按 undoResult 切换标题的做法是同一个道理。 */}
        {undoResult === null && plan !== null && plan.mergeRoot !== null && applyResult.mergeRootId !== null && (
          <div className="mt-2 border-t border-index-line pt-2 text-sm leading-caption text-index-muted">
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
          <div className="mt-2">
            <InlineStatus tone="error" live="assertive" title={t('resultFailedAt', String((applyResult.failedAt ?? 0) + 1), applyResult.error ?? '')}>
              {t('resultFailedHint')}
            </InlineStatus>
          </div>
        )}
        {applyResult.skipped.length > 0 && (
          <div className="mt-2">
            <InlineStatus tone="warning">
              <ul className="space-y-0.5">
                {applyResult.skipped.map((each) => (
                  <li key={each.bookmarkId}>{t('resultSkippedItem', each.bookmarkId, each.reason)}</li>
                ))}
              </ul>
            </InlineStatus>
          </div>
        )}
        </IndexSection>
      </div>

      {showTree && (
        <section className="border-b border-index-line py-3">
          <h2 className="font-medium text-index-ink">
            {undoResult === null ? t('resultTreeAfterApply') : t('resultTreeAfterUndo')}
          </h2>
          <p className="mb-2 mt-1 text-sm leading-caption text-index-muted">
            {t('resultTreeHint')}
          </p>
          <ResultTree nodes={tree} />
        </section>
      )}

      {undoResult !== null && (
        <div className="mt-3">
          <InlineStatus tone="success">
            <p>{plural(undoResult.restored, 'resultUndoneOne', 'resultUndoneOther', String(undoResult.restored), String(undoResult.removedFolders))}</p>
            {undoResult.skipped.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {undoResult.skipped.map((each) => (
                  <li key={each.id}>{t('resultUndoneSkippedItem', each.title, each.reason)}</li>
                ))}
              </ul>
            )}
          </InlineStatus>
        </div>
      )}

      <StickyActionBar>
        <div className="space-y-2">
        <div className="flex gap-2">
          <DangerButton
            className="flex-1"
            disabled={!undoAvailable || busy !== null}
            onClick={() => void undo()}
          >
            {t('resultUndoButton')}
          </DangerButton>
          <SecondaryButton className="flex-1" onClick={reset}>
            {t('resultAgain')}
          </SecondaryButton>
        </div>
        <PrimaryButton className="w-full" onClick={finish}>
          {t('resultFinish')}
        </PrimaryButton>
        </div>
      </StickyActionBar>
    </div>
  )
}
