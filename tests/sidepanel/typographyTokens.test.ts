import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import loadConfig from 'tailwindcss/loadConfig'

const tailwindConfig = loadConfig(resolve('tailwind.config.js'))

describe('typography tokens', () => {
  it('exposes white-index color and geometry tokens', async () => {
    const css = await readFile(resolve('src/sidepanel/index.css'), 'utf8')

    expect(css).toContain('--index-line:')
    expect(css).toContain('--index-blue:')
    expect(css).toContain('--index-radius:')
    expect(css).toContain('--index-row-min-height: 42px')
  })

  it('compiles the named typography tokens to the shared CSS variables', async () => {
    const config = {
      ...tailwindConfig,
      content: [{
        raw: [
          'font-sans font-mono',
          'text-2xs text-xs text-sm text-md text-base',
          'font-regular font-medium font-semibold',
          'leading-snug leading-normal leading-relaxed leading-caption leading-body',
        ].join(' '),
      }],
    }

    const result = await postcss(tailwindcss(config)).process('@tailwind utilities;', {
      from: undefined,
    })

    expect(result.css).toContain('.text-2xs')
    expect(result.css).toContain('font-size: var(--font-size-2xs)')
    expect(result.css).toContain('font-size: var(--font-size-xs)')
    expect(result.css).toContain('font-size: var(--font-size-sm)')
    expect(result.css).toContain('font-size: var(--font-size-md)')
    expect(result.css).toContain('font-size: var(--font-size-base)')
    expect(result.css).toContain('font-family: var(--font-family-sans)')
    expect(result.css).toContain('font-family: var(--font-family-mono)')
    expect(result.css).toContain('font-weight: var(--font-weight-regular)')
    expect(result.css).toContain('font-weight: var(--font-weight-medium)')
    expect(result.css).toContain('font-weight: var(--font-weight-semibold)')
    expect(result.css).toContain('line-height: var(--line-height-snug)')
    expect(result.css).toContain('line-height: var(--line-height-normal)')
    expect(result.css).toContain('line-height: var(--line-height-relaxed)')
    expect(result.css).toContain('line-height: var(--line-height-caption)')
    expect(result.css).toContain('line-height: var(--line-height-body)')
  })
})
