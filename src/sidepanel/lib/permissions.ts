import { isLocalBaseUrl } from '@/llm/config'

/**
 * 把 baseUrl 拼成 Chrome 的 match pattern。地址填得不成形（还在敲一半）时返回 null。
 */
function hostPattern(baseUrl: string): string | null {
  try {
    return `${new URL(baseUrl).origin}/*`
  } catch {
    return null
  }
}

/**
 * 已经拿到这个域名的访问权了吗——只查，不申请。
 *
 * 单独有这一条，是因为「一次请求失败之后」也要问同一个问题，而那一刻已经没有用户手势了：
 * `chrome.permissions.request()` 在那里必然被拒，弹不弹得出来另说，弹出来也是骚扰。
 * 失败后的复查是 llm 层答不了的那一半——那一层零浏览器依赖，只能说「请求没发出去」，
 * 说不出「因为没授权」。
 *
 * 本地模型服务器直接答 true，理由与 ensureHostPermission 里那一大段完全相同。
 */
export async function hasHostPermission(baseUrl: string): Promise<boolean> {
  const origin = hostPattern(baseUrl)
  if (origin === null) return false
  if (isLocalBaseUrl(baseUrl)) return true
  return chrome.permissions.contains({ origins: [origin] })
}

/**
 * manifest 中不静态声明任何 host 权限，改为在真正要调用模型前，
 * 只申请用户填写的那一个域名。用户拒绝时返回 false，调用方给出提示而非静默失败。
 */
export async function ensureHostPermission(baseUrl: string): Promise<boolean> {
  const origin = hostPattern(baseUrl)
  if (origin === null) return false
  // 本地模型服务器（Ollama、LM Studio）直接放行，这一步在 hasHostPermission 里。
  //
  // 不是因为 manifest 没覆盖它——optional_host_permissions 里明明写着
  // 'http://localhost/*' 与 'http://127.0.0.1/*'（见 manifest.config.ts）。真实理由在
  // 上面拼出来的 origin 上：本地服务器都跑在 11434、1234 这类非默认端口上，拼出来的
  // 是 'http://localhost:11434/*'，而 Chrome 的 match pattern 里 host 这一段没有端口语法，
  // 这个模式非法，chrome.permissions.contains/request 拿到它会当场报错——而 analyze()
  // 那条路上没人接这个异常。
  //
  // 不要把这句读成「没有别的东西可申请」：申请 manifest 里那条 'http://localhost/*'
  // 本身完全合法。这里不申请它，是因为那等于把 localhost 上**所有端口**的访问权一次要走，
  // 而用户只填了一个端点。带端口的地址该怎么申请是同一个坑的通用形态（自建端点
  // https://host:8443 会真的崩在上面那行），单独记在票 35 里，不在这里就地解决。
  if (await hasHostPermission(baseUrl)) return true
  return chrome.permissions.request({ origins: [origin] })
}

/**
 * 申请「访问所有网站」。只有失效链接检查用得上它。
 *
 * 与 ensureHostPermission 分开是因为两者要的东西本质不同：那个只要用户填的
 * 那一个域名，这个要全部。Chrome 弹出来的字面是「读取你在所有网站上的数据」，
 * 是这个扩展至今最吓人的一次弹窗——所以调用方必须先解释再调它，
 * 而且用户不点那个按钮就永远不该走到这里。
 */
export async function ensureAllHostsPermission(): Promise<boolean> {
  const origins = ['https://*/*', 'http://*/*']
  if (await chrome.permissions.contains({ origins })) return true
  return chrome.permissions.request({ origins })
}
