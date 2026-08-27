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
  { key: 'dashboard', labelKey: 'shellModeDashboard' },
] as const
/** 分段控件：浅灰槽 + 内嵌白片。四项均分整行，不做成左簇右齿轮的第二标题栏——
    Chrome 侧栏顶栏已经是那个布局，再学一遍中间会空一截。 */
const tabGroup = 'flex min-w-0 flex-1 rounded-lg bg-neutral-100 p-0.5 text-sm leading-caption'
const tabBase = [
  'inline-flex h-7 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md px-2 font-medium',
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
    cleanupScan,
  } = useStore()
  return (
    <div className="flex h-screen flex-col bg-white text-neutral-800">
      <header className={settingsOpen ? 'border-b border-neutral-200 px-4 py-2.5' : 'px-4 py-2.5'}>
        {/* Chrome 侧栏顶部已经显示了图标和「TidyMark」，这里再写一遍是重复，还白占一行高度。
            但那个标题栏属于浏览器界面、不在本文档里，读屏用户在文档中导航时找不到它，
            所以只是视觉隐藏而非删除——保证这个页面至少还有一个 h1。 */}
        <h1 className="sr-only">TidyMark</h1>
        {/* 模式切换占满这一行、齿轮贴在槽右边。不要 justify-between：
            Chrome 顶栏已经是「左身份、右按钮」，再做一遍就是两条叠着的工具栏。
            齿轮仍跟模式同一行——单独占一行的话，清理模式下那行只剩一个 16px 图标。 */}
        <div className="flex items-center gap-2">
          {/* 四条平行的路，不是一条路上的几步——所以是并列的分段控件，不是步骤条里的第五格。
              塞进步骤条会让前四格点不动、第五格能点，用户第一次点错就学会「这条随便点」。
              忙的时候禁用：busy 是单槽，切过去也什么都干不了，还会让人以为切换失灵。 */}
          {settingsOpen ? (
            /* 设置不是第几步，步骤条显示出来会误导。返回和标题同一行：
               正文里再写一个「设置」会变成顶栏只剩返回、下面孤零零一个标题。 */
            <>
              <button
                className="-ml-2 inline-flex h-8 cursor-pointer items-center gap-1 rounded-md px-2 text-base leading-body text-neutral-600 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 motion-reduce:transition-none"
                onClick={closeSettings}
              >
                <ChevronLeftIcon className="h-3.5 w-3.5" />
                {t('settingsBack')}
              </button>
              <h2 className="text-base leading-body font-medium text-neutral-900">{t('settingsTitle')}</h2>
            </>
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
        {/* 步骤条是整理这条路上的进度，不是导航：往前跳不可能（没分析过就没有预览），
            往回退今天也只有「确认结构」那一步有专门的按钮。所以刻意不长成按钮——
            圆角加填充底色是按钮的视觉语言，会一直勾着人去点一个点不动的东西。

            侧栏窄、四个标签却必须铺满这一行：左对齐加点号分隔会在右侧留一块空白，
            看起来像没排完的面包屑。每项 flex-1 均分宽度，底下用一条轨道表示进度；
            min-w-min + nowrap 保证项内不断词，窄到一行放不下时按项折到下一行。

            当前步靠字重 + 深色轨道，不只靠颜色。分隔线放在步骤条上沿，
            把模式切换和流程进度分成两层。 */}
        {!settingsOpen && mode === 'organize' && (
          <ol className="-mx-4 mt-2 flex min-w-0 flex-wrap border-t border-neutral-200 px-4 pt-2 text-sm leading-caption">
            {STEPS.map((each, i) => {
              const current = each.key === step
              const passed = STEPS.findIndex((s) => s.key === step) > i
              return (
                <li key={each.key} className="flex min-w-min flex-1 flex-col items-center px-1">
                  <span
                    // 读屏靠它知道「现在在第几步」——字重与轨道传达不到那边
                    {...(current ? { 'aria-current': 'step' as const } : {})}
                    className={
                      'whitespace-nowrap ' +
                      (current
                        ? 'font-medium text-neutral-800'
                        : passed
                          ? 'text-neutral-600'
                          : 'text-neutral-400')
                    }
                  >
                    {i + 1}. {t(each.labelKey)}
                  </span>
                  <span
                    aria-hidden="true"
                    className={
                      'mt-1.5 h-0.5 w-full rounded-full ' +
                      (current ? 'bg-neutral-800' : passed ? 'bg-neutral-400' : 'bg-neutral-200')
                    }
                  />
                </li>
              )
            })}
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
            {children}
            {/* 清理扫描结果属于「重复收藏」那一格，由 CleanupStep 自己画。
                扫描还没回来时 CleanupStep 是 null，进度仍由这里顶上。 */}
            {(mode !== 'cleanup' || cleanupScan === null) && (
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
