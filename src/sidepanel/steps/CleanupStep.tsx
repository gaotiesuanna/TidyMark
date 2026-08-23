import { useEffect, useMemo } from 'react'
import { plural, t } from '@/i18n'
import { emptyAfterRemoval } from '@/core/cleanup'
import type { DuplicateGroup } from '@/core/duplicates'
import type { BookmarkItem } from '@/core/types'
import { useStore } from '../store'

/**
 * 一条待处理的书签摊开三样：标题、完整 URL、完整路径。
 * URL 刻意不截断——「可能相同」那档全靠它看出两条到底差在哪，截了这一档就没法审。
 */
function ItemLine({ item }: { item: BookmarkItem }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-xs text-neutral-800">
        {item.title.trim() === '' ? item.url : item.title}
      </div>
      <div className="break-all text-[11px] leading-snug text-neutral-400">{item.url}</div>
      <div className="truncate text-[11px] text-neutral-400">/{item.currentPath.join('/')}/</div>
    </div>
  )
}

/**
 * 一组重复项：单选决定留哪条，其余每条一个勾选框决定删不删。
 * 保留项自己的勾选框禁用——「既保留又删除」不是一个有意义的状态。
 */
function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
  const { cleanupKeep, cleanupChecked, setCleanupKeep, toggleCleanupItem } = useStore()
  const keepId = cleanupKeep[group.key] ?? group.keepId
  return (
    <li className="space-y-2 rounded-md border border-neutral-200 p-3">
      <ul className="space-y-2">
        {group.items.map((item) => (
          <li key={item.id} className="flex items-start gap-2">
            <input
              type="radio"
              className="mt-1 shrink-0"
              name={`keep-${group.key}`}
              checked={item.id === keepId}
              aria-label={`${t('cleanupKeepLabel')}：${item.url}`}
              onChange={() => setCleanupKeep(group.key, item.id)}
            />
            <input
              type="checkbox"
              className="mt-1 shrink-0"
              checked={cleanupChecked.has(item.id)}
              disabled={item.id === keepId}
              // 用标题给可访问名，与 ItemLine 显示的那一行同源；空标题回落到 URL。
              // 不用 URL 做名字：同一组里三条 URL 一模一样，读屏念出来三遍完全相同
              aria-label={`删除 ${item.title.trim() === '' ? item.url : item.title}`}
              onChange={() => toggleCleanupItem(item.id)}
            />
            <ItemLine item={item} />
          </li>
        ))}
      </ul>
    </li>
  )
}

export function CleanupStep() {
  const {
    tree, cleanupScan, cleanupResult, cleanupChecked, cleanupFolders,
    busy, undoAvailable, runCleanupScan, runCleanup, toggleCleanupFolder, undo,
  } = useStore()

  useEffect(() => { void runCleanupScan() }, [runCleanupScan])

  /**
   * 空目录这一节跟着上面的勾选实时变。直接显示 cleanupScan.emptyFolders 报的是删除
   * **前**的数字，跟实际清掉的对不上——用户勾掉一批重复项之后新变空的目录必须立刻
   * 显形，否则他执行完才发现多清了几个。
   *
   * 传进去的是「腾空」不是「删除」：第③节的「移走」同样腾空了原位置，
   * Task 8 接上那一节时要把 cleanupMove 一起并进来。
   */
  const willBeEmpty = useMemo(
    () => emptyAfterRemoval(tree, cleanupScan?.scopeRootIds ?? [], cleanupChecked),
    [tree, cleanupScan, cleanupChecked],
  )
  const alreadyEmpty = useMemo(
    () => new Set((cleanupScan?.emptyFolders ?? []).map((f) => f.id)),
    [cleanupScan],
  )

  if (cleanupResult !== null) {
    return (
      <div className="space-y-3 text-xs">
        <p className="font-medium text-neutral-800">
          {plural(
            cleanupResult.deleted,
            'cleanupDoneOne',
            'cleanupDoneOther',
            String(cleanupResult.deleted),
            String(cleanupResult.removedFolders.length),
          )}
        </p>
        {cleanupResult.skipped.length > 0 && (
          <ul className="space-y-1 text-neutral-500">
            {cleanupResult.skipped.map((each) => (
              <li key={each.bookmarkId}>
                {t('cleanupSkippedItem', each.bookmarkId, each.reason)}
              </li>
            ))}
          </ul>
        )}
        <button
          className="rounded-md border border-neutral-300 px-2.5 py-1 hover:border-neutral-400 disabled:opacity-40"
          disabled={!undoAvailable || busy !== null}
          onClick={() => void undo()}
        >
          {t('resultUndoButton')}
        </button>
      </div>
    )
  }

  // 扫描还没回来。进度由 Shell 里的 ProgressPanel 负责显示，这里不重复画一个转圈
  if (cleanupScan === null) return null

  const exact = cleanupScan.duplicates.filter((g) => g.kind === 'exact')
  const normalized = cleanupScan.duplicates.filter((g) => g.kind === 'normalized')
  const total = cleanupChecked.size + cleanupFolders.size
  const nothing = cleanupScan.duplicates.length === 0 && willBeEmpty.length === 0

  return (
    <div>
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-neutral-500">{t('cleanupIntro')}</p>

        {nothing && <p className="text-xs text-neutral-500">{t('cleanupNothingFound')}</p>}

        {cleanupScan.duplicates.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-medium text-neutral-700">{t('cleanupSectionDuplicates')}</h2>

            {exact.length > 0 && (
              <>
                <h3 className="text-[11px] text-neutral-500">{t('cleanupGroupExact')}</h3>
                <ul className="space-y-2">
                  {exact.map((group) => <DuplicateGroupCard key={group.key} group={group} />)}
                </ul>
              </>
            )}

            {normalized.length > 0 && (
              <>
                <h3 className="text-[11px] text-neutral-500">{t('cleanupGroupNormalized')}</h3>
                {/* 这一档默认一条都不勾，提示必须说清为什么，否则用户不知道该看什么 */}
                <p className="text-[11px] leading-relaxed text-neutral-400">
                  {t('cleanupGroupNormalizedHint')}
                </p>
                <ul className="space-y-2">
                  {normalized.map((group) => <DuplicateGroupCard key={group.key} group={group} />)}
                </ul>
              </>
            )}
          </section>
        )}

        {willBeEmpty.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-medium text-neutral-700">{t('cleanupSectionEmpty')}</h2>
            <ul className="space-y-1">
              {willBeEmpty.map((folder) => (
                <li key={folder.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0"
                    checked={cleanupFolders.has(folder.id)}
                    aria-label={folder.title}
                    onChange={() => toggleCleanupFolder(folder.id)}
                  />
                  <div className="min-w-0">
                    <span className="text-xs text-neutral-800">{folder.title}</span>
                    {/* 本来就空的和「因为你的勾选才会变空的」是两件事，用户需要分得清 */}
                    {!alreadyEmpty.has(folder.id) && (
                      <span className="ml-1 text-[11px] text-neutral-400">
                        {t('cleanupWillBecomeEmpty')}
                      </span>
                    )}
                    <div className="truncate text-[11px] text-neutral-400">
                      /{folder.path.join('/')}/
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* 吸底的负外边距与 pb-4 的用意见 ScopeStep.tsx 底部那一大段注释，此处照抄 */}
      <div className="sticky -bottom-4 -mx-4 -mb-4 mt-3 space-y-2 border-t border-neutral-200 bg-white px-4 pb-4 pt-3">
        {/* 撤销只有一个槽，清理会把上一次 AI 整理的快照覆盖掉。不静默覆盖 */}
        {undoAvailable && (
          <p className="text-[11px] leading-relaxed text-amber-700">
            {t('cleanupOverwriteUndoWarning')}
          </p>
        )}
        <button
          className="w-full cursor-pointer rounded-md bg-neutral-800 py-2 text-sm font-medium text-white hover:enabled:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={total === 0 || busy !== null}
          onClick={() => void runCleanup()}
        >
          {plural(total, 'cleanupRunOne', 'cleanupRunOther', String(total))}
        </button>
      </div>
    </div>
  )
}
