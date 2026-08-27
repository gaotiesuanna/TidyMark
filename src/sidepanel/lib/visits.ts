import type { WeightedUrl } from '@/core/domains'

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

/**
 * 把浏览记录收成带权重的 URL。visitCount 缺省当 1。
 * Chrome 的 search 没有「全部」口子，10000 是它愿意给的上限附近。
 */
export async function visitUrls(): Promise<WeightedUrl[]> {
  const items = await chrome.history.search({ text: '', maxResults: 10000, startTime: 0 })
  const out: WeightedUrl[] = []
  for (const item of items) {
    if (item.url === undefined) continue
    out.push({ url: item.url, weight: item.visitCount ?? 1 })
  }
  return out
}
