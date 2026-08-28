import { useMemo } from 'react'
import { buildStructureView } from '@/core/structure'
import { currentLocale, plural, t } from '@/i18n'
import { joinTitles } from '../lib/listText'
import { useStore } from '../store'
import { IndexRow } from '../components/IndexRow'
import { IndexSection } from '../components/IndexSection'
import { InlineStatus } from '../components/InlineStatus'
import { PrimaryButton, SecondaryButton, StickyActionBar } from '../components/IndexControls'
import { fieldClass } from '../components/buttonStyles'

export function StructureStep() {
  const { plan, structureEdits, renameNode, removeNode, mergeNode, confirmStructure, backToPreferences } = useStore()
  const nodes = useMemo(
    () => (plan === null ? [] : buildStructureView(plan, structureEdits, currentLocale())),
    [plan, structureEdits],
  )
  if (plan === null) return null

  const total = nodes.reduce((sum, node) => sum + node.count, 0)
  const description = `${plural(nodes.length, 'structureIntroOne', 'structureIntroOther', String(nodes.length), String(total))} ${t('structureHint')}`

  return (
    <div>
      <p className="mb-4 text-sm leading-body text-index-muted">{description}</p>

      {/* 合并根是容器不是分类，不进下面那份两层列表；它不可删除，也不带计数 */}
      {plan.mergeRoot !== null && (
        <div className="mt-3">
          <InlineStatus tone="warning" title={t('structureMergeLabel')}>
            <label className="block">
              <span className="sr-only">{t('structureMergeLabel')}</span>
            <input
                className={`mt-1 ${fieldClass}`}
              value={structureEdits.renames[plan.mergeRoot.temporaryId] ?? plan.mergeRoot.title}
              onChange={(e) => renameNode(plan.mergeRoot!.temporaryId, e.target.value)}
            />
            </label>
          {/* 上面那行说的是东西去哪儿，没说什么会没掉。合并会把这些源目录清空后删除，
             而在这之前，整条动线没有任何一处讲过这件事——偏好页那段「范围根目录不会被删除」
             讲的还是非合并模式。第一次听说不能是结果页，那时已经删完了。
             点名到具体标题，不说「源文件夹」这种对不上号的话；删除吓人，撤销才是让人敢按的那句。 */}
            <p className="mt-2 text-xs leading-body">
            {t('structureMergeNotice', joinTitles(plan.mergeRoot.sourceTitles, currentLocale()))}
          </p>
          </InlineStatus>
        </div>
      )}

      <div data-testid="structure-section">
        <IndexSection title={t('shellStepStructure')} count={nodes.length}>
          <ol className="border-t border-index-line">
            {nodes.map((node, index) => {
              const prefix = String(index + 1).padStart(2, '0')
              const actions = node.removable ? (
                <span className="flex items-center gap-1">
                  <select
                    aria-label={t('structureMergeInto', node.title)}
                    className="min-w-0 rounded-index border border-index-line bg-index-canvas px-1 py-1 text-xs text-index-ink"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value !== '') mergeNode(node.id, e.target.value)
                    }}
                  >
                    <option value="">{t('structureMergePlaceholder')}</option>
                    {nodes
                      .filter((sibling) => sibling.id !== node.id)
                      .map((sibling) => (
                        <option key={sibling.id} value={sibling.id}>{sibling.title}</option>
                      ))}
                  </select>
                  <SecondaryButton
                    aria-label={t('structureDelete', node.title)}
                    className="min-h-0 px-2 py-1"
                    onClick={() => removeNode(node.id)}
                  >
                    ✕
                  </SecondaryButton>
                </span>
              ) : undefined
              return (
                <li key={node.id}>
                  <IndexRow
                    index={prefix}
                    title={node.removable ? (
                  <input
                        aria-label={node.title}
                        className={`${fieldClass} min-h-0 py-1`}
                    value={node.title}
                    onChange={(e) => renameNode(node.id, e.target.value)}
                  />
                ) : (
                      <span className="break-words text-index-muted">{node.title}</span>
                )}
                    measure={t('structureIncoming', String(node.count))}
                    value={actions}
                  >
                    {node.children.length > 0 && (
                      <ol>
                        {node.children.map((child, childIndex) => (
                          <li key={child.id}>
                            <IndexRow
                              index={String(childIndex + 1).padStart(2, '0')}
                              title={(
                      <input
                                  aria-label={child.title}
                                  className={`${fieldClass} min-h-0 py-1`}
                        value={child.title}
                        onChange={(e) => renameNode(child.id, e.target.value)}
                      />
                              )}
                              measure={t('structureIncoming', String(child.count))}
                              value={(
                                <span className="flex items-center gap-1">
                                  <select
                        aria-label={t('structureMergeInto', child.title)}
                                    className="min-w-0 rounded-index border border-index-line bg-index-canvas px-1 py-1 text-xs text-index-ink"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value !== '') mergeNode(child.id, e.target.value)
                        }}
                      >
                        <option value="">{t('structureMergePlaceholder')}</option>
                        {node.children
                          .filter((sibling) => sibling.id !== child.id)
                          .map((sibling) => (
                            <option key={sibling.id} value={sibling.id}>{sibling.title}</option>
                          ))}
                                  </select>
                                  <SecondaryButton
                                    aria-label={t('structureDelete', child.title)}
                                    className="min-h-0 px-2 py-1"
                                    onClick={() => removeNode(child.id)}
                                  >
                                    ✕
                                  </SecondaryButton>
                                </span>
                              )}
                            />
                          </li>
                        ))}
                      </ol>
                    )}
                  </IndexRow>
                </li>
              )
            })}
          </ol>
        </IndexSection>
      </div>

      <div className="mt-3">
        <InlineStatus tone="neutral">{t('structureFallback')}</InlineStatus>
      </div>

      <StickyActionBar>
        <div className="flex gap-2">
          <SecondaryButton onClick={backToPreferences}>{t('structureBack')}</SecondaryButton>
          <PrimaryButton className="flex-1" onClick={confirmStructure}>
          {t('structureNext')}
          </PrimaryButton>
        </div>
      </StickyActionBar>
    </div>
  )
}
