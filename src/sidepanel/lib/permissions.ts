import { isLocalBaseUrl } from '@/llm/config'

/**
 * manifest 中不静态声明任何 host 权限，改为在真正要调用模型前，
 * 只申请用户填写的那一个域名。用户拒绝时返回 false，调用方给出提示而非静默失败。
 */
export async function ensureHostPermission(baseUrl: string): Promise<boolean> {
  let origin: string
  try {
    origin = `${new URL(baseUrl).origin}/*`
  } catch {
    return false
  }
  // 本地模型服务器（Ollama、LM Studio）直接放行。
  //
  // 不是因为 manifest 没覆盖它——optional_host_permissions 里明明写着
  // 'http://localhost/*' 与 'http://127.0.0.1/*'（见 manifest.config.ts）。真实理由在
  // 上面那行拼出来的 origin 上：本地服务器都跑在 11434、1234 这类非默认端口上，拼出来的
  // 是 'http://localhost:11434/*'，而 Chrome 的 match pattern 里 host 这一段没有端口语法，
  // 这个模式非法，chrome.permissions.contains/request 拿到它会当场报错——而 analyze()
  // 那条路上没人接这个异常。manifest 里那两条不带端口的写法本来就匹配任意端口，
  // 也就是说这里既没有别的东西可申请，也没有别的问法可用。
  if (isLocalBaseUrl(baseUrl)) {
    return true
  }
  if (await chrome.permissions.contains({ origins: [origin] })) return true
  return chrome.permissions.request({ origins: [origin] })
}
