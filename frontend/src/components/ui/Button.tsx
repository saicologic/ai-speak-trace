import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * アプリで共通に使うボタン
 * type を渡さないときは button にする（フォームの中でも、押しただけで送信しない）
 */
export function Button({ type = 'button', ...props }: ButtonProps) {
  return <button type={type} {...props} />;
}
