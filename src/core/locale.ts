/**
 * 界面与产出共用的语言标识。与 _locales 下的目录名一致。
 *
 * 放在 core/ 且不依赖任何浏览器 API：产出层（规则表、提示词）也要用它，
 * 而那一层跑在 node 测试环境里，没有 chrome 全局。
 */
export type Locale = 'zh_CN' | 'en'

export const LOCALES: readonly Locale[] = ['en', 'zh_CN']

/**
 * 设置里存的语言取值。'auto' 表示跟随浏览器 UI 语言。
 *
 * 放在 core/ 而不是 storage/：i18n 层的 resolveLocale() 要收它当参数，
 * 而 i18n 不该反向依赖 storage。
 */
export type UiLocale = 'auto' | Locale

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

/**
 * Locale → HTML `lang` 属性的值。
 *
 * `zh_CN` 是 `_locales` 的目录名，不是合法的 BCP 47 标签；写进 `lang` 要用 `zh-CN`。
 * 两者只差一个字符，直接把 Locale 塞进 lang 不会报错、只会静默产出无效值，所以单列一层。
 */
export function toHtmlLang(locale: Locale): string {
  return locale === 'zh_CN' ? 'zh-CN' : 'en'
}
