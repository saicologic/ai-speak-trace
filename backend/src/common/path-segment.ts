/**
 * 1つのファイル名・フォルダ名か（保存先の外を指すおそれがないか）
 * URL や本文から受け取った ID・ファイル名でパスを作る前に確かめる。
 * 空・`.`・`..`・区切り文字（`/`・`\`）・NUL を含む名前は、保存先の外を指すおそれがあるため使えない
 * （NestJS を読み込まない MCP サーバーからも使うため、ほかのモジュールに頼らない）
 */
export function isSafePathSegment(name: string): boolean {
  return (
    typeof name === 'string' &&
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    !/[/\\\0]/.test(name)
  );
}
