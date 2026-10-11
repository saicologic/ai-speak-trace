import { execFileSync } from 'child_process';
import { KEYCHAIN_SERVICE, KeychainSecretStore } from './secret-store';

jest.mock('child_process', () => ({ execFileSync: jest.fn() }));

const mockExec = execFileSync as unknown as jest.Mock;

/** security コマンドの終了コードを持つエラー */
function exitError(status: number): Error {
  return Object.assign(new Error(`exit ${status}`), { status });
}

describe('KeychainSecretStore', () => {
  const store = new KeychainSecretStore();

  beforeEach(() => mockExec.mockReset());

  describe('get', () => {
    it('security find-generic-password で値を読む', () => {
      mockExec.mockReturnValue('stored-value\n');

      expect(store.get('anthropicApiKey')).toBe('stored-value');
      expect(mockExec).toHaveBeenCalledWith(
        '/usr/bin/security',
        [
          'find-generic-password',
          '-s',
          KEYCHAIN_SERVICE,
          '-a',
          'anthropicApiKey',
          '-w',
        ],
        expect.anything(),
      );
    });

    it('項目がない場合は null を返す', () => {
      mockExec.mockImplementation(() => {
        throw exitError(44);
      });

      expect(store.get('anthropicApiKey')).toBeNull();
    });

    it('ほかの失敗は例外にする', () => {
      mockExec.mockImplementation(() => {
        throw exitError(1);
      });

      expect(() => store.get('anthropicApiKey')).toThrow('読めませんでした');
    });
  });

  describe('set', () => {
    it('値をコマンドライン引数に載せず、security -i の標準入力から渡す', () => {
      mockExec
        .mockReturnValueOnce(Buffer.from(''))
        .mockReturnValueOnce('new-value_1.0\n');

      store.set('anthropicApiKey', 'new-value_1.0');

      const [command, args, options] = mockExec.mock.calls[0] as [
        string,
        string[],
        { input: string },
      ];
      expect(command).toBe('/usr/bin/security');
      expect(args).toEqual(['-i']);
      expect(args.join(' ')).not.toContain('new-value_1.0');
      expect(options.input).toBe(
        `add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "anthropicApiKey" -w "new-value_1.0"\n`,
      );
    });

    it('読み直した値が違う場合は、保存できなかったとして例外にする', () => {
      mockExec
        .mockReturnValueOnce(Buffer.from(''))
        .mockImplementationOnce(() => {
          throw exitError(44);
        });

      expect(() => store.set('anthropicApiKey', 'value')).toThrow(
        '保存できませんでした',
      );
    });

    it('引用符・空白・改行を含む値は、コマンドに埋め込まずに拒否する', () => {
      for (const value of ['a"b', 'a b', 'a\nb', '']) {
        expect(() => store.set('anthropicApiKey', value)).toThrow(
          '使えない文字',
        );
      }
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('項目名に使えない文字があれば拒否する', () => {
      expect(() => store.set('a"b', 'value')).toThrow('項目名');
    });
  });

  describe('delete', () => {
    it('項目がない場合は何もしない', () => {
      mockExec.mockImplementation(() => {
        throw exitError(44);
      });

      expect(() => store.delete('anthropicApiKey')).not.toThrow();
    });
  });

  describe('isAvailable', () => {
    it('SECRET_STORE=file の場合は使わない', () => {
      expect(process.env.SECRET_STORE).toBe('file');
      expect(KeychainSecretStore.isAvailable()).toBe(false);
    });
  });
});
