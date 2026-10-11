import { Logger } from '@nestjs/common';

// テストで macOS のキーチェーンを読み書きしないよう、API キーはファイルに保存する
process.env.SECRET_STORE = 'file';

// テスト実行時にNestJSのロガー出力を抑制する（失敗時のJestエラーは通常通り表示される）
jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'verbose').mockImplementation(() => undefined);
