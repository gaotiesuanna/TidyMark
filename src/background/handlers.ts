import { buildCandidatesFromFolders } from '@/core/map'
import { buildPlan, type NewFolderSpec } from '@/core/plan'
import { scanTree } from '@/core/scan'
import { buildCategoryTree } from '@/core/tree'
import type { Ports } from '@/core/ports'
import { applyPlan } from '@/engine/apply'
import { loadSnapshot } from '@/engine/snapshot'
import { undoLast } from '@/engine/undo'
import { createLlmClient, type LlmClient, type LlmConfig } from '@/llm/client'
import { classifyBookmarks } from '@/llm/classify'
import { extractTags } from '@/llm/tags'
import { loadCache, loadSettings, saveCache, saveSettings } from '@/storage/settings'
import type { Request, Response } from './messages'

export interface HandlerDeps {
  createClient?: (config: LlmConfig) => LlmClient
  now?: () => number
  /** 仅供测试注入，生产环境使用 classifyBookmarks 的默认值。 */
  batchSize?: number
}

export async function handle(
  ports: Ports,
  request: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  const createClient = deps.createClient ?? ((config: LlmConfig) => createLlmClient(config))
  const now = deps.now ?? (() => Date.now())

  try {
    switch (request.kind) {
      case 'get_tree':
        return { ok: true, kind: 'get_tree', tree: await ports.bookmarks.getTree() }

      case 'scan': {
        const tree = await ports.bookmarks.getTree()
        return { ok: true, kind: 'scan', scan: scanTree(tree, request.scopeRootIds) }
      }

      case 'analyze': {
        const settings = await loadSettings(ports)
        if (settings.llm.apiKey.trim() === '') {
          return { ok: false, error: '尚未配置 API Key，请先在设置中填写。' }
        }
        const tree = await ports.bookmarks.getTree()
        const scan = scanTree(tree, request.scopeRootIds)

        const client = createClient(settings.llm)
        let candidates = buildCandidatesFromFolders(scan.folders, request.scopeRootIds)
        let newFolders: NewFolderSpec[] = []

        if (settings.rebuildStructure) {
          const rootId = request.scopeRootIds[0]
          if (rootId === undefined) return { ok: false, error: '未选择任何范围。' }
          const tags = await extractTags(scan.bookmarks, client)
          const tree_ = buildCategoryTree({
            tags,
            rootId,
            existingFolders: scan.folders.map((f) => f.title),
          })
          candidates = tree_.candidates
          newFolders = tree_.newFolders
        }

        if (candidates.length === 0) {
          return { ok: false, error: '所选范围内没有可用的目标文件夹。请开启「重建结构」或先选择包含子文件夹的范围。' }
        }
        const cache = await loadCache(ports)
        const classifications = await classifyBookmarks({
          items: scan.bookmarks,
          candidates,
          client,
          cache,
          batchSize: deps.batchSize,
        })
        await saveCache(ports, cache)

        // source === 'none' 只在请求失败或模型漏返回时出现——模型判定"无合适目录"
        // 走的是 source === 'llm' + targetCategoryId === null 这条路。
        const failed = classifications.filter((c) => c.source === 'none')
        if (scan.bookmarks.length > 0 && failed.length === scan.bookmarks.length) {
          return {
            ok: false,
            error: `AI 分析失败，没有任何书签完成分类。\n${failed[0]!.reason}`,
          }
        }
        const warnings =
          failed.length > 0
            ? [`${failed.length} 个书签分类失败，已保持原位：${failed[0]!.reason}`]
            : []
        const plan = buildPlan({
          id: `plan-${now()}`,
          createdAt: now(),
          scopeRootIds: request.scopeRootIds,
          rebuildStructure: settings.rebuildStructure,
          items: scan.bookmarks,
          candidates,
          classifications,
          newFolders,
          warnings,
        })
        return { ok: true, kind: 'analyze', plan }
      }

      case 'apply': {
        const result = await applyPlan(ports, request.plan, new Set(request.accepted))
        return { ok: true, kind: 'apply', result }
      }

      case 'undo':
        return { ok: true, kind: 'undo', result: await undoLast(ports) }

      case 'get_settings':
        return { ok: true, kind: 'get_settings', settings: await loadSettings(ports) }

      case 'save_settings':
        await saveSettings(ports, request.settings)
        return { ok: true, kind: 'save_settings' }

      case 'get_undo_state': {
        const snapshot = await loadSnapshot(ports)
        return {
          ok: true,
          kind: 'get_undo_state',
          available: snapshot !== null,
          createdAt: snapshot?.createdAt ?? null,
        }
      }
    }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}
