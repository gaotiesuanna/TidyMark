import { useMemo } from 'react'
import { buildStructureView } from '@/core/structure'
import { currentLocale, plural, t } from '@/i18n'
import { joinTitles } from '../lib/listText'
import { useStore } from '../store'

export function StructureStep() {
  const { plan, structureEdits, renameNode, removeNode, mergeNode, confirmStructure, backToPreferences } = useStore()
  const nodes = useMemo(
    () => (plan === null ? [] : buildStructureView(plan, structureEdits, currentLocale())),
    [plan, structureEdits],
  )
  if (plan === null) return null

  const total = nodes.reduce((sum, node) => sum + node.count, 0)

  return (
    <div className="space-y-3">
      <p className="text-sm leading-caption text-neutral-500">
        {plural(nodes.length, 'structureIntroOne', 'structureIntroOther', String(nodes.length), String(total))}
        {' '}
        {t('structureHint')}
      </p>

      {/* 合并根是容器不是分类，不进下面那份两层列表；它不可删除，也不带计数 */}
      {plan.mergeRoot !== null && (
        <div className="space-y-1 rounded border border-neutral-300 bg-neutral-50 p-2">
          <label className="flex items-center gap-2 text-sm leading-caption">
            <span className="shrink-0 text-neutral-500">{t('structureMergeLabel')}</span>
            <input
              className="min-w-0 flex-1 rounded border px-2 py-1"
              value={structureEdits.renames[plan.mergeRoot.temporaryId] ?? plan.mergeRoot.title}
              onChange={(e) => renameNode(plan.mergeRoot!.temporaryId, e.target.value)}
            />
          </label>
          {/* 上面那行说的是东西去哪儿，没说什么会没掉。合并会把这些源目录清空后删除，
             而在这之前，整条动线没有任何一处讲过这件事——偏好页那段「范围根目录不会被删除」
             讲的还是非合并模式。第一次听说不能是结果页，那时已经删完了。
             点名到具体标题，不说「源文件夹」这种对不上号的话；删除吓人，撤销才是让人敢按的那句。 */}
          <p className="text-xs leading-relaxed text-neutral-500">
            {t('structureMergeNotice', joinTitles(plan.mergeRoot.sourceTitles, currentLocale()))}
          </p>
        </div>
      )}

      <ul className="space-y-1">
        {nodes.map((node, index) => {
          const prefix = String(index + 1).padStart(2, '0')
          return (
            <li key={node.id} className="rounded border p-2">
              <div className="flex items-center gap-2 text-sm leading-caption">
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
                {/* 下拉不放进上面 removable 分支里的 <input>：这里的行本身没有 <label> 包裹，
                    但选项集合仍按「只列同层」严格算，跨层等于移动，本轮不做（票 07）。
                    「其他」进选项：它虽然自己不可被合并走（下面 node.removable 挡住了它自己的下拉），
                    但可以当接收方——把一个碎目录并进「其他」，对普通主题目录效果与「删除」一致，
                    但对聚合目录不是重复：聚合目录被删会按书签的 primaryTopic 散开（见 structure.ts
                    的回落链），只有散不到同名主题时才落「其他」，用户没有别的办法表达「就是想整个
                    倒进其他」，所以合并到「其他」是一个真实存在、删除表达不了的选项（票 07 §3） */}
                {node.removable && (
                  <select
                    aria-label={t('structureMergeInto', node.title)}
                    className="shrink-0 rounded border px-1 py-0.5 text-neutral-700"
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
                )}
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
                    <li key={child.id} className="flex items-center gap-2 text-sm leading-caption">
                      <span className="w-10 shrink-0 text-neutral-400">
                        {String(childIndex + 1).padStart(2, '0')}
                      </span>
                      <input
                        className="min-w-0 flex-1 rounded border px-2 py-1"
                        value={child.title}
                        onChange={(e) => renameNode(child.id, e.target.value)}
                      />
                      <span className="shrink-0 text-neutral-400">{t('structureIncoming', String(child.count))}</span>
                      {/* 二级目录只能合到同一个父目录下的另一个二级目录——跨父目录等于移动，本轮不做 */}
                      <select
                        aria-label={t('structureMergeInto', child.title)}
                        className="shrink-0 rounded border px-1 py-0.5 text-neutral-700"
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

      <p className="text-xs leading-relaxed text-neutral-400">
        {t('structureFallback')}
      </p>

      <div className="sticky bottom-0 flex gap-2 bg-white pt-2">
        <button className="rounded border px-3 py-2 text-base leading-body" onClick={backToPreferences}>{t('structureBack')}</button>
        <button
          className="flex-1 rounded bg-neutral-800 py-2 text-base leading-body text-white"
          onClick={confirmStructure}
        >
          {t('structureNext')}
        </button>
      </div>
    </div>
  )
}
