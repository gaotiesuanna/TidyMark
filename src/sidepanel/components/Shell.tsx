import type { ReactNode } from 'react'
import { t } from '@/i18n'
import { useStore, type AppMode, type Step } from '../store'
import { AlertIcon, ChevronLeftIcon } from './icons'
import { IndexNavigation, type IndexNavigationItem } from './IndexNavigation'
import { ProgressPanel } from './ProgressPanel'
import { SettingsPanel } from './SettingsPanel'
import { StepIndex, type StepIndexItem } from './StepIndex'

function navigationItems(): readonly IndexNavigationItem<AppMode>[] {
  return [
    { key: 'organize', label: t('shellModeOrganize'), shortLabel: t('shellModeOrganizeShort') },
    { key: 'cleanup', label: t('shellModeCleanup'), shortLabel: t('shellModeCleanupShort') },
    { key: 'transfer', label: t('shellModeTransfer'), shortLabel: t('shellModeTransferShort') },
    { key: 'dashboard', label: t('shellModeDashboard'), shortLabel: t('shellModeDashboardShort') },
  ]
}

function stepItems(): readonly StepIndexItem<Step>[] {
  return [
    { key: 'scope', label: t('shellStepScope') },
    { key: 'preferences', label: t('shellStepPreferences') },
    { key: 'structure', label: t('shellStepStructure') },
    { key: 'review', label: t('shellStepReview') },
    { key: 'result', label: t('shellStepResult') },
  ]
}

export function Shell({ children, organizeContent }: { children: ReactNode; organizeContent?: ReactNode }) {
  const {
    step,
    mode,
    setMode,
    busy,
    busyKind,
    error,
    retryable,
    retry,
    progress,
    logs,
    cancel,
    settingsOpen,
    openSettings,
    closeSettings,
    cleanupScan,
  } = useStore()
  return (
    <div className="flex h-screen flex-col bg-white text-neutral-800">
      <header className={settingsOpen ? 'border-b border-index-line' : ''}>
        {/* Chrome 侧栏顶部已经显示了图标和「Reshelve」，这里再写一遍是重复，还白占一行高度。
            但那个标题栏属于浏览器界面、不在本文档里，读屏用户在文档中导航时找不到它，
            所以只是视觉隐藏而非删除——保证这个页面至少还有一个 h1。 */}
        <h1 className="sr-only">Reshelve</h1>
        {/* 模式切换占满这一行、齿轮贴在索引栏右边。不要 justify-between：
            Chrome 顶栏已经是「左身份、右按钮」，再做一遍就是两条叠着的工具栏。
            齿轮仍跟模式同一行——单独占一行的话，清理模式下那行只剩一个 16px 图标。 */}
        <div>
          {/* 四条平行的路，不是一条路上的几步——所以是并列的顶部索引标签，不是步骤条里的第五格。
              塞进步骤条会让前四格点不动、第五格能点，用户第一次点错就学会「这条随便点」。
              忙的时候禁用：busy 是单槽，切过去也什么都干不了，还会让人以为切换失灵。 */}
          {settingsOpen ? (
            /* 设置不是第几步，步骤条显示出来会误导。返回和标题同一行：
               正文里再写一个「设置」会变成顶栏只剩返回、下面孤零零一个标题。 */
            <div className="flex min-h-index-row items-center gap-2 px-3">
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1 px-1 text-sm leading-body text-index-muted transition-colors duration-150 hover:text-index-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-index-blue motion-reduce:transition-none"
                onClick={closeSettings}
              >
                <ChevronLeftIcon className="h-3.5 w-3.5" />
                {t('settingsBack')}
              </button>
              <span aria-hidden className="h-4 border-l border-index-line" />
              <h2 className="text-sm leading-body font-semibold text-index-ink">{t('settingsTitle')}</h2>
            </div>
          ) : (
            <IndexNavigation
              items={navigationItems()}
              activeKey={mode}
              disabled={busy !== null}
              settingsLabel={t('settingsGearLabel')}
              onSelect={setMode}
              onOpenSettings={openSettings}
            />
          )}
        </div>
      </header>
      {/* 设置页里这条红条让位：它讲的是刚才那轮整理/清理出了什么事，跟正在改的设置无关，
          跟到设置页来只会挡住正文，「重试」还会在用户正配模型的时候把分析重新拉起来。
          错误本身没清掉——点「返回」回到那一步，它照样在，重试也照样能点。

          role="alert" 让读屏在错误出现的那一刻就念出来——它是动态插进来的，
          不宣告的话，看不见红色的人要等到自己 Tab 到这里才知道刚才失败了 */}
      {!settingsOpen && error !== null && (
        <div
          role="alert"
          className="flex items-start gap-2.5 border-b border-red-200 bg-red-50 px-4 py-3 text-sm leading-caption text-red-700"
        >
          <AlertIcon className="mt-px h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="leading-relaxed">{error}</p>
            {/* 按钮放在红条里：出错时用户唯一在看的就是这条，不该让他自己去页底找「开始 AI 分析」。
                摆在正文下面而不是右上角——错误话长的时候会折成三四行，那个「重试」会孤零零地
                浮在第一行的右边，读到最后一行的人根本不会回头去找它。 */}
            {retryable !== null && (
              <button
                className="inline-flex h-7 cursor-pointer items-center rounded-md border border-red-300 bg-white px-2.5 font-medium text-red-700 transition-colors duration-150 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1 motion-reduce:transition-none"
                onClick={() => void retry()}
              >
                {t('errRetry')}
              </button>
            )}
          </div>
        </div>
      )}
      <main className="flex-1 overflow-y-auto p-4">
        {settingsOpen ? <SettingsPanel /> : (
          <>
            {mode === 'organize' ? (
              <StepIndex items={stepItems()} currentKey={step}>{organizeContent ?? children}</StepIndex>
            ) : children}
            {/* 清理扫描结果属于「重复收藏」那一格，由 CleanupStep 自己画。
                扫描还没回来时 CleanupStep 是 null，进度仍由这里顶上。
                看板和浏览书签不接这根管子——切过去还挂着「扫描完成：2 组重复」，
                等于别的页在替清理页说话。 */}
            {(mode === 'organize' || (mode === 'cleanup' && cleanupScan === null)) && (
              <ProgressPanel
                busy={busy}
                progress={progress}
                logs={logs}
                {...(busyKind === 'analyze' || busyKind === 'checkLinks' ? { onCancel: () => void cancel() } : {})}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}
