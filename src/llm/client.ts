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

/** 结构化输出的实现方式。并非所有 OpenAI 兼容厂商都支持 json_schema。 */
type StructuredMode = 'json_schema' | 'json_object'

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
    const responseFormat =
      mode === 'json_schema'
        ? { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } }
        : { type: 'json_object' }
    return JSON.stringify({
      model: config.model,
      temperature: 0,
      messages: [
        { role: 'user', content: mode === 'json_schema' ? prompt : withSchemaInPrompt(prompt, schema) },
      ],
      response_format: responseFormat,
    })
  }

  async function post(prompt: string, schema: object, signal?: AbortSignal): Promise<Response> {
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
      throw new LlmError(`网络请求失败: ${String(error)}`, true)
    }
  }

  return {
    async complete(prompt, schema, signal) {
      let response = await post(prompt, schema, signal)

      if (!response.ok) {
        const body = await response.text()
        // 厂商不支持 json_schema：降级为 json_object 后重试一次
        if (mode === 'json_schema' && isUnsupportedResponseFormat(response.status, body)) {
          mode = 'json_object'
          response = await post(prompt, schema, signal)
        } else {
          const retryable = response.status === 429 || response.status >= 500
          throw new LlmError(`模型接口返回 ${response.status}: ${body}`, retryable)
        }
      }

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500
        throw new LlmError(`模型接口返回 ${response.status}: ${await response.text()}`, retryable)
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = payload.choices?.[0]?.message?.content
      if (typeof content !== 'string') {
        throw new LlmError('模型响应中没有 content 字段', false)
      }
      try {
        return JSON.parse(content) as unknown
      } catch {
        throw new LlmError(`模型返回的不是合法 JSON: ${content.slice(0, 200)}`, false)
      }
    },
  }
}
