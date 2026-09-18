import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: { port: 3011 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
})
