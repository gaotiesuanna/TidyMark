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
    <div>
      <button
        className="flex items-center gap-1 text-left text-[11px] text-neutral-500 hover:text-neutral-800"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span aria-hidden className="shrink-0">{expanded ? '▾' : '▸'}</span>
        <span>{label}</span>
      </button>
      {expanded && (
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">{children}</p>
      )}
    </div>
  )
}

/** 折叠说明的默认标题，三处共用一句，不必各写各的。 */
export function detailLabel(): string {
  return t('prefsDetailToggle')
}
