import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Tauri開発時にコンソールをクリアしない
  clearScreen: false,
  server: {
    // Tauri開発時に固定ポートを使用
    strictPort: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/outputs': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
