/**
 * 这个侧栏文档的身份，进程内生成一次，之后每条发往后台的消息都带着它。
 *
 * 存在的理由是 Chrome 的侧栏每个窗口一个实例，而 service worker 只有一个：
 * 后台要能分清「这条进度该推给谁」「这次取消该掐哪一轮」（见 background/sessions.ts）。
 *
 * 模块级常量而不是每次现取：同一个侧栏必须自始至终是同一个 id，
 * 换了 id 就等于换了个人，正在跑的那一轮会认不出自己的取消请求。
 *
 * 不做持久化：id 的作用域就是这一个活着的侧栏文档。侧栏重开是新的一份，
 * 而那时后台那边旧的连接早已 onDisconnect 注销掉了。
 */
export const CLIENT_ID = createId()

function createId(): string {
  // crypto.randomUUID 在扩展页面里一定有（安全上下文）；留个兜底只是为了让
  // 单测里的极简环境不必为此造一个 crypto。
  const uuid = globalThis.crypto?.randomUUID
  if (uuid !== undefined) return globalThis.crypto.randomUUID()
  return `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}
