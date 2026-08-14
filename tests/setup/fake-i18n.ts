import { formatMessage, type Catalog } from '@/i18n/format'

export type { Catalog, MessageEntry } from '@/i18n/format'

/**
 * chrome.i18n.getMessage 的桩。替换语义由 src/i18n/format.ts 提供——
 * 桩和生产实现共用同一份代码，不会漂移。
 * 这里只补 chrome 那层「subs 可以是单个字符串」的调用约定。
 */
export function createGetMessage(catalog: Catalog) {
  return function getMessage(key: string, subs?: string | string[]): string {
    const args = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs]
    return formatMessage(catalog, key, args)
  }
}
