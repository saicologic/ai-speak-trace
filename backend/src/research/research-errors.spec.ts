import {
  describeResearchError,
  INTERRUPTED_MESSAGE,
  stopsWebResearch,
} from './research-errors';

/** Anthropic SDK のエラー文（「{HTTP ステータス} {エラーの JSON}」）を作る */
const apiError = (status: number, type: string, message = 'x') =>
  new Error(
    `${status} ${JSON.stringify({ type: 'error', error: { type, message }, request_id: 'req_1' })}`,
  );

describe('describeResearchError', () => {
  it.each([
    [
      apiError(
        400,
        'invalid_request_error',
        'Your credit balance is too low to access the Anthropic API.',
      ),
      'credit',
    ],
    [apiError(401, 'authentication_error'), 'auth'],
    [apiError(403, 'permission_error'), 'permission'],
    [apiError(429, 'rate_limit_error'), 'rate_limit'],
    [apiError(529, 'overloaded_error'), 'overloaded'],
    [apiError(500, 'api_error'), 'server'],
    [new Error('Connection error.'), 'network'],
    [new Error(INTERRUPTED_MESSAGE), 'interrupted'],
    [
      new Error(
        'AWS の認証情報（プロファイル: default）が無効なため、Guardrails で確認できませんでした',
      ),
      'aws',
    ],
    [
      new Error(
        'Claude に送る前のチェックのため、設定画面で Guardrail ID を設定してください',
      ),
      'settings',
    ],
    [
      new Error(
        '送る内容に指示の書き換え（プロンプト攻撃）の疑いがあるため、Claude に送りませんでした（PROMPT_ATTACK）',
      ),
      'blocked',
    ],
    [new Error('文字起こしが見つかりません: t1'), 'not_found'],
    [new Error('想定していないエラー'), 'unknown'],
  ])('%s を %s と判定する', (error, kind) => {
    expect(describeResearchError(error).kind).toBe(kind);
  });

  it('Web調査の失敗をまとめたエラー文でも、元の失敗の種類で判定する', () => {
    const info = describeResearchError(
      new Error(
        `すべてのキーワードで Web調査に失敗しました: ${apiError(400, 'invalid_request_error', 'Your credit balance is too low').message}`,
      ),
    );
    expect(info.kind).toBe('credit');
    expect(info.retryable).toBe(true);
    expect(info.hint).toContain('Plans & Billing');
  });

  it('Guardrails が止めた失敗は、再開できないものとして扱う', () => {
    const info = describeResearchError(
      new Error(
        'Claude の応答に不適切な表現（侮辱）が検出されたため、応答を使いませんでした',
      ),
    );
    expect(info.retryable).toBe(false);
  });
});

describe('stopsWebResearch', () => {
  it('待てば直る失敗では止め、それ以外の失敗では止めない', () => {
    expect(stopsWebResearch(apiError(529, 'overloaded_error').message)).toBe(
      true,
    );
    expect(stopsWebResearch('Connection error.')).toBe(true);
    expect(stopsWebResearch('検索結果を読み取れませんでした')).toBe(false);
    expect(
      stopsWebResearch(
        '送る内容の、伏せられない部分（思考・検索語・検索結果の題名）に個人情報（氏名）が含まれるため、Claude に送りませんでした',
      ),
    ).toBe(false);
  });
});
