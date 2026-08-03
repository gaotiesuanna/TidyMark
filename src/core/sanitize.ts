export interface SanitizedUrl {
  domain: string
  path: string
}

/**
 * 提取可安全发送给模型的 URL 片段。
 * 永远丢弃 query、fragment、用户名与密码。
 */
export function sanitizeUrl(raw: string): SanitizedUrl | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  const domain = parsed.hostname.toLowerCase().replace(/^www\./, '')
  if (domain === '') return null

  let path = parsed.pathname
  if (path.length > 1) path = path.replace(/\/+$/, '')
  if (path === '') path = '/'

  return { domain, path }
}
