import { useMemo, useState, type ReactNode } from 'react';
import type { Keyword, Speaker } from '../types';

interface Props {
  keywords: Keyword[];
  highlightedKeywords: Set<string>;
  onToggleKeyword: (keyword: string) => void;
  filterActive: boolean;
  onToggleFilter: () => void;
  onNavigateSummary?: () => void;
  onNavigateInterview?: () => void;
  onToggleContextMode?: () => void;
  contextSelectMode?: boolean;
  speakers?: Speaker[];
  selectedSpeakerId: string | null;
  onSpeakerFilterChange: (speakerId: string | null) => void;
  /** キーワードの出し方の切り替え（GiNZA のベータ機能が有効なときだけ） */
  sourceSwitch?: ReactNode;
  /** AI 分析の状態（使えるか、OFF か、足りない設定）。ボタンの上に出す */
  aiStatus?: ReactNode;
  /** AI 分析を使えないときは、要約・会話分析・発言の文脈のボタンを押せなくする */
  aiDisabled?: boolean;
}

/** 要約・会話分析・発言の文脈のボタン：押せないときは灰色にする */
const aiButtonClass =
  'mb-3 w-full rounded-lg border-none p-2 text-sm font-semibold text-white transition-colors duration-150 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400';
const aiButtonIdleClass = 'bg-primary enabled:hover:bg-primary-hover';
/** 発言を選んでいる間の「発言の文脈」：濃い青にし、カーソルを乗せても色を変えない */
const aiButtonActiveClass = 'bg-blue-800';

/** 話者の絞り込みとキーワードの検索に共通の、枠・余白・文字の大きさ */
const fieldClass = 'w-full rounded-md border border-gray-200 px-[0.6rem] py-[0.4rem] text-sm outline-none focus:shadow-[0_0_0_2px]';

/**
 * 「フィルター」ボタン
 * カーソルを乗せたときの色は、絞り込んでいる間も付ける（今までの CSS と同じ）
 */
const filterButtonClass =
  'shrink-0 rounded-sm border px-2 py-[0.2rem] text-2xs transition-all duration-150 enabled:hover:border-gray-300 enabled:hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40';
const filterButtonActiveClass = 'border-primary bg-primary text-white';
const filterButtonIdleClass = 'border-gray-200 bg-white text-gray-500';

/** キーワード：選んだキーワードは黄色にし、カーソルを乗せても色を変えない */
const keywordClass =
  'flex w-full items-center justify-between gap-2 rounded-md border px-[0.6rem] py-[0.4rem] text-left transition-all duration-150';
const keywordActiveClass = 'border-yellow-400 bg-yellow-100';
const keywordIdleClass = 'border-gray-200 bg-white hover:border-amber-200 hover:bg-yellow-50';
const countClass = 'shrink-0 rounded-[10px] px-[0.4rem] py-[0.1rem] text-2xs';

/** キーワードがないことの案内 */
const emptyClass = 'py-4 text-center text-md text-gray-400';

/** キーワード一覧コンポーネント（右サイドバー） */
export function KeywordList({
  keywords,
  highlightedKeywords,
  onToggleKeyword,
  filterActive,
  onToggleFilter,
  onNavigateSummary,
  onNavigateInterview,
  onToggleContextMode,
  contextSelectMode,
  speakers,
  selectedSpeakerId,
  onSpeakerFilterChange,
  sourceSwitch,
  aiStatus,
  aiDisabled = false,
}: Props) {
  const [filter, setFilter] = useState('');

  const filteredKeywords = useMemo(() => {
    if (!filter) return keywords;
    const lower = filter.toLowerCase();
    return keywords.filter((kw) => kw.text.toLowerCase().includes(lower));
  }, [keywords, filter]);

  // 切り替えがない場合は、これまでどおりキーワードがないことだけを出す
  if (keywords.length === 0 && !sourceSwitch) {
    return (
      <div className="flex h-full flex-col">
        {aiStatus}
        <h2>キーワード</h2>
        <p className={emptyClass}>キーワードが見つかりません</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {aiStatus}
      {onNavigateSummary && (
        <button
          className={`${aiButtonClass} ${aiButtonIdleClass}`}
          onClick={onNavigateSummary}
          disabled={aiDisabled}
        >
          要約
        </button>
      )}
      {onNavigateInterview && (
        <button
          className={`${aiButtonClass} ${aiButtonIdleClass}`}
          onClick={onNavigateInterview}
          disabled={aiDisabled}
        >
          会話分析
        </button>
      )}
      {onToggleContextMode && (
        <button
          className={`${aiButtonClass} ${contextSelectMode ? aiButtonActiveClass : aiButtonIdleClass}`}
          onClick={onToggleContextMode}
          disabled={aiDisabled}
        >
          {contextSelectMode ? '発言の文脈（選択中...）' : '発言の文脈'}
        </button>
      )}
      {speakers && speakers.length > 0 && (
        <div className="mb-3">
          <label className="mb-1 block text-xs font-semibold text-gray-500">話者フィルター</label>
          <select
            className={`${fieldClass} cursor-pointer bg-white focus:border-primary focus:shadow-blue-500/20`}
            value={selectedSpeakerId ?? ''}
            onChange={(e) => onSpeakerFilterChange(e.target.value || null)}
          >
            <option value="">全員</option>
            {speakers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}
      {sourceSwitch}
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold">キーワード</h2>
        <span className="text-xs text-gray-400">{filteredKeywords.length}件</span>
      </div>
      <input
        type="text"
        className={`${fieldClass} mb-2 focus:border-yellow-400 focus:shadow-yellow-400/20`}
        placeholder="キーワードを検索..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="mb-2 flex items-center justify-between">
        <p className="text-2xs text-gray-400">
          クリックでハイライト切替
        </p>
        <button
          className={`${filterButtonClass} ${filterActive ? filterButtonActiveClass : filterButtonIdleClass}`}
          onClick={onToggleFilter}
          disabled={highlightedKeywords.size === 0}
          title={highlightedKeywords.size === 0 ? 'キーワードを選択してください' : '選択中のキーワードで絞り込み'}
        >
          {filterActive ? 'フィルター解除' : 'フィルター'}
        </button>
      </div>
      {keywords.length === 0 && (
        <p className={emptyClass}>キーワードが見つかりません</p>
      )}
      <ul className="flex-1 list-none overflow-y-auto">
        {filteredKeywords.map((keyword) => {
          const isActive = highlightedKeywords.has(keyword.text);
          return (
            <li key={keyword.text} className="mb-1">
              <button
                className={`${keywordClass} ${isActive ? keywordActiveClass : keywordIdleClass}`}
                onClick={() => onToggleKeyword(keyword.text)}
              >
                <span className="text-sm font-medium break-all">{keyword.text}</span>
                <span className={`${countClass} ${isActive ? 'bg-amber-200 text-amber-800' : 'bg-gray-100 text-gray-400'}`}>{keyword.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
