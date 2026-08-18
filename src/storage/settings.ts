import type { Ports } from '@/core/ports'
import type { Locale, UiLocale } from '@/core/locale'
import type { CachedClassification } from '@/core/types'
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
  /** 同一层的目录数上限。只在推翻重建模式下生效。 */
  maxTopFolders: number
  /**
   * 目录最深嵌套到第几层，按**绝对**层级算（见 core/level.ts）：
   * 书签栏里的目录是一级，「其他书签」自己是一级、它里面的是二级。
   *
   * 所以这个数字与「勾了哪里」无关：上限 2 时勾书签栏可以分出二级，
   * 勾「其他书签」就只能建一层——那一层本身已经是二级了。
   * 只在推翻重建模式下生效。
   */
  maxFolderDepth: number
  /**
   * 是否要求目录至少装下 minFolderSize 个书签才值得单独建立。
   * 关掉时完全不做这项约束。只在推翻重建模式下生效。
   */
  enforceMinFolderSize: boolean
  /** 目录至少要装下几个书签。enforceMinFolderSize 关闭时这个值不被读取。 */
  minFolderSize: number
  /** 界面与产出的语言。'auto' 时跟随浏览器 UI 语言。 */
  uiLocale: UiLocale
}

/** 嵌套层数的合法区间。1 就是完全不分子目录；超过 4 层在书签管理器里已经找不着东西。 */
export const MIN_FOLDER_DEPTH = 1
export const MAX_FOLDER_DEPTH = 4

/**
 * minFolderSize 这个数字自己的合法区间——不是「目录里的书签数」的区间。
 *
 * 下界 2 是这个功能的最弱形态（只赶走独苗目录）；填 1 等于没开，那种意图应该
 * 去关开关而不是把阈值调到 1。上界 10 再往上，能活下来的目录太少，
 * 整理结果会退化成一个巨大的「其他」。
 */
export const MIN_FOLDER_SIZE = 2
export const MAX_FOLDER_SIZE = 10

export const DEFAULT_SETTINGS: Settings = {
  llm: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
  rebuildStructure: false,
  removeEmptyFolders: true,
  domainGroups: [],
  rewriteGithubTitles: false,
  maxTopFolders: MAX_SIBLINGS,
  maxFolderDepth: 2,
  enforceMinFolderSize: true,
  minFolderSize: 3,
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

/** 被 maxFolderDepth 取代的旧开关。只在读取时认，不再写出去。 */
interface LegacySettings {
  allowSubfolders?: boolean
}

export async function loadSettings(ports: Ports): Promise<Settings> {
  const stored = await ports.storage.get<Partial<Settings> & LegacySettings>(SETTINGS_KEY)
  // 上周关掉过「允许二级目录」的人，存储里躺着 false。不认这个旧键就等于把他的选择
  // 静默翻回默认，而这是「会不会给我建二级目录」这种一眼看得见的行为。
  // 新键在场时它说了算，否则改不动设置。
  const legacyDepth = stored?.allowSubfolders === false ? MIN_FOLDER_DEPTH : undefined
  return {
    llm: { ...DEFAULT_SETTINGS.llm, ...(stored?.llm ?? {}) },
    rebuildStructure: stored?.rebuildStructure ?? DEFAULT_SETTINGS.rebuildStructure,
    removeEmptyFolders: stored?.removeEmptyFolders ?? DEFAULT_SETTINGS.removeEmptyFolders,
    domainGroups: stored?.domainGroups ?? DEFAULT_SETTINGS.domainGroups,
    rewriteGithubTitles: stored?.rewriteGithubTitles ?? DEFAULT_SETTINGS.rewriteGithubTitles,
    maxTopFolders: stored?.maxTopFolders ?? DEFAULT_SETTINGS.maxTopFolders,
    maxFolderDepth: stored?.maxFolderDepth ?? legacyDepth ?? DEFAULT_SETTINGS.maxFolderDepth,
    enforceMinFolderSize: stored?.enforceMinFolderSize ?? DEFAULT_SETTINGS.enforceMinFolderSize,
    minFolderSize: stored?.minFolderSize ?? DEFAULT_SETTINGS.minFolderSize,
    uiLocale: stored?.uiLocale ?? DEFAULT_SETTINGS.uiLocale,
  }
}

export async function saveSettings(ports: Ports, settings: Settings): Promise<void> {
  await ports.storage.set(SETTINGS_KEY, settings)
}

/**
 * 旧格式（存 targetCategoryId 的那版）与任何结构不对的条目一律丢弃。
 * 换 key 格式本身就等于全量失效，这里只是确保读出来的东西形状可信。
 *
 * url 是必需字段，这也意味着加 url 字段之前那版代码（只存路径不存 url）
 * 写下的条目会被当成畸形数据一并丢弃——同样是全量失效的一部分，正确且
 * 符合预期，不必单独兼容。
 */
function isCachedClassification(value: unknown): value is CachedClassification {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<CachedClassification>
  const pathOk =
    entry.targetPath === null ||
    (Array.isArray(entry.targetPath) && entry.targetPath.every((p) => typeof p === 'string'))
  const topicOk = entry.topic === undefined || typeof entry.topic === 'string'
  return (
    pathOk &&
    typeof entry.url === 'string' &&
    topicOk &&
    typeof entry.confidence === 'number' &&
    typeof entry.reason === 'string'
  )
}

export async function loadCache(ports: Ports): Promise<Map<string, CachedClassification>> {
  const stored = await ports.storage.get<unknown>(CACHE_KEY)
  if (!Array.isArray(stored)) return new Map()
  return new Map(
    stored.filter(
      (pair): pair is [string, CachedClassification] =>
        Array.isArray(pair) && typeof pair[0] === 'string' && isCachedClassification(pair[1]),
    ),
  )
}

export async function saveCache(ports: Ports, cache: Map<string, CachedClassification>): Promise<void> {
  await ports.storage.set(CACHE_KEY, [...cache])
}
