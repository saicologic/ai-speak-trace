import {
  BedrockClient,
  CreateGuardrailVersionCommand,
  GetGuardrailCommand,
  GetGuardrailCommandOutput,
  UpdateGuardrailCommand,
} from '@aws-sdk/client-bedrock';
import { ConfigService } from '@nestjs/config';
import { GuardrailService } from './guardrail.service';
import { GroundingTierService } from './grounding-tier.service';

/** GetGuardrail の結果（tier と version を変えて使う） */
const guardrail = (
  version: string,
  tier?: 'CLASSIC' | 'STANDARD',
  status: 'READY' | 'UPDATING' | 'FAILED' = 'READY',
): GetGuardrailCommandOutput => ({
  $metadata: {},
  name: 'research-verify',
  guardrailId: 'g1',
  guardrailArn: 'arn:aws:bedrock:ap-northeast-1:000000000000:guardrail/g1',
  version,
  status,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-11T00:00:00Z'),
  blockedInputMessaging: '入力を止めました',
  blockedOutputsMessaging: '出力を止めました',
  contextualGroundingPolicy: {
    filters: [{ type: 'GROUNDING', threshold: 0.8, action: 'NONE' }],
    ...(tier && { tier: { tierName: tier } }),
  },
  crossRegionDetails: { guardrailProfileId: 'apac.guardrail.v1:0' },
});

/**
 * BedrockClient.send を差し替える。versions には、GetGuardrail のバージョンごとの結果を順に並べる
 * （同じバージョンを何度も読むときは、並べた順に返す。最後の1つは何度でも返す）
 */
function mockBedrock(
  versions: Record<string, GetGuardrailCommandOutput[]>,
  {
    updateError,
    createdVersion = '4',
  }: { updateError?: Error; createdVersion?: string } = {},
) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const send = jest
    .spyOn(BedrockClient.prototype, 'send')
    // send は呼び方ごとに型が分かれているため、差し替えの関数の型は合わせない
    .mockImplementation(((command: unknown) => {
      const { input } = command as { input: Record<string, unknown> };
      if (command instanceof GetGuardrailCommand) {
        calls.push({ name: 'GetGuardrail', input });
        const list = versions[String(input.guardrailVersion)];
        if (!list?.length) {
          return Promise.reject(new Error('ResourceNotFoundException'));
        }
        return Promise.resolve(list.length > 1 ? list.shift() : list[0]);
      }
      if (command instanceof UpdateGuardrailCommand) {
        calls.push({ name: 'UpdateGuardrail', input });
        if (updateError) return Promise.reject(updateError);
        return Promise.resolve({ guardrailId: 'g1', version: 'DRAFT' });
      }
      if (command instanceof CreateGuardrailVersionCommand) {
        calls.push({ name: 'CreateGuardrailVersion', input });
        return Promise.resolve({ guardrailId: 'g1', version: createdVersion });
      }
      return Promise.reject(new Error('想定していない呼び出し'));
    }) as never);
  return { calls, send };
}

function setup({ id = 'g1', version = '' } = {}) {
  const guardrailService = {
    get guardrailId() {
      return id;
    },
    get guardrailVersion() {
      return version || 'DRAFT';
    },
  } as unknown as GuardrailService;
  const config = {
    get: (key: string, fallback?: string) =>
      key === 'AWS_REGION' ? 'ap-northeast-1' : fallback,
  } as unknown as ConfigService;
  const service = new GroundingTierService(config, guardrailService);
  // テストでは、Guardrail が READY に戻るのを待つ間隔を 0 にする
  service.readyPollMs = 0;
  return service;
}

afterEach(() => jest.restoreAllMocks());

describe('GroundingTierService.getTier', () => {
  it('設定の Guardrail ID とバージョン（空なら DRAFT）で GetGuardrail を呼び、根拠の確認の tier を返す', async () => {
    const { calls } = mockBedrock({ DRAFT: [guardrail('DRAFT', 'STANDARD')] });
    await expect(setup().getTier()).resolves.toBe('STANDARD');
    expect(calls).toEqual([
      {
        name: 'GetGuardrail',
        input: { guardrailIdentifier: 'g1', guardrailVersion: 'DRAFT' },
      },
    ]);
  });

  it('番号付きのバージョンを使っていれば、そのバージョンの tier を返す', async () => {
    mockBedrock({
      DRAFT: [guardrail('DRAFT', 'STANDARD')],
      '3': [guardrail('3')],
    });
    await expect(setup({ version: '3' }).getTier()).resolves.toBe('CLASSIC');
  });

  it('GetGuardrail を呼べなければ（権限がないなど）UNKNOWN', async () => {
    mockBedrock({});
    await expect(setup().getTier()).resolves.toBe('UNKNOWN');
  });

  it('読めなかったとき（UNKNOWN）は覚えず、次は読み直す（IAM の権限を直した後など）', async () => {
    const send = jest
      .spyOn(BedrockClient.prototype, 'send')
      .mockImplementationOnce((() =>
        Promise.reject(new Error('AccessDeniedException'))) as never)
      .mockImplementationOnce((() =>
        Promise.resolve(guardrail('DRAFT', 'STANDARD'))) as never);
    const service = setup();
    await expect(service.getTier()).resolves.toBe('UNKNOWN');
    await expect(service.getTier()).resolves.toBe('STANDARD');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('Guardrail ID が設定されていなければ、呼ばずに UNKNOWN', async () => {
    const { calls } = mockBedrock({ DRAFT: [guardrail('DRAFT')] });
    await expect(setup({ id: '' }).getTier()).resolves.toBe('UNKNOWN');
    expect(calls).toEqual([]);
  });

  it('同じ設定の間は読み直さず、reset で読み直す', async () => {
    const { calls } = mockBedrock({
      DRAFT: [guardrail('DRAFT'), guardrail('DRAFT', 'STANDARD')],
    });
    const service = setup();
    await expect(service.getTier()).resolves.toBe('CLASSIC');
    await expect(service.getTier()).resolves.toBe('CLASSIC');
    expect(calls).toHaveLength(1);
    service.reset();
    await expect(service.getTier()).resolves.toBe('STANDARD');
    expect(calls).toHaveLength(2);
  });
});

describe('GroundingTierService.switchToStandard', () => {
  it('DRAFT を使っていれば、DRAFT の設定を引き継いで tier だけを STANDARD にし、読み直して確かめる', async () => {
    const { calls } = mockBedrock({
      DRAFT: [guardrail('DRAFT'), guardrail('DRAFT', 'STANDARD')],
    });
    await expect(setup().switchToStandard()).resolves.toEqual({
      version: 'DRAFT',
    });
    expect(calls.map((c) => c.name)).toEqual([
      'GetGuardrail',
      'UpdateGuardrail',
      'GetGuardrail',
    ]);
    expect(calls[1].input).toMatchObject({
      guardrailIdentifier: 'g1',
      contextualGroundingPolicyConfig: { tierConfig: { tierName: 'STANDARD' } },
      crossRegionConfig: { guardrailProfileIdentifier: 'apac.guardrail.v1:0' },
    });
  });

  it('番号付きのバージョンを使っていれば、DRAFT と同じ設定かを確かめてから新しいバージョンを作り、その番号を返す', async () => {
    const { calls } = mockBedrock({
      DRAFT: [guardrail('DRAFT'), guardrail('DRAFT', 'STANDARD')],
      '3': [guardrail('3')],
      '4': [guardrail('4', 'STANDARD')],
    });
    await expect(setup({ version: '3' }).switchToStandard()).resolves.toEqual({
      version: '4',
    });
    // UpdateGuardrail の後、DRAFT が READY に戻ったのを確かめてから、新しいバージョンを作る
    expect(calls.map((c) => [c.name, c.input.guardrailVersion])).toEqual([
      ['GetGuardrail', 'DRAFT'],
      ['GetGuardrail', '3'],
      ['UpdateGuardrail', undefined],
      ['GetGuardrail', 'DRAFT'],
      ['CreateGuardrailVersion', undefined],
      ['GetGuardrail', '4'],
    ]);
  });

  it('DRAFT と使っているバージョンの設定が違えば、書き換えずに止める（古い設定で上書きしないため）', async () => {
    const changed = guardrail('DRAFT');
    changed.contextualGroundingPolicy = {
      filters: [{ type: 'GROUNDING', threshold: 0.5, action: 'NONE' }],
    };
    const { calls } = mockBedrock({ DRAFT: [changed], '3': [guardrail('3')] });
    await expect(setup({ version: '3' }).switchToStandard()).rejects.toThrow(
      'DRAFT',
    );
    expect(calls.map((c) => c.name)).not.toContain('UpdateGuardrail');
  });

  it('書き換えた後に読み直して STANDARD になっていなければ失敗にする（古い SDK が tierConfig を捨てたときなど）', async () => {
    mockBedrock({ DRAFT: [guardrail('DRAFT'), guardrail('DRAFT')] });
    await expect(setup().switchToStandard()).rejects.toThrow('STANDARD');
  });

  it('切り替えたら、確かめた STANDARD を覚える（切り替えの最中に読んだ古い tier を残さない）', async () => {
    const { calls } = mockBedrock({
      DRAFT: [
        guardrail('DRAFT'),
        guardrail('DRAFT'),
        guardrail('DRAFT', 'STANDARD'),
        guardrail('DRAFT'),
      ],
    });
    const service = setup();
    await expect(service.getTier()).resolves.toBe('CLASSIC');
    await service.switchToStandard();
    await expect(service.getTier()).resolves.toBe('STANDARD');
    expect(calls.filter((c) => c.name === 'GetGuardrail')).toHaveLength(3);
  });

  it('UpdateGuardrail の後、READY に戻るまで待ってから確かめる', async () => {
    const { calls } = mockBedrock({
      DRAFT: [
        guardrail('DRAFT'),
        guardrail('DRAFT', 'STANDARD', 'UPDATING'),
        guardrail('DRAFT', 'STANDARD'),
      ],
    });
    await expect(setup().switchToStandard()).resolves.toEqual({
      version: 'DRAFT',
    });
    expect(calls.map((c) => c.name)).toEqual([
      'GetGuardrail',
      'UpdateGuardrail',
      'GetGuardrail',
      'GetGuardrail',
    ]);
  });

  it('READY に戻らなければ、新しいバージョンを作らずに失敗にする', async () => {
    const { calls } = mockBedrock({
      DRAFT: [guardrail('DRAFT'), guardrail('DRAFT', 'STANDARD', 'UPDATING')],
      '3': [guardrail('3')],
    });
    const service = setup({ version: '3' });
    service.readyPollAttempts = 3;
    await expect(service.switchToStandard()).rejects.toThrow('READY');
    expect(calls.map((c) => c.name)).not.toContain('CreateGuardrailVersion');
  });

  it('UpdateGuardrail が失敗したら、その後は呼ばずに失敗にする', async () => {
    const { calls } = mockBedrock(
      { DRAFT: [guardrail('DRAFT')], '3': [guardrail('3')] },
      { updateError: new Error('AccessDeniedException') },
    );
    await expect(setup({ version: '3' }).switchToStandard()).rejects.toThrow(
      'AccessDeniedException',
    );
    expect(calls.map((c) => c.name)).toEqual([
      'GetGuardrail',
      'GetGuardrail',
      'UpdateGuardrail',
    ]);
  });

  it('新しいバージョンの番号が返らなければ失敗にする', async () => {
    mockBedrock(
      {
        DRAFT: [guardrail('DRAFT'), guardrail('DRAFT', 'STANDARD')],
        '3': [guardrail('3')],
      },
      { createdVersion: '' },
    );
    await expect(setup({ version: '3' }).switchToStandard()).rejects.toThrow(
      'バージョンの番号',
    );
  });

  it('新しいバージョンを読み直して STANDARD でなければ失敗にする', async () => {
    mockBedrock({
      DRAFT: [guardrail('DRAFT'), guardrail('DRAFT', 'STANDARD')],
      '3': [guardrail('3')],
      '4': [guardrail('4')],
    });
    await expect(setup({ version: '3' }).switchToStandard()).rejects.toThrow(
      'STANDARD',
    );
  });

  it('DRAFT が READY でも STANDARD になっていなければ、新しいバージョンを作らずに失敗にする（使わないバージョンを増やさない）', async () => {
    const { calls } = mockBedrock({
      DRAFT: [guardrail('DRAFT'), guardrail('DRAFT')],
      '3': [guardrail('3')],
    });
    await expect(setup({ version: '3' }).switchToStandard()).rejects.toThrow(
      'STANDARD',
    );
    expect(calls.map((c) => c.name)).not.toContain('CreateGuardrailVersion');
  });

  it('FAILED になったら、待ち続けずにすぐ失敗にする', async () => {
    const failed = guardrail('DRAFT', 'STANDARD', 'FAILED');
    failed.statusReasons = ['tierConfig is not supported'];
    const { calls } = mockBedrock({ DRAFT: [guardrail('DRAFT'), failed] });
    await expect(setup().switchToStandard()).rejects.toThrow(
      'tierConfig is not supported',
    );
    expect(calls.filter((c) => c.name === 'GetGuardrail')).toHaveLength(2);
  });

  it('新しいバージョンの設定が、最初に読んだ DRAFT と tier 以外で違えば失敗にする（途中で別の操作が設定を変えたとき）', async () => {
    const changed = guardrail('4', 'STANDARD');
    changed.contextualGroundingPolicy = {
      filters: [{ type: 'GROUNDING', threshold: 0.3, action: 'NONE' }],
      tier: { tierName: 'STANDARD' },
    };
    mockBedrock({
      DRAFT: [guardrail('DRAFT'), guardrail('DRAFT', 'STANDARD')],
      '3': [guardrail('3')],
      '4': [changed],
    });
    await expect(setup({ version: '3' }).switchToStandard()).rejects.toThrow(
      '設定',
    );
  });

  it('使っているバージョンに、引き継ぎ方がわからない設定があれば、書き換えずに止める', async () => {
    const pinned = {
      ...guardrail('3'),
      automatedReasoningPolicy: { policies: ['p1'] },
    } as unknown as GetGuardrailCommandOutput;
    const { calls } = mockBedrock({
      DRAFT: [guardrail('DRAFT')],
      '3': [pinned],
    });
    await expect(setup({ version: '3' }).switchToStandard()).rejects.toThrow(
      'automatedReasoningPolicy',
    );
    expect(calls.map((c) => c.name)).not.toContain('UpdateGuardrail');
  });

  it('切り替えより前に読み始めた tier は、切り替えた後に届いても覚えない', async () => {
    let resolveSlow!: (g: GetGuardrailCommandOutput) => void;
    const slow = new Promise<GetGuardrailCommandOutput>((resolve) => {
      resolveSlow = resolve;
    });
    const later = [
      guardrail('DRAFT'),
      guardrail('DRAFT', 'STANDARD'),
      guardrail('DRAFT'),
    ];
    jest.spyOn(BedrockClient.prototype, 'send').mockImplementation(((
      command: unknown,
    ) => {
      if (command instanceof UpdateGuardrailCommand) {
        return Promise.resolve({ guardrailId: 'g1', version: 'DRAFT' });
      }
      // 最初の GetGuardrail（getTier）だけ、返すのを遅らせる
      if (!resolveSlowUsed) {
        resolveSlowUsed = true;
        return slow;
      }
      return Promise.resolve(later.shift());
    }) as never);
    let resolveSlowUsed = false;
    const service = setup();
    const first = service.getTier();
    await service.switchToStandard();
    resolveSlow(guardrail('DRAFT'));
    await expect(first).resolves.toBe('CLASSIC');
    // 切り替えで覚えた STANDARD が、遅れて届いた CLASSIC で上書きされていない
    await expect(service.getTier()).resolves.toBe('STANDARD');
  });

  it('新しいバージョンに、引き継ぎ方がわからない設定が入っていれば失敗にする（途中で別の操作が足したとき）', async () => {
    const created = {
      ...guardrail('4', 'STANDARD'),
      automatedReasoningPolicy: { policies: ['p1'] },
    } as unknown as GetGuardrailCommandOutput;
    mockBedrock({
      DRAFT: [guardrail('DRAFT'), guardrail('DRAFT', 'STANDARD')],
      '3': [guardrail('3')],
      '4': [created],
    });
    await expect(setup({ version: '3' }).switchToStandard()).rejects.toThrow(
      'automatedReasoningPolicy',
    );
  });
});
