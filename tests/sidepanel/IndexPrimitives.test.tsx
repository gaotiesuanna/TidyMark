import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IndexRow } from '@/sidepanel/components/IndexRow'
import { IndexSection } from '@/sidepanel/components/IndexSection'
import { InlineStatus } from '@/sidepanel/components/InlineStatus'
import { PageHeader } from '@/sidepanel/components/PageHeader'

describe('indexed layout primitives', () => {
  it('renders page header metadata beneath its feature-owned heading', () => {
    render(<PageHeader title="书签" description="整理你的收藏" meta={<span>12 项</span>} />)

    expect(screen.getByRole('heading', { level: 2, name: '书签' })).toBeTruthy()
    expect(screen.getByText('整理你的收藏')).toBeTruthy()
    expect(screen.getByText('12 项')).toBeTruthy()
  })

  it('renders an expandable index section with a connected direct detail region', async () => {
    const onToggle = vi.fn()
    render(
      <IndexSection index="A" title="来源" count="2" expanded onToggle={onToggle}>
        <p>来源详情</p>
      </IndexSection>,
    )

    const button = screen.getByRole('button', { name: '来源' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-controls')).toBeTruthy()
    expect(document.getElementById(button.getAttribute('aria-controls')!)?.textContent).toContain('来源详情')
    await userEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('renders an expandable index row with a direct detail region', async () => {
    const onToggle = vi.fn()
    render(
      <IndexRow index="01" title="github.com" expanded disclosureLabel="展开 github.com" onToggle={onToggle}>
        <a href="https://github.com/openai">OpenAI repository</a>
      </IndexRow>,
    )
    expect(screen.getByRole('button', { name: '展开 github.com' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('link', { name: 'OpenAI repository' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '展开 github.com' }))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('does not make a non-expandable row interactive', () => {
    render(<IndexRow index="02" title="静态来源" description="可换行的说明" />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('可换行的说明')).toBeTruthy()
  })

  it('keeps a rich row title outside its disclosure button', () => {
    render(
      <IndexRow index="03" title={<a href="https://github.com">GitHub</a>} onToggle={vi.fn()}>
        详情
      </IndexRow>,
    )

    expect(screen.getByRole('link', { name: 'GitHub' }).closest('button')).toBeNull()
  })

  it('announces assertive error status', () => {
    render(<InlineStatus tone="error" live="assertive">请求失败</InlineStatus>)
    expect(screen.getByText('请求失败').getAttribute('aria-live')).toBe('assertive')
  })
})
