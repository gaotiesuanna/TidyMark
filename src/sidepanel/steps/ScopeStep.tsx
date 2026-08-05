import { useMemo, useState } from 'react'
import { BookmarkTree, topLevelNodes } from '../components/BookmarkTree'
import { ExportPanel } from '../components/ExportPanel'
import { ImportPanel } from '../components/ImportPanel'
import { collectAllFolderIds, useStore } from '../store'

export function ScopeStep() {
  const { tree, checkedIds, toggle, goScan, busy } = useStore()
  // null 表示还没手动展开过，此时默认只展开根节点，也就是先只看一级目录
  const [expanded, setExpanded] = useState<Set<string> | null>(null)
  const defaultExpanded = useMemo(
    () => new Set(topLevelNodes(tree).map((node) => node.id)),
    [tree],
  )
  const expandedIds = expanded ?? defaultExpanded

  function toggleExpand(id: string): void {
    const next = new Set(expandedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpanded(next)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-neutral-500">
        勾选你想让 TidyMark 重构的文件夹。<strong>未勾选的部分不会被读取，也不会被修改</strong>，
        其中的书签不会移出、也不会有书签移入。
      </p>

      <div className="flex gap-1 text-xs">
        <button
          className="rounded border px-2 py-1 hover:bg-neutral-50"
          onClick={() => setExpanded(new Set(collectAllFolderIds(tree)))}
        >
          全部展开
        </button>
        <button
          className="rounded border px-2 py-1 hover:bg-neutral-50"
          onClick={() => setExpanded(new Set())}
        >
          全部收起
        </button>
      </div>

      <div className="rounded border">
        <BookmarkTree
          nodes={tree}
          checkedIds={checkedIds}
          onToggle={toggle}
          expandedIds={expandedIds}
          onToggleExpand={toggleExpand}
        />
      </div>
      <button
        className="w-full rounded bg-neutral-800 py-2 text-sm text-white disabled:opacity-40"
        disabled={checkedIds.size === 0 || busy !== null}
        onClick={() => void goScan()}
      >
        扫描选中的 {checkedIds.size} 个文件夹
      </button>
      <div className="space-y-4 border-t pt-3">
        <ExportPanel />
        <ImportPanel />
      </div>
    </div>
  )
}
