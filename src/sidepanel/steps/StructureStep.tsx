import { useMemo } from 'react'
import { buildStructureView } from '@/core/structure'
import { t } from '@/i18n'
import { useStore } from '../store'

export function StructureStep() {
  const { plan, structureEdits, renameNode, removeNode, confirmStructure, backToPreferences } = useStore()
  const nodes = useMemo(
    () => (plan === null ? [] : buildStructureView(plan, structureEdits)),
    [plan, structureEdits],
  )
  if (plan === null) return null

  const total = nodes.reduce((sum, node) => sum + node.count, 0)

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">
        {t('structureIntro', String(nodes.length), String(total))}
        {t('structureHint')}
      </p>

      <ul className="space-y-1">
        {nodes.map((node, index) => {
          const prefix = String(index + 1).padStart(2, '0')
          return (
            <li key={node.id} className="rounded border p-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-8 shrink-0 text-neutral-400">{prefix}</span>
                {node.removable ? (
                  <input
                    className="min-w-0 flex-1 rounded border px-2 py-1"
                    value={node.title}
                    onChange={(e) => renameNode(node.id, e.target.value)}
                  />
                ) : (
                  <span className="min-w-0 flex-1 px-2 py-1 text-neutral-500">{node.title}</span>
                )}
                <span className="shrink-0 text-neutral-400">{t('structureIncoming', String(node.count))}</span>
                {node.removable && (
                  <button
                    aria-label={t('structureDelete', node.title)}
                    className="shrink-0 rounded border px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-50"
                    onClick={() => removeNode(node.id)}
                  >
                    ✕
                  </button>
                )}
              </div>

              {node.children.length > 0 && (
                <ul className="mt-1 space-y-1 pl-8">
                  {node.children.map((child, childIndex) => (
                    <li key={child.id} className="flex items-center gap-2 text-xs">
                      <span className="w-10 shrink-0 text-neutral-400">
                        {String(childIndex + 1).padStart(2, '0')}
                      </span>
                      <input
                        className="min-w-0 flex-1 rounded border px-2 py-1"
                        value={child.title}
                        onChange={(e) => renameNode(child.id, e.target.value)}
                      />
                      <span className="shrink-0 text-neutral-400">{t('structureIncoming', String(child.count))}</span>
                      <button
                        aria-label={t('structureDelete', child.title)}
                        className="shrink-0 rounded border px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-50"
                        onClick={() => removeNode(child.id)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>

      <p className="text-[11px] leading-relaxed text-neutral-400">
        {t('structureFallback')}
      </p>

      <div className="sticky bottom-0 flex gap-2 bg-white pt-2">
        <button className="rounded border px-3 py-2 text-sm" onClick={backToPreferences}>{t('structureBack')}</button>
        <button
          className="flex-1 rounded bg-neutral-800 py-2 text-sm text-white"
          onClick={confirmStructure}
        >
          {t('structureNext')}
        </button>
      </div>
    </div>
  )
}
