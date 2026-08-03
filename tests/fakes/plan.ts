import type { BookmarkOperation, OrganizePlan, PlanRow, TagResult } from '@/core/types'

/**
 * 造一个推翻模式的 plan：
 *   01 GitHub（聚合组）
 *     01 AI 工具   ← g0 g1
 *   02 前端          ← f0
 *     01 React     ← r0
 *   03 其他          ← o0
 */
export function makePlan(): OrganizePlan {
  const candidates = [
    { id: 'tmp:1', path: ['01 GitHub'], domainGroup: 'github' },
    { id: 'tmp:2', path: ['01 GitHub', '01 AI 工具'], domainGroup: 'github' },
    { id: 'tmp:3', path: ['02 前端'] },
    { id: 'tmp:4', path: ['02 前端', '01 React'] },
    { id: 'tmp:5', path: ['03 其他'] },
  ]
  const moves: Array<[string, string]> = [
    ['g0', 'tmp:2'], ['g1', 'tmp:2'], ['f0', 'tmp:3'], ['r0', 'tmp:4'], ['o0', 'tmp:5'],
  ]
  const operations: BookmarkOperation[] = [
    ...candidates.map((c) => ({
      type: 'create_folder' as const,
      temporaryId: c.id,
      parentId: c.path.length === 1 ? '1' : null,
      parentTemporaryId: c.path.length === 1 ? null : candidates.find((p) => p.path.length === 1 && p.path[0] === c.path[0])!.id,
      title: c.path.at(-1)!,
    })),
    ...moves.map(([bookmarkId, toCategoryId]) => ({
      type: 'move_bookmark' as const,
      bookmarkId, fromParentId: '9', originalIndex: 0,
      toCategoryId, toTemporaryId: toCategoryId,
      confidence: 1, reason: 'r',
    })),
  ]
  const rows: PlanRow[] = moves.map(([bookmarkId, toCategoryId]) => ({
    bookmarkId, title: bookmarkId, url: `https://x/${bookmarkId}`,
    fromPath: ['旧'], toPath: candidates.find((c) => c.id === toCategoryId)!.path,
    confidence: 1, reason: 'r',
  }))
  const tags: TagResult[] = [
    { bookmarkId: 'g0', primaryTopic: '前端', secondaryTopic: null },
    { bookmarkId: 'g1', primaryTopic: '冷门', secondaryTopic: null },
    { bookmarkId: 'f0', primaryTopic: '前端', secondaryTopic: null },
    { bookmarkId: 'r0', primaryTopic: '前端', secondaryTopic: 'React' },
    { bookmarkId: 'o0', primaryTopic: '杂项', secondaryTopic: null },
  ]
  return {
    id: 'p', createdAt: 0, scopeRootIds: ['1'], rebuildStructure: true,
    candidates, operations, rows, warnings: [], tags,
    summary: {
      totalBookmarks: 5, movedBookmarks: 5, unchangedBookmarks: 0,
      createdFolders: 5, renamedFolders: 0, renamedBookmarks: 0, lowConfidenceItems: 0,
    },
  }
}
