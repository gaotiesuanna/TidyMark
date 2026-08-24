import type { ReactNode } from 'react'
import { t } from '@/i18n'
import { useStore } from '../store'
import { AlertIcon, ChevronLeftIcon, SettingsIcon } from './icons'
import { ProgressPanel } from './ProgressPanel'
import { SettingsPanel } from './SettingsPanel'

const STEPS = [
  { key: 'scope', labelKey: 'shellStepScope' },
  { key: 'preferences', labelKey: 'shellStepPreferences' },
  { key: 'review', labelKey: 'shellStepReview' },
  { key: 'result', labelKey: 'shellStepResult' },
] as const

const MODES = [
  { key: 'organize', labelKey: 'shellModeOrganize' },
  { key: 'cleanup', labelKey: 'shellModeCleanup' },
  { key: 'transfer', labelKey: 'shellModeTransfer' },
] as const
/** 分段控件的外壳：浅灰槽 + 内嵌白片，白片浮起来的那一格就是当前模式。 */
const tabGroup = 'inline-flex min-w-0 flex-wrap rounded-lg bg-neutral-100 p-0.5 text-xs'
const tabBase = [
  'inline-flex h-7 cursor-pointer items-center justify-center rounded-md px-3 font-medium',
  'transition-colors duration-150 motion-reduce:transition-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
  'disabled:cursor-not-allowed disabled:opacity-40',
].join(' ')
// 未选中用 neutral-600 而不是更浅的一档：浅灰槽底上 neutral-500 只有 4.2:1，压线不够
const tabOn = `${tabBase} bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200`
const tabOff = `${tabBase} text-neutral-600 hover:enabled:text-neutral-900`

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
      <header className="border-b border-neutral-200 px-4 py-2.5">
        {/* Chrome 侧栏顶部已经显示了图标和「TidyMark」，这里再写一遍是重复，还白占一行高度。
            但那个标题栏属于浏览器界面、不在本文档里，读屏用户在文档中导航时找不到它，
            所以只是视觉隐藏而非删除——保证这个页面至少还有一个 h1。 */}
        <h1 className="sr-only">TidyMark</h1>
        {/* 第一行永远是「左边是身份、右边是出口」：模式切换（或设置页的返回）在左，齿轮在右。
            以前齿轮单独占第二行，清理模式下那行只剩它一个，孤零零地贴在左边缘——
            一整条横杠只为一个 16px 的图标而存在。合成一行后头部少一行高度，正文多一行。 */}
        <div className="flex items-center justify-between gap-2">
          {/* 三条平行的路，不是一条路上的几步——所以是并列的分段控件，不是步骤条里的第五格。
              塞进步骤条会让前四格点不动、第五格能点，用户第一次点错就学会「这条随便点」。
              忙的时候禁用：busy 是单槽，切过去也什么都干不了，还会让人以为切换失灵。 */}
          {settingsOpen ? (
            /* 设置页里这个位置改放返回：设置不是第几步，步骤条显示出来会误导。
               左指的箭头把「回到刚才那页」说清楚，光一个「返回」得靠读字才知道。 */
            <button
              className="-ml-2 inline-flex h-8 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-neutral-600 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 motion-reduce:transition-none"
              onClick={closeSettings}
            >
              <ChevronLeftIcon className="h-3.5 w-3.5" />
              {t('settingsBack')}
            </button>
          ) : (
            <div className={tabGroup} role="tablist">
              {MODES.map((each) => (
                <button
                  key={each.key}
                  role="tab"
                  aria-selected={mode === each.key}
                  disabled={busy !== null}
                  className={mode === each.key ? tabOn : tabOff}
                  onClick={() => setMode(each.key)}
                >
                  {t(each.labelKey)}
                </button>
              ))}
            </div>
          )}
          {/* 设置页里不再重复一个齿轮：那时左边的返回才是这一行的操作，
              一个点了没反应的入口只会让人怀疑自己没点中 */}
          {!settingsOpen && (
            <button
              className="-mr-1 shrink-0 cursor-pointer rounded-md p-2 text-neutral-500 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 motion-reduce:transition-none"
              aria-label={t('settingsGearLabel')}
              onClick={openSettings}
            >
              <SettingsIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        {/* 侧栏可以被拖得很窄，四个步骤一行放不下。不换行就会在标签中间断词
            （「1.」和「Scope」被拆成两行），所以让整条步骤条按项换行、项内不断词。

            步骤条是只读的进度指示，不是导航：往前跳不可能（没分析过就没有预览），
            往回退今天也只有「确认结构」那一步有专门的按钮。所以刻意不长成按钮的样子——
            圆角加填充底色是按钮的视觉语言，会一直勾着人去点一个点不动的东西。 */}
        {!settingsOpen && mode === 'organize' && (
          <ol className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
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
        )}
      </header>
      {/* 设置页里这条红条让位：它讲的是刚才那轮整理/清理出了什么事，跟正在改的设置无关，
          跟到设置页来只会挡住正文，「重试」还会在用户正配模型的时候把分析重新拉起来。
          错误本身没清掉——点「返回」回到那一步，它照样在，重试也照样能点。

          role="alert" 让读屏在错误出现的那一刻就念出来——它是动态插进来的，
          不宣告的话，看不见红色的人要等到自己 Tab 到这里才知道刚才失败了 */}
      {!settingsOpen && error !== null && (
        <div
          role="alert"
          className="flex items-start gap-2.5 border-b border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"
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
            {children}
            {/* 紧跟在当前步骤的操作按钮下方，让状态出现在点击的地方 */}
            <ProgressPanel
              busy={busy}
              progress={progress}
              logs={logs}
              {...(busyKind === 'analyze' || busyKind === 'checkLinks' ? { onCancel: () => void cancel() } : {})}
            />
          </>
        )}
      </main>
    </div>
  )
}
