import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'path'

export default defineConfig(() => {
  // 開発時: scripts/dev-backend.mjs が書き込む .backend-port ファイルからポートを読む
  const portFile = path.resolve(__dirname, '../.backend-port')
  const backendPort = existsSync(portFile)
    ? readFileSync(portFile, 'utf-8').trim()
    : null

  if (backendPort) {
    console.log(`[vite] バックエンドポート: ${backendPort}`)
  } else {
    console.warn('[vite] .backend-port が見つかりません。Vite proxy は無効です（本番ビルドでは不要）')
  }

  return {
    plugins: [react()],
    // Tauri開発時にコンソールをクリアしない
    clearScreen: false,
    server: {
      // Tauri開発時に固定ポートを使用
      strictPort: true,
      port: 5173,
      // バックエンドポートが確定している場合のみproxyを設定
      ...(backendPort && {
        proxy: {
          '/api': {
            target: `http://127.0.0.1:${backendPort}`,
            changeOrigin: true,
          },
          '/outputs': {
            target: `http://127.0.0.1:${backendPort}`,
            changeOrigin: true,
          },
        },
      }),
    },
  }
})
