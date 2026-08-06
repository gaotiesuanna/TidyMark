import { normalizeLocale, type Locale } from '@/core/locale'

/**
 * 唯一接触 chrome.i18n 的模块。
 *
 * core/ 与 llm/ 不许 import 它——那两层要保持零浏览器依赖、能在 node 环境测试，
 * 它们改为把 Locale 当参数接收。
 */
export function resolveLocale(): Locale {
  return normalizeLocale(chrome.i18n.getUILanguage())
}

export function t(key: string, ...args: string[]): string {
  return chrome.i18n.getMessage(key, args)
}

/**
 * chrome.i18n 没有复数支持，带数量的文案只能配两个键。
 * 中文两个键填相同内容即可。
 */
export function plural(count: number, oneKey: string, otherKey: string, ...args: string[]): string {
  return t(count === 1 ? oneKey : otherKey, ...args)
}
