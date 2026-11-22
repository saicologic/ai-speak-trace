/**
 * 会話分析・要約・ディープサーチの画面で共通に使う、Tailwind のクラス
 * （今までは InterviewPage.css の同じクラスを 3 つの画面で使っていたため、ここにまとめる）
 * Tailwind はソースに書いたクラス名だけを CSS にするため、値をつないでクラス名を作らず、完全な名前で書く
 */

/** 画面の背景 */
export const pageClass = 'bg-gray-50';

/** 紺のヘッダーと、その中の戻るボタン・タイトル */
export const headerClass = 'flex items-center gap-4 bg-brand px-8 py-4 text-white';
export const backButtonClass =
  'rounded-md border border-white/30 bg-transparent px-[0.8rem] py-[0.4rem] text-md text-white transition-colors duration-150 hover:bg-white/10';
export const titleClass = 'text-xl font-semibold';

/** タブの並び */
export const tabsClass = 'flex gap-0 border-b border-gray-200 bg-gray-100';

/** タブ：選んでいるタブは白くして青い下線を引き、カーソルを乗せても色を変えない */
export const tabClassOf = (active: boolean): string =>
  `border-x-0 border-t-0 border-b-2 px-6 py-[0.65rem] text-base font-medium transition-all duration-150 ${
    active
      ? 'border-b-primary bg-white text-blue-700'
      : 'border-b-transparent bg-transparent text-gray-500 hover:bg-gray-200 hover:text-gray-700'
  }`;

/**
 * 新規のタブの中身
 * interview-content は、テストでスクロールする部分の中身を探すための目印
 */
export const contentClass = 'interview-content mx-auto w-full max-w-[800px] flex-1 p-8';
export const errorClass = 'mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800';
export const sectionClass = 'mb-8';
export const sectionHeadingClass = 'mb-3 text-lg font-semibold text-gray-800';
export const hintClass = 'mb-2 text-xs text-gray-400';
export const actionsClass = 'mt-3 flex gap-3';

/** 実行のボタン（青）と、補助のボタン（灰色） */
const buttonClass =
  'rounded-lg px-5 py-2 text-base font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50';
export const primaryButtonClass = `${buttonClass} border-none bg-primary text-white enabled:hover:bg-primary-hover`;
export const secondaryButtonClass = `${buttonClass} border border-gray-200 bg-gray-100 text-gray-700 enabled:hover:bg-gray-200`;

/**
 * Claude の応答を待つ間の表示
 * 補足の文も、今までの CSS（.interview-loading p）と同じく、本文と同じ大きさ・太さにする
 */
export const loadingClass = 'flex flex-col items-center px-8 py-12 text-gray-500';
export const loadingTextClass = 'text-lg font-medium';
export const loadingHintClass = 'mt-2 text-lg font-medium text-gray-400';
export const loadingSpinnerClass = 'mb-4 size-10 animate-spin-fast rounded-full border-3 border-gray-200 border-t-primary';

/** 結果のカードの並びと、カード・見出し */
export const resultsClass = 'mt-8 flex flex-col gap-5';
export const resultCardClass = 'rounded-[10px] border border-gray-200 bg-white p-5';
export const resultQuestionClass = 'mb-3 text-base-plus font-semibold text-blue-800';

/**
 * 過去の結果のタブ：一覧と詳細を左右に並べ、スクロールする部分の高さいっぱいに広げる（一覧と詳細は、それぞれの中でスクロールする）
 * interview-logs-layout は、テストで一覧と詳細を並べる箱を探すための目印
 */
export const logsLayoutClass = 'interview-logs-layout flex min-h-0 flex-1 overflow-hidden';
export const logsListClass = 'flex w-[260px] shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-gray-50';
export const logsListHeaderClass =
  'flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-100 px-4 py-3 text-sm font-semibold text-gray-500';
export const logsRefreshClass =
  'rounded-sm border-none bg-transparent px-[0.3rem] py-[0.15rem] text-lg text-gray-400 transition-colors duration-150 enabled:hover:bg-gray-200 enabled:hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40';
export const logsEmptyClass = 'px-4 py-8 text-center text-sm text-gray-400';

/** 一覧の項目：選んだ項目は青くして左に線を引き、カーソルを乗せても色を変えない */
export const logItemClassOf = (selected: boolean): string =>
  `block w-full cursor-pointer border-0 border-b border-b-gray-200 px-4 py-3 text-left transition-colors duration-100 ${
    selected ? 'border-l-3 border-l-primary bg-blue-50' : 'bg-transparent hover:bg-gray-200'
  }`;
export const logItemSpeakerClass = 'mb-[0.2rem] text-md font-semibold text-gray-800';
export const logItemKeywordsClass = 'mb-[0.2rem] truncate text-xs text-gray-500';
export const logItemDateClass = 'text-2xs text-gray-400';

/** 詳細 */
export const logsDetailClass = 'flex-1 overflow-y-auto bg-gray-50 px-8 py-6';
export const logsDetailEmptyClass = 'flex h-full items-center justify-center text-base text-gray-400';
export const logsDetailHeaderClass = 'mb-6 border-b border-gray-200 pb-4';
export const logsDetailMetaClass = 'mb-3 flex items-center gap-4';
export const logsDetailDateClass = 'text-sm text-gray-400';
