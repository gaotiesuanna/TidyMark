import { useMemo, useState } from 'react'
import { plural, t } from '@/i18n'
import { countScopedBookmarks } from '@/core/export'
import { BookmarkTree, topLevelNodes } from '../components/BookmarkTree'
import { ExportPanel } from '../components/ExportPanel'
import { ImportPanel } from '../components/ImportPanel'
import { isModelConfigured } from '@/llm/config'
import { collectAllFolderIds, useStore } from '../store'

export function ScopeStep() {
  const { tree, checkedIds, toggle, goScan, busy, settings, openSettings } = useStore()
  // 模型配置在设置页，而扫描一步根本用不上它——不在这里先说一声，新用户会一路顺畅
  // 走完勾选和扫描，直到第三步才发现没地方填 Key，那时他已经投入了。
  // 「配好了没有」用共用谓词判，不是自己看一眼 apiKey：本机 Ollama 不要 Key，
  // 只认 apiKey 的话这条提示对他永远不消失（见 llm/config.ts）。
  const needModel = !isModelConfigured(settings.llm)
  // null 表示还没手动展开过，此时默认只展开根节点，也就是先只看一级目录
  const [expanded, setExpanded] = useState<Set<string> | null>(null)
  const defaultExpanded = useMemo(
    () => new Set(topLevelNodes(tree).map((node) => node.id)),
    [tree],
  )
  const expandedIds = expanded ?? defaultExpanded
  // 按钮报的是「这次要处理多少条书签」，不是勾中几个文件夹：一个目录下的书签既可能
  // 分在子目录里、也可能直接散着，而目录树只画文件夹，散着的那些在这一页从不显形。
  // 只报文件夹数时，用户没有任何地方能确认那些散链算不算在内（真实案例：某个目录
  // 10 个子目录共 73 条、另有 123 条直接散在它底下，按钮却只说「11 个文件夹」）。
  // 这个数与下面 ExportPanel 报的是同一个函数、同一批书签——扫描和导出走的都是
  // findScopeRoots 去重后整棵子树遍历，两处口径必须一致，不然更让人怀疑范围对不上。
  const scopedCount = useMemo(
    () => countScopedBookmarks(tree, [...checkedIds]),
    [tree, checkedIds],
  )

  function toggleExpand(id: string): void {
    const next = new Set(expandedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpanded(next)
  }

  return (
    // 操作区不能放进这个 space-y-3 里：它的 `margin-bottom: 0` 优先级高于 -mb-4，会把下面那条负外边距吃掉。
    <div>
      <div className="space-y-3">
        {/* 次要层级、不用红色告警：没配模型不是错误，导入导出和勾选范围照常能走，这条只挡在视线里、不挡在路上。
            也不做「不再提示」——真需要配置的人会因此永久失去入口，而配好之后它自己就消失了，没有需要关闭的场景。 */}
        {needModel && (
          <section className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-xs leading-relaxed text-neutral-600">{t('scopeNeedModel')}</p>
            <button
              className="cursor-pointer rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 transition-colors duration-150 hover:border-neutral-400 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1 motion-reduce:transition-none"
              onClick={openSettings}
            >
              {t('scopeNeedModelAction')}
            </button>
          </section>
        )}
        <p className="text-xs leading-relaxed text-neutral-500">{t('scopeIntro')}</p>
        <p className="text-xs font-medium leading-relaxed text-neutral-600">{t('scopeSafety')}</p>

        <div className="flex gap-1 text-xs">
          <button
            className="rounded border px-2 py-1 hover:bg-neutral-50"
            onClick={() => setExpanded(new Set(collectAllFolderIds(tree)))}
          >
            {t('scopeExpandAll')}
          </button>
          <button
            className="rounded border px-2 py-1 hover:bg-neutral-50"
            onClick={() => setExpanded(new Set())}
          >
            {t('scopeCollapseAll')}
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
      </div>
      {/* 操作区钉在底部：书签上千条时目录树很长，扫描按钮不该被推到要滚半天才看得见的地方。
          负的左右外边距抵掉 <main> 的 p-4，让顶边线和白底铺满整宽——否则树滚到下面会从两侧透出来。
          底部同理：<main> 底下那 16px 内边距也在滚动区里，吸底位置得跟着往下挪 16px（-bottom-4）才盖得住，
          否则目录树会从这条缝里滚过去露出来；-mb-4 则是把这 16px 从文档流里减回去，
          免得滚到最底时操作区反被顶起来、底边又露出一条白缝。pb-4 把视觉内边距补回来。 */}
      <div className="sticky -bottom-4 -mx-4 -mb-4 mt-3 space-y-3 border-t border-neutral-200 bg-white px-4 pb-4 pt-3">
        <button
          className="w-full cursor-pointer rounded-md bg-neutral-800 py-2 text-sm font-medium text-white transition-colors duration-150 hover:enabled:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
          disabled={checkedIds.size === 0 || busy !== null}
          onClick={() => void goScan()}
        >
          {plural(
            scopedCount,
            'scopeScanOne',
            'scopeScanOther',
            String(scopedCount),
            // 文件夹数降为附注，但仍要单独过一次 plural：英文的 folder/folders
            // 由文件夹数决定，跟着书签数的单复数走会拼出「1 bookmark in 2 folder」
            plural(
              checkedIds.size,
              'scopeScanFolderOne',
              'scopeScanFolderOther',
              String(checkedIds.size),
            ),
          )}
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
