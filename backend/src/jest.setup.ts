import { Logger } from '@nestjs/common';

// テストで macOS のキーチェーンを読み書きしないよう、API キーはファイルに保存する
process.env.SECRET_STORE = 'file';

// テストでは AI 分析を ON にする（OFF の動きは、それを確かめるテストで AI_ANALYSIS を変える）
process.env.AI_ANALYSIS = 'on';

// テスト実行時にNestJSのロガー出力を抑制する（失敗時のJestエラーは通常通り表示される）
jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'verbose').mockImplementation(() => undefined);
