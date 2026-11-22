import { fireEvent, render, screen } from '@testing-library/react';
import { KeywordSourceSwitch } from '../KeywordSourceSwitch';
import { allCss } from '../../test/cssRules';
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

describe('KeywordSourceSwitch の見た目', () => {
  it('2 つのボタンを 1 つの枠に並べ、選んでいるほうを青くし、間に線を引く', () => {
    render(<KeywordSourceSwitch state={state({ source: 'standard' })} />);
    expect(screen.getByRole('group')).toHaveClass('flex', 'overflow-hidden', 'rounded-lg', 'border', 'border-gray-300');
    const standard = screen.getByRole('button', { name: '標準' });
    const ginza = screen.getByRole('button', { name: 'GiNZA' });
    expect(standard).toHaveClass('flex-1', 'text-xs', 'font-semibold', 'whitespace-nowrap', 'bg-primary', 'text-white');
    // 選んでいるボタンは、カーソルを乗せても色を変えない
    expect(Array.from(standard.classList).filter((c) => c.startsWith('hover:'))).toEqual([]);
    expect(ginza).toHaveClass('bg-white', 'text-gray-600', 'hover:bg-gray-100', 'border-l', 'border-gray-300');
    expect(standard).not.toHaveClass('border-l');
  });

  it('GiNZA の状態は小さい灰色の文字で出し、進み具合は青、エラーは赤にする', () => {
    const { rerender } = render(
      <KeywordSourceSwitch state={state({ status: { state: 'installing', message: '準備中' } })} />,
    );
    expect(screen.getByRole('status')).toHaveClass('mt-2', 'text-xs', 'text-gray-500');
    expect(screen.getByText('準備中…')).toHaveClass('text-blue-600');
    rerender(<KeywordSourceSwitch state={state({ status: { state: 'error', message: '入れられませんでした' } })} />);
    expect(screen.getByText('入れられませんでした')).toHaveClass('text-red-600');
    expect(screen.getByRole('button', { name: 'もう一度入れる' })).toHaveClass(
      'border-primary',
      'bg-white',
      'text-primary',
      'hover:bg-blue-50',
    );
  });

  it('KeywordSourceSwitch.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/KeywordSourceSwitch.css');
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
