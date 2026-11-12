import { AsyncLocalStorage } from 'async_hooks';
import { appendFile, mkdir, rename, stat } from 'fs/promises';
import * as net from 'net';
import { dirname } from 'path';

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

/** 外への接続を断ったときのエラーのコード */
export const EGRESS_BLOCKED = 'EGRESS_BLOCKED';

type ConnectTarget = {
  host?: string;
  port?: number;
  path?: string;
  customLookup?: boolean;
};

/**
 * Socket#connect の引数から宛先を取り出す。
 * connect(options) / connect(port, host) / connect(path) と、net.connect が渡す
 * 整えた引数（[options, callback] の配列）の形がある
 */
function connectTarget(args: unknown[]): ConnectTarget {
  const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  if (first !== null && typeof first === 'object') {
    const o = first as {
      host?: unknown;
      port?: unknown;
      path?: unknown;
      lookup?: unknown;
    };
    // Node は path が空でない文字列のときだけ Unix ソケットにする（空なら host・port につなぐ）
    if (typeof o.path === 'string' && o.path !== '') return { path: o.path };
    return {
      host: typeof o.host === 'string' ? o.host : 'localhost',
      port: Number(o.port),
      customLookup: typeof o.lookup === 'function',
    };
  }
  // Node と同じく、数として読める文字列（'0x1bb'・' 443' など）はポート、そうでない文字列はパスにする
  if (typeof first === 'string' && !(Number(first) >= 0)) {
    return { path: first };
  }
  return {
    port: Number(first),
    host: typeof args[1] === 'string' ? args[1] : 'localhost',
  };
}

/** プロキシの設定を読む環境変数（axios などが使う） */
const PROXY_ENV_NAMES = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
];

/** プロキシの URL にポートがないときの、方式ごとのポート */
const PROXY_DEFAULT_PORTS: Record<string, number> = {
  'http:': 80,
  'https:': 443,
  'socks:': 1080,
  'socks4:': 1080,
  'socks4a:': 1080,
  'socks5:': 1080,
  'socks5h:': 1080,
};

/** 環境変数に設定されたプロキシの宛先（host:port。読めない設定は除く） */
function proxyEndpoints(env: NodeJS.ProcessEnv): string[] {
  const endpoints: string[] = [];
  for (const name of PROXY_ENV_NAMES) {
    const value = env[name];
    if (!value) continue;
    try {
      // 方式を書かない設定（proxy.example:3128 など）は、axios などと同じく http として読む
      const url = new URL(value.includes('://') ? value : `http://${value}`);
      const port = url.port
        ? Number(url.port)
        : PROXY_DEFAULT_PORTS[url.protocol];
      // IPv6 は [::1] の形で入るため、角かっこを外して宛先と比べる
      const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1');
      if (hostname && port) {
        endpoints.push(`${normalizeHost(hostname)}:${port}`);
      }
    } catch {
      // URL として読めない設定は、プロキシとして扱わない
    }
  }
  return endpoints;
}

/**
 * 断ったときのエラーの文
 * 宛先がプロキシの設定と同じときは、プロキシを使う環境ではつなげないことを示す
 * （アプリは宛先の名前で確かめるため、プロキシを通す通信は通せない）
 */
function blockedMessage(
  host: string | undefined,
  port: number | undefined,
  env: NodeJS.ProcessEnv,
): string {
  const target = `${host}:${port}`;
  if (
    typeof host === 'string' &&
    proxyEndpoints(env).includes(`${normalizeHost(host)}:${port}`)
  ) {
    return `プロキシを使う環境では、外部の API につなげません（プロキシ: ${target}）。HTTPS_PROXY などのプロキシの設定を外してから、アプリを起動し直してください（プロキシを通さないとつながらないネットワークでは使えません）`;
  }
  return `外への通信を断りました: ${target}`;
}

/** 外への接続の記録（パス・ヘッダー・本文は残さない） */
export interface EgressLogEntry {
  time: string;
  host: string | undefined;
  port: number | undefined;
  allowed: boolean;
  bytesSent?: number;
  bytesReceived?: number;
}

/**
 * GitHub のリリースからファイルを取るときの宛先（github.com から release-assets に転送される）。
 * GitHub の API（api.github.com）は含めない
 */
export const GITHUB_RELEASE_HOSTS: readonly string[] = [
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
];

/** withEgressHosts で足した宛先（その処理の間だけ） */
const extraHostsStore = new AsyncLocalStorage<readonly string[]>();

/** 今の処理で withEgressHosts が足した宛先（足していなければ空） */
export function egressHostsInScope(): readonly string[] {
  return extraHostsStore.getStore() ?? [];
}

/**
 * fn の処理の間だけ、hosts の宛先への接続を許す（GitHub からのダウンロードなど）。
 * 処理の外からは、足した宛先に接続できない
 */
export function withEgressHosts<T>(
  hosts: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  return extraHostsStore.run(hosts, fn);
}

/** 記録のファイルの大きさの上限の既定（超えるときは .1 に移す） */
export const EGRESS_LOG_MAX_BYTES = 5 * 1024 * 1024;

/** まだ書いていない記録の大きさの上限の既定（書き込みが遅いときに、メモリに溜め続けない） */
export const EGRESS_LOG_MAX_PENDING_BYTES = 1024 * 1024;

/** 記録をファイルに書く関数（flush で、それまでに渡した記録を書き終えるまで待てる） */
export type EgressFileLogger = ((entry: EgressLogEntry) => void) & {
  flush: () => Promise<void>;
};

/**
 * 記録をファイルに1件ずつ JSON の行で追記する関数を返す（フォルダがなければ作る）
 * - 接続の処理を止めないよう、書き込みを待たずに戻り、順番に書く
 * - 書くと maxBytes を超えるときは、今のファイルを <file>.1 に移してから書く（古いものは1世代だけ残す）
 * - 書き込みに失敗した記録は捨て、後の記録は書き続ける
 * - まだ書いていない記録が maxPendingBytes を超えるときは、その記録を捨てる（接続は待たせない）
 */
export function createEgressFileLogger(
  file: string,
  {
    maxBytes = EGRESS_LOG_MAX_BYTES,
    maxPendingBytes = EGRESS_LOG_MAX_PENDING_BYTES,
  }: { maxBytes?: number; maxPendingBytes?: number } = {},
): EgressFileLogger {
  let queue: Promise<void> = Promise.resolve();
  /** まだ書いていない記録の大きさ */
  let pendingBytes = 0;
  /** 今のファイルの大きさ（初めて書くときと、失敗した後に読み直す） */
  let size: number | undefined;
  const write = async (line: string) => {
    try {
      if (size === undefined) {
        await mkdir(dirname(file), { recursive: true });
        size = await stat(file).then(
          (s) => s.size,
          () => 0,
        );
      }
      const bytes = Buffer.byteLength(line);
      if (size > 0 && size + bytes > maxBytes) {
        await rename(file, `${file}.1`);
        size = 0;
      }
      await appendFile(file, line);
      size += bytes;
    } catch {
      // 記録できなくても、通信の確かめには影響させない（次に書くときに大きさを読み直す）
      size = undefined;
    }
  };
  const log = (entry: EgressLogEntry) => {
    const line = JSON.stringify(entry) + '\n';
    const bytes = Buffer.byteLength(line);
    if (pendingBytes + bytes > maxPendingBytes) return;
    pendingBytes += bytes;
    queue = queue.then(() =>
      write(line).finally(() => {
        pendingBytes -= bytes;
      }),
    );
  };
  return Object.assign(log, { flush: () => queue });
}

/**
 * 外への接続を確かめるようにする（すべての TCP の接続が通る Socket#connect で確かめる）。
 * 一覧にない宛先は、DNS を引く前に EGRESS_BLOCKED のエラーで断る。
 * Unix ソケット（パスでつなぐ、Mac の中だけの通信）は断らない。
 * 戻り値の関数を呼ぶと、もとに戻す
 */
export function installEgressGuard({
  log,
  allowCustomLookup = false,
  env = process.env,
}: {
  log?: (entry: EgressLogEntry) => void;
  /** lookup の差し替えを許す（テストで DNS を引かないため。アプリでは許さない） */
  allowCustomLookup?: boolean;
  /** プロキシの設定を読む環境変数（断ったときの文に使う。既定は process.env） */
  env?: NodeJS.ProcessEnv;
} = {}): () => void {
  // 記録の処理が失敗しても、接続の確かめは続ける
  const record = (entry: EgressLogEntry) => {
    try {
      log?.(entry);
    } catch {
      // 記録できなくても、通信の確かめには影響させない
    }
  };
  const proto = net.Socket.prototype as unknown as {
    connect: (this: net.Socket, ...args: unknown[]) => net.Socket;
  };
  const original = proto.connect;
  const guarded = function (this: net.Socket, ...args: unknown[]): net.Socket {
    const target = connectTarget(args);
    if (target.path !== undefined) {
      return Reflect.apply(original, this, args);
    }
    const time = new Date().toISOString();
    const { host, port } = target;
    // lookup を差し替えると、許した名前のまま別の IP につなげるため、既定では断る
    const lookupOk = allowCustomLookup || !target.customLookup;
    if (!lookupOk || !isEgressAllowed(host, port, extraHostsStore.getStore())) {
      record({ time, host, port, allowed: false });
      const err = Object.assign(new Error(blockedMessage(host, port, env)), {
        code: EGRESS_BLOCKED,
      });
      process.nextTick(() => this.destroy(err));
      return this;
    }
    this.once('close', () =>
      record({
        time,
        host,
        port,
        allowed: true,
        bytesSent: this.bytesWritten,
        bytesReceived: this.bytesRead,
      }),
    );
    const socket: net.Socket = Reflect.apply(original, this, args);
    return socket;
  };
  proto.connect = guarded;
  return () => {
    if (proto.connect === guarded) proto.connect = original;
  };
}
