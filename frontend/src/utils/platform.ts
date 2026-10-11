/** デスクトップアプリ（Tauri）の中で動いているか（ブラウザの開発サーバーでは false） */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 確認のダイアログを表示する
 * Tauri の WebView では window.confirm が処理を止めないため plugin-dialog を使い、ブラウザでは window.confirm を使う
 */
export async function confirmDialog(
  message: string,
  options: { title: string; kind?: 'info' | 'warning' | 'error' },
): Promise<boolean> {
  if (!isTauri()) return window.confirm(message);
  const { confirm } = await import('@tauri-apps/plugin-dialog');
  return confirm(message, options);
}
