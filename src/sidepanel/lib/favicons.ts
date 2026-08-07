/**
 * 取书签的 favicon，供 HTML 导出写进 <A> 的 ICON 属性。
 *
 * 走的是 MV3 的 chrome-extension://<id>/_favicon/ 端点（需要 manifest 里的
 * favicon 权限）——它读的是 Chrome 本地已缓存的图标，不发外部网络请求，
 * 因此既不会把用户的书签清单送给第三方，也不会在导出时卡在网络上。
 */

/** 16 是书签栏的实际显示尺寸，取 32 让导出的文件在高分屏上也不糊。 */
const SIZE = 32

/**
 * _favicon/ 是本地读取，但一次几千条仍要限流：
 * 不设上限的话几千个 fetch 与随后的 FileReader 会同时压在侧栏这一个渲染进程上。
 */
const CONCURRENCY = 12

/**
 * 查不到图标时 _favicon/ 不会 404，而是回一张兜底的灰地球——
 * 直接收下的话导出的每条「没有图标的书签」都会带上同一张假图标。
 * 所以先拿一个不可能存在的域名探一次，把兜底图标的内容记下来当指纹排除掉。
 * .invalid 是 RFC 2606 保留的顶级域，永远不会被解析，也就永远不可能有真图标。
 */
const PROBE_URL = 'https://tidymark-favicon-probe.invalid/'

function endpoint(pageUrl: string): string {
  const url = new URL(chrome.runtime.getURL('/_favicon/'))
  url.searchParams.set('pageUrl', pageUrl)
  url.searchParams.set('size', String(SIZE))
  return url.toString()
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

/** 单条失败一律返回 null 由调用方跳过——导出不该因为一个图标取不到就整个失败。 */
async function fetchIcon(pageUrl: string): Promise<string | null> {
  try {
    const response = await fetch(endpoint(pageUrl))
    if (!response.ok) return null
    return await toDataUrl(await response.blob())
  } catch {
    return null
  }
}

/** 只有 http/https 会被 Chrome 记进 favicon 库，其余协议连查都不用查。 */
function lookupable(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

/** 固定大小的工作池：worker 数量封顶，每个 worker 循环认领下一个下标。 */
async function pooled<T>(items: string[], work: (item: string) => Promise<T>): Promise<T[]> {
  const results: T[] = new Array<T>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
  return results
}

/**
 * 返回 URL → data URL 的映射，取不到图标的 URL 直接不出现在 map 里，
 * 让 toHtmlExport 那边「缺项 = 不写 ICON 属性」的判断保持简单。
 */
export async function loadFavicons(urls: string[]): Promise<Map<string, string>> {
  // 书签库里同一个站会出现很多遍，去重后再查
  const unique = [...new Set(urls.filter(lookupable))]
  const icons = new Map<string, string>()
  if (unique.length === 0) return icons

  const fallback = await fetchIcon(PROBE_URL)
  const fetched = await pooled(unique, fetchIcon)
  unique.forEach((url, index) => {
    const icon = fetched[index]
    if (icon !== null && icon !== undefined && icon !== fallback) icons.set(url, icon)
  })
  return icons
}
