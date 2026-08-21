import type { Locale } from '@/core/locale'
import type { LlmClient } from './client'

/**
 * 一次连通性自检的失败分类。
 *
 * 存在的理由是一次真实故障：用户报「正在分析…」失败在 `TypeError: Failed to fetch`，
 * 定位耗了十几轮对话，因为要分清的可能性有五个——Key 无效、模型名不对、host 权限
 * 没授到、代理/DNS 不通、别的扩展拦截。只报「失败了」等于没做，所以这个类型是这个
 * 功能的全部价值所在。
 *
 * 权限那一类不在这里：能不能访问某个域名要问 `chrome.permissions.contains`，
 * 那是浏览器的事，这一层零浏览器依赖，答不了。由调用方在失败之后复查权限覆盖。
 */
export type TestFailure =
  /** Key 不对或已失效（401/403）。 */
  | 'auth'
  /** 模型名不对（404，或 400 且响应体点名 model）。 */
  | 'model'
  /** 接口通了，但这个模型不会按要求的格式作答。 */
  | 'format'
  /** 其余一切：请求没发出去、代理不通、上游挂了、分不清。 */
  | 'network'

/**
 * 探针要模型回的最小结构。
 *
 * 只有一个布尔字段：验的是「会不会按 schema 作答」，不是「答了什么」，所以模型回
 * `{"ok": false}` 也算通过。字段少一分，弱的模型答对的机会就多一分——我们要区分的是
 * 「不会按格式答」和「答得不够好」，后者不该在这里被当成配置错误。
 */
export const PROBE_SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
}

/** 提示词按 locale 双语，理由同 prompts.ts：混进另一种语言会拉低输出质量。 */
function probePrompt(locale: Locale): string {
  return locale === 'zh_CN'
    ? '这是一次连通性自检。只输出 {"ok": true}，不要任何解释、不要 Markdown 代码块。'
    : 'This is a connectivity self-check. Output exactly {"ok": true} — no explanation, no Markdown code fences.'
}

/**
 * 从客户端拼出的消息里切出 HTTP 状态码和响应体。
 *
 * client.ts 的两种语言模板分别是「模型接口返回 $status$: $body$」和
 * 「Model API returned $status$: $body$」，只认这个位置上的数字——响应体里的数字
 * 不是状态码，整条消息里乱抓会抓错。
 */
function splitStatus(message: string): { status: number; body: string } | null {
  const matched = /(?:返回|returned)\s+(\d{3})\s*[:：]\s*([\s\S]*)$/.exec(message)
  if (matched === null) return null
  return { status: Number(matched[1]), body: matched[2] ?? '' }
}

/**
 * 把一条错误消息判成一类失败。
 *
 * 定的规矩是**宁可说笼统，不可说错**：分不清就落 'network'（那一类的文案本来就是
 * 「检查代理、VPN，或有没有别的扩展在拦」，对读的人无害），而说错一类会把人推去
 * 换 Key、改模型名，白费更多时间。
 */
export function classifyTestFailure(message: string): TestFailure {
  const http = splitStatus(message)
  if (http !== null) {
    // Key 不对，或这个 Key 没有用这个接口的权限
    if (http.status === 401 || http.status === 403) return 'auth'
    // 模型名不对：404 是「没有这个模型」
    if (http.status === 404) return 'model'
    // 400 的原因多得很（参数不合法、上下文超长……），只有响应体点名 model 时才敢说
    // 是模型名。这里必须只看响应体、不看整条消息——英文模板本身就以「Model API」开头，
    // 拿整条消息去匹配会把每一个英文 400 都说成模型名不对。
    if (http.status === 400 && /model/i.test(http.body)) return 'model'
    // 429、5xx 以及其余状态码：上游的事，不是这份配置的错，落笼统那一类
    return 'network'
  }
  // 接口通了、拿到响应了，但内容不是能用的结构化输出（client.ts 抛的这两条）
  if (/不是合法 JSON|did not return valid JSON|没有 content 字段|has no content field/i.test(message)) {
    return 'format'
  }
  // 没有状态码可读时才看关键词，而且只认这几个明确到不会有歧义的。有状态码时一律
  // 以状态码为准——500 的响应体里出现 unauthorized，说的是上游的上游，不是用户的 Key。
  if (/\bunauthorized\b|\binvalid[_ ]api[_ ]key\b/i.test(message)) return 'auth'
  return 'network'
}

/** 拿到的东西是不是我们要的那个形状。只认字段在不在、类型对不对，不问值是什么。 */
function isProbeShape(payload: unknown): boolean {
  return typeof payload === 'object'
    && payload !== null
    && typeof (payload as { ok?: unknown }).ok === 'boolean'
}

/**
 * 把 Key 从要返回的文本里剥掉。
 *
 * 必须在返回之前自己做，不能指望上游不拼——厂商的错误响应体原样回显 Authorization
 * 头或请求体是真实存在的行为，而这段文本会直接显示在设置页上。
 *
 * 空 Key（本机 Ollama 不校验 Key，那一栏就是空的）直接放行：按空串做替换会把整条
 * 消息炸成逐字符插入星号。
 */
function stripSecret(text: string, secret: string): string {
  const key = secret.trim()
  if (key === '') return text
  return text.split(key).join('***')
}

export type ProbeResult =
  | { ok: true; ms: number }
  | { ok: false; error: string; reason: TestFailure }

/**
 * 用真的客户端发一个最小 schema 的请求，验这份模型配置能不能用。
 *
 * 为什么不是裸 fetch 看 200：我们要的是**结构化输出**（json_schema → json_object →
 * none 三级降级，见 client.ts）。一个能回 200 但不会按 schema 作答的厂商，只看状态码
 * 会给出假绿灯，真跑照样废。
 *
 * `createClient` 收的是工厂而不是现成的客户端：这样构造客户端时万一抛错，也落在同一个
 * try 里，走同一条剥 Key 的出口。
 */
export async function probeModel(
  createClient: () => LlmClient,
  locale: Locale,
  apiKey: string,
  now: () => number = () => Date.now(),
): Promise<ProbeResult> {
  const startedAt = now()
  let payload: unknown
  try {
    payload = await createClient().complete(probePrompt(locale), PROBE_SCHEMA)
  } catch (error) {
    // LlmError 只有 message 和 retryable，没有状态码字段，所以分类只能读消息。
    // 取 message 而不是 String(error)：后者会带上「LlmError: 」前缀，那是给开发者看的。
    const raw = error instanceof Error ? error.message : String(error)
    const safe = stripSecret(raw, apiKey)
    // 分类读的是剥过的那份：Key 本身也可能长得像状态码或关键词
    return { ok: false, error: safe, reason: classifyTestFailure(safe) }
  }
  if (!isProbeShape(payload)) {
    const detail = JSON.stringify(payload) ?? String(payload)
    return {
      ok: false,
      error: stripSecret(
        locale === 'zh_CN'
          ? `模型答上来了，但没有按要求的格式作答：${detail.slice(0, 200)}`
          : `The model answered, but not in the required format: ${detail.slice(0, 200)}`,
        apiKey,
      ),
      reason: 'format',
    }
  }
  // now 可注入，钳到非负是防调用方传进一个会往回走的时钟（测试里常见），
  // 让「耗时」这个词永远说得通
  return { ok: true, ms: Math.max(0, now() - startedAt) }
}
