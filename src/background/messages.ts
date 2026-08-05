import type { OrganizePlan, ScanResult } from '@/core/types'
import type { ApplyResult } from '@/engine/apply'
import type { UndoResult } from '@/engine/undo'
import type { BookmarkNode } from '@/core/ports'
import type { Settings } from '@/storage/settings'
import type { ExportNode } from '@/core/export'
import type { ImportResult } from '@/engine/importTree'

export type Request =
  | { kind: 'get_tree' }
  | { kind: 'scan'; scopeRootIds: string[] }
  | { kind: 'analyze'; scopeRootIds: string[] }
  | { kind: 'apply'; plan: OrganizePlan; accepted: string[] }
  | { kind: 'undo' }
  | { kind: 'get_settings' }
  | { kind: 'save_settings'; settings: Settings }
  | { kind: 'get_undo_state' }
  | { kind: 'import'; nodes: ExportNode[]; targetName: string }
  | { kind: 'cancel' }

export type Response =
  | { ok: true; kind: 'get_tree'; tree: BookmarkNode[] }
  | { ok: true; kind: 'scan'; scan: ScanResult }
  | { ok: true; kind: 'analyze'; plan: OrganizePlan }
  | { ok: true; kind: 'apply'; result: ApplyResult }
  | { ok: true; kind: 'undo'; result: UndoResult }
  | { ok: true; kind: 'get_settings'; settings: Settings }
  | { ok: true; kind: 'save_settings' }
  | { ok: true; kind: 'get_undo_state'; available: boolean; createdAt: number | null }
  | { ok: true; kind: 'import'; result: ImportResult }
  | { ok: true; kind: 'cancel' }
  /** cancelled 为 true 表示用户主动取消，不是出错。 */
  | { ok: false; error: string; cancelled?: boolean }
