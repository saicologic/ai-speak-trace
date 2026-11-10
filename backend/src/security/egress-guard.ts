import { AsyncLocalStorage } from 'async_hooks';
import { appendFileSync, mkdirSync } from 'fs';
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

type ConnectTarget = { host?: string; port?: number; path?: string };

/**
 * Socket#connect の引数から宛先を取り出す。
 * connect(options) / connect(port, host) / connect(path) と、net.connect が渡す
 * 整えた引数（[options, callback] の配列）の形がある
 */
function connectTarget(args: unknown[]): ConnectTarget {
  const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  if (first !== null && typeof first === 'object') {
    const o = first as { host?: unknown; port?: unknown; path?: unknown };
    return {
      host: typeof o.host === 'string' ? o.host : 'localhost',
      port: Number(o.port),
      path: typeof o.path === 'string' ? o.path : undefined,
    };
  }
  if (typeof first === 'number' || /^\d+$/.test(String(first))) {
    return {
      port: Number(first),
      host: typeof args[1] === 'string' ? args[1] : 'localhost',
    };
  }
  return { path: String(first) };
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

/** withEgressHosts で足した宛先（その処理の間だけ） */
const extraHostsStore = new AsyncLocalStorage<readonly string[]>();

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

/** 記録をファイルに1件ずつ JSON の行で追記する関数を返す（フォルダがなければ作る） */
export function createEgressFileLogger(
  file: string,
): (entry: EgressLogEntry) => void {
  return (entry) => {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(entry) + '\n');
  };
}

/**
 * 外への接続を確かめるようにする（すべての TCP の接続が通る Socket#connect で確かめる）。
 * 一覧にない宛先は、DNS を引く前に EGRESS_BLOCKED のエラーで断る。
 * Unix ソケット（パスでつなぐ、Mac の中だけの通信）は断らない。
 * 戻り値の関数を呼ぶと、もとに戻す
 */
export function installEgressGuard({
  log,
}: { log?: (entry: EgressLogEntry) => void } = {}): () => void {
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
    if (!isEgressAllowed(host, port, extraHostsStore.getStore())) {
      record({ time, host, port, allowed: false });
      const err = Object.assign(
        new Error(`外への通信を断りました: ${target.host}:${target.port}`),
        { code: EGRESS_BLOCKED },
      );
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
