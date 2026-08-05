import type { ExportNode } from '@/core/export'
import type { Ports } from '@/core/ports'

export interface ImportSkip {
  name: string
  /** 文件夹没有 url，这里是空串。 */
  url: string
  reason: string
}

export interface ImportResult {
  /** 新建的目标文件夹 id。 */
  folderId: string
  bookmarks: number
  /** 不含目标文件夹本身。 */
  folders: number
  skipped: ImportSkip[]
}

/**
 * 把归一后的节点建进一个新建的目标文件夹。
 *
 * 单条失败不中断——写了一半的导入仍然比整个失败有用，撤销本来就是删掉目标文件夹。
 * URL 的安全过滤在 core/import.ts 的归一阶段已经做完，这里只管建。
 */
export async function importTree(
  ports: Ports,
  nodes: ExportNode[],
  targetName: string,
  parentId: string,
): Promise<ImportResult> {
  const root = await ports.bookmarks.create({ parentId, title: targetName })
  const result: ImportResult = { folderId: root.id, bookmarks: 0, folders: 0, skipped: [] }

  async function walk(items: ExportNode[], into: string): Promise<void> {
    // 必须串行：并发创建拿不到稳定的同级顺序
    for (const item of items) {
      if ('url' in item) {
        try {
          await ports.bookmarks.create({ parentId: into, title: item.name, url: item.url })
          result.bookmarks += 1
        } catch (error) {
          result.skipped.push({ name: item.name, url: item.url, reason: `创建失败：${String(error)}` })
        }
        continue
      }
      let folderId: string
      try {
        folderId = (await ports.bookmarks.create({ parentId: into, title: item.name })).id
        result.folders += 1
      } catch (error) {
        // 建不出目录，它整棵子树都没地方放，跳过
        result.skipped.push({ name: item.name, url: '', reason: `文件夹创建失败：${String(error)}` })
        continue
      }
      await walk(item.children, folderId)
    }
  }

  await walk(nodes, root.id)
  return result
}
