import type { ReactNode } from 'react'
import { useStore } from '../store'
import { ProgressPanel } from './ProgressPanel'

const STEPS = [
  { key: 'scope', label: '选范围' },
  { key: 'preferences', label: '设置' },
  { key: 'review', label: '预览' },
  { key: 'result', label: '结果' },
] as const

export function Shell({ children }: { children: ReactNode }) {
  const { step, busy, busyKind, error, progress, logs, cancel } = useStore()
  return (
    <div className="flex h-screen flex-col bg-white text-neutral-800">
      <header className="border-b px-4 py-3">
        <h1 className="text-base font-semibold">TidyMark</h1>
        <ol className="mt-2 flex gap-1 text-xs">
          {STEPS.map((each, i) => (
            <li
              key={each.key}
              className={
                each.key === step
                  ? 'rounded bg-neutral-800 px-2 py-0.5 text-white'
                  : 'rounded bg-neutral-100 px-2 py-0.5 text-neutral-500'
              }
            >
              {i + 1}. {each.label}
            </li>
          ))}
        </ol>
      </header>
      {error !== null && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>
      )}
      <main className="flex-1 overflow-y-auto p-4">
        {children}
        {/* 紧跟在当前步骤的操作按钮下方，让状态出现在点击的地方 */}
        <ProgressPanel
          busy={busy}
          progress={progress}
          logs={logs}
          {...(busyKind === 'analyze' ? { onCancel: () => void cancel() } : {})}
        />
      </main>
    </div>
  )
}
