import { create } from 'zustand'
import { t } from '@/i18n'
import type { ProgressEvent, ProgressPhase } from '@/background/events'
import type { BookmarkNode } from '@/core/ports'
import { LOW_CONFIDENCE, renumberPlan } from '@/core/plan'
import { applyStructureEdits, EMPTY_EDITS, type StructureEdits } from '@/core/structure'
import type { OrganizePlan, ScanResult } from '@/core/types'
import {
  buildImportPreview, parseImportFile,
  type BlockedLink, type ImportPreview,
} from '@/core/import'
import type { ApplyResult } from '@/engine/apply'
import type { ImportResult } from '@/engine/importTree'
import type { UndoResult } from '@/engine/undo'
import type { Settings } from '@/storage/settings'
import { DEFAULT_SETTINGS } from '@/storage/settings'
import { send } from './lib/send'
import { ensureHostPermission } from './lib/permissions'
import { connectProgress, startKeepalive, type ProgressConnection } from './lib/progress'

export type Step = 'scope' | 'preferences' | 'structure' | 'review' | 'result'

/** 分析完成后去哪一步：只有推翻模式才有新目录结构可确认。 */
export function nextStepAfterAnalyze(rebuildStructure: boolean): Step {
  return rebuildStructure ? 'structure' : 'review'
}

export interface LogLine {
  id: number
  phase: ProgressPhase
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface Progress {
  phase: ProgressPhase
  done: number
  total: number
}

/** 日志上限，超出后丢弃最旧的几行。 */
export const MAX_LOGS = 200
/** 单行长度上限——接口返回的错误体可能是整段 JSON，完整内容仍在后台 console 里。 */
export const MAX_LOG_LENGTH = 200

/** 只有带 message 的事件才写日志；纯进度事件不写。 */
export function appendLog(logs: LogLine[], event: ProgressEvent, id: number): LogLine[] {
  if (event.message === '') return logs
  const message =
    event.message.length > MAX_LOG_LENGTH
      ? `${event.message.slice(0, MAX_LOG_LENGTH)}…`
      : event.message
  const next = [...logs, { id, phase: event.phase, level: event.level ?? 'info', message }]
  return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next
}

/** 与后台的进度长连接，整个侧栏共用一条。 */
let connection: ProgressConnection | null = null

function findNode(tree: BookmarkNode[], id: string): BookmarkNode | null {
  const stack = [...tree]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.id === id) return node
    for (const child of node.children ?? []) stack.push(child)
  }
  return null
}

export function collectDescendantFolderIds(tree: BookmarkNode[], id: string): string[] {
  const root = findNode(tree, id)
  if (root === null) return []
  const ids: string[] = []
  const stack = [...(root.children ?? [])]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.url !== undefined) continue
    ids.push(node.id)
    for (const child of node.children ?? []) stack.push(child)
  }
  return ids
}

/** 树里所有文件夹的 id，供「全部展开」使用。 */
export function collectAllFolderIds(tree: BookmarkNode[]): string[] {
  const ids: string[] = []
  const stack = [...tree]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.url !== undefined) continue
    ids.push(node.id)
    for (const child of node.children ?? []) stack.push(child)
  }
  return ids
}

export function toggleChecked(
  checked: Set<string>,
  id: string,
  tree: BookmarkNode[],
): Set<string> {
  const next = new Set(checked)
  const affected = [id, ...collectDescendantFolderIds(tree, id)]
  if (next.has(id)) for (const each of affected) next.delete(each)
  else for (const each of affected) next.add(each)
  return next
}

interface State {
  step: Step
  tree: BookmarkNode[]
  checkedIds: Set<string>
  scan: ScanResult | null
  settings: Settings
  plan: OrganizePlan | null
  accepted: Set<string>
  applyResult: ApplyResult | null
  undoResult: UndoResult | null
  undoAvailable: boolean
  busy: string | null
  /** 当前在跑哪一步，决定能不能取消。 */
  busyKind: 'init' | 'scan' | 'analyze' | 'apply' | 'undo' | null
  error: string | null
  progress: Progress | null
  logs: LogLine[]
  logSeq: number
  /** 结构确认页的草稿态编辑，不写进 Settings，每次 analyze 重置。 */
  structureEdits: StructureEdits
  /** 已选中并解析成功的导入文件。 */
  importFile: { name: string; preview: ImportPreview } | null
  /** 文件级校验没过的原因，与 importFile 互斥。 */
  importError: string | null
  /** 导入完成后的结果，blocked 来自归一阶段，与 result.skipped 分开存但一起展示。 */
  importDone: {
    result: ImportResult
    blocked: BlockedLink[]
    targetName: string
    barTitle: string
  } | null

  init(): Promise<void>
  refreshTree(): Promise<void>
  pushEvent(event: ProgressEvent): void
  cancel(): Promise<void>
  toggle(id: string): void
  goScan(): Promise<void>
  setSettings(settings: Settings): Promise<void>
  analyze(): Promise<void>
  renameNode(id: string, title: string): void
  removeNode(id: string): void
  confirmStructure(): void
  backToPreferences(): void
  toggleAccepted(bookmarkId: string): void
  acceptAll(): void
  acceptHighConfidence(threshold: number): void
  rejectAll(): void
  apply(): Promise<void>
  undo(): Promise<void>
  readImportFile(name: string, text: string): void
  confirmImport(): Promise<void>
  resetImport(): void
  reset(): void
}

export const useStore = create<State>((set, get) => ({
  step: 'scope',
  tree: [],
  checkedIds: new Set(),
  scan: null,
  settings: DEFAULT_SETTINGS,
  plan: null,
  accepted: new Set(),
  applyResult: null,
  undoResult: null,
  undoAvailable: false,
  busy: null,
  busyKind: null,
  error: null,
  progress: null,
  logs: [],
  logSeq: 0,
  structureEdits: EMPTY_EDITS,
  importFile: null,
  importError: null,
  importDone: null,

  /** 整理或撤销之后重新读一次书签树，结果页据此展示真实结构。 */
  async refreshTree() {
    const res = await send({ kind: 'get_tree' })
    if (res.ok && res.kind === 'get_tree') set({ tree: res.tree })
  },

  pushEvent(event) {
    const { logs, logSeq } = get()
    set({
      logs: appendLog(logs, event, logSeq),
      logSeq: logSeq + 1,
      progress:
        event.total !== undefined && event.done !== undefined
          ? { phase: event.phase, done: event.done, total: event.total }
          : get().progress,
    })
  },

  async cancel() {
    // 只标记取消，真正的收尾由正在进行的 analyze 自己完成
    set({ busy: t('busyCancelling'), busyKind: null })
    await send({ kind: 'cancel' })
  },

  async init() {
    connection = connectProgress({
      onEvent: (event) => get().pushEvent(event),
      onDisconnect: () => {
        if (get().busy === null) return
        set({ busy: null, busyKind: null, error: t('errBackgroundRecycled') })
      },
    })
    set({ busy: t('busyReading'), busyKind: 'init', error: null })
    const treeRes = await send({ kind: 'get_tree' })
    const settingsRes = await send({ kind: 'get_settings' })
    const undoRes = await send({ kind: 'get_undo_state' })
    set({
      tree: treeRes.ok && treeRes.kind === 'get_tree' ? treeRes.tree : [],
      settings: settingsRes.ok && settingsRes.kind === 'get_settings' ? settingsRes.settings : DEFAULT_SETTINGS,
      undoAvailable: undoRes.ok && undoRes.kind === 'get_undo_state' ? undoRes.available : false,
      busy: null,
      busyKind: null,
    })
  },

  toggle(id) {
    set({ checkedIds: toggleChecked(get().checkedIds, id, get().tree) })
  },

  async goScan() {
    set({ busy: t('busyScanning'), busyKind: 'scan', error: null, progress: null, logs: [] })
    const res = await send({ kind: 'scan', scopeRootIds: [...get().checkedIds] })
    if (!res.ok) return set({ busy: null, busyKind: null, error: res.error })
    if (res.kind !== 'scan') return set({ busy: null, busyKind: null })
    set({ scan: res.scan, step: 'preferences', busy: null, busyKind: null })
  },

  async setSettings(settings) {
    await send({ kind: 'save_settings', settings })
    set({ settings })
  },

  async analyze() {
    const granted = await ensureHostPermission(get().settings.llm.baseUrl)
    if (!granted) {
      return set({ error: t('errHostPermission') })
    }
    set({ busy: t('busyAnalyzing'), busyKind: 'analyze', error: null, progress: null, logs: [] })
    // 分析可能跑好几分钟，期间持续 ping，别让后台因空闲被回收
    const stopKeepalive = startKeepalive(connection)
    const res = await send({ kind: 'analyze', scopeRootIds: [...get().checkedIds] })
      .finally(stopKeepalive)
    // 主动取消不是错误，日志里已经有记录，不弹红条
    if (!res.ok && res.cancelled === true) {
      return set({ busy: null, busyKind: null, error: null })
    }
    if (!res.ok) return set({ busy: null, busyKind: null, error: res.error })
    if (res.kind !== 'analyze') return set({ busy: null, busyKind: null })
    set({
      plan: res.plan,
      accepted: new Set(res.plan.rows.filter((r) => r.confidence >= LOW_CONFIDENCE).map((r) => r.bookmarkId)),
      structureEdits: EMPTY_EDITS,
      step: nextStepAfterAnalyze(get().settings.rebuildStructure),
      busy: null,
      busyKind: null,
    })
  },

  renameNode(id, title) {
    const edits = get().structureEdits
    set({ structureEdits: { ...edits, renames: { ...edits.renames, [id]: title } } })
  },

  removeNode(id) {
    const edits = get().structureEdits
    if (edits.removed.includes(id)) return
    set({ structureEdits: { ...edits, removed: [...edits.removed, id] } })
  },

  confirmStructure() {
    const plan = get().plan
    if (plan === null) return
    const next = applyStructureEdits(plan, get().structureEdits)
    set({
      plan: next,
      accepted: new Set(next.rows.filter((r) => r.confidence >= LOW_CONFIDENCE).map((r) => r.bookmarkId)),
      step: 'review',
    })
  },

  backToPreferences() {
    set({ step: 'preferences', structureEdits: EMPTY_EDITS })
  },

  toggleAccepted(bookmarkId) {
    const next = new Set(get().accepted)
    if (next.has(bookmarkId)) next.delete(bookmarkId)
    else next.add(bookmarkId)
    set({ accepted: next })
  },

  acceptAll() {
    set({ accepted: new Set((get().plan?.rows ?? []).map((r) => r.bookmarkId)) })
  },

  acceptHighConfidence(threshold) {
    set({
      accepted: new Set(
        (get().plan?.rows ?? []).filter((r) => r.confidence >= threshold).map((r) => r.bookmarkId),
      ),
    })
  },

  rejectAll() {
    set({ accepted: new Set() })
  },

  async apply() {
    const plan = get().plan
    if (plan === null) return
    set({ busy: t('busyApplying'), busyKind: 'apply', error: null, progress: null, logs: [] })
    const stopKeepalive = startKeepalive(connection)
    // 按实际会落地的目录重排编号，避免出现 01、02、04 这样的空号
    const res = await send({
      kind: 'apply',
      plan: renumberPlan(plan, get().accepted, get().scan?.folders ?? []),
      accepted: [...get().accepted],
    })
      .finally(stopKeepalive)
    if (!res.ok) return set({ busy: null, busyKind: null, error: res.error })
    if (res.kind !== 'apply') return set({ busy: null, busyKind: null })
    set({ applyResult: res.result, undoAvailable: true, step: 'result', busy: null, busyKind: null })
    await get().refreshTree()
  },

  async undo() {
    set({ busy: t('busyUndoing'), busyKind: 'undo', error: null, progress: null, logs: [] })
    const res = await send({ kind: 'undo' })
    if (!res.ok) return set({ busy: null, busyKind: null, error: res.error })
    if (res.kind !== 'undo') return set({ busy: null, busyKind: null })
    set({ undoResult: res.result, undoAvailable: false, busy: null, busyKind: null })
    await get().refreshTree()
  },

  readImportFile(name, text) {
    // 兜底：解析或归一阶段任何未预见的异常（比如坏文件触发的意外报错）都不能让侧栏白屏或悄无声息地卡住。
    try {
      const parsed = parseImportFile(text)
      if (!parsed.ok) {
        return set({ importError: parsed.error, importFile: null, importDone: null, error: null })
      }
      set({
        importError: null,
        importDone: null,
        error: null,
        importFile: {
          name,
          preview: buildImportPreview(parsed.doc, get().tree, new Date()),
        },
      })
    } catch {
      set({ importError: t('errFileCorrupt'), importFile: null, importDone: null, error: null })
    }
  },

  async confirmImport() {
    const file = get().importFile
    if (file === null) return
    set({ busy: t('busyImporting'), busyKind: null, error: null, progress: null, logs: [] })

    const res = await send({
      kind: 'import',
      nodes: file.preview.nodes,
      targetName: file.preview.targetName,
    })
    if (!res.ok) return set({ busy: null, error: res.error })
    if (res.kind !== 'import') return set({ busy: null })

    set({
      importDone: {
        result: res.result,
        blocked: file.preview.blocked,
        targetName: file.preview.targetName,
        barTitle: file.preview.barTitle,
      },
      importFile: null,
      busy: null,
    })
    // 新文件夹要立刻出现在上面的勾选树里，用户可以接着勾上做整理
    await get().refreshTree()
  },

  resetImport() {
    set({ importFile: null, importError: null, importDone: null, error: null })
  },

  reset() {
    set({
      step: 'scope', scan: null, plan: null, accepted: new Set(),
      structureEdits: EMPTY_EDITS,
      applyResult: null, undoResult: null, error: null,
    })
  },
}))
