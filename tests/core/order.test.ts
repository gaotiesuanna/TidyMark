import { describe, it, expect } from 'vitest'
import { folderNumber, planBareFolderRenames, planFolderOrder } from '@/core/order'
import type { BookmarkNode } from '@/core/ports'

describe('folderNumber', () => {
  it('取出开头的编号', () => {
    expect(folderNumber('05 其他')).toBe(5)
    expect(folderNumber('01 GitHub')).toBe(1)
  })

  it('兼容上一版的点号编号', () => {
    expect(folderNumber('01.6 数字人')).toBe(1.6)
  })

  it('没有编号返回 null', () => {
    expect(folderNumber('fastapi')).toBeNull()
    expect(folderNumber('3D 建模')).toBeNull()
    expect(folderNumber('2026 年计划')).toBeNull()
  })
})

describe('planBareFolderRenames', () => {
  it('同层都没编号时从 01 起依次补号', () => {
    expect(planBareFolderRenames([
      { id: 'a', title: '语音交互' },
      { id: 'b', title: 'Web工程' },
    ])).toEqual([
      { id: 'a', oldTitle: '语音交互', newTitle: '01 语音交互' },
      { id: 'b', oldTitle: 'Web工程', newTitle: '02 Web工程' },
    ])
  })

  it('接着本层已有最大号往后编，已带号的不动', () => {
    expect(planBareFolderRenames([
      { id: 'a', title: '01 FastAPI' },
      { id: 'b', title: '语音交互' },
      { id: 'c', title: '10 其他' },
      { id: 'd', title: 'Web工程' },
    ])).toEqual([
      { id: 'b', oldTitle: '语音交互', newTitle: '11 语音交互' },
      { id: 'd', oldTitle: 'Web工程', newTitle: '12 Web工程' },
    ])
  })

  it('名字本身以数字开头的目录不补号，免得剪掉用户自己的名字', () => {
    expect(planBareFolderRenames([
      { id: 'a', title: '01 FastAPI' },
      { id: 'b', title: '12 月清单' },
    ])).toEqual([])
  })

  it('已经全带编号时不产生改名', () => {
    expect(planBareFolderRenames([
      { id: 'a', title: '01 FastAPI' },
      { id: 'b', title: '02 量化交易' },
    ])).toEqual([])
  })
})

describe('planFolderOrder', () => {
  // 截图里的顺序：未编号的在最前，01 GitHub 掉在最后
  const tree: BookmarkNode[] = [
    { id: '0', title: '', children: [
      { id: '1', title: 'NiceG', children: [
        { id: 'f-fastapi', title: 'fastapi', children: [] },
        { id: 'b1', title: 'Dashboard', url: 'https://d.dev' },
        { id: 'f-ai', title: '02 AI', children: [
          { id: 'f-rag', title: '02 RAG', children: [] },
          { id: 'f-dify', title: '01 dify', children: [] },
        ]},
        { id: 'f-dev', title: '03 开发', children: [] },
        { id: 'f-github', title: '01 GitHub', children: [] },
      ]},
    ]},
  ]

  const moves = (): ReturnType<typeof planFolderOrder> => planFolderOrder(tree, ['1'])

  it('带编号的目录按编号升序排到父目录最前面', () => {
    expect(moves().filter((m) => m.parentId === '1')).toEqual([
      { id: 'f-github', parentId: '1', index: 0 },
      { id: 'f-ai', parentId: '1', index: 1 },
      { id: 'f-dev', parentId: '1', index: 2 },
    ])
  })

  it('递归处理子目录', () => {
    expect(moves().filter((m) => m.parentId === 'f-ai')).toEqual([
      { id: 'f-dify', parentId: 'f-ai', index: 0 },
      { id: 'f-rag', parentId: 'f-ai', index: 1 },
    ])
  })

  it('没编号的目录与书签不产生移动', () => {
    const ids = moves().map((m) => m.id)
    expect(ids).not.toContain('f-fastapi')
    expect(ids).not.toContain('b1')
  })

  it('范围外的目录不动', () => {
    const outside: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: '1', title: '范围内', children: [{ id: 'a', title: '02 A', children: [] }] },
        { id: '2', title: '范围外', children: [{ id: 'b', title: '02 B', children: [] }] },
      ]},
    ]
    expect(planFolderOrder(outside, ['1']).map((m) => m.id)).toEqual(['a'])
  })

  it('父子同时被勾选时不重复产生移动', () => {
    expect(planFolderOrder(tree, ['1', 'f-ai']).filter((m) => m.parentId === 'f-ai')).toHaveLength(2)
  })

  it('已经排好序时仍给出完整落位序列，重复执行结果一致', () => {
    const sorted: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: '1', title: 'R', children: [
          { id: 'a', title: '01 A', children: [] },
          { id: 'b', title: '02 B', children: [] },
        ]},
      ]},
    ]
    expect(planFolderOrder(sorted, ['1'])).toEqual([
      { id: 'a', parentId: '1', index: 0 },
      { id: 'b', parentId: '1', index: 1 },
    ])
  })
})
