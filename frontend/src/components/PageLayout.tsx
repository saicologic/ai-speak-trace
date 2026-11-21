import type { ReactNode } from 'react';

interface PageLayoutProps {
  /** 固定する部分（戻るボタン・タイトル・タブ） */
  header: ReactNode;
  /** スクロールする部分 */
  children: ReactNode;
  /** ページごとのクラス名（背景色など） */
  className?: string;
}

/** 外枠：画面の高さに合わせ、外枠そのものはスクロールさせない（page-layout は目印のクラス） */
const rootClass = 'page-layout flex h-screen flex-col overflow-hidden';

/**
 * ページの外枠
 * ヘッダー（とタブ）を画面の上に固定し、それ以外だけをスクロールさせる。
 * メイン画面以外のページは、この外枠を使う
 */
export function PageLayout({ header, children, className }: PageLayoutProps) {
  return (
    <div className={className ? `${rootClass} ${className}` : rootClass}>
      {/* 固定する部分（ヘッダー・タブ）：中身が長くても縮まない */}
      <div className="page-layout-fixed shrink-0">{header}</div>
      {/* スクロールする部分：残りの高さを使い、中身が長いときだけスクロールする
          （一覧と詳細を左右に並べる画面は、子に flex-1 と min-h-0 を付けると、高さいっぱいに広がる） */}
      <div className="page-layout-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}
