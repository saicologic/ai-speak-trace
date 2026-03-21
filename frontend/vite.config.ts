import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // ルートの.envからBACKEND_PORTを読み込み
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const backendPort = env.BACKEND_PORT || '3100'

  return {
    plugins: [react()],
    // Tauri開発時にコンソールをクリアしない
    clearScreen: false,
    define: {
      __BACKEND_PORT__: JSON.stringify(backendPort),
    },
    server: {
      // Tauri開発時に固定ポートを使用
      strictPort: true,
      port: 5173,
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
        '/outputs': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  }
})
