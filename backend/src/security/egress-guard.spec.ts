import axios from 'axios';
import * as net from 'net';
import * as tls from 'tls';
import { installEgressGuard, isEgressAllowed } from './egress-guard';

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
