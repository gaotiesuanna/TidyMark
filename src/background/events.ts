/** 侧栏与 service worker 之间推送进度事件的长连接名。 */
export const PROGRESS_PORT = 'tidymark:progress'

/**
 * 连接名里捎上侧栏的身份：`tidymark:progress#<clientId>`。
 *
 * 走连接名而不是连上之后再发一条自报家门的消息，是因为 SW 在 onConnect 那一刻
 * 就得知道这条通道属于谁——晚一个来回的话，这中间到达的进度事件没有地方可推。
 * 也不用 port.sender.documentId：那是 Chrome 106+ 才有的字段，而且拿它做键
 * 就没法在测试里复现多窗口，而多窗口正是这套东西存在的唯一理由。
 */
export function progressPortName(clientId: string): string {
  return `${PROGRESS_PORT}#${clientId}`
}

/** 不是进度通道时返回 null；是但没带身份时返回空串，由调用方决定怎么兜底。 */
export function clientIdFromPortName(name: string): string | null {
  if (name === PROGRESS_PORT) return ''
  if (!name.startsWith(`${PROGRESS_PORT}#`)) return null
  return name.slice(PROGRESS_PORT.length + 1)
}

export type ProgressPhase = 'scan' | 'tags' | 'tree' | 'classify' | 'apply' | 'undo' | 'import' | 'cleanup'

/**
 * 值是 _locales 里的词条键，不是文案——events.ts 要保持零依赖，由渲染方 t() 取文案。
 *
 * 写成 `as const satisfies` 而不是标注成 `Record<ProgressPhase, string>`：后者会把值
 * 拓宽成 string，t() 收 MessageKey 就传不进去了。这样既留住字面量类型（键名写错时
 * 渲染方的 t() 编译期报错），又保住「ProgressPhase 每个取值都得有」这条穷尽检查，
 * 还不用 import i18n。
 */
export const PHASE_LABELS = {
  scan: 'phaseScan',
  tags: 'phaseTags',
  tree: 'phaseTree',
  classify: 'phaseClassify',
  apply: 'phaseApply',
  undo: 'phaseUndo',
  import: 'phaseImport',
  cleanup: 'phaseCleanup',
} as const satisfies Record<ProgressPhase, string>

export interface ProgressEvent {
  phase: ProgressPhase
  /** 空字符串表示只更新进度条，不写日志。 */
  message: string
  level?: 'info' | 'warn' | 'error'
  done?: number
  total?: number
}

export type EmitProgress = (event: ProgressEvent) => void
