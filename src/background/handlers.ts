import { buildCandidatesFromFolders } from '@/core/map'
import { buildPlan } from '@/core/plan'
import { scanTree } from '@/core/scan'
import type { Ports } from '@/core/ports'
import { applyPlan } from '@/engine/apply'
import { loadSnapshot } from '@/engine/snapshot'
import { undoLast } from '@/engine/undo'
import { createLlmClient, type LlmClient, type LlmConfig } from '@/llm/client'
import { classifyBookmarks } from '@/llm/classify'
import { loadCache, loadSettings, saveCache, saveSettings } from '@/storage/settings'
import type { Request, Response } from './messages'

export interface HandlerDeps {
  createClient?: (config: LlmConfig) => LlmClient
  now?: () => number
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
        const candidates = buildCandidatesFromFolders(scan.folders, request.scopeRootIds)
        if (candidates.length === 0) {
          return { ok: false, error: '所选范围内没有可用的目标文件夹。请开启「重建结构」或先选择包含子文件夹的范围。' }
        }
        const cache = await loadCache(ports)
        const classifications = await classifyBookmarks({
          items: scan.bookmarks,
          candidates,
          client: createClient(settings.llm),
          cache,
        })
        await saveCache(ports, cache)
        const plan = buildPlan({
          id: `plan-${now()}`,
          createdAt: now(),
          scopeRootIds: request.scopeRootIds,
          rebuildStructure: settings.rebuildStructure,
          items: scan.bookmarks,
          candidates,
          classifications,
          newFolders: [],
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
