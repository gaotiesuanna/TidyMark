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
  const { step, busy, busyKind, error, progress, logs, cancel, settingsOpen, openSettings, closeSettings } =
    useStore()
  return (
    <div className="flex h-screen flex-col bg-white text-neutral-800">
      <header className="border-b px-4 py-3">
        {/* Chrome 侧栏顶部已经显示了图标和「TidyMark」，这里再写一遍是重复，还白占一行高度。
            但那个标题栏属于浏览器界面、不在本文档里，读屏用户在文档中导航时找不到它，
            所以只是视觉隐藏而非删除——保证这个页面至少还有一个 h1。 */}
        <h1 className="sr-only">TidyMark</h1>
        <div className="flex items-start justify-between gap-2">
          {/* 设置页里步骤条不该出现：设置不是第几步，显示出来会误导。这个位置改放返回，
              省得下面正文再占一行，也和右边的齿轮凑成同一行的一进一出。
              侧栏可以被拖得很窄，四个步骤一行放不下。不换行就会在标签中间断词
              （「1.」和「Scope」被拆成两行），所以让整条步骤条按项换行、项内不断词。 */}
          {settingsOpen ? (
            <button
              className="shrink-0 rounded border px-2 py-0.5 text-xs hover:bg-neutral-50"
              onClick={closeSettings}
            >
              {t('settingsBack')}
            </button>
          ) : (
            <ol className="flex min-w-0 flex-wrap gap-1 text-xs">
              {STEPS.map((each, i) => (
                <li
                  key={each.key}
                  className={
                    each.key === step
                      ? 'whitespace-nowrap rounded bg-neutral-800 px-2 py-0.5 text-white'
                      : 'whitespace-nowrap rounded bg-neutral-100 px-2 py-0.5 text-neutral-500'
                  }
                >
                  {i + 1}. {t(each.labelKey)}
                </li>
              ))}
            </ol>
          )}
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
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>
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
