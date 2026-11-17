import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  ] as const)('種類が %s のときは、決めた色のクラスを付け、ほかの種類（secondary）のクラスは付けない', (variant, classes) => {
    render(<Button variant={variant}>実行</Button>);

    const button = screen.getByRole('button', { name: '実行' });
    expect(button).toHaveClass(...classes);
    // not.toHaveClass にクラスをまとめて渡すと「全部が付いているか」になるため、1 つずつ確かめる
    for (const other of ['bg-white', 'text-gray-700', 'border-gray-300']) {
      expect(button).not.toHaveClass(other);
    }
  });

  it('大きさを渡さないときは md にし、角を丸め、文字を少し太くする', () => {
    render(<Button>保存</Button>);

    expect(screen.getByRole('button', { name: '保存' })).toHaveClass(
      'px-4',
      'py-2',
      'text-md',
      'rounded-md',
      'font-medium',
    );
  });

  it('大きさが sm のときは、余白と文字を小さくする', () => {
    render(<Button size="sm">削除</Button>);

    const button = screen.getByRole('button', { name: '削除' });
    expect(button).toHaveClass('px-2.5', 'py-1', 'text-sm', 'rounded-md');
    for (const md of ['px-4', 'py-2', 'text-md']) {
      expect(button).not.toHaveClass(md);
    }
  });

  it('className を渡すと、決めたクラスを残したまま、後ろに足す（幅や外側の余白など、置き場所の指定に使う）', () => {
    render(
      <Button variant="primary" className="w-full mt-2">
        文字起こし
      </Button>,
    );

    const button = screen.getByRole('button', { name: '文字起こし' });
    expect(button).toHaveClass('bg-primary', 'px-4', 'w-full', 'mt-2');
    expect(button.className.endsWith(' w-full mt-2')).toBe(true);
  });

  it('className に空の文字列を渡したときは、後ろに空白を足さない', () => {
    render(<Button className="">閉じる</Button>);

    const button = screen.getByRole('button', { name: '閉じる' });
    expect(button).toHaveClass('bg-white', 'px-4');
    expect(button.className).toBe(button.className.trim());
  });

  it('type="submit" を渡すと、送信のボタンにする', () => {
    render(<Button type="submit">送信</Button>);

    expect(screen.getByRole('button', { name: '送信' })).toHaveAttribute('type', 'submit');
  });

  it('押せないとき（disabled）は、押しても onClick を呼ばず、薄くして押せないことが分かるようにする', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" disabled onClick={onClick}>
        保存
      </Button>,
    );

    const button = screen.getByRole('button', { name: '保存' });
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
    expect(button).toHaveClass('disabled:cursor-not-allowed', 'disabled:opacity-50');
  });

  it('押せるときは、押すと onClick を呼ぶ。aria-label などのボタンの属性も渡せる', async () => {
    const onClick = vi.fn();
    render(
      <Button aria-label="設定を開く" title="設定" onClick={onClick}>
        ⚙
      </Button>,
    );

    const button = screen.getByRole('button', { name: '設定を開く' });
    expect(button).toHaveAttribute('title', '設定');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

