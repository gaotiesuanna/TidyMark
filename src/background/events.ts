/** 侧栏与 service worker 之间推送进度事件的长连接名。 */
export const PROGRESS_PORT = 'tidymark:progress'

export type ProgressPhase = 'scan' | 'tags' | 'tree' | 'classify' | 'apply' | 'undo' | 'import'

export const PHASE_LABELS: Record<ProgressPhase, string> = {
  scan: '扫描',
  tags: '抽取标签',
  tree: '设计目录',
  classify: '分类',
  apply: '应用',
  undo: '撤销',
  import: '导入',
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
