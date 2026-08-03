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
}

export interface Classification {
  bookmarkId: string
  targetCategoryId: string | null
  confidence: number
  reason: string
  source: 'rule' | 'llm' | 'none'
}
