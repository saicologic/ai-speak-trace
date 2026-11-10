import axios from 'axios';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import * as net from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import * as tls from 'tls';
import {
  createEgressFileLogger,
  egressHostsInScope,
  GITHUB_RELEASE_HOSTS,
  type EgressLogEntry,
  installEgressGuard,
  isEgressAllowed,
  withEgressHosts,
} from './egress-guard';

describe('isEgressAllowed（外への通信を許すか）', () => {
  it('アプリが使う API の宛先（HTTPS）は許す', () => {
    expect(isEgressAllowed('api.anthropic.com', 443)).toBe(true);
    expect(isEgressAllowed('api.elevenlabs.io', 443)).toBe(true);
    expect(
      isEgressAllowed('bedrock-runtime.ap-northeast-1.amazonaws.com', 443),
    ).toBe(true);
    expect(
      isEgressAllowed('bedrock-runtime.us-east-1.amazonaws.com', 443),
    ).toBe(true);
    // AWS の認証情報（プロファイルの AssumeRole・SSO）で使う宛先
    expect(isEgressAllowed('sts.amazonaws.com', 443)).toBe(true);
    expect(isEgressAllowed('sts.ap-northeast-1.amazonaws.com', 443)).toBe(true);
    expect(
      isEgressAllowed('portal.sso.ap-northeast-1.amazonaws.com', 443),
    ).toBe(true);
    expect(isEgressAllowed('oidc.ap-northeast-1.amazonaws.com', 443)).toBe(
      true,
    );
  });

  it('一覧にない宛先は断る', () => {
    expect(isEgressAllowed('example.com', 443)).toBe(false);
    expect(isEgressAllowed('s3.amazonaws.com', 443)).toBe(false);
    expect(isEgressAllowed('evil.ap-northeast-1.amazonaws.com', 443)).toBe(
      false,
    );
  });

  it('許した名前に似た宛先は断る', () => {
    expect(isEgressAllowed('api.anthropic.com.evil.com', 443)).toBe(false);
    expect(isEgressAllowed('xapi.anthropic.com', 443)).toBe(false);
    expect(isEgressAllowed('bedrock-runtime.evil.com', 443)).toBe(false);
    expect(
      isEgressAllowed(
        'bedrock-runtime.ap-northeast-1.amazonaws.com.evil.com',
        443,
      ),
    ).toBe(false);
    expect(isEgressAllowed('bedrock-runtime..amazonaws.com', 443)).toBe(false);
  });

  it('HTTPS（443）以外のポートは断る', () => {
    expect(isEgressAllowed('api.anthropic.com', 80)).toBe(false);
    expect(isEgressAllowed('api.anthropic.com', 8443)).toBe(false);
  });

  it('IP アドレスを直に書いた宛先は断る（自分の Mac の中を含む）', () => {
    expect(isEgressAllowed('127.0.0.1', 443)).toBe(false);
    expect(isEgressAllowed('::1', 443)).toBe(false);
    expect(isEgressAllowed('203.0.113.10', 443)).toBe(false);
    expect(isEgressAllowed('localhost', 443)).toBe(false);
  });

  it('大文字・末尾のドットも同じ名前として扱う', () => {
    expect(isEgressAllowed('API.Anthropic.COM', 443)).toBe(true);
    expect(isEgressAllowed('api.anthropic.com.', 443)).toBe(true);
    expect(isEgressAllowed('example.com.', 443)).toBe(false);
  });

  it('宛先が空・文字列でないときは断る', () => {
    expect(isEgressAllowed('', 443)).toBe(false);
    expect(isEgressAllowed(undefined, 443)).toBe(false);
    expect(isEgressAllowed('api.anthropic.com', undefined)).toBe(false);
  });

  it('足した宛先（GitHub からのダウンロードなど）は、渡したときだけ許す', () => {
    expect(isEgressAllowed('github.com', 443)).toBe(false);
    expect(isEgressAllowed('github.com', 443, ['github.com'])).toBe(true);
    expect(isEgressAllowed('api.github.com', 443, ['github.com'])).toBe(false);
  });
});

/** 接続を試し、最初に起きたエラーのコードを返す（DNS を引いたかも記録する） */
function tryConnect(
  connect: (lookup: net.LookupFunction) => net.Socket,
): Promise<{ code: string | undefined; looked: boolean }> {
  return new Promise((resolve) => {
    let looked = false;
    // DNS を引かずに、名前が見つからないことにする（外に通信しない）
    const lookup: net.LookupFunction = (_host, _options, callback) => {
      looked = true;
      const err = Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
      (callback as (e: Error) => void)(err);
    };
    const socket = connect(lookup);
    socket.on('error', (e: NodeJS.ErrnoException) => {
      socket.destroy();
      resolve({ code: e.code, looked });
    });
  });
}

describe('installEgressGuard（外への接続を確かめる）', () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installEgressGuard();
  });
  afterEach(() => uninstall());

  it('一覧にない宛先への接続は、DNS を引く前に断る（net）', async () => {
    const r = await tryConnect((lookup) =>
      net.connect({ host: 'example.com', port: 443, lookup }),
    );
    expect(r).toEqual({ code: 'EGRESS_BLOCKED', looked: false });
  });

  it('ポートと宛先を引数で渡す形でも断る', async () => {
    const r = await tryConnect(() => net.connect(443, 'example.com'));
    expect(r.code).toBe('EGRESS_BLOCKED');
  });

  it('TLS の接続でも断る', async () => {
    const r = await tryConnect((lookup) =>
      tls.connect({ host: 'example.com', port: 443, lookup }),
    );
    expect(r).toEqual({ code: 'EGRESS_BLOCKED', looked: false });
  });

  it('axios（http の層）からの通信も断る', async () => {
    await expect(
      axios.get('https://example.com/', { proxy: false }),
    ).rejects.toMatchObject({ code: 'EGRESS_BLOCKED' });
  });

  it('許した宛先は、そのまま接続に進む', async () => {
    const r = await tryConnect((lookup) =>
      tls.connect({ host: 'api.anthropic.com', port: 443, lookup }),
    );
    expect(r).toEqual({ code: 'ENOTFOUND', looked: true });
  });

  it('許した宛先でも、443 以外のポートは断る', async () => {
    const r = await tryConnect((lookup) =>
      net.connect({ host: 'api.anthropic.com', port: 80, lookup }),
    );
    expect(r.code).toBe('EGRESS_BLOCKED');
  });

  it('Unix ソケット（パスでつなぐ、Mac の中だけの通信）は断らない', async () => {
    const r = await tryConnect(() =>
      net.connect({ path: '/nonexistent/egress-guard.sock' }),
    );
    expect(r.code).toBe('ENOENT');
  });

  it('外すと、もとの動きに戻る', async () => {
    uninstall();
    const r = await tryConnect((lookup) =>
      net.connect({ host: 'example.com', port: 443, lookup }),
    );
    expect(r).toEqual({ code: 'ENOTFOUND', looked: true });
    uninstall = installEgressGuard();
  });
});

/** ENOTFOUND を返すだけの lookup（外に通信しない） */
const noDns: net.LookupFunction = (_host, _options, callback) => {
  const err = Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
  (callback as (e: Error) => void)(err);
};

/** 接続を試し、閉じるまで待ってエラーのコードを返す */
function connectAndClose(host: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    let code: string | undefined;
    const socket = tls.connect({ host, port: 443, lookup: noDns });
    socket.on('error', (e: NodeJS.ErrnoException) => {
      code = e.code;
    });
    socket.on('close', () => setImmediate(() => resolve(code)));
  });
}

describe('外への接続の記録', () => {
  let entries: EgressLogEntry[];
  let uninstall: () => void;
  beforeEach(() => {
    entries = [];
    uninstall = installEgressGuard({ log: (e) => entries.push(e) });
  });
  afterEach(() => uninstall());

  it('断った接続を、日時・宛先・ポートとともに記録する', async () => {
    await connectAndClose('example.com');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      host: 'example.com',
      port: 443,
      allowed: false,
    });
    expect(Number.isNaN(Date.parse(entries[0].time))).toBe(false);
  });

  it('通した接続を、閉じたときに送受信のバイト数とともに記録する', async () => {
    await connectAndClose('api.anthropic.com');
    expect(entries).toEqual([
      expect.objectContaining({
        host: 'api.anthropic.com',
        port: 443,
        allowed: true,
        bytesSent: 0,
        bytesReceived: 0,
      }),
    ]);
  });

  it('記録には、決めた項目だけを残す（パス・ヘッダー・本文は残さない）', async () => {
    await connectAndClose('example.com');
    await connectAndClose('api.anthropic.com');
    for (const e of entries) {
      expect(
        Object.keys(e).every((k) =>
          [
            'time',
            'host',
            'port',
            'allowed',
            'bytesSent',
            'bytesReceived',
          ].includes(k),
        ),
      ).toBe(true);
    }
  });

  it('記録の処理が失敗しても、接続の確かめは続ける', async () => {
    uninstall();
    uninstall = installEgressGuard({
      log: () => {
        throw new Error('書けない');
      },
    });
    expect(await connectAndClose('example.com')).toBe('EGRESS_BLOCKED');
  });
});

describe('withEgressHosts（その処理の間だけ宛先を足す）', () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installEgressGuard();
  });
  afterEach(() => uninstall());

  it('処理の中では足した宛先に接続でき、外では断る', async () => {
    const inside = await withEgressHosts(['github.com'], () =>
      connectAndClose('github.com'),
    );
    expect(inside).toBe('ENOTFOUND');
    expect(await connectAndClose('github.com')).toBe('EGRESS_BLOCKED');
  });

  it('足した宛先のほかは、処理の中でも断る', async () => {
    const other = await withEgressHosts(['github.com'], () =>
      connectAndClose('example.com'),
    );
    expect(other).toBe('EGRESS_BLOCKED');
  });
});

describe('createEgressFileLogger（記録をファイルに書く）', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'egress-log-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('1件ずつ JSON の行で追記し、フォルダがなければ作る', () => {
    const file = join(dir, 'logs', 'network.jsonl');
    const log = createEgressFileLogger(file);
    log({ time: 't1', host: 'example.com', port: 443, allowed: false });
    log({ time: 't2', host: 'api.anthropic.com', port: 443, allowed: true });
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines.map((l) => JSON.parse(l) as EgressLogEntry)).toEqual([
      { time: 't1', host: 'example.com', port: 443, allowed: false },
      { time: 't2', host: 'api.anthropic.com', port: 443, allowed: true },
    ]);
  });
});

describe('GITHUB_RELEASE_HOSTS（GitHub のリリースからのダウンロード）', () => {
  it('リリースのファイルの宛先だけを含み、GitHub の API は含まない', () => {
    expect(isEgressAllowed('github.com', 443, GITHUB_RELEASE_HOSTS)).toBe(true);
    expect(
      isEgressAllowed(
        'release-assets.githubusercontent.com',
        443,
        GITHUB_RELEASE_HOSTS,
      ),
    ).toBe(true);
    expect(isEgressAllowed('api.github.com', 443, GITHUB_RELEASE_HOSTS)).toBe(
      false,
    );
  });

  it('egressHostsInScope は、withEgressHosts の中でだけ足した宛先を返す', async () => {
    expect(egressHostsInScope()).toEqual([]);
    const inside = await withEgressHosts(['a.example'], () =>
      Promise.resolve(egressHostsInScope()),
    );
    expect(inside).toEqual(['a.example']);
  });
});
