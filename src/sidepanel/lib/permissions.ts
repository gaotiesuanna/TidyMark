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
  // 本地地址（Ollama、LM Studio）不在 optional_host_permissions 覆盖范围内，直接放行
  if (new URL(baseUrl).hostname === 'localhost' || new URL(baseUrl).hostname === '127.0.0.1') {
    return true
  }
  if (await chrome.permissions.contains({ origins: [origin] })) return true
  return chrome.permissions.request({ origins: [origin] })
}
