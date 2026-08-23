import type { ReactNode } from 'react'
import { t } from '@/i18n'
import { useStore } from '../store'
import { SettingsIcon } from './icons'
import { ProgressPanel } from './ProgressPanel'
import { SettingsPanel } from './SettingsPanel'

const STEPS = [
  { key: 'scope', labelKey: 'shellStepScope' },
  { key: 'preferences', labelKey: 'shellStepPreferences' },
  { key: 'review', labelKey: 'shellStepReview' },
  { key: 'result', labelKey: 'shellStepResult' },
] as const

export function Shell({ children }: { children: ReactNode }) {
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
  } = useStore()
  return (
    <div className="flex h-screen flex-col bg-white text-neutral-800">
      <header className="border-b px-4 py-3">
        {/* Chrome 侧栏顶部已经显示了图标和「TidyMark」，这里再写一遍是重复，还白占一行高度。
            但那个标题栏属于浏览器界面、不在本文档里，读屏用户在文档中导航时找不到它，
            所以只是视觉隐藏而非删除——保证这个页面至少还有一个 h1。 */}
        <h1 className="sr-only">TidyMark</h1>
        {/* 两条平行的路，不是一条路上的两步——所以是并列按钮，不是步骤条里的第五格。
            塞进步骤条会让前四格点不动、第五格能点，用户第一次点错就学会「这条随便点」。
            忙的时候禁用：busy 是单槽，切过去也什么都干不了，还会让人以为切换失灵。 */}
        {!settingsOpen && (
          <div className="mb-2 flex gap-1 text-xs" role="tablist">
            {(['organize', 'cleanup'] as const).map((each) => (
              <button
                key={each}
                role="tab"
                aria-selected={mode === each}
                disabled={busy !== null}
                className={
                  mode === each
                    ? 'rounded-md bg-neutral-800 px-2.5 py-1 font-medium text-white disabled:opacity-40'
                    : 'rounded-md border border-neutral-200 px-2.5 py-1 text-neutral-600 hover:border-neutral-400 disabled:opacity-40'
                }
                onClick={() => setMode(each)}
              >
                {t(each === 'organize' ? 'shellModeOrganize' : 'shellModeCleanup')}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-start justify-between gap-2">
          {/* 设置页里步骤条不该出现：设置不是第几步，显示出来会误导。这个位置改放返回，
              省得下面正文再占一行，也和右边的齿轮凑成同一行的一进一出。
              侧栏可以被拖得很窄，四个步骤一行放不下。不换行就会在标签中间断词
              （「1.」和「Scope」被拆成两行），所以让整条步骤条按项换行、项内不断词。

              步骤条是只读的进度指示，不是导航：往前跳不可能（没分析过就没有预览），
              往回退今天也只有「确认结构」那一步有专门的按钮。所以刻意不长成按钮的样子——
              圆角加填充底色是按钮的视觉语言，会一直勾着人去点一个点不动的东西。 */}
          {settingsOpen ? (
            <button
              className="shrink-0 rounded border px-2 py-0.5 text-xs hover:bg-neutral-50"
              onClick={closeSettings}
            >
              {t('settingsBack')}
            </button>
          ) : mode === 'organize' ? (
            <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              {STEPS.map((each, i) => (
                <li key={each.key} className="flex items-center gap-x-2 whitespace-nowrap">
                  {/* 分隔点只是视觉上的断句，读屏念出来是噪音 */}
                  {i > 0 && <span aria-hidden="true" className="text-neutral-300">·</span>}
                  <span
                    // 读屏靠它知道「现在在第几步」——视觉上的加粗与下划线传达不到那边
                    {...(each.key === step ? { 'aria-current': 'step' as const } : {})}
                    className={
                      each.key === step
                        ? 'font-medium text-neutral-800 underline underline-offset-4'
                        : 'text-neutral-400'
                    }
                  >
                    {i + 1}. {t(each.labelKey)}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          <button
            className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
            aria-label={t('settingsGearLabel')}
            onClick={openSettings}
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
      </header>
      {error !== null && (
        <div className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          <span className="flex-1">{error}</span>
          {/* 按钮放在红条里：出错时用户唯一在看的就是这条，不该让他自己去页底找「开始 AI 分析」 */}
          {retryable !== null && (
            <button className="shrink-0 underline hover:no-underline" onClick={() => void retry()}>
              {t('errRetry')}
            </button>
          )}
        </div>
      )}
      <main className="flex-1 overflow-y-auto p-4">
        {settingsOpen ? <SettingsPanel /> : (
          <>
            {children}
            {/* 紧跟在当前步骤的操作按钮下方，让状态出现在点击的地方 */}
            <ProgressPanel
              busy={busy}
              progress={progress}
              logs={logs}
              {...(busyKind === 'analyze' ? { onCancel: () => void cancel() } : {})}
            />
          </>
        )}
      </main>
    </div>
  )
}
