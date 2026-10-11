import { BadRequestException } from '@nestjs/common';
import { Transcription } from '../transcription/types/transcription.types';
import { GuardrailService } from './guardrail.service';
import { PrivacyScanStore } from './privacy-scan.store';
import { PrivacyService } from './privacy.service';
import { PrivacyScan } from './privacy.types';

const transcription: Transcription = {
  id: 't1',
  audioFileName: 'a.mp3',
  createdAt: '2026-01-01T00:00:00.000Z',
  languageCode: 'ja',
  fullText: '加賀谷さんと山田太郎',
  speakers: [{ id: 's0', name: 'Aさん', color: '#000' }],
  words: [],
  utterances: [
    {
      speakerId: 's0',
      speakerName: 'Aさん',
      start: 0,
      end: 1,
      text: '加賀谷さんと山田太郎',
      words: [],
    },
  ],
};

const setup = (configured = true, saved: PrivacyScan | null = null) => {
  let stored = saved;
  const guardrail = {
    isConfigured: () => configured,
    guardrailId: 'gr-1',
    guardrailVersion: 'DRAFT',
    inspect: jest.fn(() =>
      Promise.resolve({
        pii: [
          { type: 'NAME', match: '加賀谷' },
          { type: 'NAME', match: '山田太郎' },
        ],
        words: [],
        content: [],
      }),
    ),
  };
  const store = {
    find: jest.fn(() => Promise.resolve(stored)),
    save: jest.fn((scan: PrivacyScan) => {
      stored = scan;
      return Promise.resolve(true);
    }),
  };
  const service = new PrivacyService(
    guardrail as unknown as GuardrailService,
    store as unknown as PrivacyScanStore,
  );
  return { service, guardrail, store };
};

describe('PrivacyService', () => {
  it('検出して保存し、前回の選択を引き継ぐ（新しい氏名は伏せずに要確認）', async () => {
    const previous: PrivacyScan = {
      transcriptionId: 't1',
      scannedAt: '2026-01-01T00:00:00.000Z',
      guardrailId: 'gr-1',
      guardrailVersion: 'DRAFT',
      findings: [
        {
          type: 'NAME',
          label: '氏名',
          text: '加賀谷',
          count: 1,
          mask: false,
          needsReview: false,
        },
      ],
    };
    const { service, guardrail } = setup(true, previous);
    const scan = await service.scan(transcription);
    expect(guardrail.inspect).toHaveBeenCalledWith(
      'Aさん: 加賀谷さんと山田太郎',
      'INPUT',
    );
    expect(scan.findings.map((f) => [f.text, f.mask, f.needsReview])).toEqual([
      ['加賀谷', false, false],
      ['山田太郎', false, true],
    ]);
  });

  it('同じ文字起こしを同時にチェックしても、Guardrails は1回だけ呼ぶ', async () => {
    const { service, guardrail } = setup();
    await Promise.all([
      service.scan(transcription),
      service.scan(transcription),
    ]);
    expect(guardrail.inspect).toHaveBeenCalledTimes(1);
  });

  it('チェックの実行中に何度か呼ばれた場合は、終わってから最後に渡された内容で1回だけ検出し直す', async () => {
    const { service, guardrail } = setup();
    const first = service.scan(transcription);
    const renamed = (name: string) => ({
      ...transcription,
      utterances: [{ ...transcription.utterances[0], speakerName: name }],
    });
    service.scanInBackground(renamed('山田さん'));
    service.scanInBackground(renamed('佐藤さん'));
    await first;
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(guardrail.inspect).toHaveBeenCalledTimes(2);
    expect(guardrail.inspect.mock.calls[1][0]).toContain('佐藤さん');
  });

  it('待っている間に受け取った内容は、受け取った時刻をチェックの時刻として保存する', async () => {
    const { service, store } = setup();
    const first = service.scan(transcription);
    // 削除の前に受け取った内容は、削除の後に検出しても、受け取った時刻で削除済みかを確認する
    service.scanInBackground(transcription, '2026-01-01T00:00:00.000Z');
    await first;
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(store.save).toHaveBeenCalledTimes(2);
    expect(store.save.mock.calls[1][0].scannedAt).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('確認済みの会話だけ、話者名の更新時に検出し直す', async () => {
    const saved: PrivacyScan = {
      transcriptionId: 't1',
      scannedAt: '2026-01-01T00:00:00.000Z',
      guardrailId: 'gr-1',
      guardrailVersion: 'DRAFT',
      findings: [],
    };
    const checked = setup(true, saved);
    checked.service.rescanIfChecked(transcription);
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(checked.guardrail.inspect).toHaveBeenCalledTimes(1);

    // まだ確認していない会話は、Guardrails に送らない
    const unchecked = setup(true, null);
    unchecked.service.rescanIfChecked(transcription);
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(unchecked.guardrail.inspect).not.toHaveBeenCalled();
  });

  it('初回のチェックの実行中に話者名を変えた場合も、終わってから検出し直す', async () => {
    const { service, guardrail } = setup(true, null);
    const first = service.scan(transcription);
    const renamed = {
      ...transcription,
      utterances: [{ ...transcription.utterances[0], speakerName: '山田さん' }],
    };
    service.rescanIfChecked(renamed);
    await first;
    await service.waitForScans('t1');
    expect(guardrail.inspect).toHaveBeenCalledTimes(2);
    expect(guardrail.inspect.mock.calls[1][0]).toContain('山田さん');
  });

  it('検出し直しが予約されていれば、それが終わるまで待つ', async () => {
    const { service, guardrail } = setup();
    const first = service.scan(transcription);
    service.scanInBackground({
      ...transcription,
      utterances: [{ ...transcription.utterances[0], speakerName: '佐藤さん' }],
    });
    await service.waitForScans('t1');
    expect(guardrail.inspect).toHaveBeenCalledTimes(2);
    await first;
  });

  it('Guardrail ID が未設定ならチェックできない', async () => {
    const { service } = setup(false);
    await expect(service.scan(transcription)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('送る用の文字起こしは、伏せると選んだ文字列だけを置き換える', async () => {
    const { service } = setup();
    await service.scan(transcription);
    const updated = await service.updateMasks('t1', [
      { type: 'NAME', text: '加賀谷', mask: false },
      { type: 'NAME', text: '山田太郎', mask: true },
    ]);
    expect(updated.findings.every((f) => !f.needsReview)).toBe(true);
    const masked = await service.maskForSending(transcription);
    expect(masked.utterances[0].text).toBe('加賀谷さんと[氏名]');
  });

  it('チェック前の文字起こしは、そのまま送る', async () => {
    const { service } = setup();
    expect(await service.maskForSending(transcription)).toBe(transcription);
  });
});
