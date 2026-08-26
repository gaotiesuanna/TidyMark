import { useEffect, useRef, useState } from 'react'
import { PHASE_LABELS } from '@/background/events'
import { plural, t } from '@/i18n'
import type { LogLine, Progress } from '../store'

interface Props {
  busy: string | null
  progress: Progress | null
  logs: LogLine[]
  /** 传入时显示取消按钮；只有可中断的步骤才传。 */
  onCancel?: () => void
}

const LEVEL_CLASS = {
  info: 'text-neutral-500',
  warn: 'text-amber-700',
  error: 'text-red-700',
} as const

export function ProgressPanel({ busy, progress, logs, onCancel }: Props) {
  const [expanded, setExpanded] = useState(false)
  const autoExpanded = useRef(false)
  const bottom = useRef<HTMLDivElement>(null)

  const hasError = logs.some((line) => line.level === 'error')
  // 出错时自动展开一次，之后仍尊重用户的手动折叠
  useEffect(() => {
    if (hasError && !autoExpanded.current) {
      autoExpanded.current = true
      setExpanded(true)
    }
    if (!hasError) autoExpanded.current = false
  }, [hasError])

  useEffect(() => {
    // jsdom 里没有 scrollIntoView
    if (expanded) bottom.current?.scrollIntoView?.({ block: 'nearest' })
  }, [expanded, logs])

  if (busy === null && logs.length === 0) return null

  const latest = logs[logs.length - 1]
  const percent =
    progress !== null && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : null

  return (
    <div role="status" className="mt-3 rounded border bg-neutral-50 p-2 text-xs">
      {busy !== null && (
        <div className="flex items-center gap-2 text-neutral-600">
          <span
            aria-hidden
            className="h-3 w-3 shrink-0 animate-spin rounded-full border border-neutral-300 border-t-neutral-600"
          />
          <span>{busy}</span>
          {progress !== null && progress.total > 0 && (
            <span className="ml-auto shrink-0 text-neutral-500">
              {t(PHASE_LABELS[progress.phase])} {progress.done}/{progress.total}
            </span>
          )}
          {onCancel !== undefined && (
            <button
              className={`shrink-0 rounded border px-2 py-0.5 text-neutral-600 hover:bg-white ${
                progress !== null && progress.total > 0 ? '' : 'ml-auto'
              }`}
              onClick={onCancel}
            >
              {t('progressCancel')}
            </button>
          )}
        </div>
      )}

      {percent !== null && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded bg-neutral-200">
          <div className="h-full bg-neutral-600 transition-all" style={{ width: `${percent}%` }} />
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-2">
          <button
            className="flex w-full items-center gap-1 text-left text-neutral-500 hover:text-neutral-800"
            aria-expanded={expanded}
            aria-label={expanded ? t('progressLogsCollapse') : t('progressLogsExpand')}
            onClick={() => setExpanded(!expanded)}
          >
            <span aria-hidden className="shrink-0">{expanded ? '▾' : '▸'}</span>
            {expanded ? (
              <span>{plural(logs.length, 'progressLogsTitleOne', 'progressLogsTitleOther', String(logs.length))}</span>
            ) : (
              <span className={`truncate ${LEVEL_CLASS[latest!.level]}`}>{latest!.message}</span>
            )}
          </button>

          {expanded && (
            <ul className="mt-1 max-h-64 space-y-0.5 overflow-y-auto">
              {logs.map((line) => (
                <li key={line.id} className={`whitespace-pre-wrap break-all ${LEVEL_CLASS[line.level]}`}>
                  <span className="text-neutral-400">[{t(PHASE_LABELS[line.phase])}] </span>
                  {line.message}
                </li>
              ))}
              <div ref={bottom} />
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
