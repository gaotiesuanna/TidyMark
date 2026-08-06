/** 侧栏与 service worker 之间推送进度事件的长连接名。 */
export const PROGRESS_PORT = 'tidymark:progress'

export type ProgressPhase = 'scan' | 'tags' | 'tree' | 'classify' | 'apply' | 'undo' | 'import'

/** 值是 _locales 里的词条键，不是文案——events.ts 要保持零依赖，由渲染方 t() 取文案。 */
export const PHASE_LABELS: Record<ProgressPhase, string> = {
  scan: 'phaseScan',
  tags: 'phaseTags',
  tree: 'phaseTree',
  classify: 'phaseClassify',
  apply: 'phaseApply',
  undo: 'phaseUndo',
  import: 'phaseImport',
}

export interface ProgressEvent {
  phase: ProgressPhase
  /** 空字符串表示只更新进度条，不写日志。 */
  message: string
  level?: 'info' | 'warn' | 'error'
  done?: number
  total?: number
}

export type EmitProgress = (event: ProgressEvent) => void
