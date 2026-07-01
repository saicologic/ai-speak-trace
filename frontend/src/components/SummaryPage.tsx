import { useEffect, useState } from 'react';
import { summarizeTranscription, fetchSummaryLogs, fetchSummaryLog } from '../api/client';
import type { TranscriptionSummaryLog } from '../types';
import './InterviewPage.css';

interface Props {
  transcriptionId: string;
  onBack: () => void;
}

/** 要約ページ */
export function SummaryPage({ transcriptionId, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<'new' | 'logs'>('new');
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<TranscriptionSummaryLog | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [logs, setLogs] = useState<TranscriptionSummaryLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [logDetail, setLogDetail] = useState<TranscriptionSummaryLog | null>(null);
  const [logDetailLoading, setLogDetailLoading] = useState(false);

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const all = await fetchSummaryLogs();
      const filtered = all
        .filter((l) => l.transcriptionId === transcriptionId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setLogs(filtered);
    } catch {
      // ログ取得失敗は無視
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'logs') {
      loadLogs();
    }
  }, [activeTab]);

  const handleSelectLog = async (id: string) => {
    setSelectedLogId(id);
    setLogDetail(null);
    setLogDetailLoading(true);
    try {
      const detail = await fetchSummaryLog(id);
      setLogDetail(detail);
    } catch {
      setLogDetail(null);
    } finally {
      setLogDetailLoading(false);
    }
  };

  const handleSummarize = async () => {
    setSummarizing(true);
    setError(null);
    try {
      const result = await summarizeTranscription(transcriptionId);
      setSummary(result);
      loadLogs();
    } catch (e) {
      setError(e instanceof Error ? e.message : '要約に失敗しました');
    } finally {
      setSummarizing(false);
    }
  };

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
        <h1>要約</h1>
      </header>

      <div className="interview-tabs">
        <button
          className={`interview-tab ${activeTab === 'new' ? 'active' : ''}`}
          onClick={() => setActiveTab('new')}
        >
          新規要約
        </button>
        <button
          className={`interview-tab ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          過去の要約ログ
        </button>
      </div>

      {activeTab === 'new' && (
        <div className="interview-content">
          {error && <div className="interview-error">{error}</div>}

          <section className="interview-section">
            <div className="interview-actions">
              <button
                className="interview-button primary"
                onClick={handleSummarize}
                disabled={summarizing}
              >
                {summarizing ? '要約中...' : '要約する'}
              </button>
            </div>

            {summarizing && (
              <div className="interview-loading">
                <div className="loading-spinner" />
                <p>Claude が会話を要約中...</p>
              </div>
            )}

            {summary && !summarizing && <SummaryResult summary={summary} formatDate={formatDate} />}
          </section>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="interview-logs-layout">
          <div className="interview-logs-list">
            <div className="interview-logs-list-header">
              <span>要約履歴</span>
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
              <div className="interview-logs-empty">過去の要約結果がありません</div>
            ) : (
              logs.map((log) => (
                <button
                  key={log.id}
                  className={`interview-log-item ${selectedLogId === log.id ? 'selected' : ''}`}
                  onClick={() => handleSelectLog(log.id)}
                >
                  <div className="interview-log-item-date">{formatDate(log.createdAt)}</div>
                  <div className="interview-log-item-keywords">
                    {log.topics.slice(0, 2).join('・')}
                    {log.topics.length > 2 && ` 他${log.topics.length - 2}件`}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="interview-logs-detail">
            {!selectedLogId && (
              <div className="interview-logs-detail-empty">
                左の一覧から要約結果を選択してください
              </div>
            )}
            {selectedLogId && logDetailLoading && (
              <div className="interview-logs-detail-empty">読み込み中...</div>
            )}
            {selectedLogId && !logDetailLoading && logDetail && (
              <>
                <div className="interview-logs-detail-header">
                  <div className="interview-logs-detail-meta">
                    <span className="interview-logs-detail-date">
                      {formatDate(logDetail.createdAt)}
                    </span>
                  </div>
                </div>
                <SummaryResult summary={logDetail} formatDate={formatDate} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 要約結果表示（新規・過去ログ共通） */
function SummaryResult({
  summary,
  formatDate,
}: {
  summary: TranscriptionSummaryLog;
  formatDate: (iso: string) => string;
}) {
  return (
    <div className="interview-results">
      <div className="interview-result-card">
        <h3 className="result-question">主なトピック</h3>
        <ul style={{ paddingLeft: '1.25rem', margin: '0.5rem 0' }}>
          {summary.topics.map((topic, i) => (
            <li key={i} style={{ marginBottom: '0.25rem' }}>{topic}</li>
          ))}
        </ul>
      </div>

      <div className="interview-result-card">
        <h3 className="result-question">結論・合意事項</h3>
        <p style={{ margin: '0.5rem 0', lineHeight: 1.7 }}>{summary.conclusion}</p>
      </div>

      {summary.actions.length > 0 && (
        <div className="interview-result-card">
          <h3 className="result-question">次のアクション</h3>
          <ul style={{ paddingLeft: '1.25rem', margin: '0.5rem 0' }}>
            {summary.actions.map((action, i) => (
              <li key={i} style={{ marginBottom: '0.25rem' }}>{action}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.5rem' }}>
        生成日時: {formatDate(summary.createdAt)}
      </div>
    </div>
  );
}
