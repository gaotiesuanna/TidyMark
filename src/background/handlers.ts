import { resolveLocale, t } from '@/i18n'
import { buildCandidatesFromFolders } from '@/core/map'
import type { Locale } from '@/core/locale'
import { buildPlan, type NewFolderSpec, type RenameFolderSpec } from '@/core/plan'
import { scanTree } from '@/core/scan'
import { planTitleRewrites } from '@/core/titles'
import { buildCategoryTree } from '@/core/tree'
import type { Ports } from '@/core/ports'
import type { Classification, TagResult } from '@/core/types'
import { applyPlan } from '@/engine/apply'
import { loadSnapshot } from '@/engine/snapshot'
import { undoLast } from '@/engine/undo'
import { createLlmClient, type LlmClient, type LlmConfig } from '@/llm/client'
import { classifyBookmarks } from '@/llm/classify'
import { designTagFolders } from '@/llm/folders'
import { extractTags, refineGroupTags } from '@/llm/tags'
import { loadCache, loadSettings, saveCache, saveSettings } from '@/storage/settings'
import { findBookmarksBar } from '@/core/import'
import { importTree } from '@/engine/importTree'
import type { EmitProgress, ProgressPhase } from './events'
import type { Request, Response } from './messages'

export interface HandlerDeps {
  createClient?: (config: LlmConfig, locale: Locale) => LlmClient
  now?: () => number
  /** 仅供测试注入，生产环境使用 classifyBookmarks 的默认值。 */
  batchSize?: number
  /** 把进度与日志推回侧栏。 */
  onEvent?: EmitProgress
  /** 用户是否点了取消。分析在批次之间检查它。 */
  isCancelled?: () => boolean
}

const CANCELLED: Response = { ok: false, error: t('errAnalysisCancelled'), cancelled: true }

export async function handle(
  ports: Ports,
  request: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  const createClient = deps.createClient ?? ((config: LlmConfig, locale: Locale) => createLlmClient(config, locale))
  const now = deps.now ?? (() => Date.now())
  const emit = deps.onEvent ?? ((): void => {})
  const log = (phase: ProgressPhase, message: string, level: 'info' | 'warn' | 'error' = 'info'): void =>
    emit({ phase, message, level })
  const progress = (phase: ProgressPhase) => (done: number, total: number): void =>
    emit({ phase, message: '', done, total })
  const isCancelled = deps.isCancelled ?? ((): boolean => false)
  const locale = resolveLocale()

  try {
    switch (request.kind) {
      case 'get_tree':
        return { ok: true, kind: 'get_tree', tree: await ports.bookmarks.getTree() }

      case 'scan': {
        const tree = await ports.bookmarks.getTree()
        const scan = scanTree(tree, request.scopeRootIds)
        log('scan', t('logScanDone', String(scan.stats.totalBookmarks), String(scan.stats.totalFolders)))
        return { ok: true, kind: 'scan', scan }
      }

      case 'analyze': {
        const settings = await loadSettings(ports)
        if (settings.llm.apiKey.trim() === '') {
          return { ok: false, error: t('errNoApiKey') }
        }
        const tree = await ports.bookmarks.getTree()
        const scan = scanTree(tree, request.scopeRootIds)

        const client = createClient(settings.llm, locale)
        let candidates = buildCandidatesFromFolders(scan.folders, request.scopeRootIds)
        let newFolders: NewFolderSpec[] = []
        let renameFolders: RenameFolderSpec[] = []
        let pinned: Classification[] = []
        let tags: TagResult[] = []

        if (settings.rebuildStructure) {
          const rootId = request.scopeRootIds[0]
          if (rootId === undefined) return { ok: false, error: t('errNoScope') }
          log('tags', t('logTagsStart', String(scan.bookmarks.length)))
          tags = await extractTags(scan.bookmarks, client, locale, {
            onProgress: progress('tags'),
            onLog: (message, level) => log('tags', message, level),
            isCancelled,
          })
          if (isCancelled()) return CANCELLED
          // 组内的共同点已经写在目录名上，通用标签在这里没有区分度，换一套细的重抽
          if (settings.domainGroups.length > 0) {
            tags = await refineGroupTags(tags, scan.bookmarks, settings.domainGroups, client, locale, {
              onLog: (message, level) => log('tags', message, level),
              isCancelled,
            })
            if (isCancelled()) return CANCELLED
          }
          // 分批抽标签的模型看不到全局，同义碎片只能在这里归并
          log('tree', t('logTreeStart', String(scan.bookmarks.length)))
          tags = await designTagFolders(tags, scan.bookmarks, settings.domainGroups, client, locale, {
            onLog: (message, level) => log('tree', message, level),
            isCancelled,
          })
          if (isCancelled()) return CANCELLED
          const tree_ = buildCategoryTree({
            tags, rootId, existingFolders: scan.folders,
            bookmarks: scan.bookmarks, domainGroups: settings.domainGroups, locale,
          })
          candidates = tree_.candidates
          newFolders = tree_.newFolders
          renameFolders = tree_.renameFolders
          pinned = tree_.pinned
          log(
            'tree',
            t(
              'logTreeDone',
              String(tree_.newFolders.length),
              String(tree_.candidates.length - tree_.newFolders.length),
            ),
          )
          if (pinned.length > 0) {
            log('tree', t('logPinnedSkip', String(pinned.length)))
          }
        }

        if (candidates.length === 0) {
          return { ok: false, error: t('errNoTargetFolders') }
        }
        const cache = await loadCache(ports)
        // 已按域名确定归属的书签不必再花一次分类调用
        const pinnedIds = new Set(pinned.map((p) => p.bookmarkId))
        const toClassify = scan.bookmarks.filter((b) => !pinnedIds.has(b.id))
        log('classify', t('logClassifyStart', String(toClassify.length), String(candidates.length)))
        const llmResults = await classifyBookmarks({
          items: toClassify,
          candidates,
          client,
          cache,
          batchSize: deps.batchSize,
          onProgress: progress('classify'),
          onLog: (message, level) => log('classify', message, level),
          isCancelled,
          locale,
        })
        const classifications = [...pinned, ...llmResults]
        // 已经跑完的批次仍然写进缓存，重来时不必再花一次钱
        await saveCache(ports, cache)
        if (isCancelled()) return CANCELLED

        // source === 'none' 只在请求失败或模型漏返回时出现——模型判定"无合适目录"
        // 走的是 source === 'llm' + targetCategoryId === null 这条路。
        const failed = llmResults.filter((c) => c.source === 'none')
        if (toClassify.length > 0 && failed.length === toClassify.length) {
          return {
            ok: false,
            error: t('errClassifyAllFailed', failed[0]!.reason),
          }
        }
        const warnings =
          failed.length > 0
            ? [
                t(
                  'logClassifyFailed',
                  String(failed.length),
                  // detail 是 reason 剥掉「分类失败，保持原位：」这类双语前缀后的纯错误信息；
                  // logClassifyFailed 自己的文案已经说过"分类失败"，不能再把整句 reason 塞进去重复一遍。
                  failed[0]!.detail ?? failed[0]!.reason,
                ),
              ]
            : []
        // 标题统一与目录整理相互独立：它由自己的开关决定，不受移动建议的勾选影响
        const titleRewrites = settings.rewriteGithubTitles
          ? planTitleRewrites(scan.bookmarks)
          : []
        if (titleRewrites.length > 0) {
          log('classify', t('logTitleRewrites', String(titleRewrites.length)))
        }
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
          tags,
          titleRewrites,
        })
        for (const warning of warnings) log('classify', warning, 'warn')
        log('classify', t('logAnalyzeDone', String(plan.rows.length)))
        return { ok: true, kind: 'analyze', plan }
      }

      case 'apply': {
        const settings = await loadSettings(ports)
        const result = await applyPlan(ports, request.plan, new Set(request.accepted), locale, {
          removeEmptyFolders: settings.removeEmptyFolders,
          onProgress: progress('apply'),
        })
        log(
          'apply',
          t(
            result.status === 'completed' ? 'logApplyDone' : 'logApplyInterrupted',
            String(result.executed),
            String(result.removedFolders.length),
            String(result.sortedFolders),
          ),
          result.status === 'completed' ? 'info' : 'error',
        )
        return { ok: true, kind: 'apply', result }
      }

      case 'undo': {
        const result = await undoLast(ports, locale, progress('undo'))
        log('undo', t('logUndoDone', String(result.restored), String(result.removedFolders)))
        return { ok: true, kind: 'undo', result }
      }

      case 'get_settings':
        return { ok: true, kind: 'get_settings', settings: await loadSettings(ports) }

      case 'save_settings':
        await saveSettings(ports, request.settings)
        return { ok: true, kind: 'save_settings' }

      case 'import': {
        // 用自己新读的树查书签栏，不接受侧栏传来的 id——那份树可能已经过期
        const tree = await ports.bookmarks.getTree()
        const bar = findBookmarksBar(tree)
        if (bar === null) return { ok: false, error: t('errNoBookmarksBar') }

        const result = await importTree(ports, request.nodes, request.targetName, bar.id)
        log('import', t('logImportDone', String(result.bookmarks), String(result.folders)))
        return { ok: true, kind: 'import', result }
      }

      // 取消标记由 service worker 持有，这里只是让消息类型闭合
      case 'cancel':
        return { ok: true, kind: 'cancel' }

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
