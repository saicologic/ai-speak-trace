import type { ButtonHTMLAttributes } from 'react';

/** ボタンの種類 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'onDark';

/** ボタンの大きさ */
export type ButtonSize = 'sm' | 'md';

/**
 * 種類ごとの色のクラス
 * Tailwind はソースに書いたクラス名だけを CSS にするため、値をつないでクラス名を作らず、完全な名前で書く
 */
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-primary text-white enabled:hover:bg-primary-hover',
  secondary: 'border-gray-300 bg-white text-gray-700 enabled:hover:border-gray-400 enabled:hover:bg-gray-100',
  danger: 'border-transparent bg-danger text-white enabled:hover:bg-danger-hover',
  // 紺のヘッダーの上に置くボタン（戻るボタンなど）
  onDark: 'border-white/30 bg-transparent text-white enabled:hover:bg-white/10',
};

/** 大きさごとの余白と文字の大きさのクラス */
const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-sm',
  md: 'px-4 py-2 text-md',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 種類（渡さないときは secondary） */
  variant?: ButtonVariant;
  /** 大きさ（渡さないときは md） */
  size?: ButtonSize;
}

/**
 * アプリで共通に使うボタン
 * type を渡さないときは button にする（フォームの中でも、押しただけで送信しない）
 */
export function Button({ type = 'button', variant = 'secondary', size = 'md', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`rounded-md border font-medium ${variantClasses[variant]} ${sizeClasses[size]}`}
      {...props}
    />
  );
}
