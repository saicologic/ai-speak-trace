import { GinzaKeywordsService } from './ginza-keywords.service';
import type { GinzaEnvService } from './ginza-env.service';

describe('GinzaKeywordsService', () => {
  it('Python がテキストを読む前に終了しても、バックエンドを止めずに失敗を返す', async () => {
    // すぐに終了するコマンドを Python の代わりに使い、大きなテキストを書き込んで EPIPE を起こす
    const env = {
      pythonPath: '/usr/bin/false',
      scriptPath: 'unused',
    } as unknown as GinzaEnvService;
    const service = new GinzaKeywordsService(
      env,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    // analyze は private のため、型を付け直して呼ぶ
    const target = service as unknown as {
      analyze(texts: string[]): Promise<unknown>;
    };

    await expect(target.analyze(['あ'.repeat(5_000_000)])).rejects.toThrow(
      'GiNZA の解析に失敗しました',
    );
  });
});
