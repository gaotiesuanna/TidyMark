import { toHtmlLang } from '@/core/locale'
import { currentLocale } from '@/i18n'

/**
 * 按实际界面语言改写 `<html lang>`。
 *
 * index.html 里的 lang 是静态值，只能写死一种语言，而界面是双语的。英文界面下
 * 页面若仍自称中文，屏幕阅读器会用中文发音去读英文，浏览器也可能误弹「是否翻译此页」。
 *
 * 放在 sidepanel/ 而不是 i18n/：i18n/ 那层只负责取词条，不碰 DOM。
 */
export function applyDocumentLang(): void {
  document.documentElement.lang = toHtmlLang(currentLocale())
}
