import axios from 'axios';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
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
    // テストでは DNS を引かないよう lookup を差し替えるため、差し替えを許す
    uninstall = installEgressGuard({ allowCustomLookup: true });
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
    // net.connect を通さず、Socket#connect にそのまま渡す形
    const direct = await tryConnect(() =>
      new net.Socket().connect(443, 'example.com'),
    );
    expect(direct.code).toBe('EGRESS_BLOCKED');
  });

  it('ポートを文字列（16進・前後の空白）で渡しても、パスと取り違えずに断る', async () => {
    for (const port of ['443', '0x1bb', ' 443', '443 ']) {
      const r = await tryConnect(() =>
        new net.Socket().connect(port as unknown as number, 'example.com'),
      );
      expect([port, r.code]).toEqual([port, 'EGRESS_BLOCKED']);
    }
  });

  it('path が空のとき（Unix ソケットにならず、宛先につながる）は断る', async () => {
    const r = await tryConnect((lookup) =>
      net.connect({ path: '', host: 'example.com', port: 443, lookup }),
    );
    expect(r).toEqual({ code: 'EGRESS_BLOCKED', looked: false });
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
    uninstall = installEgressGuard({ allowCustomLookup: true });
  });

  it('既定では、許した宛先でも lookup を差し替えた接続は断る（名前を引いた先の IP を変えさせない）', async () => {
    uninstall();
    uninstall = installEgressGuard();
    const r = await tryConnect((lookup) =>
      tls.connect({ host: 'api.anthropic.com', port: 443, lookup }),
    );
    expect(r).toEqual({ code: 'EGRESS_BLOCKED', looked: false });
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
    uninstall = installEgressGuard({
      log: (e) => entries.push(e),
      allowCustomLookup: true,
    });
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
    expect(entries).toHaveLength(2);
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
      allowCustomLookup: true,
    });
    expect(await connectAndClose('example.com')).toBe('EGRESS_BLOCKED');
  });
});

/** 接続を試し、最初に起きたエラーのコードと文を返す（DNS は引かずに、名前が見つからないことにする） */
function connectError(
  host: string,
  port: number,
): Promise<{ code: string | undefined; message: string }> {
  return new Promise((resolve) => {
    const lookup: net.LookupFunction = (_host, _options, callback) => {
      const err = Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
      (callback as (e: Error) => void)(err);
    };
    const socket = net.connect({ host, port, lookup });
    socket.on('error', (e: NodeJS.ErrnoException) => {
      socket.destroy();
      resolve({ code: e.code, message: e.message });
    });
  });
}

describe('プロキシを使う環境', () => {
  let uninstall: (() => void) | undefined;
  const install = (env: NodeJS.ProcessEnv) => {
    uninstall = installEgressGuard({ allowCustomLookup: true, env });
  };
  afterEach(() => uninstall?.());

  const PROXY_MESSAGE = 'プロキシを使う環境では、外部の API につなげません';

  it('プロキシの宛先への接続は、プロキシを使う環境ではつなげないと分かる文で断る', async () => {
    install({ HTTPS_PROXY: 'http://proxy.example:8080' });
    const r = await connectError('proxy.example', 8080);
    expect(r.code).toBe('EGRESS_BLOCKED');
    expect(r.message).toContain(PROXY_MESSAGE);
    expect(r.message).toContain('proxy.example:8080');
  });

  it.each([
    [{ https_proxy: 'http://proxy.example:3128' }, 3128],
    [{ HTTP_PROXY: 'http://proxy.example:8080' }, 8080],
    [{ http_proxy: 'http://proxy.example' }, 80],
    [{ ALL_PROXY: 'socks5://proxy.example:1080' }, 1080],
    [{ all_proxy: 'https://PROXY.example.' }, 443],
    [{ ALL_PROXY: 'socks5h://proxy.example' }, 1080],
    [{ ALL_PROXY: 'socks4a://proxy.example' }, 1080],
    // 方式を書かない設定（axios などは http として扱う）
    [{ HTTPS_PROXY: 'proxy.example:3128' }, 3128],
    [{ HTTP_PROXY: 'proxy.example' }, 80],
  ])(
    'プロキシの設定 %j（ポート %d）も、プロキシの文で断る',
    async (env, port) => {
      install(env);
      const r = await connectError('proxy.example', port);
      expect(r.code).toBe('EGRESS_BLOCKED');
      expect(r.message).toContain(PROXY_MESSAGE);
    },
  );

  it('宛先の大文字・末尾のドットも、プロキシと同じ名前として扱う', async () => {
    install({ HTTPS_PROXY: 'http://proxy.example:8080' });
    const r = await connectError('PROXY.Example.', 8080);
    expect(r.message).toContain(PROXY_MESSAGE);
  });

  it('IPv6 で書いたプロキシも、同じ宛先として扱う', async () => {
    install({ HTTPS_PROXY: 'http://[::1]:8080' });
    const r = await connectError('::1', 8080);
    expect(r.code).toBe('EGRESS_BLOCKED');
    expect(r.message).toContain(PROXY_MESSAGE);
  });

  it('プロキシと関係のない宛先は、これまでの文で断る', async () => {
    install({ HTTPS_PROXY: 'http://proxy.example:8080' });
    for (const [host, port] of [
      ['example.com', 443],
      ['proxy.example', 3128],
      // ポートが同じでも、名前が違えばプロキシではない
      ['other.example', 8080],
    ] as const) {
      const r = await connectError(host, port);
      expect(r.code).toBe('EGRESS_BLOCKED');
      expect(r.message).toContain('外への通信を断りました');
      expect(r.message).not.toContain(PROXY_MESSAGE);
    }
  });

  it('読めないプロキシの設定は無視し、これまでの文で断る', async () => {
    install({ HTTPS_PROXY: 'not a url', HTTP_PROXY: '' });
    const r = await connectError('example.com', 443);
    expect(r.message).toContain('外への通信を断りました');
  });

  it('許した宛先には、プロキシの設定があってもそのままつなぐ', async () => {
    install({ HTTPS_PROXY: 'http://proxy.example:8080' });
    const r = await connectError('api.anthropic.com', 443);
    expect(r.code).toBe('ENOTFOUND');
  });
});

describe('withEgressHosts（その処理の間だけ宛先を足す）', () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installEgressGuard({ allowCustomLookup: true });
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

  /** 記録のファイルの行（ファイルがなければ空） */
  const linesOf = (file: string) =>
    existsSync(file)
      ? readFileSync(file, 'utf-8')
          .trim()
          .split('\n')
          .map((l) => (JSON.parse(l) as EgressLogEntry).time)
      : [];
  const entry = (time: string): EgressLogEntry => ({
    time,
    host: 'example.com',
    port: 443,
    allowed: false,
  });

  it('1件ずつ JSON の行で追記し、フォルダがなければ作る', async () => {
    const file = join(dir, 'logs', 'network.jsonl');
    const log = createEgressFileLogger(file);
    log({ time: 't1', host: 'example.com', port: 443, allowed: false });
    log({ time: 't2', host: 'api.anthropic.com', port: 443, allowed: true });
    await log.flush();
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines.map((l) => JSON.parse(l) as EgressLogEntry)).toEqual([
      { time: 't1', host: 'example.com', port: 443, allowed: false },
      { time: 't2', host: 'api.anthropic.com', port: 443, allowed: true },
    ]);
  });

  it('書き込みを待たずに戻る（接続の処理を止めない）', async () => {
    const file = join(dir, 'logs', 'network.jsonl');
    const log = createEgressFileLogger(file);
    log(entry('t1'));
    // 呼んだ時点ではまだ書いていない
    expect(existsSync(file)).toBe(false);
    await log.flush();
    expect(linesOf(file)).toEqual(['t1']);
  });

  it('決めた大きさを超えるときは、今のファイルを .1 に移し、古いものは1世代だけ残す', async () => {
    const file = join(dir, 'network.jsonl');
    // 1行は 62 バイト（2行で 124 バイト、3行で 186 バイト）
    const log = createEgressFileLogger(file, { maxBytes: 150 });
    for (const t of ['t1', 't2', 't3', 't4', 't5']) log(entry(t));
    await log.flush();
    expect(linesOf(`${file}.1`)).toEqual(['t3', 't4']);
    expect(linesOf(file)).toEqual(['t5']);
    expect(existsSync(`${file}.2`)).toBe(false);
  });

  it('書いた後の大きさがちょうど上限なら、移さない', async () => {
    const file = join(dir, 'network.jsonl');
    const log = createEgressFileLogger(file, { maxBytes: 124 });
    log(entry('t1'));
    log(entry('t2'));
    await log.flush();
    expect(linesOf(file)).toEqual(['t1', 't2']);
    expect(existsSync(`${file}.1`)).toBe(false);
  });

  it('1行が上限より大きくても、ファイルが空なら、移さずに書く', async () => {
    const file = join(dir, 'network.jsonl');
    const log = createEgressFileLogger(file, { maxBytes: 10 });
    log(entry('t1'));
    await log.flush();
    expect(linesOf(file)).toEqual(['t1']);
    expect(existsSync(`${file}.1`)).toBe(false);
  });

  it('前からあるファイルの大きさも数える', async () => {
    const file = join(dir, 'network.jsonl');
    writeFileSync(file, JSON.stringify(entry('t0')) + '\n' + 'x'.repeat(80));
    const log = createEgressFileLogger(file, { maxBytes: 150 });
    log(entry('t1'));
    await log.flush();
    expect(readFileSync(`${file}.1`, 'utf-8')).toContain('"t0"');
    expect(linesOf(file)).toEqual(['t1']);
  });

  it('書き込みに失敗しても、例外を出さず、後の記録を止めない', async () => {
    // フォルダの場所にファイルがあり、書けない
    const blocker = join(dir, 'logs');
    writeFileSync(blocker, '');
    const log = createEgressFileLogger(join(blocker, 'network.jsonl'));
    log(entry('t1'));
    await expect(log.flush()).resolves.toBeUndefined();
    // 書けるようになれば、後の記録は書く
    rmSync(blocker);
    log(entry('t2'));
    await log.flush();
    expect(linesOf(join(blocker, 'network.jsonl'))).toEqual(['t2']);
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
