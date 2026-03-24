/** 1分あたりの推定クレジット消費量 */
export const CREDITS_PER_MINUTE = 40;

/** 秒数を mm:ss 形式にフォーマット */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** 秒数を「X時間Y分Z秒」形式にフォーマット */
export function formatDuration(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}時間${m}分` : `${h}時間`;
  }
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}
