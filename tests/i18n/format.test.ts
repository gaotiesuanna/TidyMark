import { describe, it, expect } from 'vitest'
import { formatMessage, type Catalog } from '@/i18n/format'

const catalog: Catalog = {
  plain: { message: '你好' },
  withOne: {
    message: '导出选中的 $count$ 条书签',
    placeholders: { count: { content: '$1' } },
  },
  withTwo: {
    message: '已导入 $n$ 条到 $where$',
    placeholders: { n: { content: '$1' }, where: { content: '$2' } },
  },
  escaped: { message: '价格 $$9.99' },
  undeclared: { message: '未声明的 $ghost$ 占位符' },
}

// 用 subs: string | string[] 而不是 rest 参数——下面的断言里既有传单个字符串
// 也有传数组的用例，跟 chrome.i18n.getMessage 的调用约定保持一致。
const getMessage = (key: string, subs?: string | string[]): string =>
  formatMessage(catalog, key, subs === undefined ? [] : Array.isArray(subs) ? subs : [subs])

describe('formatMessage 复刻 chrome.i18n 语义', () => {
  it('普通词条原样返回', () => {
    expect(getMessage('plain')).toBe('你好')
  })

  it('找不到的键返回空串——不是键名也不是抛错', () => {
    expect(getMessage('nope')).toBe('')
  })

  it('单个占位符按实参替换', () => {
    expect(getMessage('withOne', '3')).toBe('导出选中的 3 条书签')
  })

  it('实参可以传数组', () => {
    expect(getMessage('withOne', ['3'])).toBe('导出选中的 3 条书签')
  })

  it('多个占位符按 $1 $2 顺序对应', () => {
    expect(getMessage('withTwo', ['5', '书签栏/导入'])).toBe('已导入 5 条到 书签栏/导入')
  })

  it('占位符名大小写不敏感', () => {
    const mixedCatalog: Catalog = {
      x: { message: '值 $Count$', placeholders: { count: { content: '$1' } } },
    }
    const mixed = (key: string, ...args: string[]): string => formatMessage(mixedCatalog, key, args)
    expect(mixed('x', '7')).toBe('值 7')
  })

  it('缺少实参时补空串，不抛异常', () => {
    expect(getMessage('withOne')).toBe('导出选中的  条书签')
  })

  it('$$ 转义成一个字面 $', () => {
    expect(getMessage('escaped')).toBe('价格 $9.99')
  })

  it('未声明的占位符原样保留', () => {
    expect(getMessage('undeclared')).toBe('未声明的 $ghost$ 占位符')
  })
})
