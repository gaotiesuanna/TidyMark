/**
 * 看板「最近多久」的取值。
 *
 * 'all' 是不限，其余各自往回数一段。放在 core 里是因为界面和取数两边都要用同一套口径，
 * 而这一层不许碰浏览器 API。
 */
export type VisitWindow = 'all' | '1y' | '6m' | '3m'

/** 从宽到窄，界面按这个顺序摆。 */
export const VISIT_WINDOWS: readonly VisitWindow[] = ['all', '1y', '6m', '3m']

const DAY = 86400000

/** 按天数折算，不按自然月——「近三个月」问的是最近这一段有多活跃，不是账期。 */
const DAYS: Record<Exclude<VisitWindow, 'all'>, number> = { '1y': 365, '6m': 180, '3m': 90 }

/** 窗口起点（毫秒）。'all' 给 0——chrome.history.search 的 startTime 用 0 表示不限起点。 */
export function windowStart(range: VisitWindow, now: number): number {
  return range === 'all' ? 0 : now - DAYS[range] * DAY
}
