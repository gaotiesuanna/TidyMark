import { describe, it, expect, vi } from 'vitest'
import { listRemoteModels, parseModelList } from '@/llm/models'

describe('parseModelList', () => {
  it('从 OpenAI 兼容的 data[].id 抽出模型名，排序去重', () => {
    expect(parseModelList({
      data: [{ id: 'glm-5.2' }, { id: 'deepseek-chat' }, { id: 'glm-5.2' }],
    })).toEqual(['deepseek-chat', 'glm-5.2'])
  })

  it('形状不对就回空名单，不抛', () => {
    expect(parseModelList(null)).toEqual([])
    expect(parseModelList('nope')).toEqual([])
    expect(parseModelList({ data: 'x' })).toEqual([])
    expect(parseModelList({ data: [{ name: 'only-name' }] })).toEqual([])
  })

  it('空 id 和空格 id 丢掉', () => {
    expect(parseModelList({ data: [{ id: '' }, { id: '  ' }, { id: 'ok' }] })).toEqual(['ok'])
  })
})

describe('listRemoteModels', () => {
  it('GET {baseUrl}/models，有 Key 才带 Authorization', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'glm-5.2' }],
    }), { status: 200 }))
    await expect(listRemoteModels('https://opencode.ai/zen/go/v1/', 'sk-secret', fetchImpl))
      .resolves.toEqual(['glm-5.2'])
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://opencode.ai/zen/go/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer sk-secret' },
      }),
    )
  })

  it('空 Key 不发 Authorization——本机 Ollama 不要这个头', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    await listRemoteModels('http://localhost:11434/v1', '  ', fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:11434/v1/models',
      expect.objectContaining({ headers: {} }),
    )
  })

  it('失败消息里的 Key 要剥掉再抛', async () => {
    const fetchImpl = vi.fn(async () => new Response('sk-secret leaked', { status: 401 }))
    await expect(listRemoteModels('https://api.openai.com/v1', 'sk-secret', fetchImpl))
      .rejects.toThrow('模型列表接口返回 401: *** leaked')
  })
})
