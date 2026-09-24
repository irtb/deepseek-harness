import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const agentContractsDir = path.resolve(rootDir, '../shotgo-agent/src/contracts')

export default defineConfig({
  plugins: [react()],
  appType: 'spa',
  server: {
    port: 3011,
    strictPort: true,
    fs: {
      allow: [rootDir, agentContractsDir],
    },
    proxy: {
      '/api/agent': {
        target: 'http://127.0.0.1:3012',
        changeOrigin: true,
        timeout: 310_000,
        proxyTimeout: 310_000,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
})
