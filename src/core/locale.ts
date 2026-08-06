/**
 * 界面与产出共用的语言标识。与 _locales 下的目录名一致。
 *
 * 放在 core/ 且不依赖任何浏览器 API：产出层（规则表、提示词）也要用它，
 * 而那一层跑在 node 测试环境里，没有 chrome 全局。
 */
export type Locale = 'zh_CN' | 'en'

export const LOCALES: readonly Locale[] = ['en', 'zh_CN']

/**
 * 把 chrome.i18n.getUILanguage() 之类的 BCP 47 标签归一成受支持的 Locale。
 *
 * 繁体一并归到 zh_CN：只维护一套中文词条，繁体用户读简体好过掉到英文。
 * 认不出的语言一律落到 en——它是 manifest 里的 default_locale。
 */
export function normalizeLocale(uiLanguage: string): Locale {
  const tag = uiLanguage.trim().toLowerCase()
  if (tag === 'zh' || tag.startsWith('zh-') || tag.startsWith('zh_')) return 'zh_CN'
  return 'en'
}
