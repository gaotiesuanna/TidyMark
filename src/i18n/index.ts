import { normalizeLocale, type Locale, type UiLocale } from '@/core/locale'
import { formatMessage } from './format'
import { CATALOGS, type MessageKey } from './messages'

/**
 * 界面取词的唯一入口。
 *
 * 为什么不用 chrome.i18n.getMessage：它的语言由浏览器 UI 语言决定，
 * 运行时没有任何覆盖办法，用户就永远选不了语言。所以自建词条表。
 * chrome.i18n 只剩 getUILanguage 还在用，且只在 uiLocale 为 'auto' 时问一次。
 *
 * core/ 与 llm/ 不许 import 它——那两层要保持零浏览器依赖、能在 node 环境测试，
 * 它们改为把 Locale 当参数接收。
 */

/**
 * 当前语言。默认 en 与 manifest 的 default_locale 一致：
 * 真实运行中 main.tsx（侧栏）与 service worker 启动时都会先 setLocale，
 * 这个初值只在「设置还没读到」的极短窗口里生效。
 */
let current: Locale = 'en'

/** 纯解析：把设置里的取值翻成实际语言。'auto' 时才问浏览器。 */
export function resolveLocale(uiLocale: UiLocale): Locale {
  return uiLocale === 'auto' ? normalizeLocale(chrome.i18n.getUILanguage()) : uiLocale
}

/** 设置当前语言。由 main.tsx、store 的设置保存、background 的每次请求调用。 */
export function setLocale(locale: Locale): void {
  current = locale
}

/** 读当前语言，给需要往 core/llm 传参的调用点用。 */
export function currentLocale(): Locale {
  return current
}

export function t(key: MessageKey, ...args: string[]): string {
  return formatMessage(CATALOGS[current], key, args)
}

/**
 * chrome.i18n 没有复数支持，带数量的文案只能配两个键。
 * 中文两个键填相同内容即可。
 */
export function plural(
  count: number,
  oneKey: MessageKey,
  otherKey: MessageKey,
  ...args: string[]
): string {
  return t(count === 1 ? oneKey : otherKey, ...args)
}
