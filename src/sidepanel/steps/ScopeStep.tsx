import { BookmarkTree } from '../components/BookmarkTree'
import { useStore } from '../store'

export function ScopeStep() {
  const { tree, checkedIds, toggle, goScan, busy } = useStore()
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-neutral-500">
        勾选你想让 TidyMark 重构的文件夹。<strong>未勾选的部分不会被读取，也不会被修改</strong>，
        其中的书签不会移出、也不会有书签移入。
      </p>
      <div className="rounded border">
        <BookmarkTree nodes={tree} checkedIds={checkedIds} onToggle={toggle} />
      </div>
      <button
        className="w-full rounded bg-neutral-800 py-2 text-sm text-white disabled:opacity-40"
        disabled={checkedIds.size === 0 || busy !== null}
        onClick={() => void goScan()}
      >
        扫描选中的 {checkedIds.size} 个文件夹
      </button>
    </div>
  )
}
