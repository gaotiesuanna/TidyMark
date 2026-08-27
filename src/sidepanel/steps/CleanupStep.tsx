import { useEffect, useMemo, useState } from 'react'
import { plural, t } from '@/i18n'
import { emptyAfterRemoval } from '@/core/cleanup'
import type { DuplicateGroup } from '@/core/duplicates'
import type { BookmarkItem } from '@/core/types'
import { StaleCleanupSection } from '../components/StaleCleanupSection'
import { ProgressPanel } from '../components/ProgressPanel'
import { useStore } from '../store'
/**
 * 一条待处理的书签摊开三样：标题、完整 URL、完整路径。
 * URL 刻意不截断——「可能相同」那档全靠它看出两条到底差在哪，截了这一档就没法审。
 */
function ItemLine({ item }: { item: BookmarkItem }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm leading-caption text-neutral-800">
        {item.title.trim() === '' ? item.url : item.title}
      </div>
      <div className="break-all text-xs leading-snug text-neutral-400">{item.url}</div>
      <div className="truncate text-xs text-neutral-400">/{item.currentPath.join('/')}/</div>
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

/** 结果页那两个并排的次要按钮：同宽、同高，谁也不比谁更像主操作。 */
const secondaryAction = [
  'cursor-pointer rounded-md border border-neutral-300 py-2 text-base leading-body text-neutral-700',
  'transition-colors duration-150 motion-reduce:transition-none',
  'hover:enabled:border-neutral-400 hover:enabled:bg-neutral-50',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1',
  'disabled:cursor-not-allowed disabled:opacity-40',
].join(' ')

type CleanupTab = 'stale' | 'duplicates' | 'links'

const CLEANUP_TABS: Array<{ key: CleanupTab; labelKey: Parameters<typeof t>[0] }> = [
  { key: 'stale', labelKey: 'cleanupTabStale' },
  { key: 'duplicates', labelKey: 'cleanupTabDuplicates' },
  { key: 'links', labelKey: 'cleanupTabLinks' },
]

/** 比顶栏模式切换小一号：同一种白片槽，高度和字号都收一档，避免两排分段控件抢视觉。 */
const subTabGroup = 'flex min-w-0 rounded-md bg-neutral-100 p-0.5 text-xs'
const subTabBase = [
  'inline-flex h-6 min-w-0 flex-1 cursor-pointer items-center justify-center rounded px-1 font-medium',
  'transition-colors duration-150 motion-reduce:transition-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
].join(' ')
const subTabOn = `${subTabBase} bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200`
const subTabOff = `${subTabBase} text-neutral-600 hover:text-neutral-800`

export function CleanupStep() {
  const {
    tree, cleanupScan, cleanupResult, cleanupChecked, cleanupFolders,
    cleanupLinks, linkCheckState, cleanupMove, cleanupStaleMove,
    startLinkCheck, toggleCleanupMove, toggleCleanupItem,
    busy, busyKind, progress, logs, cancel,
    undoAvailable, runCleanupScan, runCleanup, toggleCleanupFolder, undo,
  } = useStore()
  const [tab, setTab] = useState<CleanupTab>('stale')

  useEffect(() => { void runCleanupScan() }, [runCleanupScan])

  /**
   * 「腾空」= 删除 ∪ 移走。移进「失效链接」文件夹的书签同样腾空了原来的位置，
   * 少并这一半，预览会漏报一部分目录，用户执行完才发现多清了几个。
   */
  const vacated = useMemo(
    () => new Set([...cleanupChecked, ...cleanupMove, ...cleanupStaleMove]),
    [cleanupChecked, cleanupMove, cleanupStaleMove],
  )
  /**
   * 空目录这一节跟着上面的勾选实时变。直接显示 cleanupScan.emptyFolders 报的是删除
   * **前**的数字，跟实际清掉的对不上——用户勾掉一批重复项之后新变空的目录必须立刻
   * 显形，否则他执行完才发现多清了几个。
   */
  const willBeEmpty = useMemo(
    () => emptyAfterRemoval(tree, cleanupScan?.scopeRootIds ?? [], vacated),
    [tree, cleanupScan, vacated],
  )
  const alreadyEmpty = useMemo(
    () => new Set((cleanupScan?.emptyFolders ?? []).map((f) => f.id)),
    [cleanupScan],
  )

  if (cleanupResult !== null) {
    return (
      <div className="space-y-3 text-sm leading-caption">
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
        {/* 一句「清理完成」加一个撤销，是个只能后退的死胡同：想接着清、想收工，
            界面上都没有对应的那一下。三个出口按 AI 整理结果页同一套排法——
            两个次要的并排，主操作独占一行：结束清理才是绝大多数人这时候要点的东西。 */}
        <div className="space-y-2 pt-1">
          <div className="flex gap-2">
            <button
              className={`flex-1 ${secondaryAction}`}
              disabled={!undoAvailable || busy !== null}
              onClick={() => void undo()}
            >
              {t('cleanupUndoButton')}
            </button>
            {/* 再扫一遍而不是把刚才那份结果留着：书签已经变了，旧的预览连自己都不认得 */}
            <button
              className={`flex-1 ${secondaryAction}`}
              disabled={busy !== null}
              onClick={() => void runCleanupScan()}
            >
              {t('cleanupAgain')}
            </button>
          </div>
          {/* 侧栏本身是一个独立文档，关掉它就结束了本次清理（同 ResultStep 的「结束整理」） */}
          <button
            className="w-full cursor-pointer rounded-md bg-neutral-800 py-2 text-base leading-body font-medium text-white transition-colors duration-150 hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1 motion-reduce:transition-none"
            onClick={() => window.close()}
          >
            {t('cleanupFinish')}
          </button>
        </div>
      </div>
    )
  }

  // 扫描还没回来。进度由 Shell 里的 ProgressPanel 负责显示，这里不重复画一个转圈
  if (cleanupScan === null) return null

  const exact = cleanupScan.duplicates.filter((g) => g.kind === 'exact')
  const normalized = cleanupScan.duplicates.filter((g) => g.kind === 'normalized')
  const dead = cleanupLinks.filter((l) => l.verdict === 'dead')
  const suspect = cleanupLinks.filter((l) => l.verdict === 'suspect')
  const total = cleanupChecked.size + cleanupMove.size + cleanupStaleMove.size + cleanupFolders.size

  return (
    <div>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-neutral-500">{t('cleanupIntro')}</p>

        <div role="tablist" aria-label={t('cleanupTabListLabel')} className={subTabGroup}>
          {CLEANUP_TABS.map((each) => (
            <button
              key={each.key}
              type="button"
              role="tab"
              id={`cleanup-tab-${each.key}`}
              aria-controls={`cleanup-panel-${each.key}`}
              aria-selected={tab === each.key}
              className={tab === each.key ? subTabOn : subTabOff}
              onClick={() => setTab(each.key)}
            >
              {t(each.labelKey)}
            </button>
          ))}
        </div>

        {tab === 'stale' && (
          <div role="tabpanel" id="cleanup-panel-stale" aria-labelledby="cleanup-tab-stale">
            <StaleCleanupSection showHeading={false} />
          </div>
        )}

        {tab === 'duplicates' && (
          <div
            role="tabpanel"
            id="cleanup-panel-duplicates"
            aria-labelledby="cleanup-tab-duplicates"
            className="space-y-2"
          >
            {cleanupScan.duplicates.length === 0 ? (
              <p className="text-sm leading-caption text-neutral-500">{t('cleanupNothingFound')}</p>
            ) : (
              <>
                {exact.length > 0 && (
                  <>
                    <h3 className="text-xs text-neutral-500">{t('cleanupGroupExact')}</h3>
                    <ul className="space-y-2">
                      {exact.map((group) => <DuplicateGroupCard key={group.key} group={group} />)}
                    </ul>
                  </>
                )}

                {normalized.length > 0 && (
                  <>
                    <h3 className="text-xs text-neutral-500">{t('cleanupGroupNormalized')}</h3>
                    <p className="text-xs leading-relaxed text-neutral-400">
                      {t('cleanupGroupNormalizedHint')}
                    </p>
                    <ul className="space-y-2">
                      {normalized.map((group) => <DuplicateGroupCard key={group.key} group={group} />)}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'links' && (
          <div
            role="tabpanel"
            id="cleanup-panel-links"
            aria-labelledby="cleanup-tab-links"
            className="space-y-2"
          >
            {linkCheckState === 'idle' && (
              <>
                <p className="text-xs leading-relaxed text-neutral-500">{t('cleanupLinksExplain')}</p>
                <button
                  className="rounded-md border border-neutral-300 px-2.5 py-1 text-sm leading-caption hover:border-neutral-400 disabled:opacity-40"
                  disabled={busy !== null}
                  onClick={() => void startLinkCheck()}
                >
                  {t('cleanupLinksStart')}
                </button>
              </>
            )}

            {linkCheckState === 'denied' && (
              <p className="text-xs leading-relaxed text-neutral-500">{t('cleanupLinksDenied')}</p>
            )}

            {linkCheckState === 'done' && (
              <>
                {dead.length > 0 && (
                  <>
                    <h3 className="text-xs text-neutral-500">{t('cleanupGroupDead')}</h3>
                    <p className="text-xs leading-relaxed text-neutral-400">{t('cleanupDeadActionHint')}</p>
                    <ul className="space-y-1">
                      {dead.map((link) => (
                        <li key={link.bookmarkId} className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-0.5 shrink-0"
                            checked={cleanupChecked.has(link.bookmarkId)}
                            aria-label={`${t('cleanupDeadActionDelete')} ${link.url}`}
                            onChange={() => toggleCleanupItem(link.bookmarkId)}
                          />
                          <input
                            type="checkbox"
                            className="mt-0.5 shrink-0"
                            checked={cleanupMove.has(link.bookmarkId)}
                            aria-label={`${t('cleanupDeadActionMove')} ${link.url}`}
                            onChange={() => toggleCleanupMove(link.bookmarkId)}
                          />
                          <span className="min-w-0 break-all text-xs text-neutral-600">
                            {link.url}（{link.status}）
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {suspect.length > 0 && (
                  <>
                    <h3 className="text-xs text-neutral-500">{t('cleanupGroupSuspect')}</h3>
                    <p className="text-xs leading-relaxed text-neutral-400">{t('cleanupGroupSuspectHint')}</p>
                    <ul className="space-y-1">
                      {suspect.map((link) => (
                        <li key={link.bookmarkId} className="break-all text-xs text-neutral-500">
                          {link.url}（{link.status ?? link.errorKind}）
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {willBeEmpty.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm leading-caption font-medium text-neutral-700">{t('cleanupSectionEmpty')}</h2>
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
                    <span className="text-sm leading-caption text-neutral-800">{folder.title}</span>
                    {/* 本来就空的和「因为你的勾选才会变空的」是两件事，用户需要分得清 */}
                    {!alreadyEmpty.has(folder.id) && (
                      <span className="ml-1 text-xs text-neutral-400">
                        {t('cleanupWillBecomeEmpty')}
                      </span>
                    )}
                    <div className="truncate text-xs text-neutral-400">
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
          <p className="text-xs leading-relaxed text-amber-700">
            {t('cleanupOverwriteUndoWarning')}
          </p>
        )}
        <button
          className="w-full cursor-pointer rounded-md bg-neutral-800 py-2 text-base leading-body font-medium text-white hover:enabled:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={total === 0 || busy !== null}
          onClick={() => void runCleanup()}
        >
          {plural(total, 'cleanupRunOne', 'cleanupRunOther', String(total))}
        </button>
      </div>
      {(tab === 'duplicates' || busy !== null) && (
        <ProgressPanel
          busy={busy}
          progress={progress}
          logs={logs}
          {...(busyKind === 'checkLinks' ? { onCancel: () => void cancel() } : {})}
        />
      )}
    </div>
  )
}
