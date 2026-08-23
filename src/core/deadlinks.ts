export type LinkVerdict = 'dead' | 'suspect' | 'alive'

/** 请求根本没拿到状态码时的两种收场。两种都归「可疑」，从不判死。 */
export type LinkErrorKind = 'timeout' | 'network'

/**
 * 状态码 → 判定。
 *
 * 只有 404 与 410 判死：这两个是服务器明说「这里没有东西，而且不是临时的」。
 * 其余一切降级成「可疑」，界面默认不勾、只展示不删。降级的具体理由见测试里那段注释。
 *
 * 这个函数**不发请求**，判定规则因此能被逐条覆盖——混在 fetch 循环里就测不动了。
 */
export function classifyStatus(status: number): LinkVerdict {
  if (status === 404 || status === 410) return 'dead'
  if (status >= 200 && status < 400) return 'alive'
  return 'suspect'
}

/** 服务器不认 HEAD 的两种说法。碰上就对同一个 URL 补一次 GET。 */
export function needsGetFallback(status: number): boolean {
  return status === 405 || status === 501
}

/** 拿不到状态码时一律可疑：站可能没了，也可能只是用户此刻在坐地铁。 */
export function classifyError(_kind: LinkErrorKind): LinkVerdict {
  return 'suspect'
}
