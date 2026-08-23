/**
 * 判重用的追踪参数白名单。
 *
 * 只收「加上它页面内容一个字都不变」的那几个。故意做得很窄：白名单每宽一格，
 * 就多一类「两个不同页面被并成一组」的可能，而这一组的后果是永久删掉用户的书签。
 * `?id=123`、`?page=2` 这类改变内容的参数永远不进来。
 */
const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'ref', 'spm'])
const TRACKING_PREFIX = 'utm_'

/**
 * 判重用的 URL 归一化。只做三件事：剥 # 片段、剥末尾斜杠、剥追踪参数。
 *
 * 明确不做的三件事，每一件都有真实反例：
 * - 不统一 http/https：同一个 host 上两个协议可能是两个真实存在的不同站点；
 * - 不剥 www.：同上；
 * - 不剥白名单之外的参数：`?id=123` 一剥就把整个站的所有页面并成一条。
 *
 * 解析不了的输入（用户手改过的书签、`place:` 这类 Firefox 遗留）原样返回并去掉
 * 首尾空白——归一化后仍与自己相等，于是它只可能参与「完全相同」的分组，不会
 * 被拉进需要判断的那一档。
 */
export function normalizeUrl(raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return raw.trim()
  }

  parsed.hash = ''

  // 边遍历边删会漏掉相邻的同类项，先收键名再删
  const doomed = [...parsed.searchParams.keys()].filter((name) => {
    const lower = name.toLowerCase()
    return lower.startsWith(TRACKING_PREFIX) || TRACKING_PARAMS.has(lower)
  })
  for (const name of doomed) parsed.searchParams.delete(name)

  // 根路径那个斜杠留着：剥了 'https://a.com/' 会变成 'https://a.com'，
  // 而 URL 对这两种写法本来就归一成同一个 pathname='/'，多此一举还容易读错
  if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1)
  }

  return parsed.toString()
}

/**
 * 这个 URL 值不值得发一次网络请求。
 *
 * **只管网络检查，与判重无关**：两条 `chrome://extensions` 存了两遍同样是重复、
 * 该抓，判重那条路不问这个谓词。
 */
export function isCheckableUrl(raw: string): boolean {
  try {
    const protocol = new URL(raw).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
