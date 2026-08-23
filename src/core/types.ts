export type ResourceType =
  | 'documentation' | 'article' | 'repository' | 'tool'
  | 'paper' | 'video' | 'community' | 'dashboard' | 'other'

export interface BookmarkItem {
  id: string
  title: string
  url: string
  parentId: string
  index: number
  currentPath: string[]
  dateAdded?: number
}

export interface FolderItem {
  id: string
  title: string
  parentId: string | null
  index: number
  path: string[]
  /** 相对于勾选点的深度，勾中的那个是 0。回答「这次要遍历多深」。 */
  depth: number
  /** 在书签库里的固定层级，与勾了哪里无关。回答「这是几级目录」。见 core/level.ts。 */
  level: number
}

export interface ScanStats {
  totalBookmarks: number
  totalFolders: number
  emptyFolders: number
  untitledBookmarks: number
  duplicateUrlGroups: number
  maxDepth: number
  /**
   * 同父同名的目录有几组。口径与 duplicateUrlGroups 一致：数的是「组」不是「条」，
   * 三个同名目录算一组。
   *
   * 比较前剥掉编号前缀：「01 前端」和「02 前端」对用户就是重名，编号是 TidyMark 自己加的。
   * 不同父目录下的同名目录不算——它们父目录不同，用户和模型都分得清。
   */
  duplicateFolderGroups: number
}

export interface ScanResult {
  bookmarks: BookmarkItem[]
  folders: FolderItem[]
  stats: ScanStats
}

/** 分类的候选目标。id 为现有文件夹 id，或推翻模式下的临时 id（形如 `tmp:1`）。 */
export interface CategoryCandidate {
  id: string
  path: string[]
}

export interface Classification {
  bookmarkId: string
  targetCategoryId: string | null
  confidence: number
  reason: string
  /**
   * reason 的纯 detail 部分（不含「分类失败，保持原位：」这类双语前缀）。
   * 只有 llm/classify.ts 因请求失败兜底时才会填；调用方需要拼接展示 detail
   * 而不是 reason 全文时（例如结果页避免同一句话说两遍）用它。
   */
  detail?: string
  /**
   * 模型判「无合适目录」时顺手带回的简短主题。**只有 targetCategoryId === null 时才有。**
   * 非推翻模式靠它把无家可归的书签聚类成新目录（见 core/newTopics.ts）；
   * 让分类那一轮顺手带回，是为了不为抽标签另花一轮调用。
   */
  topic?: string
  source: 'rule' | 'llm' | 'none'
}

/**
 * 缓存里存的分类结果。目标目录记**路径**不记 id——推翻模式下 id 是每轮重新
 * 生成的临时值（tmp:N），存 id 等于把上一轮的编号分配套到这一轮头上。命中时
 * 拿路径去当前候选里换回 id，换不到就当没命中。
 *
 * 另存 url：key 里存的只是 djb2(url) 这个 32 位哈希，不是 url 本身，两个不同
 * 的 URL 完全可能撞出同一个 key。命中时要比对 url 是否真的一致，不一致就当
 * 没命中——不然会把另一个书签的分类结果套过来，比撞了白算一次更糟。
 *
 * 不存 bookmarkId（已经存了完整 url，够用）也不存 source：只有 source ===
 * 'llm' 的结果才进缓存，命中时按 'llm' 还原即可。
 */
export interface CachedClassification {
  /** 目标目录的完整路径；模型判「无合适目录」时为 null。 */
  targetPath: string[] | null
  /** 书签的原始 URL，用于识别 key 撞车（djb2 是 32 位）——见上。 */
  url: string
  confidence: number
  reason: string
  /** 同 Classification.topic。必须进缓存——否则第二轮命中缓存的书签会丢掉主题，永远攒不成新目录。 */
  topic?: string
}

export type BookmarkOperation =
  | { type: 'create_folder'; temporaryId: string; parentId: string | null; parentTemporaryId: string | null; title: string }
  | { type: 'move_bookmark'; bookmarkId: string; fromParentId: string; originalIndex: number; toCategoryId: string; toTemporaryId: string | null; confidence: number; reason: string }
  | { type: 'rename_folder'; folderId: string; oldTitle: string; newTitle: string }
  | { type: 'rename_bookmark'; bookmarkId: string; oldTitle: string; newTitle: string }

/** Review 界面里的一行，与一条 move 操作一一对应。 */
export interface PlanRow {
  bookmarkId: string
  title: string
  url: string
  fromPath: string[]
  toPath: string[]
  /**
   * 目标目录的 candidate id——与对应 move 操作的 toCategoryId 保持一致。
   *
   * toPath 是给人看的路径字符串，会随 renumberPlan、合并根前缀等展示层加工而变化，
   * 拿它反查候选在多种状态下会落空（部分取消勾选、合并模式……），下拉选中值、分组键
   * 这类需要精确匹配候选的地方，必须直接用这个字段，不能反查 toPath。
   */
  toCategoryId: string
  confidence: number
  reason: string
  /** 这条建议是域名规则命中的还是模型判的。复核页靠它把整组规则命中的默认折叠。 */
  source: 'rule' | 'llm' | 'none'
}

/**
 * 这一轮**不会被动**的书签。
 *
 * 它们此前被 `buildPlan` 直接跳过，于是复核页上一个字都没有——而按根尺子
 * 「三个月后逐层浏览摸得到」，**没动的那批恰恰是「找不到」的那批**，用户却完全看不见，
 * 没法判断这次整理到底盖到了多少（见 issues/05-homeless-bookmarks.md「决定 3」）。
 */
export interface UnchangedRow {
  bookmarkId: string
  title: string
  url: string
  currentPath: string[]
  /**
   * - `inPlace`：已经在该去的目录里了。好消息，不是问题。
   * - `noTarget`：模型判「没有合适目录」。
   * - `failed`：分类请求失败，或压根没轮到它。
   *
   * 三者必须分开显示——它们对用户的含义完全不同，而今天它们混在同一条路上。
   */
  kind: 'inPlace' | 'noTarget' | 'failed'
  /** 分类阶段给的理由；`inPlace` 时为空串。 */
  reason: string
}

export interface PlanSummary {
  totalBookmarks: number
  movedBookmarks: number
  unchangedBookmarks: number
  createdFolders: number
  renamedFolders: number
  renamedBookmarks: number
  lowConfidenceItems: number
}

export interface OrganizePlan {
  id: string
  createdAt: number
  scopeRootIds: string[]
  rebuildStructure: boolean
  candidates: CategoryCandidate[]
  operations: BookmarkOperation[]
  rows: PlanRow[]
  /** 这一轮没被动过的书签，按原因分三类。见 UnchangedRow。 */
  unchanged: UnchangedRow[]
  summary: PlanSummary
  /** 部分失败时的提示，例如某些书签因模型报错未能分类。 */
  warnings: string[]
  /** 推翻模式下抽取的主题标签。删除聚合目录时据此决定书签回落到哪个主题目录。 */
  tags: TagResult[]
  /** 合并模式下新建的容器目录；非合并模式为 null。 */
  mergeRoot: {
    temporaryId: string
    title: string
    /**
     * 被合并的源根 id。
     *
     * 不能用 scopeRootIds 代替——那里装的是级联勾选的全集，
     * 勾一个父目录会连它所有子目录一起进去，既数不对个数，
     * 也不能当作「允许被删除的根」的名单。
     */
    sourceRootIds: string[]
    /** 源根的标题，用于命名兜底与结果页文案。 */
    sourceTitles: string[]
  } | null
}

/** 推翻模式下由模型抽取的主题标签，供 core/tree.ts 聚合成目录树。 */
export interface TagResult {
  bookmarkId: string
  primaryTopic: string
  secondaryTopic: string | null
}
