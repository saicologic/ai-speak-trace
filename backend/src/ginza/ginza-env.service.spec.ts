import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { ConfigService } from '@nestjs/config';
import { GinzaEnvService } from './ginza-env.service';

describe('GinzaEnvService', () => {
  const originalPlatform = process.platform;
  let home: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'ginza-env-'));
  });

  afterEach(async () => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    await fs.rm(home, { recursive: true, force: true });
  });

  const create = () =>
    new GinzaEnvService({
      get: (key: string) => (key === 'GINZA_HOME' ? home : undefined),
    } as unknown as ConfigService);

  it('対応外の環境では、インストールを始めず、今ある環境も消さない', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const marker = path.join(home, 'installed.json');
    await fs.writeFile(marker, '{}');
    const service = create();

    service.startInstall();

    expect((await service.getStatus()).state).toBe('unsupported');
    expect(existsSync(marker)).toBe(true);
  });

  it('Python には、親の PYTHONPATH などを渡さない', () => {
    // テストの前の値に戻す（実行環境の PYTHONPATH を消さないため）
    const previous = process.env.PYTHONPATH;
    process.env.PYTHONPATH = '/somewhere';
    try {
      const env = create().pythonEnv;
      expect(env.PYTHONPATH).toBeUndefined();
      expect(env.PATH).toBe('/usr/bin:/bin');
    } finally {
      if (previous === undefined) delete process.env.PYTHONPATH;
      else process.env.PYTHONPATH = previous;
    }
  });

  it('requirements.txt のコメントだけが変わっても、入れ直しと解析のやり直しを求めない', async () => {
    const bundle = await fs.mkdtemp(path.join(os.tmpdir(), 'ginza-bundle-'));
    const service = new GinzaEnvService({
      get: (key: string) =>
        key === 'GINZA_HOME'
          ? home
          : key === 'GINZA_BUNDLE_DIR'
            ? bundle
            : undefined,
    } as unknown as ConfigService);
    const hash = () =>
      (
        service as unknown as { requirementsHash(): Promise<string> }
      ).requirementsHash();
    try {
      await fs.writeFile(
        path.join(bundle, 'requirements.txt'),
        '# a\nginza==5.3.0\n    # via x\n',
      );
      await fs.writeFile(path.join(bundle, 'ginza_keywords.py'), 'print(1)\n');
      const before = await hash();
      const engineBefore = await service.engineHash();
      await fs.writeFile(
        path.join(bundle, 'requirements.txt'),
        '# b\nginza==5.3.0\n    # via y\n',
      );
      expect(await hash()).toBe(before);
      // 解析結果のキャッシュも作り直さない
      expect(await service.engineHash()).toBe(engineBefore);
      await fs.writeFile(
        path.join(bundle, 'requirements.txt'),
        '# b\nginza==5.3.1\n',
      );
      expect(await hash()).not.toBe(before);
      expect(await service.engineHash()).not.toBe(engineBefore);
    } finally {
      await fs.rm(bundle, { recursive: true, force: true });
    }
  });
});
