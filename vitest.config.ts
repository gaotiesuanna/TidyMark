import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  test: {
    globals: true,
    // 钉死时区：exportFileName 用本地日期、exportedAt 用 UTC，两者故意不同源，
    // 测试机时区不固定的话这条契约测不出来（比如把实现悄悄换成 UTC 也能全绿）。
    env: { TZ: 'Asia/Shanghai' },
    setupFiles: ['./tests/setup/i18n.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts?(x)'],
          exclude: ['tests/sidepanel/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['tests/sidepanel/**/*.test.ts?(x)'],
        },
      },
    ],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
