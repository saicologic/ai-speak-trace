import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // CSS は読み込まない（画面のテストにスタイルを入れない）。ただし、レイアウトの決まりを確かめるため、?raw で読むときだけ中身を読む
    css: { include: [/\.css\?raw$/] },
  },
})
