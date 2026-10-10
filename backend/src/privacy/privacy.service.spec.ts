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
      return Promise.resolve();
    }),
  };
  const service = new PrivacyService(
    guardrail as unknown as GuardrailService,
    store as unknown as PrivacyScanStore,
  );
  return { service, guardrail, store };
};

describe('PrivacyService', () => {
  it('検出して保存し、前回の「伏せない」の選択を引き継ぐ', async () => {
    const previous: PrivacyScan = {
      transcriptionId: 't1',
      scannedAt: '2026-01-01T00:00:00.000Z',
      guardrailId: 'gr-1',
      guardrailVersion: 'DRAFT',
      findings: [
        { type: 'NAME', label: '氏名', text: '加賀谷', count: 1, mask: false },
      ],
    };
    const { service, guardrail } = setup(true, previous);
    const scan = await service.scan(transcription);
    expect(guardrail.inspect).toHaveBeenCalledWith(
      'Aさん: 加賀谷さんと山田太郎',
      'INPUT',
    );
    expect(scan.findings.map((f) => [f.text, f.mask])).toEqual([
      ['加賀谷', false],
      ['山田太郎', true],
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

  it('Guardrail ID が未設定ならチェックできない', async () => {
    const { service } = setup(false);
    await expect(service.scan(transcription)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('送る用の文字起こしは、伏せると選んだ文字列だけを置き換える', async () => {
    const { service } = setup();
    await service.scan(transcription);
    await service.updateMasks('t1', [
      { type: 'NAME', text: '加賀谷', mask: false },
    ]);
    const masked = await service.maskForSending(transcription);
    expect(masked.utterances[0].text).toBe('加賀谷さんと[氏名]');
  });

  it('チェック前の文字起こしは、そのまま送る', async () => {
    const { service } = setup();
    expect(await service.maskForSending(transcription)).toBe(transcription);
  });
});
