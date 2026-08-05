import { useRef, type ChangeEvent } from 'react'
import type { ExportNode } from '@/core/export'
import { useStore } from '../store'

/** 直接用 'url' in node 分支返回，不要抬成布尔别名——JSX 的 && 里收窄不住 node.children。 */
function NodeRow({ node, depth }: { node: ExportNode; depth: number }) {
  const indent = { paddingLeft: `${depth * 12 + 4}px` }
  const label = node.name === '' ? '（无标题）' : node.name

  if ('url' in node) {
    return <div className="truncate py-0.5" style={indent}>{label}</div>
  }
  return (
    <div>
      <div className="truncate py-0.5" style={indent}>
        {/* 图标单独包一层，避免和 label 合并成同一个文本节点，
            否则 testing-library 的 getByText('NiceG') 精确匹配会连着「▾ 」一起比对而找不到。 */}
        <span aria-hidden="true">▾ </span>{label}
      </div>
      {node.children.map((child, index) => (
        <NodeRow key={`${child.name}-${index}`} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

export function ImportPanel() {
  const {
    importFile, importError, importDone, busy,
    readImportFile, confirmImport, resetImport,
  } = useStore()
  const inputRef = useRef<HTMLInputElement>(null)

  async function onPick(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    if (file === undefined) return
    readImportFile(file.name, await file.text())
    // 清空 value，否则连续选同一个文件不会再触发 change
    event.target.value = ''
  }

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept="application/json"
      aria-label="选择导入文件"
      className="hidden"
      onChange={(event) => void onPick(event)}
    />
  )

  if (importDone !== null) {
    const { result, blocked, targetName, barTitle } = importDone
    const missed = [...blocked, ...result.skipped]
    return (
      <div className="space-y-1 text-xs">
        {picker}
        <p className="text-neutral-700">
          已导入 {result.bookmarks} 条书签到 {barTitle}/{targetName}
        </p>
        {missed.length > 0 && (
          <div className="text-neutral-500">
            <p>{missed.length} 条没有进来：</p>
            {missed.map((item, index) => (
              <p key={`${item.name}-${index}`} className="truncate">
                · {item.name === '' ? '（无标题）' : item.name} — {item.reason}
              </p>
            ))}
          </div>
        )}
        <p className="text-neutral-500">不需要的话，直接在 Chrome 里删掉这个文件夹即可。</p>
        <button
          className="w-full rounded border py-1.5 hover:bg-neutral-50"
          onClick={resetImport}
        >
          完成
        </button>
      </div>
    )
  }

  if (importError !== null) {
    return (
      <div className="space-y-1 text-xs">
        {picker}
        <p className="text-red-600">{importError}</p>
        <button
          className="w-full rounded border py-1.5 hover:bg-neutral-50"
          onClick={resetImport}
        >
          重新选择
        </button>
      </div>
    )
  }

  if (importFile !== null) {
    const { name, preview } = importFile
    return (
      <div className="space-y-1 text-xs">
        {picker}
        <p className="truncate text-neutral-700">{name}</p>
        <p className="text-neutral-500">
          {preview.bookmarkCount} 条书签、{preview.folderCount} 个文件夹
        </p>
        {preview.duplicateCount > 0 && (
          <p className="text-neutral-500">其中 {preview.duplicateCount} 条你已经收藏过</p>
        )}
        {preview.blocked.length > 0 && (
          <p className="text-amber-700">已拦下 {preview.blocked.length} 条不安全的链接</p>
        )}
        <p className="text-neutral-500">
          将建到：{preview.barTitle}/{preview.targetName}
        </p>
        <div className="max-h-48 overflow-y-auto rounded border">
          {preview.nodes.map((node, index) => (
            <NodeRow key={`${node.name}-${index}`} node={node} depth={0} />
          ))}
        </div>
        <div className="flex gap-1">
          <button
            className="flex-1 rounded bg-neutral-800 py-1.5 text-white disabled:opacity-40"
            disabled={(preview.bookmarkCount === 0 && preview.folderCount === 0) || busy !== null}
            onClick={() => void confirmImport()}
          >
            确认导入
          </button>
          <button
            className="flex-1 rounded border py-1.5 hover:bg-neutral-50 disabled:opacity-40"
            disabled={busy !== null}
            onClick={resetImport}
          >
            取消
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="text-xs">
      {picker}
      <button
        className="w-full rounded border py-1.5 hover:bg-neutral-50 disabled:opacity-40"
        disabled={busy !== null}
        onClick={() => inputRef.current?.click()}
      >
        导入书签文件…
      </button>
    </div>
  )
}
