import { useRef, type ChangeEvent } from 'react'
import type { ExportNode } from '@/core/export'
import { plural, t } from '@/i18n'
import { useStore } from '../store'
import { filePickerButton, groupLabel, primaryButton, secondaryButton } from './buttonStyles'
import { AlertIcon, CheckCircleIcon, FileIcon, FolderIcon, LinkIcon, UploadIcon } from './icons'

/** 直接用 'url' in node 分支返回，不要抬成布尔别名——JSX 的 && 里收窄不住 node.children。 */
function NodeRow({ node, depth }: { node: ExportNode; depth: number }) {
  const indent = { paddingLeft: `${depth * 12 + 6}px` }
  const label = node.name === '' ? t('importUntitled') : node.name

  if ('url' in node) {
    return (
      <div className="flex items-center gap-1.5 py-0.5 pr-2 text-neutral-600" style={indent}>
        <LinkIcon className="h-3 w-3 shrink-0 text-neutral-300" />
        {/* label 单独包一层，和图标分开成两个节点：
            否则 testing-library 的 getByText('NiceG') 精确匹配会连着图标一起比对而找不到。 */}
        <span className="truncate">{label}</span>
      </div>
    )
  }
  return (
    <div>
      <div className="flex items-center gap-1.5 py-0.5 pr-2 text-neutral-800" style={indent}>
        <FolderIcon className="h-3 w-3 shrink-0 text-neutral-400" />
        <span className="truncate font-medium">{label}</span>
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
      aria-label={t('importPickerLabel')}
      className="hidden"
      onChange={(event) => void onPick(event)}
    />
  )

  if (importDone !== null) {
    const { result, blocked, targetName, barTitle } = importDone
    const missed = [...blocked, ...result.skipped]
    return (
      <div className="space-y-2 text-xs">
        {picker}
        {/* 成功状态不能只靠颜色，勾选图标 + 文字一起给（色盲/高对比度模式下也读得出来） */}
        <p className="flex items-start gap-1.5 text-neutral-700">
          <CheckCircleIcon className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" />
          {t('importDone', String(result.bookmarks), `${barTitle}/${targetName}`)}
        </p>
        {missed.length > 0 && (
          <div className="space-y-0.5 rounded-md border border-neutral-200 bg-white p-2 text-neutral-500">
            <p className="font-medium text-neutral-600">
              {plural(missed.length, 'importMissedOne', 'importMissedOther', String(missed.length))}
            </p>
            {missed.map((item, index) => (
              <p key={`${item.name}-${index}`} className="truncate">
                · {item.name === '' ? t('importUntitled') : item.name} — {item.reason}
              </p>
            ))}
          </div>
        )}
        <p className="leading-relaxed text-neutral-500">{t('importDeleteHint')}</p>
        <button className={`${secondaryButton} w-full`} onClick={resetImport}>
          {t('importFinish')}
        </button>
      </div>
    )
  }

  if (importError !== null) {
    return (
      <div className="space-y-2 text-xs">
        {picker}
        <p className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 p-2 text-red-700">
          <AlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />
          {importError}
        </p>
        <button className={`${secondaryButton} w-full`} onClick={resetImport}>
          {t('importRetry')}
        </button>
      </div>
    )
  }

  if (importFile !== null) {
    const { name, preview } = importFile
    return (
      <div className="space-y-2 text-xs">
        {picker}
        <p className="flex items-center gap-1.5 font-medium text-neutral-700">
          <FileIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          <span className="truncate">{name}</span>
        </p>
        <div className="space-y-1 text-neutral-500">
          <p className="tabular-nums">
            {t('importStats', String(preview.bookmarkCount), String(preview.folderCount))}
          </p>
          {preview.duplicateCount > 0 && <p>{t('importDuplicates', String(preview.duplicateCount))}</p>}
          {preview.blocked.length > 0 && (
            <p className="flex items-start gap-1.5 text-amber-700">
              <AlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />
              {t('importBlocked', String(preview.blocked.length))}
            </p>
          )}
          <p className="truncate">
            {t('importTarget', `${preview.barTitle}/${preview.targetName}`)}
          </p>
        </div>
        <div className="max-h-48 overflow-y-auto rounded-md border border-neutral-200 bg-white py-1">
          {preview.nodes.map((node, index) => (
            <NodeRow key={`${node.name}-${index}`} node={node} depth={0} />
          ))}
        </div>
        <div className="flex gap-2">
          <button
            className={`${primaryButton} flex-1`}
            disabled={(preview.bookmarkCount === 0 && preview.folderCount === 0) || busy !== null}
            onClick={() => void confirmImport()}
          >
            {t('importConfirm')}
          </button>
          <button className={`${secondaryButton} flex-1`} disabled={busy !== null} onClick={resetImport}>
            {t('importCancel')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 text-xs">
      {picker}
      {/* 标题带上行箭头图标，与上方导出组区分开；否则三个按钮长得一样，导入会被当成第三个导出选项 */}
      <p className={groupLabel}>
        <UploadIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
        {t('importGroup')}
      </p>
      <button
        className={filePickerButton}
        disabled={busy !== null}
        onClick={() => inputRef.current?.click()}
      >
        {t('importPickFile')}
      </button>
    </div>
  )
}
