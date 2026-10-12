import { fireEvent, render, screen } from '@testing-library/react';
import { KeywordSourceSwitch } from '../KeywordSourceSwitch';
import type { KeywordSourceState } from '../../hooks/useKeywordSource';

const state = (overrides: Partial<KeywordSourceState>): KeywordSourceState => ({
  source: 'ginza',
  setSource: vi.fn(),
  status: null,
  ginza: null,
  loading: false,
  error: null,
  install: vi.fn(),
  ...overrides,
});

describe('KeywordSourceSwitch', () => {
  it('標準と GiNZA を切り替えられる', () => {
    const s = state({ source: 'standard' });
    render(<KeywordSourceSwitch state={s} />);
    expect(screen.getByRole('button', { name: '標準' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'GiNZA' }));
    expect(s.setSource).toHaveBeenCalledWith('ginza');
  });

  it('GiNZA が入っていなければ、ダウンロードの大きさと入れるボタンを出す', () => {
    const s = state({ status: { state: 'not_installed', message: 'GiNZA が入っていません' } });
    render(<KeywordSourceSwitch state={s} />);
    expect(screen.getByRole('status')).toHaveTextContent('約 500MB');

    fireEvent.click(screen.getByRole('button', { name: 'GiNZA を入れる' }));
    expect(s.install).toHaveBeenCalled();
  });

  it('インストール中は進み具合を出す', () => {
    render(
      <KeywordSourceSwitch
        state={state({ status: { state: 'installing', message: 'GiNZA をインストールしています' } })}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('GiNZA をインストールしています');
  });

  it('入れられなかった場合は、理由とやり直すボタンを出す', () => {
    render(
      <KeywordSourceSwitch
        state={state({ status: { state: 'error', message: 'GiNZA を入れられませんでした: 通信エラー' } })}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('通信エラー');
    expect(screen.getByRole('button', { name: 'もう一度入れる' })).toBeInTheDocument();
  });

  it('標準のときは GiNZA の状態を出さない', () => {
    render(<KeywordSourceSwitch state={state({ source: 'standard' })} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
