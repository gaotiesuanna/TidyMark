import type { Ports } from '@/core/ports'
import type { Locale, UiLocale } from '@/core/locale'
import type { Classification } from '@/core/types'
import { MAX_SIBLINGS } from '@/core/tree'
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
  /** 把 GitHub 书签的标题统一成 `repo (owner)`。 */
  rewriteGithubTitles: boolean
  /** 一级目录数上限。只在推翻重建模式下生效。 */
  maxTopFolders: number
  /** 允许模型分出二级目录。关掉时强制单层。只在推翻重建模式下生效。 */
  allowSubfolders: boolean
  /** 界面与产出的语言。'auto' 时跟随浏览器 UI 语言。 */
  uiLocale: UiLocale
}

export const DEFAULT_SETTINGS: Settings = {
  llm: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
  rebuildStructure: false,
  removeEmptyFolders: true,
  domainGroups: [],
  rewriteGithubTitles: false,
  maxTopFolders: MAX_SIBLINGS,
  allowSubfolders: true,
  uiLocale: 'auto',
}

/**
 * label 按语言分开存：这个文件属于界面层（不在 core/llm/engine 的禁止名单里），
 * 但内容本身跟 _locales 无关——它是供应商预设，不是一句完整文案，用小型双语表
 * 比额外开一个 _locales 键更直接。「智谱」是品牌名，两种语言都保留原文；
 * 「本地 Ollama」里的「本地」是描述词不是品牌，必须双语。
 */
export const PRESETS: Array<{ label: Record<Locale, string>; baseUrl: string; model: string }> = [
  { label: { zh_CN: 'OpenAI', en: 'OpenAI' }, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: { zh_CN: 'DeepSeek', en: 'DeepSeek' }, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: { zh_CN: 'Kimi', en: 'Kimi' }, baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: { zh_CN: '智谱', en: 'Zhipu' }, baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: { zh_CN: '本地 Ollama', en: 'Local Ollama' }, baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' },
]

export async function loadSettings(ports: Ports): Promise<Settings> {
  const stored = await ports.storage.get<Partial<Settings>>(SETTINGS_KEY)
  return {
    llm: { ...DEFAULT_SETTINGS.llm, ...(stored?.llm ?? {}) },
    rebuildStructure: stored?.rebuildStructure ?? DEFAULT_SETTINGS.rebuildStructure,
    removeEmptyFolders: stored?.removeEmptyFolders ?? DEFAULT_SETTINGS.removeEmptyFolders,
    domainGroups: stored?.domainGroups ?? DEFAULT_SETTINGS.domainGroups,
    rewriteGithubTitles: stored?.rewriteGithubTitles ?? DEFAULT_SETTINGS.rewriteGithubTitles,
    maxTopFolders: stored?.maxTopFolders ?? DEFAULT_SETTINGS.maxTopFolders,
    allowSubfolders: stored?.allowSubfolders ?? DEFAULT_SETTINGS.allowSubfolders,
    uiLocale: stored?.uiLocale ?? DEFAULT_SETTINGS.uiLocale,
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
