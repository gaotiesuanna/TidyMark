import { setLocale } from '@/i18n'

/**
 * 全局桩：把界面语言钉成中文。
 *
 * 过去这里劫持 chrome.i18n.getMessage 并读真实的 zh_CN 词条文件；
 * 现在 t() 自己查 bundle 里的词条表，桩只需要设一次语言——
 * 「测试断言的中文文案来自真实词条文件」这条性质不变，
 * 键名写错或漏加词条时 t() 仍然返回空串、断言当场失败。
 *
 * chrome.i18n.getUILanguage 还留着：uiLocale 为 'auto' 时 resolveLocale 要问它。
 */
setLocale('zh_CN')

const i18n = { getUILanguage: () => 'zh-CN' }

const existing = (globalThis as { chrome?: Record<string, unknown> }).chrome
;(globalThis as { chrome?: Record<string, unknown> }).chrome = { ...existing, i18n }
