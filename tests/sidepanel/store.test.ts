import { describe, it, expect } from 'vitest'
import { collectDescendantFolderIds, toggleChecked } from '@/sidepanel/store'
import type { BookmarkNode } from '@/core/ports'

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'react', children: [
        { id: '100', title: 'A', url: 'https://a.dev' },
        { id: '101', title: '子文件夹', children: [] },
      ]},
      { id: '11', title: '杂项', children: [] },
    ]},
  ]},
]

describe('collectDescendantFolderIds', () => {
  it('只收集文件夹，不收集书签', () => {
    expect(collectDescendantFolderIds(tree, '1').sort()).toEqual(['10', '101', '11'])
  })
  it('叶子文件夹返回空数组', () => {
    expect(collectDescendantFolderIds(tree, '11')).toEqual([])
  })
})

describe('toggleChecked', () => {
  it('勾选文件夹时级联勾选其所有子文件夹', () => {
    expect([...toggleChecked(new Set(), '1', tree)].sort()).toEqual(['1', '10', '101', '11'])
  })

  it('取消勾选时级联取消其所有子文件夹', () => {
    const checked = toggleChecked(new Set(), '1', tree)
    expect([...toggleChecked(checked, '1', tree)]).toEqual([])
  })

  it('取消子文件夹不影响父文件夹的勾选状态', () => {
    const checked = toggleChecked(new Set(), '1', tree)
    const after = toggleChecked(checked, '10', tree)
    expect(after.has('1')).toBe(true)
    expect(after.has('10')).toBe(false)
    expect(after.has('101')).toBe(false)
  })
})
