import type { OrganizePlan, ScanResult } from '@/core/types'
import type { ApplyResult } from '@/engine/apply'
import type { CleanupInput, CleanupResult, CleanupScan } from '@/engine/cleanup'
import type { UndoResult } from '@/engine/undo'
import type { BookmarkNode } from '@/core/ports'
import type { Settings } from '@/storage/settings'
import type { ExportNode } from '@/core/export'
import type { ImportResult } from '@/engine/importTree'
import type { OrganizeMode } from '@/core/mode'
import type { TestFailure } from '@/llm/probe'

/**
 * 失败分类跟着探针本身定义在 llm/probe.ts（那一层零浏览器依赖），这里再导出一次，
 * 让消息契约自己说得清能带回哪些取值，侧栏不必反向去 llm/ 取类型。
 */
export type { TestFailure }

export type Request =
  | { kind: 'get_tree' }
  | { kind: 'scan'; scopeRootIds: string[] }
  | {
      kind: 'analyze'
      scopeRootIds: string[]
      /**
       * 用户在偏好页推翻了自动判断时才带上；缺省表示由后台按这次扫描的结果自己判。
       *
       * 不进 Settings：存下来就等于把删掉的开关偷偷留着，一次推翻只对这一次整理生效
       * （见 issues/14-mode-detection.md §5）。
       */
      modeOverride?: OrganizeMode
    }
  | { kind: 'apply'; plan: OrganizePlan; accepted: string[] }
  | { kind: 'undo' }
  | { kind: 'get_settings' }
  | { kind: 'save_settings'; settings: Settings }
  | { kind: 'get_undo_state' }
  | { kind: 'import'; nodes: ExportNode[]; targetName: string }
  | { kind: 'cancel' }
  /**
   * 当场验一次模型配置。必须走后台：这个功能对着的那次故障，形状是「浏览器普通标签页
   * 能打开那个域名、而扩展的请求失败」——从侧栏直接 fetch 去测会给出假绿灯。
   */
  | { kind: 'test_model'; baseUrl: string; model: string }
  /**
   * 清理模式的全库扫描。不带 scopeRootIds：重复项的常态是跨文件夹，限定范围
   * 反而把最该抓的那批漏掉（见设计文档第四节）。
   */
  | { kind: 'cleanup_scan' }
  | { kind: 'apply_cleanup'; input: CleanupInput }

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
  /** ms 是这一次请求真实的往返耗时，给用户一个「快不快」的直观印象。 */
  | { ok: true; kind: 'test_model'; ms: number }
  | { ok: true; kind: 'cleanup_scan'; scan: CleanupScan }
  | { ok: true; kind: 'apply_cleanup'; result: CleanupResult }
  /**
   * cancelled 为 true 表示用户主动取消，不是出错。
   * reason 只有 test_model 会带：失败时说清是哪一类，别的请求没有这个分类。
   */
  | { ok: false; error: string; cancelled?: boolean; reason?: TestFailure }
