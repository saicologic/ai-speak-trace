import type { ReactNode } from 'react';
import './PageLayout.css';

interface PageLayoutProps {
  /** 固定する部分（戻るボタン・タイトル・タブ） */
  header: ReactNode;
  /** スクロールする部分 */
  children: ReactNode;
  /** ページごとのクラス名（背景色など） */
  className?: string;
}

/**
 * ページの外枠
 * ヘッダー（とタブ）を画面の上に固定し、それ以外だけをスクロールさせる。
 * メイン画面以外のページは、この外枠を使う
 */
export function PageLayout({ header, children, className }: PageLayoutProps) {
  return (
    <div className={className ? `page-layout ${className}` : 'page-layout'}>
      <div className="page-layout-fixed">{header}</div>
      <div className="page-layout-scroll">{children}</div>
    </div>
  );
}
