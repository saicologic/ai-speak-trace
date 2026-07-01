import { useEffect, useState } from 'react';
import { summarizeTranscription, fetchSummaryLogs, fetchSummaryLog, fetchSummaryConfig } from '../api/client';
import type { SummaryConfig, TranscriptionSummaryLog, SummaryKeyPoint } from '../types';
import './InterviewPage.css';
import './SummaryPage.css';

interface Props {
  transcriptionId: string;
  onBack: () => void;
}

/** プロンプト指示フォームの各フィールド設定 */
interface PromptFieldConfig {
  key: 'overview' | 'key_points_topic' | 'key_points_summary' | 'decisions';
  /** JSONの親キー。サブフィールドは同じgroupKeyを持つ */
  groupKey: 'overview' | 'key_points' | 'decisions';
  label: string;
  subLabel?: string;
  defaultInstruction: string;
  instruction: string;
}

const DEFAULT_FIELDS: PromptFieldConfig[] = [
  {
    key: 'overview',
    groupKey: 'overview',
    label: '概要',
    defaultInstruction: '会話の目的・流れ・結果を第三者が読んで理解できるよう2〜3文でまとめる',
    instruction: '会話の目的・流れ・結果を第三者が読んで理解できるよう2〜3文でまとめる',
  },
  {
    key: 'key_points_topic',
    groupKey: 'key_points',
    label: 'キーポイント',
    subLabel: 'topic',
    defaultInstruction: '話題のテーマ名を名詞句で記述する',
    instruction: '話題のテーマ名を名詞句で記述する',
  },
  {
    key: 'key_points_summary',
    groupKey: 'key_points',
    label: 'キーポイント',
    subLabel: 'summary',
    defaultInstruction: '各トピックの要点を2〜3文で記述する',
    instruction: '各トピックの要点を2〜3文で記述する',
  },
  {
    key: 'decisions',
    groupKey: 'decisions',
    label: '決定事項',
    defaultInstruction: '会話中に明示的に合意・決定された事項を列挙する',
    instruction: '会話中に明示的に合意・決定された事項を列挙する',
  },
];

/** フィールド設定からプロンプトを生成（instructionが空のフィールドは除外） */
function buildPrompt(fields: PromptFieldConfig[]): string {
  const get = (key: PromptFieldConfig['key']) =>
    fields.find((f) => f.key === key)?.instruction.trim() ?? '';

  const lines: string[] = [];

  if (get('overview')) {
    lines.push(`  "overview": "${get('overview')}"`);
  }

  const kpTopic = get('key_points_topic');
  const kpSummary = get('key_points_summary');
  if (kpTopic || kpSummary) {
    lines.push(
      `  "key_points": [{\n    "topic": "${kpTopic || '（省略）'}",\n    "summary": "${kpSummary || '（省略）'}"\n  }]`,
    );
  }

  if (get('decisions')) {
    lines.push(`  "decisions": ["${get('decisions')}"]`);
  }

  const jsonShape = lines.join(',\n');

  return `あなたは会議・インタビューの文字起こしを要約するアシスタントです。

<conversation>
{{fullText}}
</conversation>

<instructions>
上記の会話を分析し、以下のJSON形式のみで出力してください。JSONの前後に説明文やコードブロック記号（\`\`\`）を含めないでください。

{
${jsonShape}
}
</instructions>`;
}

/** 要約ページ */
export function SummaryPage({ transcriptionId, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<'new' | 'logs'>('new');
  const [summarizing, setSummarizing] = useState(false);
  const [completedId, setCompletedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 設定（モデル一覧・デフォルトプロンプト）
  const [config, setConfig] = useState<SummaryConfig | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');

  // プロンプト指示フォーム
  const [fields, setFields] = useState<PromptFieldConfig[]>(DEFAULT_FIELDS);
  const [previewPrompt, setPreviewPrompt] = useState<string>(() =>
    buildPrompt(DEFAULT_FIELDS).replace('{{fullText}}', '（会話全文がここに入ります）'),
  );

  // 過去ログ
  const [logs, setLogs] = useState<TranscriptionSummaryLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [logDetail, setLogDetail] = useState<TranscriptionSummaryLog | null>(null);
  const [logDetailLoading, setLogDetailLoading] = useState(false);

  // 初期ロード: 設定取得
  useEffect(() => {
    fetchSummaryConfig()
      .then((c) => {
        setConfig(c);
        setSelectedModel(c.models[0]?.id ?? '');
      })
      .catch(() => {
        setError('設定の読み込みに失敗しました');
      });
  }, []);

  const handleFieldInstruction = (key: PromptFieldConfig['key'], value: string) => {
    setFields((prev) => prev.map((f) => (f.key === key ? { ...f, instruction: value } : { ...f })));
  };

  const handleResetFields = () => {
    setFields(DEFAULT_FIELDS.map((f) => ({ ...f })));
  };

  const isFieldsChanged = fields.some((f, i) => f.instruction !== DEFAULT_FIELDS[i].instruction);

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
    if (!selectedModel) return;
    const enabledCount = fields.filter((f) => f.instruction.trim() !== '').length;
    if (enabledCount === 0) return;

    setSummarizing(true);
    setCompletedId(null);
    setError(null);
    try {
      const prompt = buildPrompt(fields);
      const result = await summarizeTranscription(transcriptionId, selectedModel, prompt);
      setCompletedId(result.id);
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

  const enabledCount = fields.filter((f) => f.instruction.trim() !== '').length;

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
          onClick={() => { setActiveTab('new'); setCompletedId(null); }}
        >
          新規要約
        </button>
        <button
          className={`interview-tab ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          要約結果
        </button>
      </div>

      {activeTab === 'new' && (
        <div className="interview-content">
          {error && <div className="interview-error">{error}</div>}

          {/* モデル選択 */}
          <section className="interview-section">
            <h2>モデル</h2>
            {config ? (
              <select
                className="summary-model-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                {config.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
            ) : (
              <p className="interview-hint">読み込み中...</p>
            )}
          </section>

          {/* プロンプト */}
          <section className="interview-section">
            <div className="summary-prompt-header">
              <h2>プロンプト</h2>
              {isFieldsChanged && (
                <button
                  className="summary-reset-button"
                  onClick={handleResetFields}
                  title="デフォルトに戻す"
                >
                  デフォルトに戻す
                </button>
              )}
            </div>
            <p className="interview-hint">
              各項目の指示を編集できます。空にするとその項目は除外されます。
            </p>
            <div className="summary-fields-form">
              {/* overview */}
              <div className="summary-field-row">
                <span className="summary-field-label">概要</span>
                <input
                  type="text"
                  className="summary-field-instruction"
                  placeholder={fields.find((f) => f.key === 'overview')!.defaultInstruction}
                  value={fields.find((f) => f.key === 'overview')!.instruction}
                  onChange={(e) => handleFieldInstruction('overview', e.target.value)}
                />
              </div>

              {/* key_points（グループ） */}
              <div className="summary-field-group">
                <span className="summary-field-group-label">キーポイント</span>
                <div className="summary-field-group-rows">
                  {(['key_points_topic', 'key_points_summary'] as const).map((key) => {
                    const f = fields.find((f) => f.key === key)!;
                    return (
                      <div key={key} className="summary-field-subrow">
                        <span className="summary-field-sublabel">{f.subLabel}</span>
                        <input
                          type="text"
                          className="summary-field-instruction"
                          placeholder={f.defaultInstruction}
                          value={f.instruction}
                          onChange={(e) => handleFieldInstruction(key, e.target.value)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* decisions */}
              <div className="summary-field-row">
                <span className="summary-field-label">決定事項</span>
                <input
                  type="text"
                  className="summary-field-instruction"
                  placeholder={fields.find((f) => f.key === 'decisions')!.defaultInstruction}
                  value={fields.find((f) => f.key === 'decisions')!.instruction}
                  onChange={(e) => handleFieldInstruction('decisions', e.target.value)}
                />
              </div>

            </div>
            {enabledCount === 0 && (
              <div className="summary-prompt-warning">
                ⚠ 項目が1つも選択されていません
              </div>
            )}

            {/* 生成されるプロンプトのプレビュー */}
            <div className="summary-prompt-preview">
              <div className="summary-prompt-preview-header">
                <p className="summary-prompt-preview-label">Claudeへのインプット</p>
                <button
                  className="summary-prompt-update-button"
                  onClick={() =>
                    setPreviewPrompt(
                      enabledCount > 0
                        ? buildPrompt(fields).replace('{{fullText}}', '（会話全文がここに入ります）')
                        : '（項目がすべて空のためプロンプトは生成されません）',
                    )
                  }
                >
                  プロンプトを更新
                </button>
              </div>
              <pre className="summary-prompt-preview-content">{previewPrompt}</pre>
            </div>
          </section>

          {/* 実行ボタン */}
          <section className="interview-section">
            <div className="interview-actions">
              <button
                className="interview-button primary"
                onClick={handleSummarize}
                disabled={summarizing || !!completedId || !selectedModel || enabledCount === 0}
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

            {completedId && !summarizing && (
              <div className="summary-completed">
                <span className="summary-completed-message">✓ 要約が完了しました。</span>
                <button
                  className="summary-completed-link"
                  onClick={() => {
                    setActiveTab('logs');
                    handleSelectLog(completedId);
                  }}
                >
                  要約結果を見る →
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="interview-logs-layout">
          <div className="interview-logs-list">
            <div className="interview-logs-list-header">
              <span>要約結果</span>
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
              <div className="interview-logs-empty">要約結果がありません</div>
            ) : (
              logs.map((log) => (
                <button
                  key={log.id}
                  className={`interview-log-item ${selectedLogId === log.id ? 'selected' : ''}`}
                  onClick={() => handleSelectLog(log.id)}
                >
                  <div className="interview-log-item-date">{formatDate(log.createdAt)}</div>
                  <div className="interview-log-item-keywords">
                    {(log.key_points ?? []).slice(0, 2).map((kp) => kp.topic).join('・')}
                    {(log.key_points?.length ?? 0) > 2 && ` 他${(log.key_points?.length ?? 0) - 2}件`}
                  </div>
                  <div className="summary-log-model">{log.model}</div>
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
                    <span className="summary-log-model">{logDetail.model}</span>
                  </div>
                </div>
                <SummaryResult summary={logDetail} formatDate={formatDate} />
                <div className="summary-log-debug">
                  <div className="summary-log-debug-row">
                    <span className="summary-log-debug-label">モデル</span>
                    <code className="summary-log-debug-value">{logDetail.model}</code>
                  </div>
                  <div className="summary-log-debug-row">
                    <span className="summary-log-debug-label">プロンプト</span>
                    <pre className="summary-log-debug-prompt">{logDetail.prompt}</pre>
                  </div>
                </div>
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
      {summary.overview && (
        <div className="interview-result-card">
          <h3 className="result-question">概要</h3>
          <p className="summary-result-text">{summary.overview}</p>
        </div>
      )}

      {(summary.key_points?.length ?? 0) > 0 && (
        <div className="interview-result-card">
          <h3 className="result-question">キーポイント</h3>
          <ul className="summary-result-list summary-key-points">
            {summary.key_points?.map((kp: SummaryKeyPoint, i: number) => (
              <li key={i}>
                <span className="summary-key-point-topic">{kp.topic}</span>
                <span className="summary-key-point-summary">{kp.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(summary.decisions?.length ?? 0) > 0 && (
        <div className="interview-result-card">
          <h3 className="result-question">決定事項</h3>
          <ul className="summary-result-list">
            {summary.decisions?.map((decision: string, i: number) => (
              <li key={i}>{decision}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="summary-result-meta">
        生成日時: {formatDate(summary.createdAt)} / モデル: {summary.model}
      </div>
    </div>
  );
}
