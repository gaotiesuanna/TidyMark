import { describe, it, expect } from 'vitest'
import { folderLevels } from '@/core/level'
import type { BookmarkNode } from '@/core/ports'

/**
 * Chrome 的树：无名根 '0' 下面挂着「书签栏」「其他书签」「移动设备书签」三个永久根。
 * 书签栏在界面上就是那一条栏，它自己不是「一个目录」；而「其他书签」在栏的最右端
 * 显示成一个文件夹，跟栏里的目录平级。层级定义照这个视觉模型走。
 */
const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'finished', children: [
        { id: '100', title: '前端', children: [
          { id: '1000', title: 'React', children: [] },
        ]},
        { id: '101', title: 'A', url: 'https://a.dev' },
      ]},
      { id: '11', title: 'react', children: [] },
    ]},
    { id: '2', title: '其他书签', children: [
      { id: '20', title: '01 GitHub', children: [
        { id: '200', title: 'B', url: 'https://b.dev' },
      ]},
    ]},
    { id: '3', title: '移动设备书签', children: [] },
  ]},
]

describe('folderLevels', () => {
  it('书签栏自己不占一层，它的子目录是一级', () => {
    const levels = folderLevels(tree)
    expect(levels.get('1')).toBe(0)
    expect(levels.get('10')).toBe(1)
    expect(levels.get('11')).toBe(1)
  })

  it('其他书签自己就是一级——它在栏的最右端显示成一个文件夹，跟栏里的目录平级', () => {
    const levels = folderLevels(tree)
    expect(levels.get('2')).toBe(1)
    expect(levels.get('20')).toBe(2)
  })

  it('移动设备书签同理，不是只有其他书签特殊', () => {
    expect(folderLevels(tree).get('3')).toBe(1)
  })

  it('再往下逐层加一', () => {
    const levels = folderLevels(tree)
    expect(levels.get('100')).toBe(2)
    expect(levels.get('1000')).toBe(3)
  })

  it('书签不进表——层级是目录的属性', () => {
    const levels = folderLevels(tree)
    expect(levels.has('101')).toBe(false)
    expect(levels.has('200')).toBe(false)
  })

  it('无名根容器自己不是目录，不进表', () => {
    expect(folderLevels(tree).has('0')).toBe(false)
  })

  it('没有无名根包裹时也算得对——测试里常直接给一组顶层节点', () => {
    const bare: BookmarkNode[] = [
      { id: '1', title: '书签栏', children: [{ id: '10', title: 'x', children: [] }] },
      { id: '2', title: '其他书签', children: [] },
    ]
    const levels = folderLevels(bare)
    expect(levels.get('1')).toBe(0)
    expect(levels.get('10')).toBe(1)
    expect(levels.get('2')).toBe(1)
  })

  it('空树返回空表，不抛错', () => {
    expect(folderLevels([]).size).toBe(0)
  })
})
