import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Detail } from '@/sidepanel/components/Detail'

describe('Detail', () => {
  it('presents its label and disclosed value as a line-based key/value pair', async () => {
    render(<Detail label="说明">这次整理可以撤销。</Detail>)

    const disclosure = screen.getByRole('button', { name: '说明' })
    expect(disclosure.closest('dt')).toBeTruthy()
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('这次整理可以撤销。')).toBeNull()

    await userEvent.click(disclosure)

    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('这次整理可以撤销。').closest('dd')).toBeTruthy()
  })
})
