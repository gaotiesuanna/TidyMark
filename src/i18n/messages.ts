import type { Locale } from '@/core/locale'
import type { Catalog } from './format'
import en from '../../public/_locales/en/messages.json'
import zh from '../../public/_locales/zh_CN/messages.json'

/**
 * 构建期把 _locales 下的词条 import 进 bundle。
 *
 * 为什么不是运行时 fetch：省几 KB 体积换来异步加载与首帧空白，不划算。
 * 为什么不另写一张双语常量表：175 个词条会从此两处维护，迟早漂移；
 * manifest 的 name/description 又必须留在 _locales 里，那边删不掉。
 *
 * public/ 下的文件同时被 Vite 原样拷进产物、又被这里当普通模块打进 bundle。
 * 两条路互不干扰：拷贝那份供 chrome.i18n 读 manifest 文案，打包这份供界面读。
 */
export const CATALOGS: Record<Locale, Catalog> = { en, zh_CN: zh }

/**
 * 175 个键的联合类型。chrome.i18n 时代 t('typo') 静默返回空串，
 * 有了它编译期就报错——这是自建词条表顺带拿到的好处。
 */
export type MessageKey = keyof typeof zh
