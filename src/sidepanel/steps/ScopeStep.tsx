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
      {/* 操作区钉在底部：书签上千条时目录树很长，扫描按钮不该被推到要滚半天才看得见的地方。
          负的左右外边距抵掉 <main> 的 p-4，让顶边线和白底铺满整宽——否则树滚到下面会从两侧透出来；
          负的下外边距让它贴住窗口底边，pb-4 把内边距补回来。 */}
      <div className="sticky bottom-0 -mx-4 -mb-4 space-y-3 border-t border-neutral-200 bg-white px-4 pb-4 pt-3">
        <button
          className="w-full cursor-pointer rounded-md bg-neutral-800 py-2 text-sm font-medium text-white transition-colors duration-150 hover:enabled:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
          disabled={checkedIds.size === 0 || busy !== null}
          onClick={() => void goScan()}
        >
          扫描选中的 {checkedIds.size} 个文件夹
        </button>
        {/* 灰底成组：把「分享书签」这条支线整体降一级，不跟上面的主操作抢注意力。
            组内再用一条分隔线把导出和导入切开。 */}
        <section className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <ExportPanel />
          <div className="border-t border-neutral-200" />
          <ImportPanel />
        </section>
      </div>
    </div>
  )
}
