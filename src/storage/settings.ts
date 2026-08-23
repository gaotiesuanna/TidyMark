import type { Ports } from '@/core/ports'
import type { Locale, UiLocale } from '@/core/locale'
import type { CachedClassification } from '@/core/types'
import type { LlmConfig } from '@/llm/client'

export const SETTINGS_KEY = 'tidymark:settings'
export const CACHE_KEY = 'tidymark:classify-cache'

/**
 * 分类缓存的条数上限。
 *
 * manifest 里有 unlimitedStorage（见 manifest.config.ts 的 permissions），所以
 * 「撑爆配额」不是理由——真正的理由是每一轮整理都要把整份缓存完整读一遍再完整
 * 写一遍：loadCache 逐条跑 isCachedClassification 校验，saveCache 把整个数组
 * 序列化后整块落盘。这份开销跟本轮整理多少书签无关，只跟缓存有多长有关。而
 * key 里含 locale × model × 候选路径集合（见 llm/classify.ts 的 cacheKey），
 * 换语言、换模型、目录结构一变就是一整套新 key，旧的那套再也命中不了——留着
 * 它们只是让每一轮都白读白写一遍死数据。
 *
 * 取 10000：一条约 300 字节（key 约 18 + 字段名约 66 + url 约 60 + 一句中文
 * reason 约 75 + targetPath 约 30 + topic 约 12），10000 × 300 B ≈ 3 MB，一次
 * 读写在几十毫秒量级。这个数高于绝大多数书签库的规模——注意是绝大多数，不是
 * 全部：重度用户存下上万条书签是真实存在的。对这些库，缓存会退化成「只有最近
 * 一万条有缓存」，更早的那批每轮都被挤掉、下一轮必然落空，白读白写一遍。
 * 在上限之内时则相安无事：正常一轮整理写下的条目不会互相挤掉，被挤掉的只会是
 * 换配置之前那套旧 key。
 *
 * 真要给超大库兜底并不昂贵（unlimitedStorage 在场，开销只有几毫秒），但那是
 * 另一个决定，不在这里顺手做。
 */
export const MAX_CACHE_ENTRIES = 10_000

/**
 * 端点比对用的归一化 key：末尾斜杠不算另一个端点。
 *
 * 端点表拿 baseUrl 当主键，「是不是同一个端点」这个问题在存储、设置页、偏好页
 * 三处都要问，必须是同一把尺子——两把尺子会造出两条本该是同一个的端点。
 */
export function endpointKey(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/** 一个模型端点：一把 Key 后面可以挂多个模型（OpenCode Go 这类网关正是如此）。 */
export interface Endpoint {
  /** 端点地址，同时是这条记录的主键。比对一律走 endpointKey()。 */
  baseUrl: string
  apiKey: string
  /** 这个端点下存着的模型名，用户在设置页手工维护，顺序即显示顺序。 */
  models: string[]
}

export interface Settings {
  endpoints: Endpoint[]
  /**
   * 当前在用的那一对。
   *
   * 一个端点都没有时是 `{ baseUrl: '', model: '' }`——不用 null，免得六个消费方
   * 各写一遍空判断；空串走的是 activeLlm 的兜底那条路。
   */
  active: { baseUrl: string; model: string }
  /** 整理完成后清理范围内不含任何书签的目录。 */
  removeEmptyFolders: boolean
  /** 勾选的域名聚合组 key，见 core/domainGroups.ts。为空表示不聚合。 */
  domainGroups: string[]
  /** 把 GitHub 书签的标题统一成 `repo (owner)`。 */
  rewriteGithubTitles: boolean
  /** 界面与产出的语言。'auto' 时跟随浏览器 UI 语言。 */
  uiLocale: UiLocale
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini'

export const DEFAULT_SETTINGS: Settings = {
  endpoints: [{ baseUrl: DEFAULT_BASE_URL, apiKey: '', models: [DEFAULT_MODEL] }],
  active: { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL },
  removeEmptyFolders: true,
  domainGroups: [],
  rewriteGithubTitles: false,
  uiLocale: 'auto',
}

/** 按主键找端点，找不到返回 null。 */
export function findEndpoint(settings: Settings, baseUrl: string): Endpoint | null {
  const key = endpointKey(baseUrl)
  return settings.endpoints.find((e) => endpointKey(e.baseUrl) === key) ?? null
}

/**
 * 把「当前在用的那一对」拼成 llm/client.ts 要的 LlmConfig。
 *
 * **任何不一致都返回一个空 Key 的默认配置**：端点被删了、模型被移除了、
 * 一个端点都没有。于是 isModelConfigured 判 false，界面自然落到已经存在、
 * 已经有用例的「还没配置模型」分支——六个消费方一行防御都不用写，
 * 也不必新造一种错误态。
 *
 * 兜底的 baseUrl 必须是**远程**默认值。isModelConfigured 对 localhost /
 * 127.0.0.1 是放行空 Key 的（README 明确支持本机 Ollama 那条路），
 * 兜底成本机地址会把「端点被删了」判成「配好了的本机 Ollama」，
 * 用户会拿到一个开始按钮，点下去必然失败。
 */
export function activeLlm(settings: Settings): LlmConfig {
  const fallback: LlmConfig = { baseUrl: DEFAULT_BASE_URL, apiKey: '', model: DEFAULT_MODEL }
  const endpoint = findEndpoint(settings, settings.active.baseUrl)
  if (endpoint === null) return fallback
  if (!endpoint.models.includes(settings.active.model)) return fallback
  return { baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey, model: settings.active.model }
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
  // OpenCode Go 是网关，一把 Key 后面挂着 DeepSeek / Kimi / GLM / MiMo 等十几个模型。
  // baseUrl 只到 /v1：官方文档给的是完整端点 https://opencode.ai/zen/go/v1/chat/completions，
  // 而 client.ts 会自己接上 /chat/completions，照抄文档会拼成两遍。下面有用例钉这条。
  // 模型 id 在这个端点上不带 opencode-go/ 前缀——那个前缀只用于 OpenCode 自己的配置文件。
  { label: { zh_CN: 'OpenCode Go', en: 'OpenCode Go' }, baseUrl: 'https://opencode.ai/zen/go/v1', model: 'deepseek-v4-flash' },
  { label: { zh_CN: '本地 Ollama', en: 'Local Ollama' }, baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' },
]

/**
 * 被删掉的旧旋钮名单。**一个都不认**——存储里遗留的这些键读都不读，下次保存设置时
 * 自然被覆盖掉。所以这里没有 `LegacySettings` 那样的类型，`loadSettings` 也不去碰它们。
 *
 * 不认的理由是同一条：这些旋钮当年管的事，今天已经由 TidyMark 自己按当次扫描现判。
 * 继续认旧值等于把删掉的旋钮偷偷留着——用户在设置页看不到它，行为却还被它牵着走。
 *
 * - `rebuildStructure`：当年管「推翻重建还是就地整理」。现在每次按扫描结果现判
 *   （见 core/mode.ts），用户也能在界面上临时改判，没有一个常驻开关的位置。
 * - `maxTopFolders`：当年管「同一层最多几个目录」。现在由这次要整理的书签总数推导
 *   （deriveShape，见 core/shape.ts 与 issues/10-shape-from-count.md）。
 * - `maxFolderDepth`：当年管「最深嵌到第几层」。同样由 deriveShape 定——书签量撑不起
 *   两层就只建一层，撑得起才往下分，跟用户勾在哪一层无关。
 * - `allowSubfolders`：比 `maxFolderDepth` 更早的一代，当年是个「允不允许二级目录」的
 *   布尔。它曾被翻译成 `maxFolderDepth: 1`；那个目标字段现在也没了，翻译没有落点，
 *   于是连同被它取代的那一代一起不认。
 * - `enforceMinFolderSize` / `minFolderSize`：当年管「目录至少装几个书签才值得建」，
 *   还带一个「整个关掉」的开关。这个数字用户无从判断（3 还是 5 更好，取决于这批书签的
 *   主题有多分散，跑完一次才看得出来），现在退成 core 里的内部常量
 *   `MIN_FOLDER_BOOKMARKS`（见 core/prune.ts）。**约束一律生效**——以前关掉过开关的人
 *   下次整理会吃到它，这是删旋钮的代价，不是回归。
 *
 * 判例：**删掉一个旋钮时，存量值一律读取时忽略，而不是继续在后台生效。**
 * 代价是「上周关掉过二级目录」的人下次整理会看到行为变化——这是有意接受的：
 * 那件事现在由书签量说了算，把旧值留着只会让两套逻辑打架。
 *
 * - `llm`：当年是唯一那套模型配置。现在由 endpoints + active 取代，**只在迁移时读一次**
 *   （见 migrateEndpoints），存储里已经有 endpoints 之后就再也不看它。
 * - `modelHistory`：短命的一代，「按 baseUrl 记住用过的模型名」。端点表把模型名单交给
 *   用户手工维护之后，自动攒的那份历史就是第二个真相源——名单里躺着一条用户已经删掉的
 *   模型，是「双份真相」的教科书样子。读都不读。
 */
export async function loadSettings(ports: Ports): Promise<Settings> {
  const stored = await ports.storage.get<Partial<Settings> & { llm?: LlmConfig }>(SETTINGS_KEY)
  // ports.storage.get 的返回类型是 T | null（见 core/ports.ts），migrateEndpoints
  // 的参数按存量代码的既有习惯写的是 T | undefined——这里只做一次 null → undefined
  // 的规整，migrateEndpoints 自身的签名不用为了这一处调用改
  const migrated = migrateEndpoints(stored ?? undefined)
  return {
    endpoints: migrated.endpoints,
    active: migrated.active,
    removeEmptyFolders: stored?.removeEmptyFolders ?? DEFAULT_SETTINGS.removeEmptyFolders,
    domainGroups: stored?.domainGroups ?? DEFAULT_SETTINGS.domainGroups,
    rewriteGithubTitles: stored?.rewriteGithubTitles ?? DEFAULT_SETTINGS.rewriteGithubTitles,
    uiLocale: stored?.uiLocale ?? DEFAULT_SETTINGS.uiLocale,
  }
}

/**
 * 单套配置 → 端点表。
 *
 * 只在存储里**还没有** endpoints 时才看那个上一代的 llm：迁移过一次之后
 * 它就是残留，再读它会把用户后来在端点表里做的修改盖回去。
 */
function migrateEndpoints(
  stored: (Partial<Settings> & { llm?: LlmConfig }) | undefined,
): Pick<Settings, 'endpoints' | 'active'> {
  if (stored?.endpoints !== undefined) {
    return { endpoints: stored.endpoints, active: stored.active ?? DEFAULT_SETTINGS.active }
  }
  const llm = stored?.llm
  if (llm === undefined) {
    return { endpoints: DEFAULT_SETTINGS.endpoints, active: DEFAULT_SETTINGS.active }
  }
  return {
    endpoints: [{ baseUrl: llm.baseUrl, apiKey: llm.apiKey, models: [llm.model] }],
    active: { baseUrl: llm.baseUrl, model: llm.model },
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

/**
 * 落盘前按写入顺序截到 MAX_CACHE_ENTRIES：Map 保插入顺序，`[...cache]` 就是写入
 * 顺序，取后 MAX_CACHE_ENTRIES 项＝淘汰最早写入的那批（FIFO）。
 *
 * 只截落盘的这一份，不动传进来的那个 Map——同一轮里 classifyBookmarks 还拿着它
 * 在用，就地删条目等于在别人手里抽东西。
 *
 * FIFO 的已知代价，写在这儿别装作没有：命中缓存不刷新条目位置（全程只有
 * llm/classify.ts 里那一处 cache.set 会写），所以一条写过一次、之后被命中一百次
 * 的条目，仍按它最初的写入时间被淘汰，可能先于一条刚写进来、再也用不上的条目。
 * 而且 Map.set 对已存在的 key 只改值不挪位置，这个顺序严格说是「首次写入顺序」，
 * 重写一条也不会让它变年轻。要修得改成命中时重新插入（LRU），代价是让读也变成
 * 写。这个量级下不值当——先记下来。
 */
export async function saveCache(ports: Ports, cache: Map<string, CachedClassification>): Promise<void> {
  const entries = [...cache]
  // 算成正索引而不是写 slice(-MAX_CACHE_ENTRIES)：负索引在不足上限时确实原样
  // 返回全部条目，但上限为 0 时 -0 会被当成 0，slice(0) 同样返回全部——「一条
  // 都不留」悄悄变成「不限」。今天 MAX_CACHE_ENTRIES 是常量碰不到，将来有人
  // 把它调小做实验时不该踩这个坑。
  await ports.storage.set(CACHE_KEY, entries.slice(Math.max(0, entries.length - MAX_CACHE_ENTRIES)))
}
