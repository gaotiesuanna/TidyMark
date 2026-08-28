import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DangerButton,
  PrimaryButton,
  SecondaryButton,
  SegmentedChoice,
  StickyActionBar,
} from '@/sidepanel/components/IndexControls'

const options = [
  { value: 'bookmarks', label: '书签' },
  { value: 'visits', label: '访问' },
] as const

describe('IndexControls', () => {
  it('reports the selected segmented choice accessibly', async () => {
    const onChange = vi.fn()

    render(<SegmentedChoice label="数据类型" value="bookmarks" options={options} onChange={onChange} />)

    expect(screen.getByRole('group', { name: '数据类型' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '书签' }).getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: '访问' }))
    expect(onChange).toHaveBeenCalledWith('visits')
  })

  it('does not change a disabled segmented choice', async () => {
    const onChange = vi.fn()

    render(<SegmentedChoice label="数据类型" value="bookmarks" options={options} disabled onChange={onChange} />)

    const visits = screen.getByRole('button', { name: '访问' }) as HTMLButtonElement
    expect(visits.disabled).toBe(true)
    await userEvent.click(visits)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps native button props and class extensions on semantic buttons', () => {
    render(
      <>
        <PrimaryButton className="primary-extra" disabled>保存</PrimaryButton>
        <SecondaryButton className="secondary-extra">取消</SecondaryButton>
        <DangerButton className="danger-extra">删除</DangerButton>
        <StickyActionBar><button type="button">提交</button></StickyActionBar>
      </>,
    )

    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: '保存' }).className).toContain('primary-extra')
    expect(screen.getByRole('button', { name: '取消' }).className).toContain('secondary-extra')
    expect(screen.getByRole('button', { name: '删除' }).className).toContain('danger-extra')
    expect(screen.getByRole('button', { name: '提交' }).parentElement?.className).toContain('sticky')
  })
})
