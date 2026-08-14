/** 侧栏与 service worker 之间推送进度事件的长连接名。 */
export const PROGRESS_PORT = 'tidymark:progress'

export type ProgressPhase = 'scan' | 'tags' | 'tree' | 'classify' | 'apply' | 'undo' | 'import'

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
