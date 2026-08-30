import { describe, it, expect } from 'vitest'
import { createChromePorts } from '@/background/chrome-ports'

/**
 * 后台能碰的浏览器能力有一份明确的清单，而且这份清单**短**。
 *
 * 这条不是在测某个行为，是在守一条边界：清理页对用户写着「不读取浏览历史」，
 * 而后台之所以做得到，是因为它压根没有通往 chrome.history 的口子——不是因为
 * 谁记得别去调。曾经有过一个 history 端口（实现齐全、一处未用），
 * 这条测试就是防它、或者别的什么，哪天又被顺手加回来。
 *
 * 真要给后台开一项新能力，改这里的名单是有意为之的一步，不该是改别处时的副作用。
 */
describe('后台的能力清单', () => {
  it('只有书签与存储两样', () => {
    expect(Object.keys(createChromePorts()).sort()).toEqual(['bookmarks', 'storage'])
  })

  it('没有通往浏览历史的口子', () => {
    expect('history' in createChromePorts()).toBe(false)
  })
})
