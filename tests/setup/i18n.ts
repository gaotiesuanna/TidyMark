import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGetMessage, type Catalog } from './fake-i18n'

/**
 * 读的是真实的 zh_CN 词条文件，不是另写一份假数据。
 *
 * 这样一来现有那些断言中文文案的测试不用改一个字，
 * 而且键名写错或漏加词条时 getMessage 会返回空串、断言当场失败——
 * 整套测试顺带成了 zh_CN 词条的完整性检查。
 *
 * 故意不写成 `new URL('../../public/...', import.meta.url)`：Vite 会把这个字面
 * 写法当成静态资源引用特殊处理（jsdom project 用 Vite 的浏览器式转换），
 * 命中 public/ 目录约定后被改写成 http://localhost:3000/_locales/... 这种
 * dev-server URL，在 node project 里则不受影响——两个 project 结果不一致，
 * 且都不是我们要的本地文件路径。改用 path.resolve 纯走 Node 文件系统语义。
 */
const here = dirname(fileURLToPath(import.meta.url))
const catalogPath = resolve(here, '../../public/_locales/zh_CN/messages.json')
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Catalog

const i18n = {
  getMessage: createGetMessage(catalog),
  getUILanguage: () => 'zh-CN',
}

const existing = (globalThis as { chrome?: Record<string, unknown> }).chrome
;(globalThis as { chrome?: Record<string, unknown> }).chrome = { ...existing, i18n }
