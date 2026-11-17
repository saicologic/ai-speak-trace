import { render, screen } from '@testing-library/react';
import { Button } from '../Button';

/**
 * アプリで共通に使うボタン
 * 種類（variant）と大きさ（size）を選ぶと、決めた色と大きさのクラスが付く
 */
describe('Button', () => {
  it('中身を表示し、type を渡さないときは button にする（フォームの中でも、押しただけで送信しない）', () => {
    render(<Button>保存</Button>);

    expect(screen.getByRole('button', { name: '保存' })).toHaveAttribute('type', 'button');
  });

  it('種類を渡さないときは、白地に灰色の枠のボタン（secondary）にする', () => {
    render(<Button>閉じる</Button>);

    expect(screen.getByRole('button', { name: '閉じる' })).toHaveClass(
      'bg-white',
      'text-gray-700',
      'border-gray-300',
      'enabled:hover:bg-gray-100',
    );
  });

  it.each([
    ['primary', ['bg-primary', 'text-white', 'enabled:hover:bg-primary-hover']],
    ['danger', ['bg-danger', 'text-white', 'enabled:hover:bg-danger-hover']],
    // 紺のヘッダーの上に置くボタン（戻るボタンなど）
    ['onDark', ['bg-transparent', 'text-white', 'border-white/30', 'enabled:hover:bg-white/10']],
  ] as const)('種類が %s のときは、決めた色のクラスを付ける', (variant, classes) => {
    render(<Button variant={variant}>実行</Button>);

    expect(screen.getByRole('button', { name: '実行' })).toHaveClass(...classes);
  });
});

