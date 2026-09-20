import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  appType: 'spa',
  server: {
    port: 3011,
    strictPort: true,
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
