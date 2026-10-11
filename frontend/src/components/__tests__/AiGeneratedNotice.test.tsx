import { render, screen } from '@testing-library/react';
import { AiGeneratedNotice } from '../AiGeneratedNotice';

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
});
