import type { LlmConfig } from '@/llm/client'
import type { Settings } from '@/storage/settings'

/**
 * 把一份「单套配置」写法摊成端点表 + active。
 *
 * 存在的理由：`llm: { … }` 这个写法在 7 个测试文件里出现 76 次，全是「就想要这么
 * 一套配置」的意思。给它一个 helper，下次再动 Settings 的形状时只改这一处，
 * 而不是 76 处各改各的。
 */
export function withLlm(llm: LlmConfig): Pick<Settings, 'endpoints' | 'active'> {
  return {
    endpoints: [{ baseUrl: llm.baseUrl, apiKey: llm.apiKey, models: [llm.model] }],
    active: { baseUrl: llm.baseUrl, model: llm.model },
  }
}
