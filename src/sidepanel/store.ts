import { create } from 'zustand'
import { currentLocale, resolveLocale, setLocale, t } from '@/i18n'
import type { Locale } from '@/core/locale'
import type { ProgressEvent, ProgressPhase } from '@/background/events'
import type { BookmarkNode } from '@/core/ports'
import { renumberPlan, retargetRow } from '@/core/plan'
import { applyStructureEdits, EMPTY_EDITS, type StructureEdits } from '@/core/structure'
import type { OrganizeMode } from '@/core/mode'
import type { OrganizePlan, ScanResult } from '@/core/types'
import {
  buildImportPreview, parseImportFile,
  type BlockedLink, type ImportError, type ImportPreview,
} from '@/core/import'
import type { ApplyResult } from '@/engine/apply'
import type { ImportResult } from '@/engine/importTree'
import type { UndoResult } from '@/engine/undo'
import type { Settings } from '@/storage/settings'
import { DEFAULT_SETTINGS } from '@/storage/settings'
import { send } from './lib/send'
import { ensureHostPermission } from './lib/permissions'
import { connectProgress, startKeepalive, type ProgressConnection } from './lib/progress'
import { applyDocumentLang } from './lib/documentLang'

export type Step = 'scope' | 'preferences' | 'structure' | 'review' | 'result'

/**
 * 这次异步请求发出后，用户有没有把这一轮整理放弃掉（见 State.runSeq）。
 *
 * 过期时顺手把 busy 收掉：busy 是个单槽，同一时刻只可能有一个请求占着它，
 * 而所有开始按钮都被 busy 禁用，所以这个 busy 一定是自己留下的。不收的话，
 * 选范围页的扫描按钮会被一个用户已经放弃的任务永久钉死。
 */
function isStale(
  get: () => State,
  set: (partial: Partial<State>) => void,
  run: number,
): boolean {
  if (get().runSeq === run) return false
  set({ busy: null, busyKind: null })
  return true
}

/** 分析完成后去哪一步：只有推翻模式才有新目录结构可确认。 */
export function nextStepAfterAnalyze(rebuildStructure: boolean): Step {
  return rebuildStructure ? 'structure' : 'review'
}

/**
 * 失败的统一收场：错误与「可重试的是哪一步」必须一起写。
 *
 * 这两件事分开写正是票 24 的病根——写 error 的地方有七处，写 retryable 的曾经只有两处，
 * 于是漏掉的那几处会留下**过期的**重试入口：按钮出不出现取决于「上一次有没有失败过」，
 * 不取决于当前这个错误。最难看的一例是导入失败后红条带着「重试」回来、点下去跑的是扫描
 * （见 .superpowers/sdd/2026-08-19-retry-affordance/final-review.md I3）。
 *
 * 这里把两件事焊在一个签名上：谁想写 error 就必须显式说出 retryable 是什么，
 * 漏参数会被 tsc 挡住，而不是静默继承上一轮的值。
 */
function fail(set: (partial: Partial<State>) => void, error: string, retryable: State['retryable']): void {
  set({ busy: null, busyKind: null, retryable, error })
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

/** core 层只产出错误码（保持零浏览器依赖），这里翻成用户可读的文案。 */
function describeImportError(error: ImportError): string {
  if (error.code === 'unknownKind') return t('errImportUnknownKind', error.kind)
  if (error.code === 'invalidJson') return t('errImportInvalidJson')
  if (error.code === 'unsupportedFormat') return t('errImportUnsupportedFormat')
  return t('errImportMalformed')
}

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
  /**
   * 当前这一轮整理的序号，reset() 时 +1。
   *
   * 扫描和分析都是异步的，分析还能跑好几分钟，而这期间「返回」是能点的。
   * 点了就是 reset()：这一轮作废。在途的请求回来时要拿它对一下自己还算不算数——
   * 不对的话，一个属于已放弃轮次的 plan 会写进 store 并把用户拽到结构页，
   * 而那时 scan 已经被清掉了，偏好页从此是一整页空白。
   */
  runSeq: number
  settings: Settings
  plan: OrganizePlan | null
  accepted: Set<string>
  applyResult: ApplyResult | null
  undoResult: UndoResult | null
  undoAvailable: boolean
  busy: string | null
  /** 当前在跑哪一步，决定能不能取消。 */
  busyKind: 'init' | 'scan' | 'analyze' | 'apply' | 'undo' | null
  /**
   * 上一次失败的是哪一步，`null` 表示没有可重试的东西。
   *
   * 不复用 `busyKind`——那个字段的语义是「**正在**跑哪一步」，用来决定能不能取消；
   * 让它在失败后继续留着值，会把「在跑」和「跑挂了」两种状态混进同一个字段。
   *
   * **只认 scan 与 analyze**：这两步一个只读书签树、一个只产出方案，重跑零风险，
   * 而且分类缓存让重试很便宜。apply / undo / import 失败时可能已经改了一部分书签
   * （applyPlan 还写着断点），给它们一个通用的重试按钮，等于诱使用户在结构未定的
   * 状态上再跑一遍，可能把同一批移动做两次。它们的收场由各自的机制负责
   * （撤销、断点续做），不是由这个按钮糊过去（见 issues/24-retry-affordance.md）。
   */
  retryable: 'scan' | 'analyze' | null
  error: string | null
  progress: Progress | null
  logs: LogLine[]
  logSeq: number
  /** 结构确认页的草稿态编辑，不写进 Settings，每次 analyze 重置。 */
  structureEdits: StructureEdits
  /**
   * 用户对自动判断的推翻，`null` 表示听判断的。
   *
   * 与 structureEdits 一样是草稿态，不进 Settings：一次推翻只对这一次整理生效
   * （见 issues/14-mode-detection.md §5）。重新扫描或 reset 之后作废——
   * 那时判断的对象已经换了一批书签。
   */
  modeOverride: OrganizeMode | null
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
  /** 设置页是否盖在内容区上。不进 Step——设置不是流程的一步，
      混进 Step 会污染 nextStepAfterAnalyze 这类按步骤推进的判断。 */
  settingsOpen: boolean
  /** 当前界面语言。App 拿它当 key 强制重挂载，切语言后所有 t() 才会重新求值。 */
  locale: Locale

  init(): Promise<void>
  refreshTree(): Promise<void>
  pushEvent(event: ProgressEvent): void
  cancel(): Promise<void>
  toggle(id: string): void
  goScan(): Promise<void>
  setSettings(settings: Settings): Promise<void>
  setModeOverride(mode: OrganizeMode | null): void
  analyze(): Promise<void>
  retry(): Promise<void>
  renameNode(id: string, title: string): void
  removeNode(id: string): void
  confirmStructure(): void
  backToPreferences(): void
  toggleAccepted(bookmarkId: string): void
  /**
   * 把一条建议改投到另一个目录——拒绝之外的第二条路。
   *
   * 复核页此前对不满意的建议只能拒绝，拒绝等于书签留在原地，那是最差的结果
   * （见 issues/06-review-at-scale.md「决定 3」）。目标不存在、或这条书签不在方案里时
   * retargetRow 原样返回同一个 plan，这里靠引用相等判断有没有真的改，没改就不 set。
   */
  setRowTarget(bookmarkId: string, targetId: string): void
  acceptAll(): void
  acceptHighConfidence(threshold: number): void
  rejectAll(): void
  apply(): Promise<void>
  undo(): Promise<void>
  readImportFile(name: string, text: string): void
  confirmImport(): Promise<void>
  resetImport(): void
  openSettings(): void
  closeSettings(): void
  reset(): void
}

/**
 * 语言只有一个真相来源：Settings.uiLocale。这里把它落到三个地方——
 * i18n 的模块级状态（t() 读它）、<html lang>（读屏与浏览器翻译提示读它）、
 * store 的 locale（App 拿它当重挂载 key）。三处必须一起动，漏一处就会出现
 * 「文案变了但 lang 没变」或「设置存了但界面没刷」这类半截状态。
 */
function syncLocale(settings: Settings): Locale {
  const locale = resolveLocale(settings.uiLocale)
  setLocale(locale)
  applyDocumentLang()
  return locale
}

export const useStore = create<State>((set, get) => ({
  step: 'scope',
  tree: [],
  checkedIds: new Set(),
  scan: null,
  runSeq: 0,
  settings: DEFAULT_SETTINGS,
  plan: null,
  accepted: new Set(),
  applyResult: null,
  undoResult: null,
  undoAvailable: false,
  busy: null,
  busyKind: null,
  retryable: null,
  error: null,
  progress: null,
  logs: [],
  logSeq: 0,
  structureEdits: EMPTY_EDITS,
  modeOverride: null,
  importFile: null,
  importError: null,
  importDone: null,
  settingsOpen: false,
  // 这行在模块求值期执行，那时 main.tsx 还没 setLocale，取到的必然是 i18n 的初值。
  // 真正的对齐由 main.tsx 在 render 之前补一次 setState 完成。
  locale: currentLocale(),

  /** 整理或撤销之后重新读一次书签树，结果页据此展示真实结构。 */
  async refreshTree() {
    const res = await send({ kind: 'get_tree' })
    if (!res.ok || res.kind !== 'get_tree') return
    // 顺手剪掉已经不存在的勾选。合并会删掉被勾中的源目录，撤销又拿新 id 把它们重建出来，
    // 两种情况下 checkedIds 里都躺着一批死 id。reset() 有意保留这个集合（「再整理一次」
    // 不用重勾），可没人剪过它：回到范围页会看到「扫描 2 个文件夹」的按钮亮着、
    // 树上却一个勾都没有，点下去扫的是一批不存在的 id，直接撞 errNoScope。
    // 只剪死的，活着的一个不动——跨 reset 记住选择是有意为之。
    const alive = new Set(collectAllFolderIds(res.tree))
    set({
      tree: res.tree,
      checkedIds: new Set([...get().checkedIds].filter((id) => alive.has(id))),
    })
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
        // 按当时的 busyKind 填：这是这条文案唯一的来源，漏了它，端口断而 SW
        // 未死时用户连「请重试」这四个字都看不到（见 issues/24-retry-affordance.md §2）
        const kind = get().busyKind
        fail(set, t('errBackgroundRecycled'), kind === 'scan' || kind === 'analyze' ? kind : null)
      },
    })
    set({ busy: t('busyReading'), busyKind: 'init', error: null })
    const treeRes = await send({ kind: 'get_tree' })
    const settingsRes = await send({ kind: 'get_settings' })
    const undoRes = await send({ kind: 'get_undo_state' })
    const settings =
      settingsRes.ok && settingsRes.kind === 'get_settings' ? settingsRes.settings : DEFAULT_SETTINGS
    set({
      tree: treeRes.ok && treeRes.kind === 'get_tree' ? treeRes.tree : [],
      settings,
      locale: syncLocale(settings),
      undoAvailable: undoRes.ok && undoRes.kind === 'get_undo_state' ? undoRes.available : false,
      busy: null,
      busyKind: null,
    })
  },

  toggle(id) {
    set({ checkedIds: toggleChecked(get().checkedIds, id, get().tree) })
  },

  async goScan() {
    const run = get().runSeq
    set({ busy: t('busyScanning'), busyKind: 'scan', retryable: null, error: null, progress: null, logs: [] })
    const res = await send({ kind: 'scan', scopeRootIds: [...get().checkedIds] })
    if (isStale(get, set, run)) return
    if (!res.ok) return fail(set, res.error, 'scan')
    if (res.kind !== 'scan') return set({ busy: null, busyKind: null })
    set({ scan: res.scan, step: 'preferences', modeOverride: null, busy: null, busyKind: null })
  },

  async setSettings(settings) {
    set({ settings, locale: syncLocale(settings) })
    await send({ kind: 'save_settings', settings })
  },

  setModeOverride(mode) {
    set({ modeOverride: mode })
  },

  async analyze() {
    const run = get().runSeq
    const granted = await ensureHostPermission(get().settings.llm.baseUrl)
    if (isStale(get, set, run)) return
    if (!granted) {
      // 重试有意义：ensureHostPermission 会重新弹一次权限请求，不是配置类错误
      return fail(set, t('errHostPermission'), 'analyze')
    }
    set({ busy: t('busyAnalyzing'), busyKind: 'analyze', retryable: null, error: null, progress: null, logs: [] })
    // 分析可能跑好几分钟，期间持续 ping，别让后台因空闲被回收
    const stopKeepalive = startKeepalive(connection)
    const res = await send({
      kind: 'analyze',
      scopeRootIds: [...get().checkedIds],
      // null 表示没推翻，这时候一个字段都不带，后台自己判
      modeOverride: get().modeOverride ?? undefined,
    }).finally(stopKeepalive)
    if (isStale(get, set, run)) return
    // 主动取消不是错误，日志里已经有记录，不弹红条，也不算失败，不记可重试
    if (!res.ok && res.cancelled === true) {
      return set({ busy: null, busyKind: null, error: null })
    }
    if (!res.ok) return fail(set, res.error, 'analyze')
    if (res.kind !== 'analyze') return set({ busy: null, busyKind: null })
    set({
      plan: res.plan,
      // 默认全选：不勾 = 书签留在原来那个散落的位置 = 彻底找不到；进了一个不太准的主题目录，
      // 至少还在逐层摸的范围内。放错比不放更可接受，所以默认接受、让标记去引导修正
      // （见 issues/06-review-at-scale.md「决定 3」）。
      accepted: new Set(res.plan.rows.map((r) => r.bookmarkId)),
      structureEdits: EMPTY_EDITS,
      // 走哪条路由后台判定并记在 plan 上，界面不再自己猜——
      // 设置里已经没有那个开关了，猜出来的必然是错的
      step: nextStepAfterAnalyze(res.plan.rebuildStructure),
      busy: null,
      busyKind: null,
    })
  },

  async retry() {
    const kind = get().retryable
    if (kind === null) return
    // 清掉红条再重跑：让用户看得出这一次是新的一轮，而不是旧错误还挂着
    set({ error: null, retryable: null })
    if (kind === 'scan') return get().goScan()
    return get().analyze()
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
    const next = applyStructureEdits(plan, get().structureEdits, currentLocale())
    set({
      plan: next,
      // 同 analyze()：默认全选，放错比不放更可接受
      accepted: new Set(next.rows.map((r) => r.bookmarkId)),
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

  setRowTarget(bookmarkId, targetId) {
    const plan = get().plan
    if (plan === null) return
    const next = retargetRow(plan, bookmarkId, targetId)
    // 引用相等表示什么都没改（目标不存在或这条书签不在方案里），不必惊动订阅者
    if (next === plan) return
    // 改了目标就当用户认这条了——他刚刚亲手指定了去处
    set({ plan: next, accepted: new Set(get().accepted).add(bookmarkId) })
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
    // 不给重试入口：apply 失败时可能已经改了一部分书签，重跑有把同一批移动做两次的风险
    // （收场靠断点续做，不是这个按钮，见 State.retryable 的注释）
    if (!res.ok) return fail(set, res.error, null)
    if (res.kind !== 'apply') return set({ busy: null, busyKind: null })
    set({ applyResult: res.result, undoAvailable: true, step: 'result', busy: null, busyKind: null })
    await get().refreshTree()
  },

  async undo() {
    set({ busy: t('busyUndoing'), busyKind: 'undo', error: null, progress: null, logs: [] })
    const res = await send({ kind: 'undo' })
    // 不给重试入口：undo 失败时书签可能处于半撤销状态，重跑有二次改动的风险
    if (!res.ok) return fail(set, res.error, null)
    if (res.kind !== 'undo') return set({ busy: null, busyKind: null })
    set({ undoResult: res.result, undoAvailable: false, busy: null, busyKind: null })
    await get().refreshTree()
  },

  readImportFile(name, text) {
    // 兜底：解析或归一阶段任何未预见的异常（比如坏文件触发的意外报错）都不能让侧栏白屏或悄无声息地卡住。
    try {
      const parsed = parseImportFile(text)
      if (!parsed.ok) {
        return set({ importError: describeImportError(parsed.error), importFile: null, importDone: null, error: null })
      }
      set({
        importError: null,
        importDone: null,
        error: null,
        importFile: {
          name,
          preview: buildImportPreview(parsed.doc, get().tree, new Date(), currentLocale()),
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
    // 不给重试入口：import 失败时可能已经写入了一部分书签，重跑有重复导入的风险；
    // 这里显式写 null 还顺带堵上了 I3——上一次扫描失败留下的 'scan' 不会再借尸还魂
    if (!res.ok) return fail(set, res.error, null)
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

  openSettings() {
    set({ settingsOpen: true })
  },

  closeSettings() {
    set({ settingsOpen: false })
  },

  reset() {
    set({
      // 让在途的扫描/分析知道自己已经过期，回来时别再写 store
      runSeq: get().runSeq + 1,
      step: 'scope', scan: null, plan: null, accepted: new Set(),
      structureEdits: EMPTY_EDITS, modeOverride: null,
      applyResult: null, undoResult: null, error: null, retryable: null,
    })
  },
}))
