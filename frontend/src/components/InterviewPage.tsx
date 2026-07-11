import { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import { generateQuestions, analyzeInterview, fetchAnalysisLogs, fetchAnalysisLog } from '../api/client';
import { extractKeywords } from '../utils/keywords';
import type { InterviewAnalysis, InterviewAnalysisSummary, Speaker, Utterance } from '../types';
import './InterviewPage.css';

// markedの設定: リンクを新しいタブで開く
marked.use({
  renderer: {
    link({ href, text }) {
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

interface QuestionItem {
  text: string;
  checked: boolean;
}

interface Props {
  transcriptionId: string;
  speakers: Speaker[];
  utterances: Utterance[];
  onBack: () => void;
}

/** 会話分析ページ */
export function InterviewPage({
  transcriptionId,
  speakers,
  utterances,
  onBack,
}: Props) {
  const [selectedSpeakerId, setSelectedSpeakerId] = useState(
    speakers[0]?.id ?? '',
  );
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(
    new Set(),
  );
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [analysis, setAnalysis] = useState<InterviewAnalysis | null>(null);
  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 過去ログ関連の状態
  const [logs, setLogs] = useState<InterviewAnalysisSummary[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [logDetail, setLogDetail] = useState<InterviewAnalysis | null>(null);
  const [logDetailLoading, setLogDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'new' | 'logs'>('new');

  /** 過去ログを取得（現在の文字起こしに絞り込み、最新順） */
  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const result = await fetchAnalysisLogs();
      const filtered = result
        .filter((l) => l.transcriptionId === transcriptionId)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      setLogs(filtered);
    } catch {
      // ログ取得失敗は無視（初回は空）
    } finally {
      setLogsLoading(false);
    }
  };

  // タブ切り替え時にログを読み込む
  useEffect(() => {
    if (activeTab === 'logs') {
      loadLogs();
    }
  }, [activeTab]);

  /** ログ詳細を表示 */
  const handleSelectLog = async (id: string) => {
    setSelectedLogId(id);
    setLogDetail(null);
    setLogDetailLoading(true);
    try {
      const detail = await fetchAnalysisLog(id);
      setLogDetail(detail);
    } catch {
      setLogDetail(null);
    } finally {
      setLogDetailLoading(false);
    }
  };

  /** 選択中の話者の発話テキストからキーワードを抽出（メモ化） */
  const keywords = useMemo(() => {
    const speakerText = utterances
      .filter((u) => u.speakerId === selectedSpeakerId)
      .map((u) => u.text)
      .join('\n');
    return extractKeywords(speakerText);
  }, [utterances, selectedSpeakerId]);

  /** 話者を変更したときにキーワード選択・質問をリセット */
  const handleSpeakerChange = (speakerId: string) => {
    setSelectedSpeakerId(speakerId);
    setSelectedKeywords(new Set());
    setQuestions([]);
    setError(null);
  };

  /** キーワードの選択をトグル */
  const toggleKeyword = (text: string) => {
    setSelectedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(text)) {
        next.delete(text);
      } else {
        next.add(text);
      }
      return next;
    });
  };

  // 選択中のキーワードを配列として取得
  const activeKeywords = keywords
    .filter((kw) => selectedKeywords.has(kw.text))
    .map((kw) => kw.text);

  // 選択キーワードを含む発話を抽出して会話の文脈を組み立てる
  const conversationContext = useMemo(() => {
    if (activeKeywords.length === 0) return undefined;
    const relevantUtterances = utterances.filter(
      (u) =>
        u.speakerId === selectedSpeakerId &&
        activeKeywords.some((kw) => u.text.includes(kw)),
    );
    if (relevantUtterances.length === 0) return undefined;
    return relevantUtterances.map((u) => `${u.speakerName}: ${u.text}`).join('\n');
  }, [utterances, selectedSpeakerId, activeKeywords]);

  // チェック済み質問数
  const checkedCount = questions.filter((q) => q.checked).length;

  /** 質問のチェックをトグル */
  const toggleQuestion = (index: number) => {
    setQuestions((prev) =>
      prev.map((q, i) => (i === index ? { ...q, checked: !q.checked } : q)),
    );
  };

  /** 全選択 / 全解除 */
  const toggleAllQuestions = () => {
    const allChecked = questions.every((q) => q.checked);
    setQuestions((prev) => prev.map((q) => ({ ...q, checked: !allChecked })));
  };

  /** 質問文を自動生成 */
  const handleGenerateQuestions = async () => {
    if (activeKeywords.length === 0) {
      setError('キーワードを選択してください');
      return;
    }
    setGeneratingQuestions(true);
    setError(null);
    try {
      const result = await generateQuestions(
        transcriptionId,
        selectedSpeakerId,
        activeKeywords,
        conversationContext,
      );
      setQuestions(result.map((text) => ({ text, checked: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : '質問生成に失敗しました');
    } finally {
      setGeneratingQuestions(false);
    }
  };

  /** 分析を実行 */
  const handleAnalyze = async () => {
    const checkedQuestions = questions
      .filter((q) => q.checked)
      .map((q) => q.text);

    if (checkedQuestions.length === 0) {
      setError('分析する質問を選択してください');
      return;
    }

    setAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeInterview(
        transcriptionId,
        selectedSpeakerId,
        activeKeywords,
        checkedQuestions,
        conversationContext,
      );
      setAnalysis(result);
      // 分析完了後にログ一覧を更新（新規タブに戻った場合用）
      loadLogs();
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析に失敗しました');
    } finally {
      setAnalyzing(false);
    }
  };

  const selectedSpeaker = speakers.find((s) => s.id === selectedSpeakerId);

  /** 分析結果のMarkdownをHTMLに変換（メモ化） */
  const renderedResults = useMemo(() => {
    if (!analysis) return [];
    return analysis.results.map((result) => ({
      ...result,
      answerHtml: marked.parse(result.answer) as string,
    }));
  }, [analysis]);

  /** ログ詳細のMarkdownをHTMLに変換（メモ化） */
  const renderedLogResults = useMemo(() => {
    if (!logDetail) return [];
    return logDetail.results.map((result) => ({
      ...result,
      answerHtml: marked.parse(result.answer) as string,
    }));
  }, [logDetail]);

  /** 日時を表示用にフォーマット */
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="interview-page">
      <header className="interview-header">
        <button className="interview-back-button" onClick={onBack}>
          ← 戻る
        </button>
        <h1>会話分析</h1>
      </header>

      {/* タブ切り替え */}
      <div className="interview-tabs">
        <button
          className={`interview-tab ${activeTab === 'new' ? 'active' : ''}`}
          onClick={() => setActiveTab('new')}
        >
          新規分析
        </button>
        <button
          className={`interview-tab ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          過去の分析ログ
        </button>
      </div>

      {/* 新規分析タブ */}
      {activeTab === 'new' && (
        <div className="interview-content">
          {error && <div className="interview-error">{error}</div>}

          {/* 話者選択 */}
          <section className="interview-section">
            <h2>話者を選択</h2>
            <select
              className="interview-select"
              value={selectedSpeakerId}
              onChange={(e) => handleSpeakerChange(e.target.value)}
            >
              {speakers.map((speaker) => (
                <option key={speaker.id} value={speaker.id}>
                  {speaker.name}
                </option>
              ))}
            </select>
          </section>

          {/* キーワード選択 */}
          <section className="interview-section">
            <h2>分析キーワード</h2>
            <p className="interview-hint">
              クリックでキーワードを選択（{selectedKeywords.size}件選択中）
            </p>
            <div className="interview-keywords">
              {keywords.map((kw) => (
                <button
                  key={kw.text}
                  className={`interview-keyword-tag ${selectedKeywords.has(kw.text) ? 'selected' : ''}`}
                  onClick={() => toggleKeyword(kw.text)}
                >
                  {kw.text}
                </button>
              ))}
            </div>
          </section>

          {/* 質問生成・選択 */}
          <section className="interview-section">
            <h2>調査質問</h2>
            <div className="interview-actions">
              <button
                className="interview-button secondary"
                onClick={handleGenerateQuestions}
                disabled={generatingQuestions || analyzing || activeKeywords.length === 0}
              >
                {generatingQuestions ? '生成中...' : '質問を生成'}
              </button>
            </div>

            {questions.length > 0 && (
              <div className="question-list">
                <div className="question-list-header">
                  <button
                    className="question-toggle-all"
                    onClick={toggleAllQuestions}
                  >
                    {questions.every((q) => q.checked) ? '全解除' : '全選択'}
                  </button>
                  <span className="question-list-count">
                    {checkedCount}/{questions.length}件 選択中
                  </span>
                </div>
                {questions.map((q, i) => (
                  <label key={i} className="question-checkbox-item">
                    <input
                      type="checkbox"
                      checked={q.checked}
                      onChange={() => toggleQuestion(i)}
                      disabled={analyzing}
                    />
                    <span className="question-checkbox-text">{q.text}</span>
                  </label>
                ))}
              </div>
            )}

            {questions.length > 0 && (
              <div className="interview-actions">
                <button
                  className="interview-button primary"
                  onClick={handleAnalyze}
                  disabled={analyzing || generatingQuestions || checkedCount === 0}
                >
                  {analyzing ? '分析中...' : `分析する（${checkedCount}件）`}
                </button>
              </div>
            )}
          </section>

          {/* ローディング */}
          {analyzing && (
            <div className="interview-loading">
              <div className="loading-spinner" />
              <p>Claude がWeb検索しながら分析中...</p>
              <p className="interview-loading-hint">
                質問数に応じて数十秒〜数分かかる場合があります
              </p>
            </div>
          )}

          {/* 分析結果 */}
          {analysis && !analyzing && (
            <section className="interview-section">
              <h2>
                分析結果 —{' '}
                <span style={{ color: selectedSpeaker?.color }}>
                  {analysis.speakerName}
                </span>
              </h2>
              <AnalysisResultList results={renderedResults} />
            </section>
          )}
        </div>
      )}

      {/* 過去ログタブ */}
      {activeTab === 'logs' && (
        <div className="interview-logs-layout">
          {/* ログ一覧 */}
          <div className="interview-logs-list">
            <div className="interview-logs-list-header">
              <span>分析履歴</span>
              <button
                className="interview-logs-refresh"
                onClick={loadLogs}
                disabled={logsLoading}
                title="更新"
              >
                ↻
              </button>
            </div>
            {logsLoading ? (
              <div className="interview-logs-empty">読み込み中...</div>
            ) : logs.length === 0 ? (
              <div className="interview-logs-empty">
                過去の分析結果がありません
              </div>
            ) : (
              logs.map((log) => (
                <button
                  key={log.id}
                  className={`interview-log-item ${selectedLogId === log.id ? 'selected' : ''}`}
                  onClick={() => handleSelectLog(log.id)}
                >
                  <div className="interview-log-item-speaker">
                    {log.speakerName}
                  </div>
                  <div className="interview-log-item-keywords">
                    {log.keywords.slice(0, 3).join('・')}
                    {log.keywords.length > 3 && ` 他${log.keywords.length - 3}件`}
                  </div>
                  <div className="interview-log-item-date">
                    {formatDate(log.createdAt)}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* ログ詳細 */}
          <div className="interview-logs-detail">
            {!selectedLogId && (
              <div className="interview-logs-detail-empty">
                左の一覧から分析結果を選択してください
              </div>
            )}
            {selectedLogId && logDetailLoading && (
              <div className="interview-logs-detail-empty">読み込み中...</div>
            )}
            {selectedLogId && !logDetailLoading && logDetail && (
              <>
                <div className="interview-logs-detail-header">
                  <div className="interview-logs-detail-meta">
                    <span className="interview-logs-detail-speaker">
                      {logDetail.speakerName}
                    </span>
                    <span className="interview-logs-detail-date">
                      {formatDate(logDetail.createdAt)}
                    </span>
                  </div>
                  <div className="interview-logs-detail-keywords">
                    {logDetail.keywords.map((kw) => (
                      <span key={kw} className="interview-logs-keyword-tag">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
                <AnalysisResultList results={renderedLogResults} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 分析結果カードリスト（新規・過去ログ共通） */
function AnalysisResultList({
  results,
}: {
  results: { question: string; answerHtml: string; sources: { title: string; url: string }[] }[];
}) {
  return (
    <div className="interview-results">
      {results.map((result, i) => (
        <div key={i} className="interview-result-card">
          <h3 className="result-question">
            Q{i + 1}: {result.question}
          </h3>
          <div
            className="result-answer"
            dangerouslySetInnerHTML={{ __html: result.answerHtml }}
          />
          {result.sources.length > 0 && (
            <div className="result-sources">
              <span className="result-sources-label">出典:</span>
              {result.sources.map((source, j) => (
                <a
                  key={j}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="result-source-link"
                >
                  {source.title}
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
