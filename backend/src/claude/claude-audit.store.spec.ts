import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ConfigService } from '@nestjs/config';
import {
  CLAUDE_AUDIT_DIR,
  ClaudeAuditRecord,
  ClaudeAuditStore,
  countPiiTypes,
} from './claude-audit.store';

describe('ClaudeAuditStore', () => {
  let tmpDir: string;
  let store: ClaudeAuditStore;

  const record = (at: string): ClaudeAuditRecord => ({
    at,
    purpose: 'summary',
    model: 'claude-sonnet-5-5',
    guardrailId: 'gr-1',
    guardrailVersion: '1',
    outcome: 'sent',
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-audit-'));
    store = new ClaudeAuditStore({
      get: (key: string) => (key === 'DATA_DIR' ? tmpDir : undefined),
    } as unknown as ConfigService);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('月ごとの JSON Lines ファイルに追記する', async () => {
    await store.append(record('2026-10-01T00:00:00.000Z'));
    await store.append(record('2026-10-31T00:00:00.000Z'));
    await store.append(record('2026-11-01T00:00:00.000Z'));

    const october = await fs.readFile(
      path.join(tmpDir, CLAUDE_AUDIT_DIR, '2026-10.jsonl'),
      'utf-8',
    );
    expect(
      october
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as object),
    ).toEqual([
      record('2026-10-01T00:00:00.000Z'),
      record('2026-10-31T00:00:00.000Z'),
    ]);
    await expect(
      fs.access(path.join(tmpDir, CLAUDE_AUDIT_DIR, '2026-11.jsonl')),
    ).resolves.toBeUndefined();
  });

  it('書き込めなくても例外を投げない（Claude の呼び出しを止めない）', async () => {
    // 保存先と同じ名前のファイルを置き、ディレクトリを作れないようにする
    await fs.writeFile(path.join(tmpDir, CLAUDE_AUDIT_DIR), '');

    await expect(
      store.append(record('2026-10-01T00:00:00.000Z')),
    ).resolves.toBeUndefined();
  });
});

describe('countPiiTypes', () => {
  it('種類ごとの件数にまとめる', () => {
    expect(
      countPiiTypes([{ type: 'PHONE' }, { type: 'EMAIL' }, { type: 'PHONE' }]),
    ).toEqual({ PHONE: 2, EMAIL: 1 });
  });
});
