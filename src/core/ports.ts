export interface BookmarkNode {
  id: string
  parentId?: string
  index?: number
  title: string
  url?: string
  dateAdded?: number
  dateLastUsed?: number
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

/**
 * 后台能碰的全部浏览器能力，就这两样。
 *
 * 这里曾经还有一个 `history?: HistoryApi`，连同 chrome-ports.ts 里的实现一起，
 * 从头到尾没有任何一处读过它——「长期未点击」判的是书签自己的 dateLastUsed
 * 与 dateAdded（见 core/stale.ts），不是浏览历史。真正读历史的是侧栏的
 * sidepanel/lib/visits.ts，只给看板的访问排行用，而且要用户单独授权。
 *
 * 删掉它不只是清死代码：清理页那句「不读取浏览历史」从此由结构保证——
 * 后台层根本没有通往历史的口子，不再是靠一条「我们没调它」的测试拦着。
 */
export interface Ports {
  bookmarks: BookmarksApi
  storage: StorageApi
}
