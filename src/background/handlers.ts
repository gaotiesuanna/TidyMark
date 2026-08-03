import { buildCandidatesFromFolders } from '@/core/map'
import { buildPlan, type NewFolderSpec, type RenameFolderSpec } from '@/core/plan'
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
import type { EmitProgress, ProgressPhase } from './events'
import type { Request, Response } from './messages'

export interface HandlerDeps {
  createClient?: (config: LlmConfig) => LlmClient
  now?: () => number
  /** 仅供测试注入，生产环境使用 classifyBookmarks 的默认值。 */
  batchSize?: number
  /** 把进度与日志推回侧栏。 */
  onEvent?: EmitProgress
}

export async function handle(
  ports: Ports,
  request: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  const createClient = deps.createClient ?? ((config: LlmConfig) => createLlmClient(config))
  const now = deps.now ?? (() => Date.now())
  const emit = deps.onEvent ?? ((): void => {})
  const log = (phase: ProgressPhase, message: string, level: 'info' | 'warn' | 'error' = 'info'): void =>
    emit({ phase, message, level })
  const progress = (phase: ProgressPhase) => (done: number, total: number): void =>
    emit({ phase, message: '', done, total })

  try {
    switch (request.kind) {
      case 'get_tree':
        return { ok: true, kind: 'get_tree', tree: await ports.bookmarks.getTree() }

      case 'scan': {
        const tree = await ports.bookmarks.getTree()
        const scan = scanTree(tree, request.scopeRootIds)
        log('scan', `扫描完成：${scan.stats.totalBookmarks} 个书签、${scan.stats.totalFolders} 个文件夹`)
        return { ok: true, kind: 'scan', scan }
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
        let renameFolders: RenameFolderSpec[] = []

        if (settings.rebuildStructure) {
          const rootId = request.scopeRootIds[0]
          if (rootId === undefined) return { ok: false, error: '未选择任何范围。' }
          log('tags', `开始为 ${scan.bookmarks.length} 个书签抽取主题标签`)
          const tags = await extractTags(scan.bookmarks, client, {
            onProgress: progress('tags'),
            onLog: (message, level) => log('tags', message, level),
          })
          const tree_ = buildCategoryTree({ tags, rootId, existingFolders: scan.folders })
          candidates = tree_.candidates
          newFolders = tree_.newFolders
          renameFolders = tree_.renameFolders
          log(
            'tree',
            `目录设计完成：新建 ${tree_.newFolders.length} 个目录，` +
              `复用 ${tree_.candidates.length - tree_.newFolders.length} 个已有目录`,
          )
        }

        if (candidates.length === 0) {
          return { ok: false, error: '所选范围内没有可用的目标文件夹。请开启「重建结构」或先选择包含子文件夹的范围。' }
        }
        const cache = await loadCache(ports)
        log('classify', `开始分类：${scan.bookmarks.length} 个书签，${candidates.length} 个候选目录`)
        const classifications = await classifyBookmarks({
          items: scan.bookmarks,
          candidates,
          client,
          cache,
          batchSize: deps.batchSize,
          onProgress: progress('classify'),
          onLog: (message, level) => log('classify', message, level),
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
            ? [
                `${failed.length} 个书签分类失败，已保持原位。原因：` +
                  failed[0]!.reason.replace(/^分类失败，保持原位：/, ''),
              ]
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
          renameFolders,
          warnings,
        })
        for (const warning of warnings) log('classify', warning, 'warn')
        log('classify', `分析完成：${plan.rows.length} 条移动建议`)
        return { ok: true, kind: 'analyze', plan }
      }

      case 'apply': {
        const settings = await loadSettings(ports)
        const result = await applyPlan(ports, request.plan, new Set(request.accepted), {
          removeEmptyFolders: settings.removeEmptyFolders,
          onProgress: progress('apply'),
        })
        log(
          'apply',
          `整理${result.status === 'completed' ? '完成' : '中断'}：执行 ${result.executed} 步，` +
            `清理空文件夹 ${result.removedFolders.length} 个`,
          result.status === 'completed' ? 'info' : 'error',
        )
        return { ok: true, kind: 'apply', result }
      }

      case 'undo': {
        const result = await undoLast(ports, progress('undo'))
        log('undo', `撤销完成：还原 ${result.restored} 项，删除新建目录 ${result.removedFolders} 个`)
        return { ok: true, kind: 'undo', result }
      }

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
