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
  /**
   * 足すクラス（幅や外側の余白など、置き場所の指定に使う）
   * 色・余白・文字の大きさは variant と size で決める。同じ項目のクラスを渡しても、どちらが効くかは CSS の順で決まり、後ろに書いたほうが勝つとは限らない
   */
  className?: string;
}

/**
 * アプリで共通に使うボタン
 * type を渡さないときは button にする（フォームの中でも、押しただけで送信しない）
 */
export function Button({
  type = 'button',
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  const classes = `rounded-md border font-medium disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]}`;
  return <button type={type} className={className ? `${classes} ${className}` : classes} {...props} />;
}
