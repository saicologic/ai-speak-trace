import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { marked } from 'marked';
import {
  fetchTranscriptions,
  fetchTranscription,
  fetchDocuments,
  uploadDocument,
  fetchDocumentStatus,
  deleteDocument,
  deepSearch,
  analyzeDeepSearchResults,
} from '../api/client';
import { extractKeywords } from '../utils/keywords';
import type {
  TranscriptionSummary,
  Keyword,
  DocumentInfo,
  DeepSearchResultItem,
  DeepSearchAnalysis,
} from '../types';
import './DeepSearchPage.css';

// markedの設定: リンクを新しいタブで開く
marked.use({
  renderer: {
    link({ href, text }) {
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

/** 流れの1段（会話・キーワード・検索ソース・統合分析） */
function FlowStep({
  number,
  title,
  status,
  onClick,
  children,
}: {
  number: number;
  title: string;
  status: 'done' | 'current' | 'todo';
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`deepsearch-flow-step ${status}`}
      onClick={onClick}
    >
      <span className="deepsearch-flow-step-title">
        <span className="deepsearch-step-number">{number}</span>
        {title}
      </span>
      <span className="deepsearch-flow-step-body">{children}</span>
    </button>
  );
}

interface Props {
  /** 初期選択する文字起こしID */
  initialTranscriptionId?: string;
  /** 初期キーワード */
  initialKeywords?: string[];
  /** 戻るボタンのコールバック */
  onBack: () => void;
}

/** ソースタイプの日本語表示 */
function sourceTypeLabel(type: string): string {
  switch (type) {
    case 'conversation':
      return '会話';
    case 'pdf':
      return '社内資料（PDF）';
    case 'web':
      return 'Web';
    default:
      return type;
  }
}

/** ディープサーチページ */
export function DeepSearchPage({
  initialTranscriptionId,
  initialKeywords = [],
  onBack,
}: Props) {
  // 会話選択
  const [transcriptions, setTranscriptions] = useState<TranscriptionSummary[]>(
    [],
  );
  const [selectedTranscriptionIds, setSelectedTranscriptionIds] = useState<
    Set<string>
  >(new Set(initialTranscriptionId ? [initialTranscriptionId] : []));

  // PDF管理
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [includePdfs, setIncludePdfs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // キーワード入力
  const [keywords, setKeywords] = useState<string[]>(initialKeywords);
  const [keywordInput, setKeywordInput] = useState('');

  // キーワードサジェスト（選択した会話から抽出）
  const [suggestedKeywords, setSuggestedKeywords] = useState<Keyword[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  // フェッチ済みのfullTextをキャッシュ
  const fullTextCacheRef = useRef<Map<string, string>>(new Map());

  // 検索オプション
  const [includeWeb, setIncludeWeb] = useState(true);

  // 検索結果
  const [results, setResults] = useState<DeepSearchResultItem[]>([]);
  // 検索ログID（分析結果を同じログに記録するために保持）
  const [searchId, setSearchId] = useState<string | undefined>(undefined);
  // 表示中の検索結果を得たときのキーワード（検索後にキーワードを変えても、分析は結果と同じ条件で行う）
  const [resultKeywords, setResultKeywords] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  // 分析
  const [analysis, setAnalysis] = useState<DeepSearchAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [error, setError] = useState<string | null>(null);

  /** 文字起こし一覧を取得 */
  useEffect(() => {
    fetchTranscriptions()
      .then(setTranscriptions)
      .catch(() => setTranscriptions([]));
  }, []);

  /** PDFドキュメント一覧を取得 */
  const loadDocuments = async () => {
    try {
      const result = await fetchDocuments();
      setDocuments(result);
    } catch {
      setDocuments([]);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  /** 処理中のドキュメントをポーリング */
  useEffect(() => {
    const processingDocs = documents.filter(
      (d) => d.status === 'processing',
    );
    if (processingDocs.length === 0) return;

    const interval = setInterval(async () => {
      for (const doc of processingDocs) {
        try {
          const updated = await fetchDocumentStatus(doc.id);
          setDocuments((prev) =>
            prev.map((d) => (d.id === updated.id ? updated : d)),
          );
        } catch {
          // ポーリング失敗は無視
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [documents]);

  /** 選択された会話からキーワードを抽出 */
  useEffect(() => {
    const ids = Array.from(selectedTranscriptionIds);
    if (ids.length === 0) {
      setSuggestedKeywords([]);
      return;
    }

    let cancelled = false;
    const loadKeywords = async () => {
      setLoadingSuggestions(true);
      try {
        // 未キャッシュのIDだけフェッチ
        const uncachedIds = ids.filter(
          (id) => !fullTextCacheRef.current.has(id),
        );
        await Promise.all(
          uncachedIds.map(async (id) => {
            const t = await fetchTranscription(id);
            fullTextCacheRef.current.set(id, t.fullText);
          }),
        );

        if (cancelled) return;

        // 選択された会話のテキストを結合してキーワード抽出
        const combinedText = ids
          .map((id) => fullTextCacheRef.current.get(id) ?? '')
          .join('\n');
        const extracted = extractKeywords(combinedText);
        setSuggestedKeywords(extracted.slice(0, 5));
      } catch {
        // 取得失敗時はサジェストを空にする
        if (!cancelled) setSuggestedKeywords([]);
      } finally {
        if (!cancelled) setLoadingSuggestions(false);
      }
    };

    loadKeywords();
    return () => {
      cancelled = true;
    };
  }, [selectedTranscriptionIds]);

  /** 会話の選択をトグル */
  const toggleTranscription = (id: string) => {
    setSelectedTranscriptionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /** 全選択/全解除 */
  const toggleAllTranscriptions = () => {
    if (selectedTranscriptionIds.size === transcriptions.length) {
      setSelectedTranscriptionIds(new Set());
    } else {
      setSelectedTranscriptionIds(
        new Set(transcriptions.map((t) => t.id)),
      );
    }
  };

  /** キーワードを追加 */
  const addKeyword = () => {
    const trimmed = keywordInput.trim();
    if (!trimmed || keywords.includes(trimmed)) return;
    setKeywords((prev) => [...prev, trimmed]);
    setKeywordInput('');
  };

  /** Enterキーでキーワード追加 */
  const handleKeywordKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword();
    }
  };

  /** キーワードを削除 */
  const removeKeyword = (keyword: string) => {
    setKeywords((prev) => prev.filter((k) => k !== keyword));
  };

  /** PDFアップロード */
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setUploadError(null);
      await uploadDocument(file);
      await loadDocuments();
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'アップロードに失敗しました',
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  /** PDF削除 */
  const handleDeleteDocument = async (id: string) => {
    try {
      setUploadError(null);
      await deleteDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : '削除に失敗しました',
      );
    }
  };

  /** 検索可能なPDFの件数 */
  const searchablePdfCount = documents.filter(
    (d) => d.status === 'searchable',
  ).length;

  /** 検索実行 */
  const handleSearch = async () => {
    if (keywords.length === 0) {
      setError('キーワードを入力してください');
      return;
    }
    if (selectedTranscriptionIds.size === 0 && !includePdfs && !includeWeb) {
      setError('検索対象を選択してください');
      return;
    }

    setSearching(true);
    setError(null);
    setAnalysis(null);
    try {
      const response = await deepSearch(
        keywords,
        Array.from(selectedTranscriptionIds),
        includePdfs,
        includeWeb,
      );
      setResults(response.results);
      setSearchId(response.id);
      setResultKeywords(keywords);
      setSearched(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : '検索に失敗しました',
      );
    } finally {
      setSearching(false);
    }
  };

  /** 結果をClaude分析 */
  const handleAnalyze = async () => {
    if (results.length === 0) return;

    setAnalyzing(true);
    setError(null);
    try {
      const response = await analyzeDeepSearchResults(
        resultKeywords,
        results.map((r) => ({
          sourceType: r.sourceType,
          sourceName: r.sourceName,
          text: r.text,
          url: r.url,
        })),
        searchId,
      );
      setAnalysis(response);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : '分析に失敗しました',
      );
    } finally {
      setAnalyzing(false);
    }
  };

  /** 結果をソースタイプごとにグループ化 */
  // 番号は分析APIに渡す順（results の並び）と同じで、分析の根拠番号 [n] に対応する
  const groupedResults = useMemo(() => {
    const groups: Record<
      string,
      { item: DeepSearchResultItem; number: number }[]
    > = {};
    results.forEach((item, i) => {
      if (!groups[item.sourceType]) {
        groups[item.sourceType] = [];
      }
      groups[item.sourceType].push({ item, number: i + 1 });
    });
    return groups;
  }, [results]);

  /** 分析結果のMarkdownをHTMLに変換し、根拠番号 [n] を検索結果へのリンクにする（メモ化） */
  const analysisHtml = useMemo(() => {
    if (!analysis) return '';
    const html = marked.parse(analysis.analysis) as string;
    return html.replace(/\[(\d+)\]/g, (match, num: string) => {
      const n = Number(num);
      const source = results[n - 1]?.sourceType;
      if (!source) return match;
      return `<a href="#deepsearch-result-${n}" class="deepsearch-cite ${source}" data-result="${n}" title="${sourceTypeLabel(source)}の検索結果 ${n}">[${n}]</a>`;
    });
  }, [analysis, results]);

  /** 分析で引用された根拠の件数（情報源ごと） */
  const citationCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!analysis) return counts;
    const cited = new Set(
      Array.from(analysis.analysis.matchAll(/\[(\d+)\]/g), (m) =>
        Number(m[1]),
      ),
    );
    for (const n of cited) {
      const source = results[n - 1]?.sourceType;
      if (source) counts[source] = (counts[source] ?? 0) + 1;
    }
    return counts;
  }, [analysis, results]);

  /** 根拠番号をクリックしたら、該当する検索結果までスクロールして強調する */
  const handleAnalysisClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-result]',
    );
    if (!target) return;
    e.preventDefault();
    const card = document.getElementById(
      `deepsearch-result-${target.dataset.result}`,
    );
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('highlighted');
    void card.offsetWidth;
    card.classList.add('highlighted');
  };

  /** 流れの各段階へスクロールする */
  const scrollToStep = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  // 検索ソースごとの状態（流れの表示用）
  const sourceStates = [
    { type: 'conversation', enabled: selectedTranscriptionIds.size > 0 },
    { type: 'pdf', enabled: includePdfs },
    { type: 'web', enabled: includeWeb },
  ];

  return (
    <div className="deepsearch-page">
      <header className="deepsearch-header">
        <button className="deepsearch-back-button" onClick={onBack}>
          ← 戻る
        </button>
        <h1>ディープサーチ</h1>
      </header>

      <div className="deepsearch-content">
        {error && <div className="deepsearch-error">{error}</div>}

        {/* データの流れ: 会話 → キーワード → 検索ソース → 統合分析 */}
        <nav className="deepsearch-flow" aria-label="ディープサーチの流れ">
          <FlowStep
            number={1}
            title="会話"
            status={selectedTranscriptionIds.size > 0 ? 'done' : 'current'}
            onClick={() => scrollToStep('deepsearch-step-conversation')}
          >
            {selectedTranscriptionIds.size > 0
              ? `${selectedTranscriptionIds.size}件を選択`
              : '会話を選択'}
          </FlowStep>
          <span className="deepsearch-flow-arrow" aria-hidden="true">
            →
          </span>
          <FlowStep
            number={2}
            title="キーワード"
            status={
              keywords.length > 0
                ? 'done'
                : selectedTranscriptionIds.size > 0
                  ? 'current'
                  : 'todo'
            }
            onClick={() => scrollToStep('deepsearch-step-keywords')}
          >
            {keywords.length > 0 ? (
              <>
                <span className="deepsearch-flow-keywords">
                  {keywords.join(' ＋ ')}
                </span>
                {keywords.length > 1 && (
                  <span className="deepsearch-flow-note">まとめて検索</span>
                )}
              </>
            ) : (
              '会話から選ぶ'
            )}
          </FlowStep>
          <span className="deepsearch-flow-arrow" aria-hidden="true">
            →
          </span>
          <FlowStep
            number={3}
            title="検索ソース"
            status={
              searched
                ? 'done'
                : searching || keywords.length > 0
                  ? 'current'
                  : 'todo'
            }
            onClick={() => scrollToStep('deepsearch-step-sources')}
          >
            <span className="deepsearch-flow-sources">
              {sourceStates.map((s) => (
                <span
                  key={s.type}
                  className={`deepsearch-flow-source ${s.type}${s.enabled ? '' : ' disabled'}`}
                >
                  {sourceTypeLabel(s.type)}
                  {searched && s.enabled && (
                    <span className="deepsearch-flow-count">
                      {groupedResults[s.type]?.length ?? 0}件
                    </span>
                  )}
                </span>
              ))}
            </span>
          </FlowStep>
          <span className="deepsearch-flow-arrow" aria-hidden="true">
            →
          </span>
          <FlowStep
            number={4}
            title="統合分析"
            status={
              analysis
                ? 'done'
                : analyzing || results.length > 0
                  ? 'current'
                  : 'todo'
            }
            onClick={() => scrollToStep('deepsearch-step-analysis')}
          >
            {analysis
              ? `根拠 ${Object.values(citationCounts).reduce((a, b) => a + b, 0)}件`
              : analyzing
                ? '分析中...'
                : '検索後に実行'}
          </FlowStep>
        </nav>

        {/* ① 会話選択 */}
        <section
          id="deepsearch-step-conversation"
          className="deepsearch-section"
        >
          <h2>
            <span className="deepsearch-step-number">1</span>
            検索の起点にする会話
          </h2>
          <p className="deepsearch-hint">
            検索する会話を選択してください（{selectedTranscriptionIds.size}件選択中）
          </p>
          {transcriptions.length > 0 && (
            <div className="deepsearch-transcription-list">
              <div className="deepsearch-transcription-header">
                <button
                  className="deepsearch-toggle-all"
                  onClick={toggleAllTranscriptions}
                >
                  {selectedTranscriptionIds.size === transcriptions.length
                    ? '全解除'
                    : '全選択'}
                </button>
              </div>
              {transcriptions.map((t) => (
                <label key={t.id} className="deepsearch-transcription-item">
                  <input
                    type="checkbox"
                    checked={selectedTranscriptionIds.has(t.id)}
                    onChange={() => toggleTranscription(t.id)}
                    disabled={searching || analyzing}
                  />
                  <div className="deepsearch-transcription-info">
                    <span className="deepsearch-transcription-name">
                      {t.audioFileName}
                    </span>
                    <span className="deepsearch-transcription-date">
                      {new Date(t.createdAt).toLocaleDateString('ja-JP')}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          )}
          {transcriptions.length === 0 && (
            <p className="deepsearch-empty">文字起こし履歴がありません</p>
          )}
        </section>

        {/* ② キーワード入力 */}
        <section id="deepsearch-step-keywords" className="deepsearch-section">
          <h2>
            <span className="deepsearch-step-number">2</span>
            検索キーワード
          </h2>
          <p className="deepsearch-hint">
            選んだ会話からキーワードの候補を出します。複数のキーワードはまとめて1つの検索として、③のすべての検索ソースを調べ、統合分析にもすべて使います
          </p>
          <div className="deepsearch-keyword-input">
            <input
              type="text"
              placeholder="キーワードを入力してEnter..."
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={handleKeywordKeyDown}
              disabled={searching || analyzing}
            />
            <button
              className="deepsearch-keyword-add"
              onClick={addKeyword}
              disabled={searching || analyzing || !keywordInput.trim()}
            >
              追加
            </button>
          </div>
          {keywords.length > 0 && (
            <div className="deepsearch-keyword-tags">
              {keywords.map((kw) => (
                <span key={kw} className="deepsearch-keyword-tag">
                  {kw}
                  <button
                    className="deepsearch-keyword-remove"
                    onClick={() => removeKeyword(kw)}
                    disabled={searching || analyzing}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* キーワードサジェスト */}
          {loadingSuggestions && (
            <p className="deepsearch-hint">キーワードを抽出中...</p>
          )}
          {!loadingSuggestions && suggestedKeywords.length > 0 && (
            <div className="deepsearch-suggestions">
              <span className="deepsearch-suggestions-label">候補:</span>
              {suggestedKeywords
                .filter((kw) => !keywords.includes(kw.text))
                .map((kw) => (
                  <button
                    key={kw.text}
                    className="deepsearch-suggestion-chip"
                    onClick={() =>
                      setKeywords((prev) => [...prev, kw.text])
                    }
                    disabled={searching || analyzing}
                    title={`出現回数: ${kw.count}`}
                  >
                    + {kw.text}
                    <span className="deepsearch-suggestion-count">
                      {kw.count}
                    </span>
                  </button>
                ))}
            </div>
          )}
        </section>

        {/* ③ 検索ソース */}
        <section id="deepsearch-step-sources" className="deepsearch-section">
          <h2>
            <span className="deepsearch-step-number">3</span>
            検索ソース
          </h2>
          <div className="deepsearch-source-cards">
            <div
              className={`deepsearch-source-card conversation${selectedTranscriptionIds.size > 0 ? '' : ' disabled'}`}
            >
              <div className="deepsearch-source-card-header">
                <span className="deepsearch-source-badge conversation">
                  会話
                </span>
                <span className="deepsearch-source-card-detail">
                  ①で選んだ{selectedTranscriptionIds.size}件
                </span>
              </div>
              <p className="deepsearch-source-card-text">
                会話の中から、キーワードに関連する発言を関連度順に探します
              </p>
            </div>
            <div
              className={`deepsearch-source-card web${includeWeb ? '' : ' disabled'}`}
            >
              <label className="deepsearch-source-card-header">
                <input
                  type="checkbox"
                  checked={includeWeb}
                  onChange={(e) => setIncludeWeb(e.target.checked)}
                  disabled={searching || analyzing}
                />
                <span className="deepsearch-source-badge web">Web</span>
              </label>
              <p className="deepsearch-source-card-text">
                インターネットの記事を検索し、引用された本文を根拠にします
              </p>
            </div>
          </div>

          <div
            className={`deepsearch-source-card pdf deepsearch-source-card-wide${includePdfs ? '' : ' disabled'}`}
          >
            <div className="deepsearch-pdf-header">
              <label className="deepsearch-source-card-header">
                <input
                  type="checkbox"
                  checked={includePdfs}
                  onChange={(e) => setIncludePdfs(e.target.checked)}
                  disabled={searching || analyzing}
                />
                <span className="deepsearch-source-badge pdf">
                  社内資料（PDF）
                </span>
                <span className="deepsearch-source-card-detail">
                  {searchablePdfCount}件検索可能
                </span>
              </label>
            </div>

          {includePdfs && (
            <div className="deepsearch-pdf-content">
              <div className="deepsearch-pdf-upload">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleUpload}
                  disabled={uploading || searching || analyzing}
                  hidden
                />
                <button
                  className="deepsearch-pdf-upload-button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || searching || analyzing}
                >
                  {uploading ? 'アップロード中...' : 'PDFをアップロード'}
                </button>
                <button
                  className="deepsearch-pdf-reload-button"
                  onClick={loadDocuments}
                  disabled={uploading || searching || analyzing}
                >
                  更新
                </button>
              </div>

              {uploadError && (
                <div className="deepsearch-pdf-error">{uploadError}</div>
              )}

              {documents.length > 0 ? (
                <div className="deepsearch-pdf-list">
                  {documents.map((doc) => (
                    <div key={doc.id} className="deepsearch-pdf-item">
                      <div className="deepsearch-pdf-info">
                        <span
                          className="deepsearch-pdf-name"
                          title={doc.fileName}
                        >
                          {doc.fileName}
                        </span>
                        <span
                          className={`deepsearch-pdf-status deepsearch-pdf-status-${doc.status}`}
                        >
                          {doc.status === 'uploading' && 'アップロード中'}
                          {doc.status === 'processing' && '処理中'}
                          {doc.status === 'searchable' && '検索可能'}
                          {doc.status === 'error' && 'エラー'}
                        </span>
                      </div>
                      <button
                        className="deepsearch-pdf-delete"
                        onClick={() => handleDeleteDocument(doc.id)}
                        title="削除"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="deepsearch-empty">
                  PDFがありません。アップロードしてください。
                </p>
              )}
            </div>
          )}
          </div>
        </section>

        {/* 検索ボタン */}
        <div className="deepsearch-actions">
          <button
            className="deepsearch-button primary"
            onClick={handleSearch}
            disabled={searching || analyzing || keywords.length === 0}
          >
            {searching ? '検索中...' : '検索する'}
          </button>
        </div>

        {/* ローディング */}
        {searching && (
          <div className="deepsearch-loading">
            <div className="loading-spinner" />
            <p>複数ソースから検索中...</p>
            <p className="deepsearch-loading-hint">
              検索対象によって数秒〜数十秒かかる場合があります
            </p>
          </div>
        )}

        {/* 検索結果 */}
        {searched && !searching && (
          <section className="deepsearch-section">
            <h2>検索結果（{results.length}件）</h2>

            {results.length === 0 && (
              <p className="deepsearch-empty">
                該当する結果が見つかりませんでした
              </p>
            )}

            <p className="deepsearch-hint">
              番号は統合分析の根拠番号 [n] に対応しています
            </p>
            {Object.entries(groupedResults).map(([sourceType, items]) => (
              <div key={sourceType} className="deepsearch-result-group">
                <h3 className="deepsearch-result-group-title">
                  <span
                    className={`deepsearch-source-badge ${sourceType}`}
                  >
                    {sourceTypeLabel(sourceType)}
                  </span>
                  <span className="deepsearch-result-group-count">
                    {items.length}件
                  </span>
                </h3>
                <div className="deepsearch-result-items">
                  {items.map(({ item, number }) => (
                    <div
                      key={number}
                      id={`deepsearch-result-${number}`}
                      className={`deepsearch-result-card ${sourceType}`}
                    >
                      <div className="deepsearch-result-header">
                        <span
                          className={`deepsearch-result-number ${sourceType}`}
                        >
                          [{number}]
                        </span>
                        <span className="deepsearch-result-source">
                          {item.sourceName}
                        </span>
                        {item.speakerName && (
                          <span className="deepsearch-result-speaker">
                            {item.speakerName}
                          </span>
                        )}
                        {item.score !== undefined && (
                          <span className="deepsearch-result-score">
                            関連度: {(item.score * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <p className="deepsearch-result-text">{item.text}</p>
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="deepsearch-result-url"
                        >
                          {item.url}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* 分析ボタン */}
            {results.length > 0 && !analysis && (
              <div className="deepsearch-actions">
                <button
                  className="deepsearch-button primary"
                  onClick={handleAnalyze}
                  disabled={analyzing}
                >
                  {analyzing
                    ? '分析中...'
                    : `Claudeで分析する（${results.length}件）`}
                </button>
              </div>
            )}
          </section>
        )}

        {/* 分析ローディング */}
        {analyzing && (
          <div className="deepsearch-loading">
            <div className="loading-spinner" />
            <p>Claudeが検索結果を分析中...</p>
            <p className="deepsearch-loading-hint">
              結果量に応じて数十秒〜数分かかる場合があります
            </p>
          </div>
        )}

        {/* 分析結果 */}
        <div id="deepsearch-step-analysis" />
        {analysis && !analyzing && (
          <section className="deepsearch-section">
            <h2>
              <span className="deepsearch-step-number">4</span>
              統合分析
            </h2>
            <div className="deepsearch-citation-summary">
              <span>根拠に使われた検索結果:</span>
              {Object.keys(groupedResults).map((type) => (
                <span key={type} className={`deepsearch-source-badge ${type}`}>
                  {sourceTypeLabel(type)} {citationCounts[type] ?? 0}件
                </span>
              ))}
            </div>
            <div className="deepsearch-analysis-card">
              <div
                className="deepsearch-analysis-content"
                onClick={handleAnalysisClick}
                dangerouslySetInnerHTML={{ __html: analysisHtml }}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
