import type { Locale } from '@/core/locale'

export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export class LlmError extends Error {
  readonly retryable: boolean
  /**
   * 输出被截断（模型没写完就到了 max_tokens）。
   *
   * 与 retryable 分开两个字段，因为收场方式正相反：retryable 是「原样再问一次」，
   * 截断原样再问只会再截断一次，得把这一批拆小了问（见 llm/tags.ts 的 ask）。
   */
  readonly truncated: boolean
  constructor(message: string, retryable: boolean, truncated = false) {
    super(message)
    this.name = 'LlmError'
    this.retryable = retryable
    this.truncated = truncated
  }
}

export interface LlmClient {
  complete(prompt: string, schema: object, signal?: AbortSignal): Promise<unknown>
}

/**
 * 结构化输出的实现方式，按能力从强到弱排列。
 * 并非所有 OpenAI 兼容厂商都支持 json_schema，有些连 response_format 都不认，
 * 遇到 400 就沿着这条链逐级降级。
 */
const MODES = ['json_schema', 'json_object', 'none'] as const
type StructuredMode = (typeof MODES)[number]

/**
 * 从模型输出里截出那段 JSON，并告诉调用方括号有没有闭合。
 *
 * 按层级配平着扫，不是找「最后一个右括号」：
 * - 老写法有条快路径，文本以 `{` 开头就原样返回，于是「先给 JSON、末尾再补一句
 *   解释」这种输出一个字都不修，直接喂给 JSON.parse 报错；
 * - 而那句解释里但凡带一个 `}`，找最后一个右括号也会把它一并圈进来。
 * 字符串内部的括号与转义引号都要跳过，否则 `{"a":"}"}` 会在半路就判定闭合。
 *
 * `closed` 为 false 表示扫到头也没回到 0 层——输出被砍断时正是这个形状，
 * 用来在厂商不给 finish_reason 时兜底判定截断。
 */
function sliceJson(content: string): { text: string; closed: boolean } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content)
  const text = (fenced?.[1] ?? content).trim()
  const start = text.search(/[{[]/)
  if (start < 0) return { text, closed: false }

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return { text: text.slice(start, i + 1), closed: true }
    }
  }
  return { text: text.slice(start), closed: false }
}

/** 去掉模型可能加上的 Markdown 代码块或前后废话，取出其中的 JSON。 */
export function extractJson(content: string): string {
  return sliceJson(content).text
}

/**
 * 出问题的 content 怎么放进错误信息。
 *
 * 只留头部（老写法的 slice(0, 200)）等于把唯一有诊断价值的地方扔了：截断也好、
 * 末尾拖了一句解释也好，破绽全在尾巴上，而头部永远是一段合法 JSON，看着毫无问题。
 * 所以头尾都留，只省略中间，并把省掉多少字说出来。
 */
const KEEP = 200

function headAndTail(content: string, locale: Locale): string {
  if (content.length <= KEEP * 2) return content
  const omitted = content.length - KEEP * 2
  const middle =
    locale === 'zh_CN' ? ` …（中间省略 ${omitted} 字）… ` : ` …(${omitted} chars omitted)… `
  return content.slice(0, KEEP) + middle + content.slice(-KEEP)
}

/**
 * 只支持 json_object 的厂商（如 DeepSeek）无法约束输出形状，
 * 因此把 schema 直接写进提示词。调用方本来就会校验并丢弃非法字段。
 *
 * 这段格式指令会拼进发给模型的最终提示词，混进另一种语言会拉低输出质量，
 * 甚至诱导模型用错语言作答，因此必须和 prompts.ts 一样按 locale 双语。
 */
function withSchemaInPrompt(prompt: string, schema: object, locale: Locale): string {
  return [
    prompt,
    '',
    locale === 'zh_CN'
      ? '只输出一个 JSON 对象，不要任何解释文字、不要 Markdown 代码块。'
      : 'Output only a single JSON object — no explanations, no Markdown code fences.',
    locale === 'zh_CN'
      ? '输出必须严格符合以下 JSON Schema：'
      : 'The output must strictly conform to the following JSON Schema:',
    JSON.stringify(schema),
  ].join('\n')
}

function isUnsupportedResponseFormat(status: number, body: string): boolean {
  return status === 400 && /response_format/i.test(body)
}

export function createLlmClient(config: LlmConfig, locale: Locale, fetchImpl: typeof fetch = fetch): LlmClient {
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  // 一旦探明厂商不支持 json_schema 就记住，后续请求不再浪费一次 400。
  let mode: StructuredMode = 'json_schema'

  function buildBody(prompt: string, schema: object, attempt: StructuredMode): string {
    const body: Record<string, unknown> = {
      model: config.model,
      temperature: 0,
      messages: [
        { role: 'user', content: attempt === 'json_schema' ? prompt : withSchemaInPrompt(prompt, schema, locale) },
      ],
    }
    // attempt === 'none' 的厂商连 response_format 字段都不认，只能靠提示词约束
    if (attempt === 'json_schema') {
      body.response_format = { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } }
    } else if (attempt === 'json_object') {
      body.response_format = { type: 'json_object' }
    }
    return JSON.stringify(body)
  }

  async function post(
    prompt: string,
    schema: object,
    attempt: StructuredMode,
    signal?: AbortSignal,
  ): Promise<Response> {
    const startedAt = Date.now()
    try {
      return await fetchImpl(endpoint, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: buildBody(prompt, schema, attempt),
      })
    } catch (error) {
      const elapsed = Date.now() - startedAt
      // 只进开发者控制台，不必双语。
      console.error(`[TidyMark] fetch 失败（耗时 ${elapsed}ms）：`, error)
      // 这条消息会经 String(error) 拼进 logBatchFailed / logFoldersFailed 的 detail，
      // 显示在侧栏运行日志里，属于用户可见内容，必须双语。
      throw new LlmError(
        locale === 'zh_CN'
          ? `网络请求失败（耗时 ${elapsed}ms）: ${String(error)}`
          : `Network request failed (${elapsed}ms): ${String(error)}`,
        true,
      )
    }
  }

  return {
    async complete(prompt, schema, signal) {
      // 降级判断必须基于「这次请求实际用的那一级」。并发请求共享 mode，
      // 若按共享值往下推，别的请求刚推过的一步会被重复消耗，
      // 后发的请求会误以为已经无级可降而直接失败。
      let attempt = mode

      for (;;) {
        const response = await post(prompt, schema, attempt, signal)

        if (!response.ok) {
          const body = await response.text()
          const next = MODES[MODES.indexOf(attempt) + 1]
          if (isUnsupportedResponseFormat(response.status, body) && next !== undefined) {
            // 只进开发者控制台，不必双语。
            console.warn(`[TidyMark] 厂商不支持 ${attempt}，降级为 ${next} 重试`)
            // mode 只前进不后退，作为后续请求的起点
            if (MODES.indexOf(next) > MODES.indexOf(mode)) mode = next
            // 别的请求可能已经探到更低的一级，直接从那里接着试
            attempt = MODES.indexOf(mode) > MODES.indexOf(next) ? mode : next
            continue
          }
          const retryable = response.status === 429 || response.status >= 500
          // 同上：会经 String(error) 流入侧栏日志，必须双语。
          throw new LlmError(
            locale === 'zh_CN'
              ? `模型接口返回 ${response.status}: ${body}`
              : `Model API returned ${response.status}: ${body}`,
            retryable,
          )
        }

        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
        }
        const content = payload.choices?.[0]?.message?.content
        const finishReason = payload.choices?.[0]?.finish_reason
        if (typeof content !== 'string') {
          throw new LlmError(
            locale === 'zh_CN' ? '模型响应中没有 content 字段' : 'The model response has no content field',
            false,
          )
        }
        const sliced = sliceJson(content)
        try {
          return JSON.parse(sliced.text) as unknown
        } catch {
          // 厂商不给 finish_reason 时（网关转发常见）退回看括号有没有闭合。
          const truncated = finishReason === 'length' || !sliced.closed
          const reason = finishReason ?? (locale === 'zh_CN' ? '未提供' : 'absent')
          // 截断标 retryable: false——原样再问一次只会再截断一次，
          // 该做的是把这一批拆小，那件事由 llm/tags.ts 按 truncated 决定。
          throw new LlmError(
            locale === 'zh_CN'
              ? `模型返回的不是合法 JSON（finish_reason=${reason}，content 共 ${content.length} 字）：${headAndTail(content, locale)}`
              : `The model did not return valid JSON (finish_reason=${reason}, content ${content.length} chars): ${headAndTail(content, locale)}`,
            false,
            truncated,
          )
        }
      }
    },
  }
}
