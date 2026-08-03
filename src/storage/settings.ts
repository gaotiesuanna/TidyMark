import type { Ports } from '@/core/ports'
import type { Classification } from '@/core/types'
import type { LlmConfig } from '@/llm/client'

export const SETTINGS_KEY = 'tidymark:settings'
export const CACHE_KEY = 'tidymark:classify-cache'

export interface Settings {
  llm: LlmConfig
  rebuildStructure: boolean
  /** 整理完成后清理范围内不含任何书签的目录。 */
  removeEmptyFolders: boolean
  /** 勾选的域名聚合组 key，见 core/domainGroups.ts。为空表示不聚合。 */
  domainGroups: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  llm: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
  rebuildStructure: false,
  removeEmptyFolders: true,
  domainGroups: [],
}

export const PRESETS: Array<{ label: string; baseUrl: string; model: string }> = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: '本地 Ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' },
]

export async function loadSettings(ports: Ports): Promise<Settings> {
  const stored = await ports.storage.get<Partial<Settings>>(SETTINGS_KEY)
  return {
    llm: { ...DEFAULT_SETTINGS.llm, ...(stored?.llm ?? {}) },
    rebuildStructure: stored?.rebuildStructure ?? DEFAULT_SETTINGS.rebuildStructure,
    removeEmptyFolders: stored?.removeEmptyFolders ?? DEFAULT_SETTINGS.removeEmptyFolders,
    domainGroups: stored?.domainGroups ?? DEFAULT_SETTINGS.domainGroups,
  }
}

export async function saveSettings(ports: Ports, settings: Settings): Promise<void> {
  await ports.storage.set(SETTINGS_KEY, settings)
}

export async function loadCache(ports: Ports): Promise<Map<string, Classification>> {
  const stored = await ports.storage.get<Array<[string, Classification]>>(CACHE_KEY)
  return new Map(stored ?? [])
}

export async function saveCache(ports: Ports, cache: Map<string, Classification>): Promise<void> {
  await ports.storage.set(CACHE_KEY, [...cache])
}
