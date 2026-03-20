import { useEffect, useMemo, useRef, useState } from 'react';
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
      return 'PDF';
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
        keywords,
        results.map((r) => ({
          sourceType: r.sourceType,
          sourceName: r.sourceName,
          text: r.text,
          url: r.url,
        })),
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
  const groupedResults = useMemo(() => {
    const groups: Record<string, DeepSearchResultItem[]> = {};
    for (const result of results) {
      if (!groups[result.sourceType]) {
        groups[result.sourceType] = [];
      }
      groups[result.sourceType].push(result);
    }
    return groups;
  }, [results]);

  /** 分析結果のMarkdownをHTMLに変換（メモ化） */
  const analysisHtml = useMemo(() => {
    if (!analysis) return '';
    return marked.parse(analysis.analysis) as string;
  }, [analysis]);

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

        {/* 会話選択 */}
        <section className="deepsearch-section">
          <h2>検索対象の会話</h2>
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

        {/* キーワード入力 */}
        <section className="deepsearch-section">
          <h2>検索キーワード</h2>
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

        {/* PDFドキュメント */}
        <section className="deepsearch-section">
          <div className="deepsearch-pdf-header">
            <label className="deepsearch-option">
              <input
                type="checkbox"
                checked={includePdfs}
                onChange={(e) => setIncludePdfs(e.target.checked)}
                disabled={searching || analyzing}
              />
              <h2>PDFドキュメント</h2>
              {searchablePdfCount > 0 && (
                <span className="deepsearch-option-badge pdf">
                  {searchablePdfCount}件検索可能
                </span>
              )}
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
        </section>

        {/* 検索オプション */}
        <section className="deepsearch-section">
          <h2>その他の検索ソース</h2>
          <div className="deepsearch-options">
            <label className="deepsearch-option">
              <input
                type="checkbox"
                checked={includeWeb}
                onChange={(e) => setIncludeWeb(e.target.checked)}
                disabled={searching || analyzing}
              />
              <span>Web検索</span>
            </label>
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
                  {items.map((item, i) => (
                    <div key={i} className="deepsearch-result-card">
                      <div className="deepsearch-result-header">
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
        {analysis && !analyzing && (
          <section className="deepsearch-section">
            <h2>分析結果</h2>
            <div className="deepsearch-analysis-card">
              <div
                className="deepsearch-analysis-content"
                dangerouslySetInnerHTML={{ __html: analysisHtml }}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
