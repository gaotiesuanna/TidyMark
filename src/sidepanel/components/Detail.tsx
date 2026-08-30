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
 *
 * `flush` 供「本身已经在一张描边卡片里」的位置用：卡片自己用 divide-y 画行间线，
 * 这里再画一条自己的上下边，两条会挨在一起变成双线；行内边距也跟着卡片的 px-3 走，
 * 否则同一张卡里复选框和 ▸ 会差 4px，一眼能看出没对齐。
 */
export function Detail({
  label,
  flush = false,
  children,
}: {
  label: string
  flush?: boolean
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const pad = flush ? 'px-3' : 'px-2'
  return (
    <dl className={`${flush ? '' : 'border-t border-index-line'} text-xs leading-body`}>
      <div className={`grid grid-cols-[5rem_minmax(0,1fr)] ${flush ? '' : 'border-b border-index-line'}`}>
        <dt>
          <button
            type="button"
            className={`flex min-h-8 w-full items-center gap-1 ${pad} text-left font-medium text-index-muted transition-colors duration-150 hover:text-index-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-index-blue motion-reduce:transition-none`}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <span aria-hidden className="shrink-0">{expanded ? '▾' : '▸'}</span>
            <span>{label}</span>
          </button>
        </dt>
        {expanded && (
          <dd className={`min-w-0 border-l border-index-line py-2 ${pad} text-index-muted`}>
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
