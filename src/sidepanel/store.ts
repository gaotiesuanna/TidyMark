import { create } from 'zustand'
import type { BookmarkNode } from '@/core/ports'
import type { OrganizePlan, ScanResult } from '@/core/types'
import type { ApplyResult } from '@/engine/apply'
import type { UndoResult } from '@/engine/undo'
import type { Settings } from '@/storage/settings'
import { DEFAULT_SETTINGS } from '@/storage/settings'
import { send } from './lib/send'
import { ensureHostPermission } from './lib/permissions'

export type Step = 'scope' | 'preferences' | 'review' | 'result'

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
  error: string | null

  init(): Promise<void>
  toggle(id: string): void
  goScan(): Promise<void>
  setSettings(settings: Settings): Promise<void>
  analyze(): Promise<void>
  toggleAccepted(bookmarkId: string): void
  acceptAll(): void
  acceptHighConfidence(threshold: number): void
  rejectAll(): void
  apply(): Promise<void>
  undo(): Promise<void>
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
  error: null,

  async init() {
    set({ busy: '正在读取书签…', error: null })
    const treeRes = await send({ kind: 'get_tree' })
    const settingsRes = await send({ kind: 'get_settings' })
    const undoRes = await send({ kind: 'get_undo_state' })
    set({
      tree: treeRes.ok && treeRes.kind === 'get_tree' ? treeRes.tree : [],
      settings: settingsRes.ok && settingsRes.kind === 'get_settings' ? settingsRes.settings : DEFAULT_SETTINGS,
      undoAvailable: undoRes.ok && undoRes.kind === 'get_undo_state' ? undoRes.available : false,
      busy: null,
    })
  },

  toggle(id) {
    set({ checkedIds: toggleChecked(get().checkedIds, id, get().tree) })
  },

  async goScan() {
    set({ busy: '正在扫描…', error: null })
    const res = await send({ kind: 'scan', scopeRootIds: [...get().checkedIds] })
    if (!res.ok) return set({ busy: null, error: res.error })
    if (res.kind !== 'scan') return set({ busy: null })
    set({ scan: res.scan, step: 'preferences', busy: null })
  },

  async setSettings(settings) {
    await send({ kind: 'save_settings', settings })
    set({ settings })
  },

  async analyze() {
    const granted = await ensureHostPermission(get().settings.llm.baseUrl)
    if (!granted) {
      return set({ error: '需要授权访问模型接口所在的域名才能继续分析。请重试并允许该权限。' })
    }
    set({ busy: '正在分析…', error: null })
    const res = await send({ kind: 'analyze', scopeRootIds: [...get().checkedIds] })
    if (!res.ok) return set({ busy: null, error: res.error })
    if (res.kind !== 'analyze') return set({ busy: null })
    set({
      plan: res.plan,
      accepted: new Set(res.plan.rows.filter((r) => r.confidence >= 0.7).map((r) => r.bookmarkId)),
      step: 'review',
      busy: null,
    })
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
    set({ busy: '正在应用…', error: null })
    const res = await send({ kind: 'apply', plan, accepted: [...get().accepted] })
    if (!res.ok) return set({ busy: null, error: res.error })
    if (res.kind !== 'apply') return set({ busy: null })
    set({ applyResult: res.result, undoAvailable: true, step: 'result', busy: null })
  },

  async undo() {
    set({ busy: '正在撤销…', error: null })
    const res = await send({ kind: 'undo' })
    if (!res.ok) return set({ busy: null, error: res.error })
    if (res.kind !== 'undo') return set({ busy: null })
    set({ undoResult: res.result, undoAvailable: false, busy: null })
  },

  reset() {
    set({
      step: 'scope', scan: null, plan: null, accepted: new Set(),
      applyResult: null, undoResult: null, error: null,
    })
  },
}))
