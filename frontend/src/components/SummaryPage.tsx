import { useEffect, useState } from 'react';
import { FeedbackButton } from './FeedbackButton';
import { summarizeTranscription, fetchSummaryLogs, fetchSummaryLog, fetchSummaryConfig } from '../api/client';
import type {
  SummaryConfig,
  SummaryEvidence,
  TranscriptionSummaryLog,
  SummaryKeyPoint,
} from '../types';
import { AiGeneratedNotice } from './AiGeneratedNotice';
import { useGuardrailConfigured } from '../hooks/usePrivacyStatuses';
import { GuardrailMissingNotice } from './PrivacyPanel';
import { PageLayout } from './PageLayout';
import {
  actionsClass,
  completedClass,
  completedLinkClass,
  completedMessageClass,
  logItemModelClass,
  backButtonClass,
  contentClass,
  errorClass,
  headerClass,
  hintClass,
  loadingClass,
  loadingSpinnerClass,
  loadingTextClass,
  logItemClassOf,
  logItemDateClass,
  logItemKeywordsClass,
  logsDetailClass,
  logsDetailDateClass,
  logsDetailEmptyClass,
  logsDetailHeaderClass,
  logsDetailMetaClass,
  logsEmptyClass,
  logsLayoutClass,
  logsListClass,
  logsListHeaderClass,
  logsRefreshClass,
  pageClass,
  primaryButtonClass,
  resultCardClass,
  resultQuestionClass,
  resultsClass,
  sectionClass,
  sectionHeadingClass,
  tabClassOf,
  tabsClass,
  titleClass,
} from './interviewPageClasses';

interface Props {
  transcriptionId: string;
  onBack: () => void;
  /** 根拠の発言を、元の文字起こしで開く */
  onOpenUtterance?: (utteranceIndex: number) => void;
}

/** プロンプト・記録の等幅の字体 */
const monoClass = "[font-family:ui-monospace,SFMono-Regular,'SF_Mono',Consolas,monospace]";
/** 指示の入力欄（カードの直下に置くときは左右をあけ、項目名と並べるときは幅いっぱいにする） */
const instructionClass =
  'rounded-md border border-blue-100 bg-white px-[0.6rem] py-[0.4rem] text-[0.82rem] text-gray-700 transition-colors duration-150 placeholder:text-gray-400 focus:border-primary focus:shadow-[0_0_0_2px] focus:shadow-blue-500/15 focus:outline-none';
const cardInstructionClass = `${instructionClass} mx-3 my-[0.4rem] w-[calc(100%-1.5rem)]`;
const subrowInstructionClass = `${instructionClass} w-full`;
/** 指示のカードと、その項目名 */
const fieldCardClass = 'overflow-hidden rounded-lg border border-gray-200 bg-white';
const fieldCardLabelClass = 'block border-b border-gray-100 px-3 pt-2 pb-[0.3rem] text-md font-medium text-gray-700';
/** 白い地に灰色の枠の小さいボタン：カーソルを乗せると灰色にする */
const smallButtonClass = 'rounded-md border border-gray-300 bg-white transition-all duration-150 hover:border-gray-400 hover:bg-gray-100';
/** 長い文を、等幅の字体で折り返して出す（プロンプトのプレビュー・記録） */
const preformattedClass = `text-[0.78rem] leading-[1.6] [word-break:break-word] whitespace-pre-wrap text-gray-700 ${monoClass}`;

/** 要約の結果のリスト（キーポイント・決定事項）と、その項目の文字 */
const resultListClass = 'm-0 flex flex-col gap-[0.3rem] pl-5';
const resultItemTextClass = 'text-base leading-[1.6] text-gray-700';
/** 根拠のリンクと、リンクにしない根拠 */
const evidenceLinkClass = 'cursor-pointer border-none bg-transparent p-0 text-xs text-blue-700 underline';
const evidenceNoteClass = 'text-xs text-gray-400';

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

/** 要点の根拠の指示（会話にあることをバックエンドで確かめ、確かめられた引用だけを根拠として表示する） */
const EVIDENCE_INSTRUCTION =
  '要点の根拠になる発言を、会話から一字一句そのまま1〜2個抜き出す（各10〜60文字）';

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
      `  "key_points": [{\n    "topic": "${kpTopic || '（省略）'}",\n    "summary": "${kpSummary || '（省略）'}",\n    "evidence": ["${EVIDENCE_INSTRUCTION}"]\n  }]`,
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
export function SummaryPage({ transcriptionId, onBack, onOpenUtterance }: Props) {
  const [activeTab, setActiveTab] = useState<'new' | 'logs'>('new');
  const [summarizing, setSummarizing] = useState(false);
  const [completedId, setCompletedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guardrail ID が未設定なら Claude に送れないため、要約を実行しない
  const guardrailConfigured = useGuardrailConfigured([transcriptionId]);

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
    <PageLayout
      className={pageClass}
      header={
        <>
          <header className={headerClass}>
            <button className={backButtonClass} onClick={onBack}>
              ← 戻る
            </button>
            <h1 className={titleClass}>要約</h1>
          </header>

          <div className={tabsClass}>
            <button
              className={tabClassOf(activeTab === 'new')}
              onClick={() => { setActiveTab('new'); setCompletedId(null); }}
            >
              新規要約
            </button>
            <button
              className={tabClassOf(activeTab === 'logs')}
              onClick={() => setActiveTab('logs')}
            >
              要約結果
            </button>
          </div>
        </>
      }
    >
      {activeTab === 'new' && (
        <div className={contentClass}>
          {error && <div className={errorClass}>{error}</div>}

          {/* モデル選択 */}
          <section className={sectionClass}>
            <h2 className={sectionHeadingClass}>モデル</h2>
            {config ? (
              <select
                className="min-w-[280px] cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-2 text-base text-gray-800 transition-colors duration-150 focus:border-primary focus:shadow-[0_0_0_2px] focus:shadow-blue-500/20 focus:outline-none"
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
              <p className={hintClass}>読み込み中...</p>
            )}
          </section>

          {/* プロンプト */}
          <section className={sectionClass}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">プロンプト</h2>
              {isFieldsChanged && (
                <button
                  className={`${smallButtonClass} px-[0.7rem] py-[0.3rem] text-sm text-gray-500 hover:text-gray-700`}
                  onClick={handleResetFields}
                  title="デフォルトに戻す"
                >
                  デフォルトに戻す
                </button>
              )}
            </div>
            <p className={hintClass}>
              各項目の指示を編集できます。空にするとその項目は除外されます。
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {/* overview */}
              <div className={fieldCardClass}>
                <span className={fieldCardLabelClass}>概要</span>
                <input
                  type="text"
                  className={cardInstructionClass}
                  placeholder={fields.find((f) => f.key === 'overview')!.defaultInstruction}
                  value={fields.find((f) => f.key === 'overview')!.instruction}
                  onChange={(e) => handleFieldInstruction('overview', e.target.value)}
                />
              </div>

              {/* key_points（グループ） */}
              <div className={fieldCardClass}>
                <span className={fieldCardLabelClass}>キーポイント</span>
                {(['key_points_topic', 'key_points_summary'] as const).map((key) => {
                  const f = fields.find((f) => f.key === key)!;
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-3 border-b border-gray-100 px-3 py-[0.4rem] last:border-b-0"
                    >
                      <span className={`min-w-16 shrink-0 text-xs font-semibold whitespace-nowrap text-gray-500 ${monoClass}`}>{f.subLabel}</span>
                      <input
                        type="text"
                        className={subrowInstructionClass}
                        placeholder={f.defaultInstruction}
                        value={f.instruction}
                        onChange={(e) => handleFieldInstruction(key, e.target.value)}
                      />
                    </div>
                  );
                })}
              </div>

              {/* decisions */}
              <div className={fieldCardClass}>
                <span className={fieldCardLabelClass}>決定事項</span>
                <input
                  type="text"
                  className={cardInstructionClass}
                  placeholder={fields.find((f) => f.key === 'decisions')!.defaultInstruction}
                  value={fields.find((f) => f.key === 'decisions')!.instruction}
                  onChange={(e) => handleFieldInstruction('decisions', e.target.value)}
                />
              </div>

            </div>
            {enabledCount === 0 && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                ⚠ 項目が1つも選択されていません
              </div>
            )}

            {/* 生成されるプロンプトのプレビュー */}
            <div className="mt-3">
              <div className="mb-[0.4rem] flex items-center justify-between">
                <p className="text-sm text-gray-500">Claudeへのインプット</p>
                <button
                  className={`${smallButtonClass} px-[0.65rem] py-1 text-[0.78rem] text-gray-700`}
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
              <pre className={`mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-slate-50 p-3 ${preformattedClass}`}>{previewPrompt}</pre>
            </div>
          </section>

          {/* 実行ボタン */}
          <section className={sectionClass}>
            {guardrailConfigured === false && <GuardrailMissingNotice />}
            <div className={actionsClass}>
              <button
                className={primaryButtonClass}
                onClick={handleSummarize}
                disabled={
                  summarizing ||
                  !!completedId ||
                  !selectedModel ||
                  enabledCount === 0 ||
                  guardrailConfigured === false
                }
              >
                {summarizing ? '要約中...' : '要約する'}
              </button>
            </div>

            {summarizing && (
              <div className={loadingClass}>
                <div className={loadingSpinnerClass} />
                <p className={loadingTextClass}>Claude が会話を要約中...</p>
              </div>
            )}

            {completedId && !summarizing && (
              <div className={completedClass}>
                <span className={completedMessageClass}>✓ 要約が完了しました。</span>
                <button
                  className={completedLinkClass}
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
        <div className={logsLayoutClass}>
          <div className={logsListClass}>
            <div className={logsListHeaderClass}>
              <span>要約結果</span>
              <button
                className={logsRefreshClass}
                onClick={loadLogs}
                disabled={logsLoading}
                title="更新"
              >
                ↻
              </button>
            </div>
            {logsLoading ? (
              <div className={logsEmptyClass}>読み込み中...</div>
            ) : logs.length === 0 ? (
              <div className={logsEmptyClass}>要約結果がありません</div>
            ) : (
              logs.map((log) => (
                <button
                  key={log.id}
                  className={logItemClassOf(selectedLogId === log.id)}
                  onClick={() => handleSelectLog(log.id)}
                >
                  <div className={logItemDateClass}>{formatDate(log.createdAt)}</div>
                  <div className={logItemKeywordsClass}>
                    {(log.key_points ?? []).slice(0, 2).map((kp) => kp.topic).join('・')}
                    {(log.key_points?.length ?? 0) > 2 && ` 他${(log.key_points?.length ?? 0) - 2}件`}
                  </div>
                  <div className={logItemModelClass}>{log.model}</div>
                </button>
              ))
            )}
          </div>

          <div className={logsDetailClass}>
            {!selectedLogId && (
              <div className={logsDetailEmptyClass}>
                左の一覧から要約結果を選択してください
              </div>
            )}
            {selectedLogId && logDetailLoading && (
              <div className={logsDetailEmptyClass}>読み込み中...</div>
            )}
            {selectedLogId && !logDetailLoading && logDetail && (
              <>
                <div className={logsDetailHeaderClass}>
                  <div className={logsDetailMetaClass}>
                    <span className={logsDetailDateClass}>
                      {formatDate(logDetail.createdAt)}
                    </span>
                    <span className={logItemModelClass}>{logDetail.model}</span>
                  </div>
                </div>
                <SummaryResult
                  summary={logDetail}
                  formatDate={formatDate}
                  onOpenUtterance={onOpenUtterance}
                />
                <div className="mt-6 flex flex-col gap-3 rounded-lg border border-gray-200 bg-slate-50 p-3">
                  <div className="flex flex-col gap-[0.3rem]">
                    <span className="text-[0.72rem] font-semibold tracking-[0.05em] text-gray-400 uppercase">モデル</span>
                    <code className={`text-[0.82rem] text-gray-700 ${monoClass}`}>{logDetail.model}</code>
                  </div>
                  <div className="flex flex-col gap-[0.3rem]">
                    <span className="text-[0.72rem] font-semibold tracking-[0.05em] text-gray-400 uppercase">プロンプト</span>
                    <pre className={`m-0 ${preformattedClass}`}>{logDetail.prompt}</pre>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </PageLayout>
  );
}

/** 要約結果表示（新規・過去ログ共通） */
function SummaryResult({
  summary,
  formatDate,
  onOpenUtterance,
}: {
  summary: TranscriptionSummaryLog;
  formatDate: (iso: string) => string;
  onOpenUtterance?: (utteranceIndex: number) => void;
}) {
  return (
    <div className={resultsClass}>
      <AiGeneratedNotice
        basis="元の会話"
        model={summary.model}
        warnings={summary.contentWarnings}
      />
      {summary.overview && (
        <div className={resultCardClass}>
          <h3 className={resultQuestionClass}>概要</h3>
          <p className="m-0 text-base leading-[1.7] text-gray-700">{summary.overview}</p>
        </div>
      )}

      {(summary.key_points?.length ?? 0) > 0 && (
        <div className={resultCardClass}>
          <h3 className={resultQuestionClass}>キーポイント</h3>
          <ul className={resultListClass}>
            {summary.key_points?.map((kp: SummaryKeyPoint, i: number) => (
              <li
                key={i}
                className={`${resultItemTextClass} flex list-none flex-col gap-[0.15rem] border-l-3 border-l-gray-200 pl-3`}
              >
                <span className="text-md font-semibold text-gray-900">{kp.topic}</span>
                <span className="text-md leading-[1.6] text-gray-500">{kp.summary}</span>
                {kp.evidence && (
                  <EvidenceList evidence={kp.evidence} onOpenUtterance={onOpenUtterance} />
                )}
              </li>
            ))}
          </ul>
          {(summary.droppedEvidenceCount ?? 0) > 0 && (
            <p className="mt-2 text-xs text-gray-400">
              会話の中に見つからなかった根拠 {summary.droppedEvidenceCount}件は、表示から除きました。
            </p>
          )}
        </div>
      )}

      {(summary.decisions?.length ?? 0) > 0 && (
        <div className={resultCardClass}>
          <h3 className={resultQuestionClass}>決定事項</h3>
          <ul className={resultListClass}>
            {summary.decisions?.map((decision: string, i: number) => (
              <li key={i} className={resultItemTextClass}>{decision}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="pt-2 text-right text-xs text-gray-400">
        生成日時: {formatDate(summary.createdAt)} / モデル: {summary.model}
      </div>
      <FeedbackButton
        key={summary.id}
        feature="summary"
        targetId={summary.id}
        transcriptionId={summary.transcriptionId}
      />
    </div>
  );
}

/** 秒を m:ss の形式にする */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** 要点の根拠（会話から抜き出した発言）。押すと元の文字起こしのその発言を開く */
function EvidenceList({
  evidence,
  onOpenUtterance,
}: {
  evidence: SummaryEvidence[];
  onOpenUtterance?: (utteranceIndex: number) => void;
}) {
  if (evidence.length === 0) {
    return <span className={evidenceNoteClass}>根拠の発言を確認できませんでした</span>;
  }
  return (
    <ul className="mt-1 p-0">
      {evidence.map((e, i) => (
        <li
          key={i}
          className="flex list-none flex-row flex-wrap items-baseline gap-[0.4rem] text-[0.78rem] leading-[1.6] text-gray-700"
        >
          <span className="text-gray-700">「{e.quote}」</span>
          {onOpenUtterance ? (
            <button
              type="button"
              className={evidenceLinkClass}
              onClick={() => onOpenUtterance(e.utteranceIndex)}
            >
              {e.speakerName} {formatTime(e.start)}
            </button>
          ) : (
            <span className={evidenceNoteClass}>
              {e.speakerName} {formatTime(e.start)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
