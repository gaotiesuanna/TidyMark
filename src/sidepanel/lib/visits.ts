import type { WeightedUrl } from '@/core/domains'
import { windowStart, type VisitWindow } from '@/core/visitWindow'

const HISTORY: chrome.permissions.Permissions = { permissions: ['history'] }

/** 只查不申请。切到「访问」那一格时先问这个，没有权限就停在解释文案上。 */
export async function hasHistoryPermission(): Promise<boolean> {
  return chrome.permissions.contains(HISTORY)
}

/**
 * 申请浏览记录权限。必须由按钮点击触发——chrome.permissions.request()
 * 要用户手势，而且 Chrome 弹出来的字面是「读取您的浏览记录」，
 * 调用方必须先解释再调它。
 */
export async function ensureHistoryPermission(): Promise<boolean> {
  return chrome.permissions.request(HISTORY)
}

/** 同时在飞的 getVisits 数。逐条问会慢得没法看，一次全放出去又会把消息通道堵死。 */
const VISIT_LOOKUP_CONCURRENCY = 24

/**
 * 把浏览记录收成带权重的 URL。
 * Chrome 的 search 没有「全部」口子，10000 是它愿意给的上限附近。
 *
 * 限了时间窗就不能用 search 给的 visitCount——startTime 只筛「哪些 URL 在窗内被碰过」，
 * 它带回来的次数仍是有史以来的总数。一个两年前刷了五百次、上个月只开过一次的站，
 * 照 visitCount 排会稳坐第一，那正是这个筛子要拆掉的东西。所以逐条问 getVisits，
 * 自己数窗内的时间戳。窗内一次都没有的丢掉。
 */
export async function visitUrls(
  range: VisitWindow = 'all',
  now = Date.now(),
): Promise<WeightedUrl[]> {
  const startTime = windowStart(range, now)
  const items = await chrome.history.search({ text: '', maxResults: 10000, startTime })
  const found = items.flatMap((item) =>
    item.url === undefined
      ? []
      : [{ url: item.url, weight: item.visitCount ?? 1, title: item.title }],
  )
  if (range === 'all') return found

  const counted = await mapPooled(found, VISIT_LOOKUP_CONCURRENCY, async (item) => ({
    ...item,
    weight: await countVisitsSince(item.url, startTime),
  }))
  return counted.filter((item) => item.weight > 0)
}

/** 某个地址在 startTime 之后被打开过几次。问不到就当零——少算一条好过整张看板崩掉。 */
async function countVisitsSince(url: string, startTime: number): Promise<number> {
  try {
    const visits = await chrome.history.getVisits({ url })
    return visits.filter((visit) => (visit.visitTime ?? 0) >= startTime).length
  } catch {
    return 0
  }
}

/** 按固定并发跑一遍，保持输入顺序。 */
async function mapPooled<In, Out>(
  items: readonly In[],
  concurrency: number,
  run: (item: In) => Promise<Out>,
): Promise<Out[]> {
  const out = new Array<Out>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next
      next += 1
      out[i] = await run(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return out
}
