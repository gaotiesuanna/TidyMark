import { describe, it, expect, vi } from 'vitest'
import { createLlmClient, LlmError } from '@/llm/client'

const config = { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'gpt-x' }
const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }

function okResponse(payload: unknown) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    { status: 200 },
  )
}

describe('createLlmClient', () => {
  it('向 {baseUrl}/chat/completions 发起带 Bearer 的 POST', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ ok: true }))
    const client = createLlmClient(config, fetchImpl as unknown as typeof fetch)
    await client.complete('hi', schema)

    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gpt-x')
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.schema).toEqual(schema)
    expect(body.messages[0].content).toBe('hi')
  })

  it('baseUrl 末尾多余的斜杠被规范化', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ ok: true }))
    const client = createLlmClient({ ...config, baseUrl: 'https://api.example.com/v1/' }, fetchImpl as unknown as typeof fetch)
    await client.complete('hi', schema)
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.example.com/v1/chat/completions')
  })

  it('解析并返回结构化 JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ ok: true }))
    const client = createLlmClient(config, fetchImpl as unknown as typeof fetch)
    expect(await client.complete('hi', schema)).toEqual({ ok: true })
  })

  it('429 与 5xx 标记为可重试', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }))
    const client = createLlmClient(config, fetchImpl as unknown as typeof fetch)
    await expect(client.complete('hi', schema)).rejects.toMatchObject({ retryable: true })
  })

  it('401 标记为不可重试', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad key', { status: 401 }))
    const client = createLlmClient(config, fetchImpl as unknown as typeof fetch)
    await expect(client.complete('hi', schema)).rejects.toMatchObject({ retryable: false })
  })

  it('返回内容不是合法 JSON 时抛不可重试错误', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '不是 JSON' } }] }), { status: 200 }),
    )
    const client = createLlmClient(config, fetchImpl as unknown as typeof fetch)
    await expect(client.complete('hi', schema)).rejects.toBeInstanceOf(LlmError)
  })

  it('网络异常标记为可重试', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const client = createLlmClient(config, fetchImpl as unknown as typeof fetch)
    await expect(client.complete('hi', schema)).rejects.toMatchObject({ retryable: true })
  })
})
