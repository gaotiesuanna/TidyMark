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

export function createLlmClient(config: LlmConfig, fetchImpl: typeof fetch = fetch): LlmClient {
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`

  return {
    async complete(prompt, schema, signal) {
      let response: Response
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0,
            messages: [{ role: 'user', content: prompt }],
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'result', strict: true, schema },
            },
          }),
        })
      } catch (error) {
        throw new LlmError(`网络请求失败: ${String(error)}`, true)
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
