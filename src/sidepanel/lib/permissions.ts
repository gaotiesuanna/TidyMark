import { isLocalBaseUrl } from '@/llm/config'

/**
 * 把 baseUrl 拼成 Chrome 的 match pattern。地址填得不成形（还在敲一半）时返回 null。
 *
 * **端口必须丢掉，不能用 URL.origin。** Chrome 的 match pattern 里 host 那一段没有
 * 端口语法，`https://proxy.example.com:8443/*` 是个非法模式，
 * `chrome.permissions.contains/request` 拿到它当场抛 Invalid value for origins[0]。
 * 而 README 明确把「自建代理」列为支持的路径，自建代理十有八九带端口——
 * 用 origin 拼，这条路径是必炸的，而且炸得不响：见下面两个函数的 catch。
 *
 * 丢掉端口的代价是拿到的权限比「就这一个 origin」宽——是这个主机上**所有端口**的
 * 访问权。这不是我们挑的粒度，是 Chrome 能表达的最细粒度，要么这样要么申请不了。
 * 域名仍旧只有用户填的那一个，README 那句「只申请你填的那个域名」一字不改。
 */
function hostPattern(baseUrl: string): string | null {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return null
  }
  // 只有 http/https 有对应的 match pattern。别的协议（file:、chrome-extension: …）
  // 拼出来同样非法，在这里答 null 比留给 chrome 去抛干净。
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname === '') return null
  return `${url.protocol}//${url.hostname}/*`
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
  // contains 抛出来一律当「没这个权限」。它实际只有一种失败原因——模式非法
  // （hostPattern 已经挡掉了已知的那几种，剩下的是 IPv6 字面量这类没预料到的），
  // 而那一刻「拿不到这个权限」就是正确答案。
  //
  // 关键是**不能让它穿出去**：analyze() 里这一步在 set({ busy }) 之前，异常穿出去
  // 的结果是点了「开始 AI 分析」界面一动不动；testModel() 里它在
  // settle({ state: 'running' }) 之后，结果是测试按钮永远转下去。答 false 的话，
  // 两处各自现成的分支会给出「授权失败，可重试」，用户至少知道发生了什么。
  try {
    return await chrome.permissions.contains({ origins: [origin] })
  } catch {
    return false
  }
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
  // 曾经的第一条理由是「本地服务器跑在 11434 这类非默认端口上，拼出来的模式非法」——
  // 那条理由已经不成立了：hostPattern 现在丢端口，拼出的是 'http://localhost/*'，
  // 与 manifest 的 optional_host_permissions 里写的那条一字不差，完全合法。
  //
  // 留着这个短路是为了剩下的那条理由：申请它等于把 localhost 上**所有端口**的访问权
  // 一次要走，而用户只填了一个端点。远端主机现在也是这个粒度（见 hostPattern），
  // 差别在于 localhost 上跑着的东西比某个远端主机上的多得多，那一次弹窗要的也就更多。
  //
  // 未解的一半：短路意味着本地端点**永远拿不到 host 权限**，后台 worker 那次
  // fetch 于是只能靠模型服务器自己的 CORS 头放行（Ollama 要 OLLAMA_ORIGINS 配上
  // chrome-extension:// 才认）。这条与本次「带端口的端点会静默炸掉」是两件事，
  // 不在这里顺手改——改了会动到今天能用的那批本地用户。
  if (await hasHostPermission(baseUrl)) return true
  // request 与 contains 同理：模式非法时抛出来，而这里答 false 正好落在调用方
  // 现成的「用户拒绝了」分支上，文案与真被拒绝时一致，都是「授权失败，可重试」。
  try {
    return await chrome.permissions.request({ origins: [origin] })
  } catch {
    return false
  }
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
