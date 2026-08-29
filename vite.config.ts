import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import { fileURLToPath, URL } from 'node:url'
import manifest from './manifest.config.ts'

/**
 * CRXJS 2.7.1 still assigns `server.hmr.host`, which Vite 8 deprecates in
 * favor of `server.ws.host`. https://github.com/crxjs/chrome-extension-tools/issues/1231
 */
function crxWithVite8Ws(options: Parameters<typeof crx>[0]) {
  return crx(options).map((plugin) => {
    if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin)) return plugin
    const crxPlugin = plugin as Plugin
    if (crxPlugin.name !== 'crx:hmr' || typeof crxPlugin.config !== 'function') return plugin
    const originalConfig = crxPlugin.config
    return {
      ...crxPlugin,
      async config(config, env) {
        const server = { ...config.server }
        if (server.hmr && typeof server.hmr === 'object') {
          server.hmr = { ...server.hmr }
        }
        const result = await originalConfig.call(this, { ...config, server }, env)
        const next = result?.server
        if (!next?.hmr || typeof next.hmr !== 'object') return result
        const { host } = next.hmr
        if (host == null) return result
        const { ws, ...rest } = next
        delete rest.hmr
        return {
          ...result,
          server: {
            ...rest,
            ws: { ...(typeof ws === 'object' && ws ? ws : {}), host },
          },
        }
      },
    } satisfies Plugin
  })
}

export default defineConfig({
  plugins: [react(), crxWithVite8Ws({ manifest })],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
