import type { LlmConfig } from './client'

/**
 * baseUrl 是不是指向本机上的模型服务器（Ollama、LM Studio 这一类）。
 *
 * 只认 localhost 与 127.0.0.1 两个主机名，跟 manifest 的 optional_host_permissions
 * 保持一格不差（`http://localhost/*`、`http://127.0.0.1/*`，见 manifest.config.ts）。
 * 认得比它多（`::1`、`0.0.0.0`、局域网地址）等于在界面上放行一个到了申请权限那一步
 * 必然过不去的地址——那比早点说「还没配」更糟。
 *
 * 地址填得不成形（还在敲一半）时返回 false：那时候确实还不算配好。
 */
export function isLocalBaseUrl(baseUrl: string): boolean {
  let hostname: string
  try {
    hostname = new URL(baseUrl).hostname
  } catch {
    return false
  }
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

/**
 * 模型配好了没有——界面上「要不要提示去配置」和后台「要不要直接拒掉这次分析」问的
 * 是同一个问题，所以是同一个谓词，三处调用点共用（选范围页、偏好页、后台 analyze）。
 *
 * 不能只看 apiKey：PRESETS 里的「本地 Ollama」指向 http://localhost:11434/v1，本机
 * 服务器不校验 Key，点完那个预设 apiKey 仍然是空串。只认 apiKey 的话，这类用户会走进
 * 一个死循环——选范围页那条「现在还没配」的提示永远不消失，偏好页永远只给「先去配置
 * 模型」，点它又回到他刚配完的设置页，「开始 AI 分析」一辈子拿不到。README 把本机
 * Ollama / LM Studio 明确列为支持的路径，这条路就得走得通。
 */
export function isModelConfigured(llm: LlmConfig): boolean {
  return llm.apiKey.trim() !== '' || isLocalBaseUrl(llm.baseUrl)
}
