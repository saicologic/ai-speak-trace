import { isEgressAllowed } from './egress-guard';

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
