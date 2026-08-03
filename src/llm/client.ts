export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export class LlmError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'LlmError'
    this.retryable = retryable
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

/** 去掉模型可能加上的 Markdown 代码块或前后废话，取出其中的 JSON。 */
export function extractJson(content: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content)
  const text = (fenced?.[1] ?? content).trim()
  if (text.startsWith('{') || text.startsWith('[')) return text
  const start = text.search(/[{[]/)
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
  return start >= 0 && end > start ? text.slice(start, end + 1) : text
}

/**
 * 只支持 json_object 的厂商（如 DeepSeek）无法约束输出形状，
 * 因此把 schema 直接写进提示词。调用方本来就会校验并丢弃非法字段。
 */
function withSchemaInPrompt(prompt: string, schema: object): string {
  return [
    prompt,
    '',
    '只输出一个 JSON 对象，不要任何解释文字、不要 Markdown 代码块。',
    '输出必须严格符合以下 JSON Schema：',
    JSON.stringify(schema),
  ].join('\n')
}

function isUnsupportedResponseFormat(status: number, body: string): boolean {
  return status === 400 && /response_format/i.test(body)
}

export function createLlmClient(config: LlmConfig, fetchImpl: typeof fetch = fetch): LlmClient {
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  // 一旦探明厂商不支持 json_schema 就记住，后续请求不再浪费一次 400。
  let mode: StructuredMode = 'json_schema'

  function buildBody(prompt: string, schema: object): string {
    const body: Record<string, unknown> = {
      model: config.model,
      temperature: 0,
      messages: [
        { role: 'user', content: mode === 'json_schema' ? prompt : withSchemaInPrompt(prompt, schema) },
      ],
    }
    // mode === 'none' 的厂商连 response_format 字段都不认，只能靠提示词约束
    if (mode === 'json_schema') {
      body.response_format = { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } }
    } else if (mode === 'json_object') {
      body.response_format = { type: 'json_object' }
    }
    return JSON.stringify(body)
  }

  async function post(prompt: string, schema: object, signal?: AbortSignal): Promise<Response> {
    const startedAt = Date.now()
    try {
      return await fetchImpl(endpoint, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: buildBody(prompt, schema),
      })
    } catch (error) {
      const elapsed = Date.now() - startedAt
      console.error(`[TidyMark] fetch 失败（耗时 ${elapsed}ms）：`, error)
      throw new LlmError(`网络请求失败（耗时 ${elapsed}ms）: ${String(error)}`, true)
    }
  }

  return {
    async complete(prompt, schema, signal) {
      // 每次 400 都沿着 MODES 往下降一级，降到底还不行才报错
      for (;;) {
        const response = await post(prompt, schema, signal)

        if (!response.ok) {
          const body = await response.text()
          const next = MODES[MODES.indexOf(mode) + 1]
          if (isUnsupportedResponseFormat(response.status, body) && next !== undefined) {
            console.warn(`[TidyMark] 厂商不支持 ${mode}，降级为 ${next} 重试`)
            mode = next
            continue
          }
          const retryable = response.status === 429 || response.status >= 500
          throw new LlmError(`模型接口返回 ${response.status}: ${body}`, retryable)
        }

        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>
        }
        const content = payload.choices?.[0]?.message?.content
        if (typeof content !== 'string') {
          throw new LlmError('模型响应中没有 content 字段', false)
        }
        try {
          return JSON.parse(extractJson(content)) as unknown
        } catch {
          throw new LlmError(`模型返回的不是合法 JSON: ${content.slice(0, 200)}`, false)
        }
      }
    },
  }
}
