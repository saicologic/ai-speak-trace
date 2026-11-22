import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  confirmResearch,
  fetchResearchJob,
  fetchResearchJobs,
  fetchTranscription,
  fetchTranscriptions,
  resumeResearch,
  startResearch,
  updateResearchTitle,
} from '../api/client';
import type { TranscriptionSummary } from '../types';
import type {
  ClaimCheck,
  DomainProposal,
  ReportCitation,
  ResearchJob,
  ResearchJobSummary,
  ResearchStatus,
  PreSendFinding,
} from '../types/research';
import { extractKeywords } from '../utils/keywords';
import { buildReport, citeClassOf, splitTopics, topicHighlights } from '../utils/researchReport';
import { selectRelatedLinks } from '../utils/relatedLinks';
import { finishedStages, resumeLabel } from '../utils/researchResume';
import type { NumberedCitation } from '../utils/researchReport';
import { AiGeneratedNotice } from './AiGeneratedNotice';
import { FeedbackButton } from './FeedbackButton';
import { useGuardrailConfigured } from '../hooks/usePrivacyStatuses';
import { GuardrailMissingNotice, PrivacyPanel } from './PrivacyPanel';
import { PageLayout } from './PageLayout';
import {
  backButtonClass,
  completedClass,
  completedLinkClass,
  completedMessageClass,
  logItemClassOf,
  logItemDateClass,
  logItemKeywordsClass,
  logItemModelClass,
  logsDetailClass,
  logsDetailEmptyClass,
  logsEmptyClass,
  logsLayoutClass,
  logsListClass,
  logsListHeaderClass,
  logsRefreshClass,
  headerClass,
  pageClass,
  tabClassOf,
  tabsClass,
} from './interviewPageClasses';

interface Props {
  onBack: () => void;
  /** 根拠の発言を、元の文字起こしで開く（utteranceIndex がなければ文字起こしの先頭を開く） */
  onOpenTranscription: (transcriptionId: string, utteranceIndex?: number) => void;
}

/** ドメインの等幅の字体 */
const domainFontClass = '[font-family:ui-monospace,SFMono-Regular,Menlo,monospace]';
/** 調査の中の見出し・説明・注意・エラー */
const sectionClass = 'mb-8';
const sectionHeadingClass = 'mb-3 text-lg font-semibold text-gray-800';
const hintClass = 'mb-3 text-md leading-[1.6] text-gray-500';
const noticeClass = 'my-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800';
const errorClass = 'mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800';
/** 青い実行のボタン */
const primaryButtonClass =
  'cursor-pointer rounded-lg border-none bg-blue-600 px-5 py-[0.6rem] text-base font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-400';
/** 進み具合の知らせと、その中の読み込み中の丸 */
const progressClass = 'mb-6 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-base text-blue-900';
const spinnerClass = 'size-[1.1rem] shrink-0 animate-spin-fast rounded-full border-2 border-blue-200 border-t-blue-600';
/** 印を付けない一覧 */
const plainListClass = 'm-0 list-none p-0';
/** 確認の一覧（送る前の確認・AI 倫理）：項目を横に並べ、下に線を引く */
const checksItemClass =
  '[&_li]:flex [&_li]:flex-wrap [&_li]:gap-[0.4rem] [&_li]:border-b [&_li]:border-gray-100 [&_li]:py-[0.4rem] [&_li]:text-md';
const checksClass = `${plainListClass} ${checksItemClass} [&_li]:items-baseline`;
/** 送る前の確認は、項目を上にそろえる */
const presendChecksClass = `${plainListClass} ${checksItemClass} [&_li]:items-start`;
/** 確認の印：問題がなければ緑、失敗は赤、注意が必要なら橙にする */
const checkMarkClassOf = (state: 'passed' | 'failed' | 'warning'): string =>
  `font-bold ${state === 'passed' ? 'text-emerald-600' : state === 'failed' ? 'text-red-600' : 'text-amber-600'}`;
const checkDetailClass = 'w-full text-[0.78rem] text-gray-500';
/** 会話の引用（キーワードの提案では、チェックボックスの分だけ左をあける） */
const quoteClass = 'mt-[0.3rem] border-l-3 border-l-gray-300 bg-gray-50 px-[0.6rem] py-[0.3rem] text-sm leading-[1.6] text-gray-700';
/** 提案の理由・公式サイトの理由 */
const reasonClass = 'mt-[0.4rem] mb-[0.3rem] ml-[1.6rem] text-[0.82rem] leading-[1.6] text-gray-600';
/** キーワードの提案：選んだ提案は青い枠にする */
const proposalClassOf = (selected: boolean): string =>
  `mb-[0.6rem] rounded-lg border px-4 py-3 ${selected ? 'border-primary bg-[#f8fbff]' : 'border-gray-200 bg-white'}`;
const proposalHeadClass = 'flex cursor-pointer items-center gap-[0.6rem]';
const proposalKeywordClass = 'flex-1 font-semibold';
const proposalCountClass = 'rounded-[999px] bg-blue-100 px-2 py-[0.1rem] text-xs text-blue-800';
/** キーワードと公式サイトを足す欄 */
const addClass = 'mt-2 flex gap-2';
const addInputClass = 'flex-1 rounded-md border border-gray-300 px-[0.6rem] py-[0.45rem] text-md';
const addButtonClass = 'cursor-pointer rounded-md border border-gray-300 bg-white px-[0.9rem] py-[0.45rem] text-md';
/** 公式サイトの名前と運営者 */
const domainClass = `font-semibold ${domainFontClass}`;
const domainOwnerClass = 'text-[0.78rem] text-gray-500';
/** 灰色の小さい補足（日付・一般のサイト・ドメイン） */
const mutedSmallClass = 'text-xs text-gray-400';
/** 「さらに読む」と話題になった発言の見出しの中では、左をあけ、太字にしない */
const extraMutedSmallClass = `${mutedSmallClass} ml-[0.4rem] font-normal`;
/** 調査の状態のバッジ */
const jobStatusClassOf = (status: ResearchStatus): string =>
  `ml-2 rounded-[999px] px-2 py-[0.1rem] text-[0.68rem] ${
    status === 'completed' ? 'bg-emerald-100 text-emerald-800' : status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
  }`;
/** 調査の流れの段階：終わった段階は緑、実行中は青、失敗は赤にする */
const stepClassOf = (state: 'done' | 'active' | 'failed' | 'pending'): string =>
  `relative flex flex-col gap-[0.2rem] rounded-lg border bg-white px-[0.7rem] py-[0.6rem] ${
    {
      done: 'border-emerald-200 text-gray-700',
      active: 'border-primary text-blue-900 shadow-[0_0_0_2px] shadow-blue-500/20',
      failed: 'border-red-400 text-red-800 shadow-[0_0_0_2px] shadow-red-400/20',
      pending: 'border-gray-200 text-gray-400',
    }[state]
  }`;
const stepNumberClassOf = (state: 'done' | 'active' | 'failed' | 'pending'): string =>
  `inline-flex size-6 items-center justify-center rounded-full text-sm font-semibold ${
    { done: 'bg-emerald-500 text-white', active: 'bg-primary text-white', failed: 'bg-red-600 text-white', pending: 'bg-gray-200 text-gray-500' }[state]
  }`;
/** キーワードと公式サイトの札 */
const chipClass = 'rounded-[999px] px-[0.7rem] py-[0.2rem] text-[0.82rem]';
/** 根拠の種類のバッジ：会話は紫、Web は灰色、公式サイトは緑 */
const citationKindClassOf = (kind: 'conversation' | 'web', official = false): string =>
  `rounded-[999px] px-[0.45rem] py-[0.05rem] text-2xs ${
    kind === 'conversation' ? 'bg-violet-100 text-violet-800' : official ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700'
  }`;
const citationMetaClass = 'flex items-baseline gap-[0.6rem] text-[0.78rem] text-gray-500';
/** 枠のない青い文字のボタン（引用の続き・根拠を開く） */
const textButtonClass = 'cursor-pointer border-none bg-transparent p-0 text-[0.78rem] text-blue-700 hover:underline';
/** 白い地に青い枠の小さいボタン（会話を開く・ページを開く） */
const actionButtonClass =
  'cursor-pointer rounded-md border border-blue-600 bg-white px-[10px] py-1 text-[13px] whitespace-nowrap text-blue-600 no-underline hover:bg-blue-50';
/** タイトルの編集のボタン */
const titleButtonClass = 'cursor-pointer rounded-md border px-3 py-1.5 text-[13px] disabled:cursor-default disabled:opacity-50';
/** 表示から除いた文の一覧（評価の詳細） */
const removedClass =
  'my-3 text-md [&_summary]:cursor-pointer [&_summary]:text-amber-800 [&_li]:border-b [&_li]:border-gray-100 [&_li]:py-[0.4rem]';
/** 調査の記録の文 */
const recordLineClass = 'mb-2 text-[14px] text-gray-700';
/** 「さらに読む」と話題になった発言の欄（上だけに点線を引く。border-dashed はほかの辺にも線を出すため使わない） */
const topicExtraClass =
  'mt-4 [border-top:1px_dashed_var(--color-gray-200)] pt-3 [&_h3]:mt-0 [&_h3]:mb-2 [&_h3]:text-md [&_h3]:font-semibold [&_h3]:text-gray-700';

/** 実行中の状態（この間は結果を定期的に取得する） */
const RUNNING: ResearchStatus[] = ['proposing', 'researching', 'analyzing', 'evaluating'];

/** 結果を取得する間隔（ミリ秒） */
const POLL_INTERVAL_MS = 3000;

/** 最初から選んでおくキーワードの数（出現回数の多い順） */
const DEFAULT_KEYWORD_COUNT = 4;

/** 調査の段階 */
const STEPS = [
  { label: '会話の読み込み', detail: '個人情報を伏せてから送る' },
  { label: 'キーワード', detail: '会話に出てこない語・引用を除く' },
  { label: 'Web調査', detail: '選んだ公式サイトを優先して調べる' },
  { label: '統合分析', detail: '各文に出典を付けて書く' },
  { label: '最終確認', detail: '根拠のない文を除き、AI倫理を確認する' },
];

/** 状態ごとの、完了した段階の数と実行中の段階 */
function stepState(status: ResearchStatus | undefined): { done: number; active: number | null } {
  switch (status) {
    // 提案を始めた時点で、① 会話の読み込み（と送る前の確認）は終わっている
    case 'proposing':
      return { done: 1, active: 1 };
    case 'awaiting_confirmation':
      return { done: 1, active: 1 };
    case 'researching':
      return { done: 2, active: 2 };
    case 'analyzing':
      return { done: 3, active: 3 };
    case 'evaluating':
      return { done: 4, active: 4 };
    case 'completed':
      return { done: 5, active: null };
    default:
      return { done: 0, active: null };
  }
}

const STATUS_LABELS: Record<ResearchStatus, string> = {
  proposing: 'キーワードを提案中',
  awaiting_confirmation: 'キーワードの確定待ち',
  researching: 'Web調査中',
  analyzing: '統合分析中',
  evaluating: '最終確認中',
  completed: '完了',
  failed: '失敗',
};

/** 0〜1 の割合を％で表す */
function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

/**
 * 調査の流れ（5段）
 * 失敗した調査は、失敗した段階に印を付ける（以前の調査は再開する段階を使い、それもなければ印を付けない）
 */
function StepFlow({ status, failedStage }: { status: ResearchStatus | undefined; failedStage?: ResearchStatus }) {
  const { done, active } = stepState(status === 'failed' ? failedStage : status);
  const failed = status === 'failed' ? active : null;
  return (
    <ol className="m-0 mb-8 grid list-none grid-cols-5 gap-2 p-0 max-[720px]:grid-cols-1">
      {STEPS.map((step, i) => {
        const state = i === failed ? 'failed' : i === active ? 'active' : i < done ? 'done' : 'pending';
        return (
          <li key={step.label} className={stepClassOf(state)}>
            <span className={stepNumberClassOf(state)}>
              {i === failed ? '✕' : i < done && i !== active ? '✓' : i + 1}
            </span>
            <span className="text-base font-semibold">{step.label}</span>
            <span className="text-[0.72rem] leading-[1.4]">{step.detail}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * 失敗した調査の表示（失敗の原因・解決方法・終わっている段階・再開ボタン）
 * 再開すると、終わっている段階の結果はそのまま使い、終わっていない段階から続ける
 */
function ResearchFailure({ job, onResumed }: { job: ResearchJob; onResumed: (job: ResearchJob) => void }) {
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const info = job.errorInfo;
  const finished = finishedStages(job);

  const handleResume = async () => {
    setResuming(true);
    setResumeError(null);
    try {
      onResumed(await resumeResearch(job.id));
    } catch (e) {
      setResumeError(e instanceof Error ? e.message : String(e));
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className={`${errorClass} flex flex-col items-start gap-2`}>
      <p className="font-semibold">{info?.title ?? '調査に失敗しました'}</p>
      {info && <p className="text-base leading-[1.6] text-gray-700">解決方法: {info.hint}</p>}
      {finished.length > 0 && (
        <p className="text-base leading-[1.6] text-gray-700">終わっている段階: {finished.join('・')}</p>
      )}
      {job.resume && (
        <button className={`${primaryButtonClass} mt-1`} disabled={resuming} onClick={() => void handleResume()}>
          {resuming ? '再開しています...' : resumeLabel(job.resume)}
        </button>
      )}
      {resumeError && <p className="text-md">{resumeError}</p>}
      {job.error && (
        <details className="text-sm text-gray-500 [&_code]:mt-1 [&_code]:block [&_code]:break-all [&_code]:whitespace-pre-wrap">
          <summary>エラーの詳細</summary>
          <code>{job.error}</code>
        </details>
      )}
    </div>
  );
}

/** ディープサーチ（会話の読み込み → キーワード → Web調査 → 統合分析 → 最終確認） */
export function ResearchPage({ onBack, onOpenTranscription }: Props) {
  const [activeTab, setActiveTab] = useState<'new' | 'results'>('new');
  const [transcriptions, setTranscriptions] = useState<TranscriptionSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<ResearchJobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  // 「新しい調査」タブで進めている調査
  const [job, setJob] = useState<ResearchJob | null>(null);
  // 「調査結果」タブで選んだ調査
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [resultJob, setResultJob] = useState<ResearchJob | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [customKeyword, setCustomKeyword] = useState('');
  // キーワードごとに選んだ公式サイト
  const [selectedSites, setSelectedSites] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const selectedIdList = useMemo(() => Array.from(selectedIds), [selectedIds]);
  // Guardrail ID が未設定なら Claude に送れないため、調査を始めない
  const guardrailConfigured = useGuardrailConfigured(selectedIdList);
  const [error, setError] = useState<string | null>(null);

  const refreshJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      setJobs(await fetchResearchJobs());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTranscriptions()
      .then(setTranscriptions)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // 「調査結果」タブを開いたら一覧を取得し直す
  useEffect(() => {
    if (activeTab === 'results') void refreshJobs();
  }, [activeTab, refreshJobs]);

  // 実行中は結果を定期的に取得する
  const jobId = job?.id;
  const running = job ? RUNNING.includes(job.status) : false;
  useEffect(() => {
    if (!jobId || !running) return;
    const timer = setInterval(async () => {
      try {
        const latest = await fetchResearchJob(jobId);
        // 取得中に別の調査を選んだ場合は、選んだ調査を上書きしない
        setJob((current) => (current?.id === jobId ? latest : current));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [jobId, running]);

  // 提案が届いたら、出現回数の多いキーワードと、すべての公式サイトを選んでおく
  const proposal = job?.status === 'awaiting_confirmation' ? job.proposal : undefined;
  useEffect(() => {
    if (!proposal) return;
    setSelectedKeywords(
      new Set(proposal.keywords.slice(0, DEFAULT_KEYWORD_COUNT).map((k) => k.keyword)),
    );
    setSelectedSites(
      Object.fromEntries(
        proposal.keywords.map((k) => [
          k.keyword,
          (k.domains ?? proposal.domains).map((d) => d.domain),
        ]),
      ),
    );
  }, [proposal]);

  const toggle = (set: Set<string>, value: string): Set<string> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const handleStart = async () => {
    setBusy(true);
    setError(null);
    try {
      // 会話で多く使われている語を、キーワード提案の参考として渡す
      const texts = await Promise.all(
        Array.from(selectedIds).map(async (id) =>
          (await fetchTranscription(id)).utterances.map((u) => u.text).join('\n'),
        ),
      );
      const frequentWords = extractKeywords(texts.join('\n'))
        .slice(0, 30)
        .map((k) => ({ word: k.text, count: k.count }));
      setJob(await startResearch(Array.from(selectedIds), frequentWords));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      setJob(
        await confirmResearch(
          job.id,
          Array.from(selectedKeywords).map((keyword) => ({
            keyword,
            domains: selectedSites[keyword] ?? [],
          })),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 「調査結果」タブで調査を選ぶ（確定待ち・実行中の調査は「新しい調査」タブで続きを表示する） */
  /** 調査結果のタブの中で、選んだ調査を表示する（終わっていない調査も、続けるかどうかは利用者が選ぶ） */
  const handleSelectResult = async (summary: ResearchJobSummary) => {
    setError(null);
    setSelectedResultId(summary.id);
    setResultJob(null);
    setResultLoading(true);
    try {
      setResultJob(await fetchResearchJob(summary.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResultLoading(false);
    }
  };

  /** 完了した調査を「調査結果」タブで開く */
  const handleShowResult = (completed: ResearchJob) => {
    setActiveTab('results');
    setSelectedResultId(completed.id);
    setResultJob(completed);
  };

  const addCustomKeyword = () => {
    const value = customKeyword.trim();
    if (!value) return;
    setSelectedKeywords((prev) => new Set(prev).add(value));
    setCustomKeyword('');
  };



  const customKeywords = Array.from(selectedKeywords).filter(
    (k) => !job?.proposal?.keywords.some((p) => p.keyword === k),
  );

  return (
    <PageLayout
      className={pageClass}
      header={
        <>
          <header className={headerClass}>
            <button className={backButtonClass} onClick={onBack}>
              ← 戻る
            </button>
            <h1 className="flex-1 text-xl font-semibold">ディープサーチ</h1>
            {activeTab === 'new' && job && (
              <button className={backButtonClass} onClick={() => setJob(null)}>
                ＋ 新しい調査
              </button>
            )}
          </header>

          <div className={tabsClass}>
            <button
              className={tabClassOf(activeTab === 'new')}
              onClick={() => setActiveTab('new')}
            >
              新しい調査
            </button>
            <button
              className={tabClassOf(activeTab === 'results')}
              onClick={() => setActiveTab('results')}
            >
              調査結果
            </button>
          </div>
        </>
      }
    >
      {/* research-content は、テストでスクロールする部分の中身を探すための目印 */}
      {activeTab === 'new' && (
        <div className="research-content mx-auto w-full max-w-[880px] flex-1 p-8 max-[720px]:p-4">
          {error && <div className={errorClass}>{error}</div>}

          <StepFlow status={job?.status} failedStage={job?.failedStage ?? job?.resume?.from} />

          {/* ① 会話の選択（新しい調査） */}
          {!job && (
            <>
              <section className={sectionClass}>
                <h2 className={sectionHeadingClass}>① 調べる会話を選ぶ</h2>
                <p className={hintClass}>
                  選んだ会話の全文をもとに、AIが調べるべきキーワードを提案します。前編・後編のように、関連する会話をまとめて選べます。
                </p>
                <ul
                  className={`${plainListClass} max-h-[320px] overflow-y-auto rounded-lg border border-gray-200 bg-white [&_li+li]:border-t [&_li+li]:border-gray-100 [&_label]:flex [&_label]:cursor-pointer [&_label]:items-center [&_label]:gap-[0.6rem] [&_label]:px-3 [&_label]:py-[0.55rem] [&_label]:text-md`}
                >
                  {transcriptions.map((t) => (
                    <li key={t.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(t.id)}
                          onChange={() => setSelectedIds((prev) => toggle(prev, t.id))}
                        />
                        <span className="flex-1 wrap-anywhere">{t.audioFileName}</span>
                        <span className={mutedSmallClass}>
                          {new Date(t.createdAt).toLocaleDateString('ja-JP')}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className={noticeClass}>
                  選んだ会話の全文を Anthropic（Claude）に送信します。この後のWeb調査では、確定したキーワードだけを検索に使います。
                </p>
                {guardrailConfigured === false && <GuardrailMissingNotice />}
                {/* 選んだ会話ごとの個人情報チェック（まだ確認していない会話は自動で検出する） */}
                {guardrailConfigured !== false &&
                  selectedIdList.map((id) => (
                    <PrivacyPanel
                      key={id}
                      transcriptionId={id}
                      title={transcriptions.find((t) => t.id === id)?.audioFileName}
                    />
                  ))}
                <button
                  className={primaryButtonClass}
                  disabled={selectedIds.size === 0 || busy || guardrailConfigured === false}
                  onClick={handleStart}
                >
                  {busy ? '準備中...' : `${selectedIds.size}件の会話で調査を始める`}
                </button>
              </section>

            </>
          )}

          {job && (
            <section className={sectionClass}>
              {job.title && <p className="mb-3 text-[18px] font-semibold text-gray-800">{job.title}</p>}
              <h2 className={sectionHeadingClass}>調べている会話</h2>
              <ul className={`${plainListClass} [&_li]:py-[0.3rem] [&_li]:text-md [&_li]:wrap-anywhere [&_li]:text-gray-700`}>
                {job.transcriptionIds.map((id, i) => (
                  <li key={id}>
                    会話{i + 1}: {job.transcriptionNames[id] ?? id}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {job?.preSendChecks && (
            <section className={sectionClass}>
              <h2 className={sectionHeadingClass}>送る前の確認</h2>
              <PreSendChecksView job={job} onOpenTranscription={onOpenTranscription} />
            </section>
          )}

          {job?.status === 'failed' && <ResearchFailure job={job} onResumed={setJob} />}

          {job?.status === 'proposing' && (
            <div className={progressClass}>
              <div className={spinnerClass} />
              会話を読み込み、調べるべきキーワードと公式サイトを提案しています...
            </div>
          )}

          {/* ② キーワードと公式サイトの確定 */}
          {job?.status === 'awaiting_confirmation' && job.proposal && (
            <>
              <section className={sectionClass}>
                <h2 className={sectionHeadingClass}>② 調べるキーワードと公式サイトを確定する</h2>
                <p className={hintClass}>
                  AIが会話から提案したキーワードです。回数は選んだ会話全体での出現回数、引用は会話の原文です。
                  選んだキーワードごとに、調べる公式サイトを選べます。サイトを選ばなかったキーワードや、選んだサイトで十分な情報が見つからなかったキーワードは、一般のサイトも調べます。
                </p>
                <ul className={plainListClass}>
                  {job.proposal.keywords.map((k) => (
                    <li
                      key={k.keyword}
                      className={proposalClassOf(selectedKeywords.has(k.keyword))}
                    >
                      <label className={proposalHeadClass}>
                        <input
                          type="checkbox"
                          checked={selectedKeywords.has(k.keyword)}
                          onChange={() => setSelectedKeywords((prev) => toggle(prev, k.keyword))}
                        />
                        <span className={proposalKeywordClass}>{k.keyword}</span>
                        <span className={proposalCountClass}>{k.frequency}回</span>
                      </label>
                      <p className={reasonClass}>{k.reason}</p>
                      {k.quotes.map((q, i) => (
                        <blockquote key={i} className={`${quoteClass} ml-[1.6rem]`}>
                          <span className="block text-[0.72rem] text-gray-400">
                            {job.transcriptionNames[q.transcriptionId] ?? ''} / {q.speakerName}
                          </span>
                          「{q.text}」
                        </blockquote>
                      ))}
                      {selectedKeywords.has(k.keyword) && (
                        <KeywordSites
                          proposed={k.domains ?? job.proposal!.domains}
                          selected={selectedSites[k.keyword] ?? []}
                          onChange={(sites) => setSelectedSites((prev) => ({ ...prev, [k.keyword]: sites }))}
                        />
                      )}
                    </li>
                  ))}
                  {customKeywords.map((k) => (
                    <li key={k} className={proposalClassOf(true)}>
                      <label className={proposalHeadClass}>
                        <input
                          type="checkbox"
                          checked
                          onChange={() => setSelectedKeywords((prev) => toggle(prev, k))}
                        />
                        <span className={proposalKeywordClass}>{k}</span>
                        <span className={proposalCountClass}>追加</span>
                      </label>
                      <KeywordSites
                        proposed={[]}
                        selected={selectedSites[k] ?? []}
                        onChange={(sites) => setSelectedSites((prev) => ({ ...prev, [k]: sites }))}
                      />
                    </li>
                  ))}
                </ul>
                <div className={addClass}>
                  <input
                    className={addInputClass}
                    value={customKeyword}
                    placeholder="キーワードを追加"
                    onChange={(e) => setCustomKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && addCustomKeyword()}
                  />
                  <button className={addButtonClass} onClick={addCustomKeyword}>
                    追加
                  </button>
                </div>
                <p className={noticeClass}>
                  確定したキーワードを Web 検索に使います。会話の本文は検索に使いません。
                </p>
                <button
                  className={primaryButtonClass}
                  disabled={selectedKeywords.size === 0 || busy}
                  onClick={handleConfirm}
                >
                  {busy ? '送信中...' : `${selectedKeywords.size}個のキーワードで調べる`}
                </button>
              </section>
            </>
          )}

          {job && ['researching', 'analyzing', 'evaluating'].includes(job.status) && (
            <div className={progressClass}>
              <div className={spinnerClass} />
              {STATUS_LABELS[job.status]}です。数分かかることがあります。この画面を離れても調査は続きます。
            </div>
          )}

          {job?.confirmed && (
            <section className={sectionClass}>
              <h2 className={sectionHeadingClass}>確定したキーワードと公式サイト</h2>
              <ConfirmedTargets job={job} />
            </section>
          )}

          {job?.status === 'completed' && (
            <div className={completedClass}>
              <span className={completedMessageClass}>✓ 調査が完了しました。</span>
              <button className={completedLinkClass} onClick={() => handleShowResult(job)}>
                調査結果を見る →
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'results' && (
        <div className={logsLayoutClass}>
          <div className={logsListClass}>
            <div className={logsListHeaderClass}>
              <span>調査結果</span>
              <button
                className={logsRefreshClass}
                onClick={() => void refreshJobs()}
                disabled={jobsLoading}
                title="更新"
              >
                ↻
              </button>
            </div>
            {jobsLoading && jobs.length === 0 ? (
              <div className={logsEmptyClass}>読み込み中...</div>
            ) : jobs.length === 0 ? (
              <div className={logsEmptyClass}>調査結果がありません</div>
            ) : (
              jobs.map((j) => (
                <button
                  key={j.id}
                  className={logItemClassOf(selectedResultId === j.id)}
                  onClick={() => void handleSelectResult(j)}
                >
                  {j.title && <div className="mb-1 leading-[1.4] font-semibold text-gray-800">{j.title}</div>}
                  <div className={logItemDateClass}>
                    {formatDate(j.createdAt)}
                    <span className={jobStatusClassOf(j.status)}>
                      {STATUS_LABELS[j.status]}
                    </span>
                  </div>
                  <div className={logItemKeywordsClass}>
                    {j.keywords.length === 0
                      ? 'キーワード未確定'
                      : j.keywords.slice(0, 2).join('・') +
                        (j.keywords.length > 2 ? ` 他${j.keywords.length - 2}件` : '')}
                  </div>
                  <div className={logItemModelClass}>
                    {j.transcriptionIds.map((id) => j.transcriptionNames[id] ?? id).join('、')}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className={logsDetailClass}>
            {error && <div className={errorClass}>{error}</div>}
            {!selectedResultId && (
              <div className={logsDetailEmptyClass}>
                左の一覧から調査結果を選択してください
              </div>
            )}
            {selectedResultId && resultLoading && (
              <div className={logsDetailEmptyClass}>読み込み中...</div>
            )}
            {selectedResultId && !resultLoading && resultJob && (
              <div className="mx-auto max-w-[880px]">
                <ResearchResult
                  job={resultJob}
                  onOpenTranscription={onOpenTranscription}
                  onContinue={(unfinished) => {
                    setJob(unfinished);
                    // 再開した調査は、「調査結果」タブにも反映する（戻ったときに失敗の表示を残さない）
                    setResultJob((prev) => (prev?.id === unfinished.id ? unfinished : prev));
                    setActiveTab('new');
                  }}
                  onTitleChange={(updated) => {
                    setResultJob(updated);
                    setJobs((prev) =>
                      prev.map((j) => (j.id === updated.id ? { ...j, title: updated.title } : j)),
                    );
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </PageLayout>
  );
}

/** 除いた文を読みやすくする（書式の記号・箇条書きの記号・内部の番号を除く） */
function plainClaim(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/^[\s\-*]+/, '')
    .replace(/[（(]\d+-\d+[)）]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 文を除いた理由を、利用者向けの決まった言葉で表す */
function removedReason(claim: ClaimCheck): string {
  if (claim.missingCitation === true) return 'この文には根拠のページが付いていませんでした。';
  if (claim.missingCitation === false) return '根拠のページに、この内容は書かれていませんでした。';
  return '根拠を確認できませんでした。';
}

/** 個人情報チェックで検出した文字列を「氏名 金井（4か所）」の形で並べる */
function findingList(findings: PreSendFinding[]): string {
  return findings.map((f) => `${f.label} ${f.text}（${f.count}か所）`).join('、');
}

/**
 * 送る前の確認（① 会話の読み込みの後、Claude に送る前と、キーワード提案の直後に行った確認）
 * 会話ごとに、伏せて送った文字列・伏せずに送った文字列と、文字起こしへのリンクを出す
 */
function PreSendChecksView({
  job,
  onOpenTranscription,
}: {
  job: ResearchJob;
  onOpenTranscription: Props['onOpenTranscription'];
}) {
  const checks = job.preSendChecks!;
  const conversationLabel = (id: string) =>
    `会話${job.transcriptionIds.indexOf(id) + 1}（${job.transcriptionNames[id] ?? id}）`;
  const others: { ok: boolean; text: string }[] = [];
  if (checks.droppedFrequentWords !== undefined && checks.droppedFrequentWords > 0) {
    others.push({
      ok: true,
      text: `伏せた文字列を含む頻出語 ${checks.droppedFrequentWords}件は、キーワード提案の参考として送りませんでした`,
    });
  }
  if (checks.droppedKeywords !== undefined) {
    others.push({
      ok: true,
      text:
        checks.droppedKeywords.length > 0
          ? `会話に出てこないキーワード（${checks.droppedKeywords.join('、')}）を、提案から外しました`
          : '提案されたキーワードは、すべて会話に出てきます',
    });
  }
  if (checks.droppedQuotes !== undefined) {
    others.push({
      ok: true,
      text:
        checks.droppedQuotes > 0
          ? `会話の原文と一致しない引用 ${checks.droppedQuotes}件を、提案から外しました`
          : '提案の引用は、すべて会話の原文と一致しました',
    });
  }

  return (
    <ul className={presendChecksClass}>
      {!checks.privacyConfigured && (
        <li>
          <span className={checkMarkClassOf('failed')}>!</span>
          個人情報チェック（Guardrail ID）が設定されていないため、会話は伏せずにそのまま送りました
        </li>
      )}
      {checks.privacyConfigured &&
        checks.privacy.map((p) => (
          <li key={p.transcriptionId}>
            <span className={checkMarkClassOf(p.scanned && p.needsReview === 0 ? 'passed' : 'warning')}>{p.scanned && p.needsReview === 0 ? '✓' : '!'}</span>
            <div className="flex-1 [&_p]:mt-1 [&_p]:text-[14px] [&_p]:text-gray-700">
              <div className="flex flex-wrap items-center gap-2 font-semibold">
                <span>{conversationLabel(p.transcriptionId)}</span>
                <button className={actionButtonClass} onClick={() => onOpenTranscription(p.transcriptionId)}>
                  文字起こしを開く
                </button>
              </div>
              {!p.scanned ? (
                <p>個人情報チェックをしていないため、伏せずにそのまま送りました。</p>
              ) : (
                <>
                  <p>
                    伏せて送った:{' '}
                    {p.maskedKinds === 0
                      ? 'なし'
                      : p.masked
                        ? findingList(p.masked)
                        : `${p.maskedKinds}種類（${p.maskedCount}か所）`}
                  </p>
                  <p>
                    伏せずに送った（要確認のまま）:{' '}
                    {p.needsReview === 0
                      ? 'なし'
                      : p.unmasked
                        ? findingList(p.unmasked)
                        : `${p.needsReview}件`}
                  </p>
                </>
              )}
            </div>
          </li>
        ))}
      {others.map((item, i) => (
        <li key={i}>
          <span className={checkMarkClassOf(item.ok ? 'passed' : 'warning')}>{item.ok ? '✓' : '!'}</span>
          {item.text}
        </li>
      ))}
    </ul>
  );
}

/** キーワードごとに調べる公式サイトを選ぶ（提案されたサイトのチェックと、サイトの追加） */
function KeywordSites({
  proposed,
  selected,
  onChange,
}: {
  proposed: DomainProposal[];
  selected: string[];
  onChange: (sites: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const added = selected.filter((d) => !proposed.some((p) => p.domain === d));
  const toggleSite = (domain: string) =>
    onChange(selected.includes(domain) ? selected.filter((d) => d !== domain) : [...selected, domain]);
  const add = () => {
    const value = input.trim();
    if (!value) return;
    if (!selected.includes(value)) onChange([...selected, value]);
    setInput('');
  };
  return (
    <div className="mt-[0.6rem] ml-[1.6rem] rounded-r-md border-l-3 border-l-blue-200 bg-slate-50 px-3 py-[0.6rem]">
      <span className="mb-[0.3rem] block text-xs font-semibold text-gray-600">調べる公式サイト</span>
      <ul
        className={`${plainListClass} [&_li]:border-b [&_li]:border-gray-100 [&_li]:py-2 [&_label]:flex [&_label]:cursor-pointer [&_label]:items-center [&_label]:gap-[0.6rem] [&_label]:text-[0.88rem]`}
      >
        {proposed.map((d) => (
          <li key={d.domain}>
            <label>
              <input type="checkbox" checked={selected.includes(d.domain)} onChange={() => toggleSite(d.domain)} />
              <span className={domainClass}>{d.domain}</span>
              <span className={domainOwnerClass}>{d.owner}</span>
            </label>
            <p className={reasonClass}>{d.reason}</p>
          </li>
        ))}
        {added.map((d) => (
          <li key={d}>
            <label>
              <input type="checkbox" checked onChange={() => toggleSite(d)} />
              <span className={domainClass}>{d}</span>
              <span className={domainOwnerClass}>追加</span>
            </label>
          </li>
        ))}
      </ul>
      {selected.length === 0 && <p className={hintClass}>サイトを選ばない場合は、一般のサイトを調べます。</p>}
      <div className={addClass}>
        <input
          className={addInputClass}
          value={input}
          placeholder="サイトを追加（例: anthropic.com）"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
        />
        <button className={addButtonClass} onClick={add}>
          追加
        </button>
      </div>
    </div>
  );
}

/** 確定したキーワードと、キーワードごとに調べた公式サイト（以前の調査は、全キーワード共通のサイト） */
function ConfirmedTargets({ job }: { job: ResearchJob }) {
  const confirmed = job.confirmed;
  if (!confirmed) return null;
  const targets = confirmed.targets ?? confirmed.keywords.map((keyword) => ({ keyword, domains: confirmed.domains }));
  const failed = new Set((job.webResearchFailures ?? []).map((f) => f.keyword));
  return (
    <ul className={`${plainListClass} [&_li]:flex [&_li]:flex-wrap [&_li]:items-center [&_li]:gap-[0.35rem] [&_li]:py-[0.2rem]`}>
      {targets.map((t) => (
        <li key={t.keyword}>
          <span className={`${chipClass} bg-blue-100 text-blue-800`}>{t.keyword}</span>
          {failed.has(t.keyword) && <span className="text-[0.72rem] text-red-700">Web調査に失敗</span>}
          {t.domains.length > 0 ? (
            t.domains.map((d) => (
              <span key={d} className={`${chipClass} bg-gray-100 text-gray-700 ${domainFontClass}`}>
                {d}
              </span>
            ))
          ) : (
            <span className={mutedSmallClass}>一般のサイト</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** 根拠の引用を短く表示する文字数（これを超える場合は「続きを読む」で開く） */
const QUOTE_PREVIEW_CHARS = 140;

/** 会話の引用は、先頭の「話者: 」を除く（話者は別に表示する） */
function quoteText(c: NumberedCitation): string {
  const text = c.citedText.trim();
  const prefix = c.utterance ? `${c.utterance.speakerName}: ` : '';
  return prefix && text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/** 秒を「1:02:03」「12:34」の形で表す */
function formatTime(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** 根拠の引用（長い場合は先頭だけを表示し、「続きを読む」で全文を表示する） */
function CitedText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > QUOTE_PREVIEW_CHARS;
  return (
    <blockquote className={quoteClass}>
      {long && !expanded ? `${text.slice(0, QUOTE_PREVIEW_CHARS)}…` : text}
      {long && (
        <button className={`${textButtonClass} ml-[0.4rem]`} onClick={() => setExpanded((v) => !v)}>
          {expanded ? '閉じる' : '続きを読む'}
        </button>
      )}
    </blockquote>
  );
}

/** 日時を「2026/10/11 10:32」の形で表す（要約結果と同じ） */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** URL からサイト名（www. を除いたホスト名）を取り出す */
function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 開いている出典の吹き出し（論点・まとめた根拠と、表示する位置） */
interface OpenCite {
  topic: number;
  numbers: number[];
  top: number;
  left: number;
}

/**
 * 調査の結果を、読む人が知りたい順に表示する
 * 何を調べたか → 信頼度のまとめ → 目次 → キーワードごとの解説 → 評価の詳細
 * キーワードごとに、解説（根拠は文の末尾に短く示し、クリックで吹き出し）・さらに読む・会話で話題になった箇所を表示する
 */
/** 調査のタイトル（調査結果の見出し）。タイトルを変更できる */
function ResearchTitle({
  job,
  onChange,
}: {
  job: ResearchJob;
  onChange: (job: ResearchJob) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(job.title ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 別の調査を選んだときは、編集をやめる
  useEffect(() => {
    setDraft(job.title ?? '');
    setEditing(false);
    setError(null);
  }, [job.id, job.title]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onChange(await updateResearchTitle(job.id, draft));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          className="min-w-[240px] flex-1 rounded-md border border-gray-300 px-[10px] py-2 text-[16px]"
          value={draft}
          maxLength={60}
          autoFocus
          aria-label="調査のタイトル"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <button
          className={`${titleButtonClass} border-blue-600 bg-blue-600 text-white`}
          disabled={saving || !draft.trim()}
          onClick={() => void save()}
        >
          {saving ? '保存中...' : '保存'}
        </button>
        <button className={`${titleButtonClass} border-gray-300 bg-white text-gray-700`} disabled={saving} onClick={() => setEditing(false)}>
          キャンセル
        </button>
        {error && <div className={errorClass}>{error}</div>}
      </div>
    );
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <h2 className={`m-0 text-[20px] ${job.title ? 'text-gray-800' : 'text-gray-400'}`}>{job.title ?? 'タイトルなし'}</h2>
      <button className={`${titleButtonClass} border-gray-300 bg-white text-gray-700`} onClick={() => setEditing(true)}>
        {job.title ? 'タイトルを変更' : 'タイトルを付ける'}
      </button>
    </div>
  );
}

function ResearchResult({
  job,
  onOpenTranscription,
  onTitleChange,
  onContinue,
}: {
  job: ResearchJob;
  onOpenTranscription: Props['onOpenTranscription'];
  onTitleChange: (job: ResearchJob) => void;
  /** 終わっていない調査を「新しい調査」のタブで続ける */
  onContinue: (job: ResearchJob) => void;
}) {
  const [openCite, setOpenCite] = useState<OpenCite | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // 会話は、選んだ順に「会話1」「会話2」と呼ぶ（ファイル名は読みにくいため）
  const conversationNo = useMemo(
    () => new Map(job.transcriptionIds.map((id, i) => [id, i + 1])),
    [job.transcriptionIds],
  );
  // 論点（キーワード）ごとに、出典の表示付きの HTML を作る
  const topics = useMemo(() => {
    if (!job.report || job.status !== 'completed') return [];
    const label = (c: ReportCitation) => {
      if (c.sourceKind === 'web') return `${siteName(c.sourceId)}${c.official ? ' 公式' : ''}`;
      const name = `会話${conversationNo.get(c.sourceId) ?? ''}`;
      return c.utterance ? `${name} ${formatTime(c.utterance.start)}` : name;
    };
    return splitTopics(job.report).map((topic) => {
      const built = buildReport(topic.segments, label);
      // さらに読む: 関連リンクの共通設定（utils/relatedLinks.ts）で選んだページ
      const pages = selectRelatedLinks(topic.segments).map((link) => link.citation);
      const mentions = job.mentions?.find((m) => m.keyword === topic.title);
      return { title: topic.title, ...built, pages, mentions, ...topicHighlights(topic.segments) };
    });
  }, [job, conversationNo]);

  // 吹き出しの外をクリックするか Esc キーで閉じる
  useEffect(() => {
    if (!openCite) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.target instanceof Element && e.target.closest('.research-cite-popover, .research-cite')) return;
      setOpenCite(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [openCite]);

  /** 出典の表示をクリックしたら、その根拠を吹き出しで表示する */
  const handleReportClick = (e: MouseEvent<HTMLDivElement>) => {
    const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-citations]');
    const topicEl = chip?.closest<HTMLElement>('[data-topic]');
    if (!chip || !topicEl || !bodyRef.current) return;
    const topic = Number(topicEl.dataset.topic);
    const numbers = (chip.dataset.citations ?? '').split(',').map(Number);
    if (openCite && openCite.topic === topic && openCite.numbers.join() === numbers.join()) {
      setOpenCite(null);
      return;
    }
    const box = bodyRef.current.getBoundingClientRect();
    const rect = chip.getBoundingClientRect();
    setOpenCite({
      topic,
      numbers,
      top: rect.bottom - box.top + 6,
      left: Math.max(0, Math.min(rect.left - box.left, box.width - 360)),
    });
  };

  const scrollToTopic = (index: number) =>
    document
      .getElementById(`research-topic-${index}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const evaluation = job.status === 'completed' ? job.evaluation : undefined;
  const reviewCount = evaluation?.reviewClaims?.length ?? 0;
  const topicIndex = (keyword: string) => topics.findIndex((t) => t.title === keyword);
  // 除いた文は、論点がわかるもの（新しい調査）は解説の中に、わからないもの（以前の調査）は記録に出す
  const removedIn = (keyword: string | null) =>
    keyword ? (evaluation?.removedClaims.filter((c) => c.topic === keyword) ?? []) : [];
  const removedWithoutTopic = evaluation?.removedClaims.filter((c) => !c.topic) ?? [];
  const removedInTopics = (evaluation?.removedClaims.length ?? 0) - removedWithoutTopic.length;

  // 次にできること: 確認が必要なところ（評価・Web調査の失敗・会話との食い違い）と、読むとよい公式ページ
  // 以前の調査は、解説の「関連するキーワード」の判定も保存しているため、確定したキーワードだけを見る
  const relevance =
    evaluation?.relevance.filter((r) => !job.confirmed || job.confirmed.keywords.includes(r.keyword)) ?? [];
  const notAnswered = relevance.filter((r) => !r.answered).map((r) => r.keyword);
  const failedEthics = evaluation?.ethics.filter((e) => !e.passed) ?? [];
  const failedResearch = job.webResearchFailures?.map((f) => f.keyword) ?? [];
  const differences = topics.filter((t) => t.title && t.hasDifference);
  const issueCount = notAnswered.length + failedEthics.length + failedResearch.length + differences.length;
  // キーワードごとに、関連リンクの1件目を読むとよいページとして出す
  const readingPages = topics.flatMap((t) =>
    t.title && t.pages.length > 0 ? [{ keyword: t.title, page: t.pages[0] }] : [],
  );

  return (
    <>
      <ResearchTitle job={job} onChange={onTitleChange} />

      <p className="-mt-2 mb-4 text-[13px] text-gray-500">
        {formatDate(job.createdAt)} ・ 会話{job.transcriptionIds.length}件
        {job.confirmed && ` ・ キーワード${job.confirmed.keywords.length}つ`}
      </p>

      {(job.status === 'awaiting_confirmation' || RUNNING.includes(job.status)) && (
        <div className="mb-4 [&_p]:my-3 [&_p]:text-gray-700">
          <StepFlow status={job.status} />
          <p>
            {job.status === 'awaiting_confirmation'
              ? 'この調査は、キーワードの確定を待っています。'
              : `この調査は進行中です（${STATUS_LABELS[job.status]}）。`}
          </p>
          <button className={actionButtonClass} onClick={() => onContinue(job)}>
            {job.status === 'awaiting_confirmation' ? 'キーワードを確定して続ける' : '進み具合を見る'}
          </button>
        </div>
      )}

      {job.status === 'failed' && (
        <>
          <StepFlow status={job.status} failedStage={job.failedStage ?? job.resume?.from} />
          {/* 再開したら、進み具合を「新しい調査」のタブで見る */}
          <ResearchFailure job={job} onResumed={onContinue} />
        </>
      )}

      {topics.length > 0 && (
        <>
          <AiGeneratedNotice basis="根拠" model={job.models.analysis} />

          {/* 要点（キーワードごとの「一言でいうと」。キーワードを押すと解説に移る） */}
          <section
          className={`${sectionClass} [&_ul]:m-0 [&_ul]:list-none [&_ul]:p-0 [&_li]:grid [&_li]:grid-cols-[200px_1fr] [&_li]:gap-3 [&_li]:border-b [&_li]:border-gray-100 [&_li]:py-2 [&_li]:leading-[1.6] [&_li:last-child]:border-b-0`}
        >
            <h2 className={sectionHeadingClass}>要点</h2>
            <ul>
              {topics.map((t, i) =>
                t.title ? (
                  <li key={i}>
                    <button className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-left font-semibold text-blue-600 hover:underline" onClick={() => scrollToTopic(i)}>
                      {t.title}
                    </button>
                    <span>
                      {t.oneLiner ??
                        (removedIn(t.title).some((c) => c.claim.includes('一言でいうと'))
                          ? '（一言の説明は、根拠を確認できなかったため除きました。解説の中に表示しています）'
                          : '（一言の説明はありません。解説を読んでください）')}
                    </span>
                  </li>
                ) : null,
              )}
            </ul>
          </section>

          {/* 次にできること */}
          <section className={sectionClass}>
            <h2 className={sectionHeadingClass}>次にできること</h2>
            {evaluation && (
              <p className={`mb-3 font-semibold ${issueCount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {issueCount > 0
                  ? `確認するとよいところが${issueCount}件あります`
                  : `✓ ${relevance.length}つのキーワードとも、根拠付きで説明できています`}
                <span className="ml-1.5 text-[13px] font-normal text-gray-500">
                  （根拠付き {percent(evaluation.citationCoverage)}・公式の根拠 {percent(evaluation.officialSourceRate)}・AI倫理{' '}
                  {failedEthics.length === 0 ? '問題なし' : `${failedEthics.length}件の問題`}）
                </span>
              </p>
            )}
            <ul
            // warning は、注意が必要な項目を見分けるための目印（項目の色と左の線を変える）
            className={`${plainListClass} [&_li]:mb-1.5 [&_li]:flex [&_li]:flex-wrap [&_li]:items-center [&_li]:gap-2 [&_li]:rounded-md [&_li]:bg-gray-50 [&_li]:px-[10px] [&_li]:py-2 [&_li]:leading-normal [&_li.warning]:border-l-3 [&_li.warning]:border-l-amber-500 [&_li.warning]:bg-amber-50 [&_li>span]:min-w-[200px] [&_li>span]:flex-1`}
          >
              {failedEthics.map((e) => (
                <li key={e.item} className="warning">
                  <span>AI倫理の確認で問題が見つかりました: {e.item}（{e.detail}）。解説をそのまま使う前に内容を確かめてください。</span>
                </li>
              ))}
              {failedResearch.map((keyword) => (
                <li key={`failed-${keyword}`} className="warning">
                  <span>「{keyword}」は Web調査に失敗したため、解説が少ないか、ないことがあります。</span>
                </li>
              ))}
              {notAnswered.map((keyword) => (
                <li key={`thin-${keyword}`} className="warning">
                  <span>「{keyword}」は Web の情報が少なく、説明が不十分です。</span>
                  {topicIndex(keyword) >= 0 && (
                    <button className={actionButtonClass} onClick={() => scrollToTopic(topicIndex(keyword))}>
                      解説を見る
                    </button>
                  )}
                </li>
              ))}
              {differences.map((t) => (
                <li key={`diff-${t.title}`}>
                  <span>「{t.title}」は、会話での説明と Web の説明に違いがあります。</span>
                  <button className={actionButtonClass} onClick={() => scrollToTopic(topicIndex(t.title!))}>
                    違いを読む
                  </button>
                  {t.mentions && t.mentions.items.length > 0 && (
                    <button
                      className={actionButtonClass}
                      onClick={() =>
                        onOpenTranscription(t.mentions!.items[0].transcriptionId, t.mentions!.items[0].utteranceIndex)
                      }
                    >
                      会話を聞き直す
                    </button>
                  )}
                </li>
              ))}
              {readingPages.map(({ keyword, page }) => (
                <li key={`page-${keyword}`}>
                  <span>
                    「{keyword}」を詳しく知るなら、{page.official ? '公式ページ' : 'この記事'}から読む: {page.title}
                  </span>
                  <a className={actionButtonClass} href={page.sourceId} target="_blank" rel="noopener noreferrer">
                    ページを開く
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <p className={hintClass}>
            文の後ろの「langchain.com 公式」などは、その文の根拠です。クリックすると、根拠になったページの抜粋を確かめられます。
          </p>

          {/* キーワードごとの解説 */}
          <div className="relative" ref={bodyRef} onClick={handleReportClick}>
            {topics.map((t, i) => (
              <section key={i} id={`research-topic-${i}`} className="mb-4 scroll-mt-4 rounded-lg border border-gray-200 bg-white px-5 py-4" data-topic={i}>
                {t.title && notAnswered.includes(t.title) && (
                  <p className="mb-2 rounded-md bg-amber-50 px-[10px] py-2 text-[14px] text-amber-800">
                    Web の情報が少なく、この解説は「{t.title}」を十分に説明できていません。
                  </p>
                )}
                <div
                  className="rounded-lg bg-white text-base leading-[1.8] text-gray-800 [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-gray-200 [&_h2]:pb-[0.3rem] [&_h2]:text-[1.05rem] [&_h2:first-child]:mt-0 [&_ul]:pl-5"
                  dangerouslySetInnerHTML={{ __html: t.html }} />
                {removedIn(t.title).length > 0 && (
                  <div className="my-3 rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-[10px] [&_ul]:m-0 [&_ul]:pl-[18px]">
                    <p className="mb-1.5 text-[13px] font-semibold text-gray-500">根拠を確認できなかったため、表示から除いた文</p>
                    <ul>
                      {removedIn(t.title).map((c, j) => (
                        <li key={j}>
                          <p className="m-0 text-gray-500 line-through decoration-gray-300">{plainClaim(c.claim)}</p>
                          <p className={checkDetailClass}>
                            {removedReason(c)}
                            {t.pages.length > 0 && '正しいかどうかは、下の「さらに読む」のページで確かめてください。'}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {t.pages.length > 0 && (
                  <div className={topicExtraClass}>
                    <h3>さらに読む</h3>
                    <ul
                      className={`${plainListClass} [&_li]:flex [&_li]:flex-wrap [&_li]:items-baseline [&_li]:gap-2 [&_li]:border-b [&_li]:border-gray-100 [&_li]:py-[0.4rem] [&_li]:text-md [&_li]:wrap-anywhere`}
                    >
                      {t.pages.map((c) => (
                        <li key={c.sourceId}>
                          <span className={citationKindClassOf('web', c.official)}>
                            {c.official ? '公式' : 'Web'}
                          </span>
                          <a href={c.sourceId} target="_blank" rel="noopener noreferrer">
                            {c.title}
                          </a>
                          <span className={extraMutedSmallClass}>{siteName(c.sourceId)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {t.mentions && t.mentions.total > 0 && (
                  <div className={topicExtraClass}>
                    <h3>
                      会話で話題になった箇所
                      {t.mentions.total > t.mentions.items.length && (
                        <span className={extraMutedSmallClass}>（全{t.mentions.total}か所のうち最初の{t.mentions.items.length}か所）</span>
                      )}
                    </h3>
                    <div className="flex flex-wrap gap-[0.4rem]">
                      {t.mentions.items.map((m) => (
                        <button
                          key={`${m.transcriptionId}-${m.utteranceIndex}`}
                          className={citeClassOf('conversation', true)}
                          onClick={() => onOpenTranscription(m.transcriptionId, m.utteranceIndex)}
                          title={`${m.speakerName}の発言を文字起こしで開く`}
                        >
                          会話{conversationNo.get(m.transcriptionId)} {formatTime(m.start)} {m.speakerName}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            ))}
            {openCite && (
              <div
                // research-cite-popover は、出典の吹き出しを見分けるための目印
                className="research-cite-popover absolute z-10 max-h-[360px] w-[360px] max-w-full overflow-y-auto rounded-lg border border-gray-300 bg-white p-3 text-[0.82rem] shadow-[0_8px_24px] shadow-black/12"
                style={{ top: openCite.top, left: openCite.left }}
                role="dialog"
              >
                {openCite.numbers.map((n) => {
                  const c = topics[openCite.topic].citations[n - 1];
                  return (
                    <div key={n} className="flex flex-col gap-[0.35rem] wrap-anywhere [&+&]:mt-3 [&+&]:border-t [&+&]:border-gray-100 [&+&]:pt-3">
                      {c.sourceKind === 'conversation' ? (
                        <div className={citationMetaClass}>
                          <span className={citationKindClassOf('conversation')}>
                            会話{conversationNo.get(c.sourceId)}
                          </span>
                          {c.utterance && (
                            <>
                              <span className="text-blue-600 tabular-nums">{formatTime(c.utterance.start)}</span>
                              <span className="font-semibold text-gray-700">{c.utterance.speakerName}</span>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className={citationMetaClass}>
                          <span className={citationKindClassOf('web', c.official)}>
                            {c.official ? 'Web（公式）' : 'Web'}
                          </span>
                          <span className="text-gray-700">{c.title}</span>
                        </div>
                      )}
                      <CitedText text={quoteText(c)} />
                      {c.sourceKind === 'conversation' ? (
                        <button
                          className={`${textButtonClass} self-start`}
                          onClick={() => onOpenTranscription(c.sourceId, c.utterance?.index)}
                        >
                          {c.utterance ? '文字起こしのこの発言を見る →' : '文字起こしを開く →'}
                        </button>
                      ) : (
                        <a className={`${textButtonClass} self-start`} href={c.sourceId} target="_blank" rel="noopener noreferrer">
                          ページを開く →
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 誤りの報告（複数の会話を使うため、どれかの文字起こしを削除すると報告も削除する） */}
          <FeedbackButton
            key={job.id}
            feature="research"
            targetId={job.id}
            transcriptionId={job.transcriptionIds[0]}
            transcriptionIds={job.transcriptionIds}
          />
        </>
      )}

      {/* この調査の記録（普段は開かなくてよい内容） */}
      <details className={`${sectionClass} [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-[15px]`}>
        <summary>この調査の記録</summary>
        <section className="mb-4 rounded-lg border border-gray-200 bg-white px-[1.1rem] py-[0.9rem] text-md [&_dd]:m-0 [&_dd]:wrap-anywhere [&_dd]:text-gray-800 [&_dl]:m-0 [&_dl]:grid [&_dl]:grid-cols-[6rem_1fr] [&_dl]:gap-x-3 [&_dl]:gap-y-[0.45rem] [&_dt]:text-gray-500">
          <dl>
            <dt>日時</dt>
            <dd>
              {formatDate(job.createdAt)}
              <span className="ml-3 text-xs text-gray-400">{job.models.analysis}</span>
            </dd>
            <dt>会話</dt>
            <dd>
              {job.transcriptionIds.map((id) => (
                <div key={id}>
                  会話{conversationNo.get(id)}: {job.transcriptionNames[id] ?? id}
                </div>
              ))}
            </dd>
            {job.confirmed && (
              <>
                <dt>キーワード</dt>
                <dd>
                  <ConfirmedTargets job={job} />
                </dd>
              </>
            )}
          </dl>
        </section>

        {job.preSendChecks && (
          <>
            <h3>送る前の確認</h3>
            <PreSendChecksView job={job} onOpenTranscription={onOpenTranscription} />
          </>
        )}

        {evaluation && (
          <>
            <h3>評価</h3>
            <p className={recordLineClass}>
              根拠付き {percent(evaluation.citationCoverage)}・裏付けあり {percent(evaluation.supportedRate)}・Webの根拠のうち公式{' '}
              {percent(evaluation.officialSourceRate)}・根拠がなく除いた文 {evaluation.removedClaims.length}件
            </p>
            <ul className={checksClass}>
              {evaluation.ethics.map((e) => (
                <li key={e.item}>
                  <span className={checkMarkClassOf(e.passed ? 'passed' : 'failed')}>{e.passed ? '✓' : '✕'}</span>
                  {e.item}
                </li>
              ))}
            </ul>
            {reviewCount > 0 && (
              <details className={removedClass}>
                <summary>評価モデルと Guardrails の判定が分かれた文（{reviewCount}件）</summary>
                <ul>
                  {evaluation.reviewClaims!.map((c, i) => (
                    <li key={i}>
                      <p>{c.claim}</p>
                      <p className={checkDetailClass}>{c.reason}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {removedInTopics > 0 && (
              <p className={recordLineClass}>
                根拠を確認できなかった文 {removedInTopics}件は、各キーワードの解説の中に表示しています。
              </p>
            )}
            {removedWithoutTopic.length > 0 && (
              <details className={removedClass}>
                <summary>根拠を確認できなかったため、表示から除いた文（{removedWithoutTopic.length}件）</summary>
                <ul>
                  {removedWithoutTopic.map((c, i) => (
                    <li key={i}>
                      <p>{plainClaim(c.claim)}</p>
                      <p className={checkDetailClass}>{removedReason(c)}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className={hintClass}>
              評価は、分析とは別のモデル（{evaluation.judgeModel}）が、各文とその根拠を突き合わせて判定しています。評価もAIによるため、重要な判断の前には根拠を確認してください。
            </p>
          </>
        )}
      </details>
    </>
  );
}
