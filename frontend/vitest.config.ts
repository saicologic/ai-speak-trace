import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // CSS は読み込まない。ただし、レイアウトの決まりをテストで確かめる CSS だけは中身を読めるようにする
    css: { include: [/PageLayout\.css/] },
  },
})
