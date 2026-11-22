import { render, screen } from '@testing-library/react';
import { AiGeneratedNotice } from '../AiGeneratedNotice';
import { allCss } from '../../test/cssRules';

describe('AiGeneratedNotice', () => {
  it('AIが生成した内容であることと、使ったモデルを表示する', () => {
    render(<AiGeneratedNotice basis="元の会話" model="claude-sonnet-5-5" />);
    expect(
      screen.getByText(/AIが生成した内容です（モデル: claude-sonnet-5-5）。誤りを含むことがあるため、元の会話を確認/),
    ).toBeInTheDocument();
  });

  it('モデルがわからない場合は、モデルを表示しない', () => {
    render(<AiGeneratedNotice basis="根拠" />);
    expect(screen.getByRole('note')).not.toHaveTextContent('モデル');
  });

  it('不適切な表現が検出された場合は、種類を警告として表示する', () => {
    render(
      <AiGeneratedNotice
        basis="出典"
        warnings={[
          { type: 'INSULTS', confidence: 'MEDIUM' },
          { type: 'VIOLENCE', confidence: 'HIGH' },
        ]}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('不適切な表現（侮辱、暴力）');
  });

  it('警告がない場合は、警告を表示しない', () => {
    render(<AiGeneratedNotice basis="出典" warnings={[]} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('注意は黄色、警告は赤の枠と背景で、小さい文字で出す', () => {
    render(<AiGeneratedNotice basis="出典" warnings={[{ type: 'INSULTS', confidence: 'MEDIUM' }]} />);
    expect(screen.getByRole('note')).toHaveClass('border-amber-200', 'bg-amber-50', 'text-amber-800', 'text-xs');
    expect(screen.getByRole('alert')).toHaveClass('border-red-200', 'bg-red-50', 'text-red-800', 'text-xs');
  });

  it('AiGeneratedNotice.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/AiGeneratedNotice.css');
    // 探し方がまちがっていないことを、index.css が見つかることで確かめる
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
