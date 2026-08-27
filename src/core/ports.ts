export interface HistoryVisit {
  url: string
  lastVisitTime?: number
}

export interface BookmarkNode {
  id: string
  parentId?: string
  index?: number
  title: string
  url?: string
  children?: BookmarkNode[]
}

export interface BookmarksApi {
  getTree(): Promise<BookmarkNode[]>
  get(id: string): Promise<BookmarkNode | null>
  /** 传了 url 建书签，没传建文件夹。 */
  create(arg: { parentId: string; title: string; index?: number; url?: string }): Promise<BookmarkNode>
  move(id: string, dest: { parentId?: string; index?: number }): Promise<BookmarkNode>
  update(id: string, changes: { title: string }): Promise<BookmarkNode>
  remove(id: string): Promise<void>
}

export interface StorageApi {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
}

export interface Ports {
  bookmarks: BookmarksApi
  storage: StorageApi
}
