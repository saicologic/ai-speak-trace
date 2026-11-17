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
});
