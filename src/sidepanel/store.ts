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
import { DEFAULT_SETTINGS, activeLlm, endpointKey } from '@/storage/settings'
import { send } from './lib/send'
import type { TestFailure } from '@/background/messages'
import { ensureHostPermission, hasHostPermission } from './lib/permissions'
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

/**
 * 一次连通性自检的失败分类，比后台那份多一类。
 *
 * 'permission' 只可能由这一层给出：能不能访问某个域名要问 `chrome.permissions.contains`，
 * llm 层零浏览器依赖，答不了，所以 `TestFailure` 里没有它（见 llm/probe.ts）。
 * 这一层在失败之后复查一次权限，把一句笼统的「请求没能发出去」换成确定的答案——
 * 这正是本功能对着的那次故障里最缺的东西。
 */
export type ModelTestReason = TestFailure | 'permission'

/**
 * 「测试连接」的即时结果。**不进 Settings、不落盘**：它是一次探针，不是状态。
 * 重新打开设置页时显示一个上次的绿勾会撒谎——配置早就可能改过了。
 */
export interface ModelTest {
  state: 'idle' | 'running' | 'ok' | 'fail'
  /** 成功时这一次请求真实的往返耗时，毫秒。 */
  ms?: number
  /**
   * 失败分类。**可能是 undefined**：service worker 被回收时 send 自己造的那个失败、
   * 以及后台外层 catch 兜到的失败，都只有 error 没有 reason。界面必须有一条兜底文案。
   */
  reason?: ModelTestReason
  /** 失败的原始说明（后台已剥掉 Key）。分类文案给方向，它给证据（状态码、响应体）。 */
  error?: string
}

/**
 * 一条测试结果的键。
 *
 * 用 `\u0000` 分隔而不是 `/`：baseUrl 里本来就带斜杠，拿它当分隔符会让
 * `https://x/v1` + `a` 和 `https://x` + `v1/a` 撞成同一个键
 * （llm/classify.ts:36 的 pathKey 早就为同一个坑改用了 `\u0000`）。
 */
export function modelTestKey(baseUrl: string, model: string): string {
  return `${endpointKey(baseUrl)}\u0000${model}`
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

/** 超长时开头保留多少字，其余额度留给结尾。 */
const HEAD_CHARS = Math.floor(MAX_LOG_LENGTH / 2)

/**
 * 超长的日志砍中间，不砍尾巴。
 *
 * 从头截断会把唯一有诊断价值的地方扔掉：模型输出非法时开头永远是一段合法 JSON，
 * 破绽全在末尾；接口错误体同样越往后越具体。llm/client.ts 特意把 content 的尾部
 * 拼进错误信息，就是被这里砍没的——那条修复到不了用户眼前。
 *
 * 开头仍要留一截，否则一屏日志里认不出这是哪一条。
 */
function truncate(message: string): string {
  if (message.length <= MAX_LOG_LENGTH) return message
  return `${message.slice(0, HEAD_CHARS)}…${message.slice(HEAD_CHARS - MAX_LOG_LENGTH)}`
}

/** 只有带 message 的事件才写日志；纯进度事件不写。 */
export function appendLog(logs: LogLine[], event: ProgressEvent, id: number): LogLine[] {
  if (event.message === '') return logs
  const message = truncate(event.message)
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
  /**
   * 每一对「端点 + 模型」各自的测试结果，键见 modelTestKey。
   *
   * 从单槽改成一张表：设置页现在一个模型一行、一行一个测试按钮，
   * 单槽会让后测的那行把前一行的结论盖掉。
   */
  modelTests: Record<string, ModelTest>
  /**
   * 设置页挂载的次数，resetModelTest() 时 +1。
   *
   * 一次测试可能跑好几秒，这期间用户可以关掉设置页、改完 Key 再打开。在途的那次回来时
   * 要拿它对一下自己还算不算数——不对的话，一个针对旧配置的结论会写进一个刚刚被清空的
   * 界面，那正是「显示上次的结论会撒谎」的另一种形态。
   */
  modelTestSeq: number
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
  /**
   * 把一个目录合并进另一个目录——合并 = 删除 + 指定去处，两件事必须一起写。
   *
   * 只写 removed 会让书签按 resolve() 的默认回落链走，不会去用户选的目的地；
   * 只写 mergedInto 会让目录本身还留在树上。合并到自己没有意义，挡在这里
   * 而不是让 resolve() 去兜——那会绕一圈回到同一个 id。
   */
  mergeNode(id: string, into: string): void
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
  rejectAll(): void
  apply(): Promise<void>
  undo(): Promise<void>
  readImportFile(name: string, text: string): void
  confirmImport(): Promise<void>
  resetImport(): void
  openSettings(): void
  closeSettings(): void
  /** 把测试结果清回空白。设置页每次挂载都调它——结果不跨一次开合存活。 */
  resetModelTest(): void
  /**
   * 当场验一次模型配置：先申请权限（按钮点击是干净的用户手势），再让后台用真的客户端
   * 发一个最小 schema 的请求，失败时说清是哪一类。
   */
  testModel(baseUrl: string, model: string): Promise<void>
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
  modelTests: {},
  modelTestSeq: 0,
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
    const granted = await ensureHostPermission(activeLlm(get().settings).baseUrl)
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

  mergeNode(id, into) {
    // 合进自己没有意义，挡在这里而不是让 resolve 去兜——那会绕一圈回到同一个 id
    if (id === into) return
    const edits = get().structureEdits
    set({
      structureEdits: {
        ...edits,
        // 合并 = 删除 + 指定去处，两件事一起写。只写一处会得到半截状态
        removed: edits.removed.includes(id) ? edits.removed : [...edits.removed, id],
        mergedInto: { ...edits.mergedInto, [id]: into },
      },
    })
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

  resetModelTest() {
    set({ modelTests: {}, modelTestSeq: get().modelTestSeq + 1 })
  },

  async testModel(baseUrl, model) {
    const seq = get().modelTestSeq
    const key = modelTestKey(baseUrl, model)
    /** 结论过期就丢掉：设置页已经重新开过一次，那时的配置未必还是这一次测的那份。 */
    const settle = (modelTest: ModelTest): void => {
      if (get().modelTestSeq !== seq) return
      set({ modelTests: { ...get().modelTests, [key]: modelTest } })
    }
    settle({ state: 'running' })

    // 权限申请就放在这一刻：chrome.permissions.request() 要用户手势，而按钮点击是干净的
    // 手势。这顺带把授权从「点开始分析那一刻」前移到了配置时。
    if (!await ensureHostPermission(baseUrl)) {
      // 拒了就到此为止，不发消息：那次请求必然失败，而且会把「权限没授到」这个已经确定的
      // 答案，换成一句笼统的「请求没能发出去」——正是这个功能要消灭的东西。
      return settle({ state: 'fail', reason: 'permission' })
    }

    const res = await send({ kind: 'test_model', baseUrl, model })
    if (res.ok && res.kind === 'test_model') return settle({ state: 'ok', ms: res.ms })
    // 回来的是别的 kind：说不出所以然，只能走兜底那条文案
    if (res.ok) return settle({ state: 'fail' })

    // 失败之后复查一次权限。后台给的 reason 里没有「权限」这一类，llm 层答不了这个问题；
    // 而这一刻答案是确定的，一句 'network' 会把人推去查代理、查 DNS、关别的扩展，
    // 而真正的下一步只是「再点一次并允许」。
    const reason: ModelTestReason | undefined =
      await hasHostPermission(baseUrl) ? res.reason : 'permission'
    settle({ state: 'fail', reason, error: res.error })
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
