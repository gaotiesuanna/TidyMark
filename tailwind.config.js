export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    fontFamily: {
      sans: 'var(--font-family-sans)',
      mono: 'var(--font-family-mono)',
    },
    fontSize: {
      '2xs': 'var(--font-size-2xs)',
      xs: 'var(--font-size-xs)',
      sm: 'var(--font-size-sm)',
      md: 'var(--font-size-md)',
      base: 'var(--font-size-base)',
    },
    fontWeight: {
      regular: 'var(--font-weight-regular)',
      medium: 'var(--font-weight-medium)',
      semibold: 'var(--font-weight-semibold)',
    },
    lineHeight: {
      snug: 'var(--line-height-snug)',
      normal: 'var(--line-height-normal)',
      relaxed: 'var(--line-height-relaxed)',
      caption: 'var(--line-height-caption)',
      body: 'var(--line-height-body)',
    },
    extend: {
      colors: {
        index: {
          canvas: 'var(--index-canvas)',
          ink: 'var(--index-ink)',
          muted: 'var(--index-muted)',
          faint: 'var(--index-faint)',
          line: 'var(--index-line)',
          'line-strong': 'var(--index-line-strong)',
          blue: 'var(--index-blue)',
          'blue-soft': 'var(--index-blue-soft)',
        },
      },
      borderRadius: {
        index: 'var(--index-radius)',
      },
      minHeight: {
        'index-row': 'var(--index-row-min-height)',
      },
    },
  },
  plugins: [],
}
