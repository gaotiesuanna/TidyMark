export interface SanitizedUrl {
  domain: string
  /**
   * 域名带上端口，默认端口(:80/:443)不写。
   *
   * 看板按它聚合：一台机器上跑着两个项目时 `localhost` 是同一个域名，两套路由会叠成一棵读不懂的树，
   * 端口才是它们各自的身份。喂给模型的那条路仍旧只取 domain 与 path，这一栏不参与。
   */
  host: string
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

  // URL 已经把默认端口规整掉了，parsed.port 那时是空串。
  return { domain, host: parsed.port === '' ? domain : `${domain}:${parsed.port}`, path }
}
