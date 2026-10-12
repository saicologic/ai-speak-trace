import { useMemo, useState, type ReactNode } from 'react';
import type { Keyword, Speaker } from '../types';
import './KeywordList.css';

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
      <div className="keyword-list">
        {aiStatus}
        <h2>キーワード</h2>
        <p className="keyword-list-empty">キーワードが見つかりません</p>
      </div>
    );
  }

  return (
    <div className="keyword-list">
      {aiStatus}
      {onNavigateSummary && (
        <button
          className="keyword-interview-button"
          onClick={onNavigateSummary}
          disabled={aiDisabled}
        >
          要約
        </button>
      )}
      {onNavigateInterview && (
        <button
          className="keyword-interview-button"
          onClick={onNavigateInterview}
          disabled={aiDisabled}
        >
          会話分析
        </button>
      )}
      {onToggleContextMode && (
        <button
          className={`keyword-context-button ${contextSelectMode ? 'active' : ''}`}
          onClick={onToggleContextMode}
          disabled={aiDisabled}
        >
          {contextSelectMode ? '発言の文脈（選択中...）' : '発言の文脈'}
        </button>
      )}
      {speakers && speakers.length > 0 && (
        <div className="speaker-filter">
          <label className="speaker-filter-label">話者フィルター</label>
          <select
            className="speaker-filter-select"
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
      <div className="keyword-list-header">
        <h2>キーワード</h2>
        <span className="keyword-list-count">{filteredKeywords.length}件</span>
      </div>
      <input
        type="text"
        className="keyword-filter"
        placeholder="キーワードを検索..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="keyword-list-actions">
        <p className="keyword-list-hint">
          クリックでハイライト切替
        </p>
        <button
          className={`keyword-filter-button ${filterActive ? 'active' : ''}`}
          onClick={onToggleFilter}
          disabled={highlightedKeywords.size === 0}
          title={highlightedKeywords.size === 0 ? 'キーワードを選択してください' : '選択中のキーワードで絞り込み'}
        >
          {filterActive ? 'フィルター解除' : 'フィルター'}
        </button>
      </div>
      {keywords.length === 0 && (
        <p className="keyword-list-empty">キーワードが見つかりません</p>
      )}
      <ul className="keyword-list-items">
        {filteredKeywords.map((keyword) => {
          const isActive = highlightedKeywords.has(keyword.text);
          return (
            <li key={keyword.text}>
              <button
                className={`keyword-item ${isActive ? 'active' : ''}`}
                onClick={() => onToggleKeyword(keyword.text)}
              >
                <span className="keyword-item-text">{keyword.text}</span>
                <span className="keyword-item-count">{keyword.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
