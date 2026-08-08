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
  depth: number
}

export interface ScanStats {
  totalBookmarks: number
  totalFolders: number
  emptyFolders: number
  untitledBookmarks: number
  duplicateUrlGroups: number
  maxDepth: number
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
  /** 该目录属于哪个域名聚合组；主题目录不带此字段。删除聚合目录时据此决定回落。 */
  domainGroup?: string
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
  source: 'rule' | 'llm' | 'none'
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
  confidence: number
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
