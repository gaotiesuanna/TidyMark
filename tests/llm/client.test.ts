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

  // 端点接了连接却不吐数据时，fetch 既不 resolve 也不 reject，整个 worker 永久堵死——
  // 而重试等的正是一个 reject，所以 MAX_RETRIES 永远轮不到。真实一遍里 8 个标签批次
  // 有 2 个这样挂住，整轮作废、已付的钱全丢，产品自己毫无察觉。
  it('请求超时后抛可重试的错误，不再无限挂起', async () => {
    // 永不 settle 的 fetch，但要respect signal——真实 fetch 就是这样
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch, undefined, 20)

    await expect(client.complete('hi', schema)).rejects.toThrow(LlmError)
    await expect(client.complete('hi', schema)).rejects.toMatchObject({ retryable: true })
  })

  it('超时的文案与「用户取消」分得开——两者的收场方式正相反', async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const client = createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch, undefined, 20)
    await expect(client.complete('hi', schema)).rejects.toThrow(/超时/)
  })

  it('用户取消仍然标成不可重试，没有被超时那条路顶掉', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      controller.abort()
    }))
    const client = createLlmClient(
      config, 'zh_CN', fetchImpl as unknown as typeof fetch, controller.signal, 60_000,
    )
    await expect(client.complete('hi', schema)).rejects.toMatchObject({ retryable: false })
  })
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

describe('非法 JSON 的诊断与截断判定', () => {
  function jsonFailResponse(content: string, finishReason?: string) {
    const choice: Record<string, unknown> = { message: { content } }
    if (finishReason !== undefined) choice.finish_reason = finishReason
    return new Response(JSON.stringify({ choices: [choice] }), { status: 200 })
  }

  function clientFor(content: string, finishReason?: string) {
    const fetchImpl = vi.fn().mockResolvedValue(jsonFailResponse(content, finishReason))
    return createLlmClient(config, 'zh_CN', fetchImpl as unknown as typeof fetch)
  }

  /** 半个数组：括号没闭合，正是被 max_tokens 砍断时的形状。 */
  const CUT = '{"results": [{"bookmark_id": "805", "primary_topic": "MinerU"}, {"bookmark_id": "83'

  it('错误信息带上 finish_reason，用户不必猜是不是被截断', async () => {
    const error = await clientFor(CUT, 'length').complete('p', schema).catch((e: unknown) => e)
    expect(String(error)).toContain('finish_reason=length')
  })

  it('错误信息带上 content 总长，200 字的头部不再是全部线索', async () => {
    const error = await clientFor(CUT, 'length').complete('p', schema).catch((e: unknown) => e)
    expect(String(error)).toContain(`content 共 ${CUT.length} 字`)
  })

  it('content 过长时头尾都留，中间才省略', async () => {
    const long = `{"results": [${'{"bookmark_id": "1", "primary_topic": "AAA"}, '.repeat(30)}{"bookmark_id": "9`
    const error = await clientFor(long, 'length').complete('p', schema).catch((e: unknown) => e)
    expect(String(error)).toContain(long.slice(0, 100))
    expect(String(error)).toContain(long.slice(-100))
  })

  it('finish_reason=length 判定为截断', async () => {
    const error = await clientFor(CUT, 'length').complete('p', schema).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).truncated).toBe(true)
  })

  it('厂商没给 finish_reason 时，靠括号没闭合判定截断', async () => {
    const error = await clientFor(CUT).complete('p', schema).catch((e: unknown) => e)
    expect((error as LlmError).truncated).toBe(true)
  })

  it('括号闭合了的非法 JSON 不算截断', async () => {
    const error = await clientFor('{"a": 1,}', 'stop').complete('p', schema).catch((e: unknown) => e)
    expect((error as LlmError).truncated).toBe(false)
  })

  it('截断不算可重试：同一个请求只会再截断一次', async () => {
    const error = await clientFor(CUT, 'length').complete('p', schema).catch((e: unknown) => e)
    expect((error as LlmError).retryable).toBe(false)
  })

  it('英文界面下诊断信息里没有中文', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonFailResponse(CUT, 'length'))
    const client = createLlmClient(config, 'en', fetchImpl as unknown as typeof fetch)
    const error = await client.complete('p', schema).catch((e: unknown) => e)
    expect(/[一-鿿]/.test((error as LlmError).message)).toBe(false)
    expect((error as LlmError).message).toContain('finish_reason=length')
  })
})

describe('extractJson 的配平截取', () => {
  it('砍掉 JSON 后面拖着的解释文字', () => {
    expect(extractJson('{"a":1}\n注：仅供参考')).toBe('{"a":1}')
  })

  it('字符串里的花括号不参与配平', () => {
    expect(extractJson('{"a":"}"}\n以上')).toBe('{"a":"}"}')
  })

  it('转义引号不会被当成字符串结束', () => {
    expect(extractJson('{"a":"\\""}尾巴')).toBe('{"a":"\\""}')
  })

  it('括号没闭合时把剩下的原样交出去，让上层报截断', () => {
    expect(extractJson('前言\n{"results": [1,')).toBe('{"results": [1,')
  })
})

describe('整轮取消信号', () => {
  function clientWith(signal: AbortSignal, fetchImpl: unknown) {
    return createLlmClient(config, 'zh_CN', fetchImpl as typeof fetch, signal)
  }

  // 断言的是行为不是对象同一性：signal 现在是「取消 + 超时闹钟」合成出来的，
  // 拿 toBe 比对象会把「加了超时」这件事误报成回归
  it('整轮的信号会交给 fetch，调用方不必每次都传', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      controller.abort()
      return init.signal?.aborted === true
        ? Promise.reject(new DOMException('Aborted', 'AbortError'))
        : Promise.resolve(okResponse({ ok: true }))
    })
    await expect(clientWith(controller.signal, fetchImpl as unknown as typeof fetch).complete('p', schema))
      .rejects.toMatchObject({ retryable: false })
  })

  it('单次调用传的 signal 优先于整轮的', async () => {
    const run = new AbortController()
    const one = new AbortController()
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      // 只 abort 单次那个：整轮那个不动，能断掉就说明生效的是单次的
      one.abort()
      return init.signal?.aborted === true
        ? Promise.reject(new DOMException('Aborted', 'AbortError'))
        : Promise.resolve(okResponse({ ok: true }))
    })
    await expect(
      clientWith(run.signal, fetchImpl as unknown as typeof fetch).complete('p', schema, one.signal),
    ).rejects.toMatchObject({ retryable: false })
    expect(run.signal.aborted).toBe(false)
  })

  it('取消导致的中断标成不可重试——否则调用方还要各自再问两次', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn().mockImplementation(() => {
      controller.abort()
      return Promise.reject(new DOMException('Aborted', 'AbortError'))
    })
    const error = await clientWith(controller.signal, fetchImpl)
      .complete('p', schema)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).retryable).toBe(false)
  })

  it('没 abort 的网络失败仍然可重试，别把两件事混成一件', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn().mockRejectedValue(new Error('boom'))
    const error = await clientWith(controller.signal, fetchImpl)
      .complete('p', schema)
      .catch((e: unknown) => e)
    expect((error as LlmError).retryable).toBe(true)
  })

  it('中断的错误信息双语，英文版不含中文', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn().mockImplementation(() => {
      controller.abort()
      return Promise.reject(new DOMException('Aborted', 'AbortError'))
    })
    const client = createLlmClient(config, 'en', fetchImpl as unknown as typeof fetch, controller.signal)
    const error = await client.complete('p', schema).catch((e: unknown) => e)
    expect(/[一-鿿]/.test((error as LlmError).message)).toBe(false)
  })
})
