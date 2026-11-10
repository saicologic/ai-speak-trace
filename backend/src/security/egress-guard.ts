/**
 * バックエンドから外への通信を、アプリが使う API の宛先だけに絞る。
 * 読み込んだ会話や依存のパッケージに仕込まれたものが、会話のデータを知らないサーバーに送らないようにする
 */

/** いつも許す宛先（HTTPS だけ） */
const ALLOWED_HOSTS = new Set([
  'api.anthropic.com',
  'api.elevenlabs.io',
  'sts.amazonaws.com',
]);

/**
 * AWS のリージョンごとの宛先（Guardrails と、プロファイルの認証情報）。
 * リージョンの名前は英小文字・数字・ハイフンだけ（例 ap-northeast-1）
 */
const ALLOWED_AWS_HOST =
  /^(bedrock-runtime|sts|portal\.sso|oidc)\.[a-z]{2}(-[a-z]+)+-\d\.amazonaws\.com$/;

const HTTPS_PORT = 443;

/** 宛先の名前を比べやすい形にする（大文字・末尾のドットをそろえる） */
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '');
}

/**
 * その宛先とポートへの通信を許すか。
 * extraHosts: その処理の間だけ足す宛先（GitHub からのダウンロードなど）
 */
export function isEgressAllowed(
  host: string | undefined,
  port: number | undefined,
  extraHosts: readonly string[] = [],
): boolean {
  if (typeof host !== 'string' || host === '' || port !== HTTPS_PORT) {
    return false;
  }
  const name = normalizeHost(host);
  return (
    ALLOWED_HOSTS.has(name) ||
    ALLOWED_AWS_HOST.test(name) ||
    extraHosts.some((h) => normalizeHost(h) === name)
  );
}
