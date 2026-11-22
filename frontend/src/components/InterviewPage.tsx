import { useEffect, useMemo, useState } from 'react';
import { FeedbackButton } from './FeedbackButton';
import { generateQuestions, analyzeInterview, fetchAnalysisLogs, fetchAnalysisLog } from '../api/client';
import { keywordsFor } from '../utils/speakerKeywords';
import { keepAvailable } from '../utils/keywordSelection';
import { useKeywordSource } from '../hooks/useKeywordSource';
import { KeywordSourceSwitch } from './KeywordSourceSwitch';
import type { InterviewAnalysis, InterviewAnalysisSummary, Speaker, Utterance } from '../types';
import { AiGeneratedNotice } from './AiGeneratedNotice';
import { markdownToSafeHtml } from '../utils/markdownHtml';
import { useGuardrailConfigured } from '../hooks/usePrivacyStatuses';
import { GuardrailMissingNotice } from './PrivacyPanel';
import { PageLayout } from './PageLayout';
import {
  actionsClass,
  backButtonClass,
  contentClass,
  errorClass,
  headerClass,
  hintClass,
  loadingClass,
  loadingHintClass,
  loadingSpinnerClass,
  loadingTextClass,
  logItemClassOf,
  logItemDateClass,
  logItemKeywordsClass,
  logItemSpeakerClass,
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
  secondaryButtonClass,
  sectionClass,
  sectionHeadingClass,
  tabClassOf,
  tabsClass,
  titleClass,
} from './interviewPageClasses';

/** 話者を選ぶ欄 */
const selectClass =
  'w-full max-w-[300px] cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-2 text-base focus:border-primary focus:shadow-[0_0_0_2px] focus:shadow-blue-500/20 focus:outline-none';

/** キーワードの札：選んだ札は黄色にし、カーソルを乗せても色を変えない */
const keywordTagClassOf = (selected: boolean): string =>
  `inline-block cursor-pointer rounded-xl border px-[0.6rem] py-1 text-sm transition-all duration-150 ${
    selected
      ? 'border-yellow-400 bg-yellow-100 text-amber-800'
      : 'border-gray-200 bg-gray-100 text-gray-500 hover:border-amber-200 hover:bg-yellow-50'
  }`;

/** 回答（Markdown から作った HTML）の見た目 */
const answerClass = [
  'text-base leading-[1.7] text-gray-700',
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_:is(h1,h2,h3,h4)]:mt-4 [&_:is(h1,h2,h3,h4)]:mb-2 [&_:is(h1,h2,h3,h4)]:text-base [&_:is(h1,h2,h3,h4)]:font-semibold [&_:is(h1,h2,h3,h4)]:text-gray-800',
  '[&_:is(h1,h2,h3):first-child]:mt-0',
  '[&_:is(ul,ol)]:my-2 [&_:is(ul,ol)]:pl-6 [&_li]:mb-1',
  '[&_strong]:font-semibold [&_strong]:text-gray-900',
  '[&_a]:text-primary [&_a]:no-underline [&_a:hover]:underline',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-3 [&_blockquote]:border-l-gray-200 [&_blockquote]:bg-gray-50 [&_blockquote]:px-4 [&_blockquote]:py-2 [&_blockquote]:text-gray-500',
  '[&_code]:rounded-[3px] [&_code]:bg-gray-100 [&_code]:px-[0.3rem] [&_code]:py-[0.1rem] [&_code]:text-[0.85em]',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-gray-100 [&_pre]:px-4 [&_pre]:py-3',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
].join(' ');

interface QuestionItem {
  text: string;
  checked: boolean;
}

interface Props {
  transcriptionId: string;
  speakers: Speaker[];
  utterances: Utterance[];
  /** GiNZA のキーワード抽出（ベータ機能）が有効か */
  enableGinzaKeywords?: boolean;
  onBack: () => void;
}

/** 会話分析ページ */
export function InterviewPage({
  transcriptionId,
  speakers,
  utterances,
  enableGinzaKeywords = false,
  onBack,
}: Props) {
  const [selectedSpeakerId, setSelectedSpeakerId] = useState(
    speakers[0]?.id ?? '',
  );
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(
    new Set(),
  );
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  // Guardrail ID が未設定なら Claude に送れないため、質問の生成・分析を実行しない
  const guardrailConfigured = useGuardrailConfigured([transcriptionId]);
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

  /** キーワードの出し方（標準 / GiNZA。GiNZA はベータ機能） */
  const keywordSource = useKeywordSource(transcriptionId, enableGinzaKeywords);

  /** 選択中の話者の発話テキストからキーワードを抽出（メモ化） */
  const keywords = useMemo(
    () => keywordsFor(utterances, keywordSource.source, keywordSource.ginza, selectedSpeakerId),
    [utterances, selectedSpeakerId, keywordSource.source, keywordSource.ginza],
  );

  /** 出し方を切り替えたら、切り替え後の一覧にない語の選択を外す（GiNZA の解析中は待つ） */
  const keywordsLoading = keywordSource.source === 'ginza' && !keywordSource.ginza;
  useEffect(() => {
    if (keywordsLoading) return;
    setSelectedKeywords((prev) => keepAvailable(prev, keywords));
  }, [keywords, keywordsLoading]);

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

  /** 分析結果のMarkdownを、表示しても安全なHTMLに変換（メモ化） */
  const renderedResults = useMemo(() => {
    if (!analysis) return [];
    return analysis.results.map((result) => ({
      ...result,
      answerHtml: markdownToSafeHtml(result.answer),
    }));
  }, [analysis]);

  /** ログ詳細のMarkdownをHTMLに変換（メモ化） */
  const renderedLogResults = useMemo(() => {
    if (!logDetail) return [];
    return logDetail.results.map((result) => ({
      ...result,
      answerHtml: markdownToSafeHtml(result.answer),
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
    <PageLayout
      className={pageClass}
      header={
        <>
          <header className={headerClass}>
            <button className={backButtonClass} onClick={onBack}>
              ← 戻る
            </button>
            <h1 className={titleClass}>会話分析</h1>
          </header>

          {/* タブ切り替え */}
          <div className={tabsClass}>
            <button
              className={tabClassOf(activeTab === 'new')}
              onClick={() => setActiveTab('new')}
            >
              新規分析
            </button>
            <button
              className={tabClassOf(activeTab === 'logs')}
              onClick={() => setActiveTab('logs')}
            >
              過去の分析ログ
            </button>
          </div>
        </>
      }
    >
      {/* 新規分析タブ */}
      {activeTab === 'new' && (
        <div className={contentClass}>
          {error && <div className={errorClass}>{error}</div>}

          {/* 話者選択 */}
          <section className={sectionClass}>
            <h2 className={sectionHeadingClass}>話者を選択</h2>
            <select
              className={selectClass}
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
          <section className={sectionClass}>
            <h2 className={sectionHeadingClass}>分析キーワード</h2>
            {enableGinzaKeywords && <KeywordSourceSwitch state={keywordSource} />}
            <p className={hintClass}>
              クリックでキーワードを選択（{selectedKeywords.size}件選択中）
            </p>
            <div className="flex flex-wrap gap-[0.4rem]">
              {keywords.map((kw) => (
                <button
                  key={kw.text}
                  className={keywordTagClassOf(selectedKeywords.has(kw.text))}
                  onClick={() => toggleKeyword(kw.text)}
                >
                  {kw.text}
                </button>
              ))}
            </div>
          </section>

          {/* 質問生成・選択 */}
          <section className={sectionClass}>
            <h2 className={sectionHeadingClass}>調査質問</h2>
            {guardrailConfigured === false && <GuardrailMissingNotice />}
            <div className={actionsClass}>
              <button
                className={secondaryButtonClass}
                onClick={handleGenerateQuestions}
                disabled={
                  generatingQuestions ||
                  analyzing ||
                  activeKeywords.length === 0 ||
                  guardrailConfigured === false
                }
              >
                {generatingQuestions ? '生成中...' : '質問を生成'}
              </button>
            </div>

            {questions.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white">
                <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
                  <button
                    className="rounded-sm border border-gray-200 bg-white px-2 py-[0.2rem] text-xs text-gray-500 transition-all duration-150 hover:border-gray-300 hover:bg-gray-100"
                    onClick={toggleAllQuestions}
                  >
                    {questions.every((q) => q.checked) ? '全解除' : '全選択'}
                  </button>
                  <span className="text-xs text-gray-400">
                    {checkedCount}/{questions.length}件 選択中
                  </span>
                </div>
                {questions.map((q, i) => (
                  <label
                    key={i}
                    className="flex cursor-pointer items-start gap-3 border-b border-gray-100 px-4 py-3 transition-colors duration-100 last:border-b-0 hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 cursor-pointer accent-primary"
                      checked={q.checked}
                      onChange={() => toggleQuestion(i)}
                      disabled={analyzing}
                    />
                    <span className="text-md leading-[1.6] text-gray-700">{q.text}</span>
                  </label>
                ))}
              </div>
            )}

            {questions.length > 0 && (
              <div className={actionsClass}>
                <button
                  className={primaryButtonClass}
                  onClick={handleAnalyze}
                  disabled={
                    analyzing || generatingQuestions || checkedCount === 0 || guardrailConfigured === false
                  }
                >
                  {analyzing ? '分析中...' : `分析する（${checkedCount}件）`}
                </button>
              </div>
            )}
          </section>

          {/* ローディング */}
          {analyzing && (
            <div className={loadingClass}>
              <div className={loadingSpinnerClass} />
              <p className={loadingTextClass}>Claude がWeb検索しながら分析中...</p>
              <p className={loadingHintClass}>
                質問数に応じて数十秒〜数分かかる場合があります
              </p>
            </div>
          )}

          {/* 分析結果 */}
          {analysis && !analyzing && (
            <section className={sectionClass}>
              <h2 className={sectionHeadingClass}>
                分析結果 —{' '}
                <span style={{ color: selectedSpeaker?.color }}>
                  {analysis.speakerName}
                </span>
              </h2>
              <AnalysisResultList results={renderedResults} analysis={analysis} />
            </section>
          )}
        </div>
      )}

      {/* 過去ログタブ */}
      {activeTab === 'logs' && (
        <div className={logsLayoutClass}>
          {/* ログ一覧 */}
          <div className={logsListClass}>
            <div className={logsListHeaderClass}>
              <span>分析履歴</span>
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
              <div className={logsEmptyClass}>
                過去の分析結果がありません
              </div>
            ) : (
              logs.map((log) => (
                <button
                  key={log.id}
                  className={logItemClassOf(selectedLogId === log.id)}
                  onClick={() => handleSelectLog(log.id)}
                >
                  <div className={logItemSpeakerClass}>
                    {log.speakerName}
                  </div>
                  <div className={logItemKeywordsClass}>
                    {log.keywords.slice(0, 3).join('・')}
                    {log.keywords.length > 3 && ` 他${log.keywords.length - 3}件`}
                  </div>
                  <div className={logItemDateClass}>
                    {formatDate(log.createdAt)}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* ログ詳細 */}
          <div className={logsDetailClass}>
            {!selectedLogId && (
              <div className={logsDetailEmptyClass}>
                左の一覧から分析結果を選択してください
              </div>
            )}
            {selectedLogId && logDetailLoading && (
              <div className={logsDetailEmptyClass}>読み込み中...</div>
            )}
            {selectedLogId && !logDetailLoading && logDetail && (
              <>
                <div className={logsDetailHeaderClass}>
                  <div className={logsDetailMetaClass}>
                    <span className="text-lg font-semibold text-gray-800">
                      {logDetail.speakerName}
                    </span>
                    <span className={logsDetailDateClass}>
                      {formatDate(logDetail.createdAt)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-[0.4rem]">
                    {logDetail.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="inline-block rounded-xl border border-yellow-400 bg-yellow-100 px-[0.55rem] py-[0.2rem] text-xs text-amber-800"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
                <AnalysisResultList results={renderedLogResults} analysis={logDetail} />
              </>
            )}
          </div>
        </div>
      )}
    </PageLayout>
  );
}

/** 分析結果カードリスト（新規・過去ログ共通） */
function AnalysisResultList({
  results,
  analysis,
}: {
  results: { question: string; answerHtml: string; sources: { title: string; url: string }[] }[];
  analysis: InterviewAnalysis;
}) {
  return (
    <div className={resultsClass}>
      <AiGeneratedNotice
        basis="出典"
        model={analysis.model}
        warnings={analysis.contentWarnings}
      />
      {results.map((result, i) => (
        <div key={i} className={resultCardClass}>
          <h3 className={resultQuestionClass}>
            Q{i + 1}: {result.question}
          </h3>
          <div
            className={answerClass}
            dangerouslySetInnerHTML={{ __html: result.answerHtml }}
          />
          {result.sources.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
              <span className="text-xs font-medium text-gray-400">出典:</span>
              {result.sources.map((source, j) => (
                <a
                  key={j}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-sm bg-blue-50 px-[0.4rem] py-[0.15rem] text-xs text-primary no-underline hover:bg-blue-100 hover:underline"
                >
                  {source.title}
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
      <FeedbackButton
        key={analysis.id}
        feature="analysis"
        targetId={analysis.id}
        transcriptionId={analysis.transcriptionId}
      />
    </div>
  );
}
