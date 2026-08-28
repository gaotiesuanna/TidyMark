import { useState, type ReactNode } from 'react'
import { t } from '@/i18n'

/**
 * 一段默认收起的说明文字。
 *
 * 偏好页原本把三段灰色小字直接摊在「开始 AI 分析」上方，加起来比页面主体还长，
 * 而其中真正影响决定的只有各自的第一句——后面的编号规则、合并模式例外、权限
 * 措辞，都是读一次就够的东西，却每一轮都挡在按钮前面。
 *
 * 沿用 ProgressPanel 的 ▸/▾ 惯例，不另造一种展开样式：同一个侧栏里两种折叠
 * 长得不一样，用户要认两次。
 */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <dl className="border-t border-index-line text-xs leading-body">
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] border-b border-index-line">
        <dt>
          <button
            type="button"
            className="flex min-h-8 w-full items-center gap-1 px-2 text-left font-medium text-index-muted hover:text-index-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-index-blue"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <span aria-hidden className="shrink-0">{expanded ? '▾' : '▸'}</span>
            <span>{label}</span>
          </button>
        </dt>
        {expanded && (
          <dd className="min-w-0 border-l border-index-line px-2 py-2 text-index-muted">
            {children}
          </dd>
        )}
      </div>
    </dl>
  )
}

/** 折叠说明的默认标题，三处共用一句，不必各写各的。 */
export function detailLabel(): string {
  return t('prefsDetailToggle')
}
