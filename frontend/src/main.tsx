import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initBackendUrl } from './api/client.ts'

// バックエンドURLを初期化してからReactをマウント
// 本番時はTauri invokeでポートが確定するまで待機する
initBackendUrl().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}).catch((err) => {
  console.error('[main] バックエンドURL初期化失敗:', err)
  // エラー時もアプリを表示（APIエラーはUI側でハンドリング）
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
