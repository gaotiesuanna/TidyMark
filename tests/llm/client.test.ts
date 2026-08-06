import { describe, it, expect, vi } from 'vitest'
import { createLlmClient, extractJson, LlmError } from '@/llm/client'

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
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)
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
    const client = createLlmClient({ ...config, baseUrl: 'https://api.example.com/v1/' }, 'zh_CN', fetchImpl as unknown as typeof fetch)
    await client.complete('hi', schema)
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.example.com/v1/chat/completions')
  })

  it('解析并返回结构化 JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ ok: true }))
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)
    expect(await client.complete('hi', schema)).toEqual({ ok: true })
  })

  it('429 与 5xx 标记为可重试', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }))
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)
    await expect(client.complete('hi', schema)).rejects.toMatchObject({ retryable: true })
  })

  it('401 标记为不可重试', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad key', { status: 401 }))
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)
    await expect(client.complete('hi', schema)).rejects.toMatchObject({ retryable: false })
  })

  it('返回内容不是合法 JSON 时抛不可重试错误', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '不是 JSON' } }] }), { status: 200 }),
    )
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)
    await expect(client.complete('hi', schema)).rejects.toBeInstanceOf(LlmError)
  })

  it('网络异常标记为可重试', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)
    await expect(client.complete('hi', schema)).rejects.toMatchObject({ retryable: true })
  })
})

describe('json_schema 不受支持时自动降级为 json_object', () => {
  function unsupportedResponse() {
    return new Response(
      JSON.stringify({
        error: {
          message: 'This response_format type is unavailable now',
          type: 'invalid_request_error',
        },
      }),
      { status: 400 },
    )
  }

  it('遇到 response_format 不支持的 400 时自动改用 json_object 重试并成功返回', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(unsupportedResponse())
      .mockResolvedValueOnce(okResponse({ ok: true }))
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)

    expect(await client.complete('hi', schema)).toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('降级后的请求用 json_object，并把 schema 写进提示词', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(unsupportedResponse())
      .mockResolvedValueOnce(okResponse({ ok: true }))
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)
    await client.complete('原始提示', schema)

    const body = JSON.parse(fetchImpl.mock.calls[1]![1].body as string)
    expect(body.response_format).toEqual({ type: 'json_object' })
    const content = body.messages[0].content as string
    expect(content).toContain('原始提示')
    expect(content).toContain('"ok"')
  })

  it('降级是粘性的：同一个 client 的后续请求直接用 json_object，不再浪费一次 400', async () => {
    // 每次返回全新的 Response —— body 只能读一次，复用同一个实例会假失败
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(unsupportedResponse())
      .mockImplementation(async () => okResponse({ ok: true }))
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)

    await client.complete('第一次', schema)
    await client.complete('第二次', schema)

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(JSON.parse(fetchImpl.mock.calls[2]![1].body as string).response_format)
      .toEqual({ type: 'json_object' })
  })

  it('与 response_format 无关的 400 不触发降级，直接抛不可重试错误', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 400 }),
    )
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)

    await expect(client.complete('hi', schema)).rejects.toMatchObject({ retryable: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('json_object 也不受支持时继续降级为完全不带 response_format', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(unsupportedResponse())
      .mockResolvedValueOnce(unsupportedResponse())
      .mockResolvedValueOnce(okResponse({ ok: true }))
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)

    expect(await client.complete('原始提示', schema)).toEqual({ ok: true })
    const body = JSON.parse(fetchImpl.mock.calls[2]![1].body as string)
    expect(body.response_format).toBeUndefined()
    expect(body.messages[0].content as string).toContain('原始提示')
    expect(body.messages[0].content as string).toContain('"ok"')
  })

  it('三种方式都失败时抛出错误，不无限重试', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => unsupportedResponse())
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)

    await expect(client.complete('hi', schema)).rejects.toBeInstanceOf(LlmError)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})

describe('extractJson', () => {
  it('原样返回裸 JSON', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}')
  })

  it('剥掉 Markdown 代码块', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('剥掉 JSON 前后的解释文字', () => {
    expect(extractJson('好的，结果如下：\n{"a":1}\n希望有帮助')).toBe('{"a":1}')
  })

  it('没有 JSON 时原样返回，交给上层报错', () => {
    expect(extractJson('抱歉我做不到')).toBe('抱歉我做不到')
  })
})

describe('不带 response_format 时仍能解析被代码块包住的输出', () => {
  it('解析 ```json 包裹的内容', async () => {
    const wrapped = new Response(
      JSON.stringify({ choices: [{ message: { content: '```json\n{"ok":true}\n```' } }] }),
      { status: 200 },
    )
    const fetchImpl = vi.fn().mockResolvedValue(wrapped)
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)
    expect(await client.complete('hi', schema)).toEqual({ ok: true })
  })
})

describe('并发请求共享降级状态时不会互相把台阶踩没', () => {
  /** 只接受完全不带 response_format 的请求，其余一律 400。 */
  function onlyPlainFetch() {
    return vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { response_format?: unknown }
      if (body.response_format !== undefined) {
        return new Response(
          JSON.stringify({ error: { message: 'This response_format type is unavailable now' } }),
          { status: 400 },
        )
      }
      return okResponse({ ok: true })
    })
  }

  it('四个并发请求全部成功降到底，没有一个被判定为无级可降', async () => {
    const fetchImpl = onlyPlainFetch()
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => client.complete(`第 ${i} 批`, schema)),
    )
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: true }])
  })

  it('探明之后的请求直接用可用方式，不再浪费 400', async () => {
    const fetchImpl = onlyPlainFetch()
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)

    await Promise.all(Array.from({ length: 4 }, () => client.complete('并发', schema)))
    const before = fetchImpl.mock.calls.length
    await client.complete('后续', schema)
    expect(fetchImpl.mock.calls.length - before).toBe(1)
  })
})
