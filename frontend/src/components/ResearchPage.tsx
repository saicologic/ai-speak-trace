import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  confirmResearch,
  fetchResearchJob,
  fetchResearchJobs,
  fetchTranscription,
  fetchTranscriptions,
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
import { buildReport, splitTopics, topicHighlights } from '../utils/researchReport';
import type { NumberedCitation } from '../utils/researchReport';
import { AiGeneratedNotice } from './AiGeneratedNotice';
import { useGuardrailConfigured } from '../hooks/usePrivacyStatuses';
import { GuardrailMissingNotice, PrivacyPanel } from './PrivacyPanel';
import './InterviewPage.css';
import './SummaryPage.css';
import './ResearchPage.css';

interface Props {
  onBack: () => void;
  /** 根拠の発言を、元の文字起こしで開く（utteranceIndex がなければ文字起こしの先頭を開く） */
  onOpenTranscription: (transcriptionId: string, utteranceIndex?: number) => void;
}

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

/** 調査の流れ（5段） */
function StepFlow({ status }: { status: ResearchStatus | undefined }) {
  const { done, active } = stepState(status);
  return (
    <ol className="research-steps">
      {STEPS.map((step, i) => {
        const state = i === active ? 'active' : i < done ? 'done' : 'pending';
        return (
          <li key={step.label} className={`research-step ${state}`}>
            <span className="research-step-number">{i < done && i !== active ? '✓' : i + 1}</span>
            <span className="research-step-label">{step.label}</span>
            <span className="research-step-detail">{step.detail}</span>
          </li>
        );
      })}
    </ol>
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
  const handleSelectResult = async (summary: ResearchJobSummary) => {
    setError(null);
    if (summary.status === 'awaiting_confirmation' || RUNNING.includes(summary.status)) {
      try {
        setJob(await fetchResearchJob(summary.id));
        setActiveTab('new');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
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
    <div className="research-page">
      <header className="research-header">
        <button className="research-back-button" onClick={onBack}>
          ← 戻る
        </button>
        <h1>ディープサーチ（ベータ）</h1>
        {activeTab === 'new' && job && (
          <button className="research-new-button" onClick={() => setJob(null)}>
            ＋ 新しい調査
          </button>
        )}
      </header>

      <div className="interview-tabs">
        <button
          className={`interview-tab ${activeTab === 'new' ? 'active' : ''}`}
          onClick={() => setActiveTab('new')}
        >
          新しい調査
        </button>
        <button
          className={`interview-tab ${activeTab === 'results' ? 'active' : ''}`}
          onClick={() => setActiveTab('results')}
        >
          調査結果
        </button>
      </div>

      {activeTab === 'new' && (
        <div className="research-content">
          {error && <div className="research-error">{error}</div>}

          <StepFlow status={job?.status} />

          {/* ① 会話の選択（新しい調査） */}
          {!job && (
            <>
              <section className="research-section">
                <h2>① 調べる会話を選ぶ</h2>
                <p className="research-hint">
                  選んだ会話の全文をもとに、AIが調べるべきキーワードを提案します。前編・後編のように、関連する会話をまとめて選べます。
                </p>
                <ul className="research-transcriptions">
                  {transcriptions.map((t) => (
                    <li key={t.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(t.id)}
                          onChange={() => setSelectedIds((prev) => toggle(prev, t.id))}
                        />
                        <span className="research-transcription-name">{t.audioFileName}</span>
                        <span className="research-transcription-date">
                          {new Date(t.createdAt).toLocaleDateString('ja-JP')}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="research-notice">
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
                  className="research-primary-button"
                  disabled={selectedIds.size === 0 || busy || guardrailConfigured === false}
                  onClick={handleStart}
                >
                  {busy ? '準備中...' : `${selectedIds.size}件の会話で調査を始める`}
                </button>
              </section>

            </>
          )}

          {job && (
            <section className="research-section">
              {job.title && <p className="research-current-title">{job.title}</p>}
              <h2>調べている会話</h2>
              <ul className="research-selected-transcriptions">
                {job.transcriptionIds.map((id, i) => (
                  <li key={id}>
                    会話{i + 1}: {job.transcriptionNames[id] ?? id}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {job?.preSendChecks && (
            <section className="research-section">
              <h2>送る前の確認</h2>
              <PreSendChecksView job={job} onOpenTranscription={onOpenTranscription} />
            </section>
          )}

          {job?.status === 'failed' && (
            <div className="research-error">調査に失敗しました: {job.error}</div>
          )}

          {job?.status === 'proposing' && (
            <div className="research-progress">
              <div className="research-spinner" />
              会話を読み込み、調べるべきキーワードと公式サイトを提案しています...
            </div>
          )}

          {/* ② キーワードと公式サイトの確定 */}
          {job?.status === 'awaiting_confirmation' && job.proposal && (
            <>
              <section className="research-section">
                <h2>② 調べるキーワードと公式サイトを確定する</h2>
                <p className="research-hint">
                  AIが会話から提案したキーワードです。回数は選んだ会話全体での出現回数、引用は会話の原文です。
                  選んだキーワードごとに、調べる公式サイトを選べます。サイトを選ばなかったキーワードや、選んだサイトで十分な情報が見つからなかったキーワードは、一般のサイトも調べます。
                </p>
                <ul className="research-proposals">
                  {job.proposal.keywords.map((k) => (
                    <li
                      key={k.keyword}
                      className={`research-proposal ${selectedKeywords.has(k.keyword) ? 'selected' : ''}`}
                    >
                      <label className="research-proposal-head">
                        <input
                          type="checkbox"
                          checked={selectedKeywords.has(k.keyword)}
                          onChange={() => setSelectedKeywords((prev) => toggle(prev, k.keyword))}
                        />
                        <span className="research-proposal-keyword">{k.keyword}</span>
                        <span className="research-proposal-count">{k.frequency}回</span>
                      </label>
                      <p className="research-proposal-reason">{k.reason}</p>
                      {k.quotes.map((q, i) => (
                        <blockquote key={i} className="research-quote">
                          <span className="research-quote-speaker">
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
                    <li key={k} className="research-proposal selected">
                      <label className="research-proposal-head">
                        <input
                          type="checkbox"
                          checked
                          onChange={() => setSelectedKeywords((prev) => toggle(prev, k))}
                        />
                        <span className="research-proposal-keyword">{k}</span>
                        <span className="research-proposal-count">追加</span>
                      </label>
                      <KeywordSites
                        proposed={[]}
                        selected={selectedSites[k] ?? []}
                        onChange={(sites) => setSelectedSites((prev) => ({ ...prev, [k]: sites }))}
                      />
                    </li>
                  ))}
                </ul>
                <div className="research-add">
                  <input
                    value={customKeyword}
                    placeholder="キーワードを追加"
                    onChange={(e) => setCustomKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && addCustomKeyword()}
                  />
                  <button onClick={addCustomKeyword}>追加</button>
                </div>
                <p className="research-notice">
                  確定したキーワードを Web 検索に使います。会話の本文は検索に使いません。
                </p>
                <button
                  className="research-primary-button"
                  disabled={selectedKeywords.size === 0 || busy}
                  onClick={handleConfirm}
                >
                  {busy ? '送信中...' : `${selectedKeywords.size}個のキーワードで調べる`}
                </button>
              </section>
            </>
          )}

          {job && ['researching', 'analyzing', 'evaluating'].includes(job.status) && (
            <div className="research-progress">
              <div className="research-spinner" />
              {STATUS_LABELS[job.status]}です。数分かかることがあります。この画面を離れても調査は続きます。
            </div>
          )}

          {job?.confirmed && (
            <section className="research-section">
              <h2>確定したキーワードと公式サイト</h2>
              <ConfirmedTargets job={job} />
            </section>
          )}

          {job?.status === 'completed' && (
            <div className="summary-completed">
              <span className="summary-completed-message">✓ 調査が完了しました。</span>
              <button className="summary-completed-link" onClick={() => handleShowResult(job)}>
                調査結果を見る →
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'results' && (
        <div className="interview-logs-layout">
          <div className="interview-logs-list">
            <div className="interview-logs-list-header">
              <span>調査結果</span>
              <button
                className="interview-logs-refresh"
                onClick={() => void refreshJobs()}
                disabled={jobsLoading}
                title="更新"
              >
                ↻
              </button>
            </div>
            {jobsLoading && jobs.length === 0 ? (
              <div className="interview-logs-empty">読み込み中...</div>
            ) : jobs.length === 0 ? (
              <div className="interview-logs-empty">調査結果がありません</div>
            ) : (
              jobs.map((j) => (
                <button
                  key={j.id}
                  className={`interview-log-item ${selectedResultId === j.id ? 'selected' : ''}`}
                  onClick={() => void handleSelectResult(j)}
                >
                  {j.title && <div className="research-job-title">{j.title}</div>}
                  <div className="interview-log-item-date">
                    {formatDate(j.createdAt)}
                    <span className={`research-job-status ${j.status}`}>
                      {STATUS_LABELS[j.status]}
                    </span>
                  </div>
                  <div className="interview-log-item-keywords">
                    {j.keywords.length === 0
                      ? 'キーワード未確定'
                      : j.keywords.slice(0, 2).join('・') +
                        (j.keywords.length > 2 ? ` 他${j.keywords.length - 2}件` : '')}
                  </div>
                  <div className="summary-log-model">
                    {j.transcriptionIds.map((id) => j.transcriptionNames[id] ?? id).join('、')}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="interview-logs-detail">
            {error && <div className="research-error">{error}</div>}
            {!selectedResultId && (
              <div className="interview-logs-detail-empty">
                左の一覧から調査結果を選択してください
              </div>
            )}
            {selectedResultId && resultLoading && (
              <div className="interview-logs-detail-empty">読み込み中...</div>
            )}
            {selectedResultId && !resultLoading && resultJob && (
              <div className="research-result">
                <ResearchResult
                  job={resultJob}
                  onOpenTranscription={onOpenTranscription}
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
    </div>
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
    <ul className="research-checks research-presend">
      {!checks.privacyConfigured && (
        <li className="failed">
          <span className="research-check-mark">!</span>
          個人情報チェック（Guardrail ID）が設定されていないため、会話は伏せずにそのまま送りました
        </li>
      )}
      {checks.privacyConfigured &&
        checks.privacy.map((p) => (
          <li key={p.transcriptionId} className={p.scanned && p.needsReview === 0 ? 'passed' : 'warning'}>
            <span className="research-check-mark">{p.scanned && p.needsReview === 0 ? '✓' : '!'}</span>
            <div className="research-presend-body">
              <div className="research-presend-head">
                <span>{conversationLabel(p.transcriptionId)}</span>
                <button className="research-action-button" onClick={() => onOpenTranscription(p.transcriptionId)}>
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
        <li key={i} className={item.ok ? 'passed' : 'warning'}>
          <span className="research-check-mark">{item.ok ? '✓' : '!'}</span>
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
    <div className="research-keyword-sites">
      <span className="research-keyword-sites-label">調べる公式サイト</span>
      <ul className="research-domains">
        {proposed.map((d) => (
          <li key={d.domain}>
            <label>
              <input type="checkbox" checked={selected.includes(d.domain)} onChange={() => toggleSite(d.domain)} />
              <span className="research-domain">{d.domain}</span>
              <span className="research-domain-owner">{d.owner}</span>
            </label>
            <p className="research-domain-reason">{d.reason}</p>
          </li>
        ))}
        {added.map((d) => (
          <li key={d}>
            <label>
              <input type="checkbox" checked onChange={() => toggleSite(d)} />
              <span className="research-domain">{d}</span>
              <span className="research-domain-owner">追加</span>
            </label>
          </li>
        ))}
      </ul>
      {selected.length === 0 && <p className="research-hint">サイトを選ばない場合は、一般のサイトを調べます。</p>}
      <div className="research-add">
        <input
          value={input}
          placeholder="サイトを追加（例: anthropic.com）"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
        />
        <button onClick={add}>追加</button>
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
    <ul className="research-targets">
      {targets.map((t) => (
        <li key={t.keyword}>
          <span className="research-chip">{t.keyword}</span>
          {failed.has(t.keyword) && <span className="research-target-failed">Web調査に失敗</span>}
          {t.domains.length > 0 ? (
            t.domains.map((d) => (
              <span key={d} className="research-chip domain">
                {d}
              </span>
            ))
          ) : (
            <span className="research-web-domain">一般のサイト</span>
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
    <blockquote className="research-quote">
      {long && !expanded ? `${text.slice(0, QUOTE_PREVIEW_CHARS)}…` : text}
      {long && (
        <button className="research-quote-toggle" onClick={() => setExpanded((v) => !v)}>
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
      <div className="research-title research-title--editing">
        <input
          className="research-title-input"
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
          className="research-title-button primary"
          disabled={saving || !draft.trim()}
          onClick={() => void save()}
        >
          {saving ? '保存中...' : '保存'}
        </button>
        <button className="research-title-button" disabled={saving} onClick={() => setEditing(false)}>
          キャンセル
        </button>
        {error && <div className="research-error">{error}</div>}
      </div>
    );
  }
  return (
    <div className="research-title">
      <h2 className={job.title ? '' : 'research-title-empty'}>{job.title ?? 'タイトルなし'}</h2>
      <button className="research-title-button" onClick={() => setEditing(true)}>
        {job.title ? 'タイトルを変更' : 'タイトルを付ける'}
      </button>
    </div>
  );
}

function ResearchResult({
  job,
  onOpenTranscription,
  onTitleChange,
}: {
  job: ResearchJob;
  onOpenTranscription: Props['onOpenTranscription'];
  onTitleChange: (job: ResearchJob) => void;
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
      // さらに読む: この論点で引用した Web ページ（公式を先に）
      const pages = Array.from(
        new Map(
          built.citations.filter((c) => c.sourceKind === 'web').map((c) => [c.sourceId, c] as const),
        ).values(),
      ).sort((a, b) => Number(b.official ?? false) - Number(a.official ?? false));
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
  const officialPages = topics.flatMap((t) => {
    const page = t.pages.find((c) => c.official);
    return t.title && page ? [{ keyword: t.title, page }] : [];
  });

  return (
    <>
      <ResearchTitle job={job} onChange={onTitleChange} />

      <p className="research-meta">
        {formatDate(job.createdAt)} ・ 会話{job.transcriptionIds.length}件
        {job.confirmed && ` ・ キーワード${job.confirmed.keywords.length}つ`}
      </p>

      {job.status === 'failed' && (
        <>
          <StepFlow status={job.status} />
          <div className="research-error">調査に失敗しました: {job.error}</div>
        </>
      )}

      {topics.length > 0 && (
        <>
          <AiGeneratedNotice basis="根拠" />

          {/* 要点（キーワードごとの「一言でいうと」。キーワードを押すと解説に移る） */}
          <section className="research-section research-highlights">
            <h2>要点</h2>
            <ul>
              {topics.map((t, i) =>
                t.title ? (
                  <li key={i}>
                    <button className="research-highlight-keyword" onClick={() => scrollToTopic(i)}>
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
          <section className="research-section research-next">
            <h2>次にできること</h2>
            {evaluation && (
              <p className={`research-verdict ${issueCount > 0 ? 'warning' : 'ok'}`}>
                {issueCount > 0
                  ? `確認するとよいところが${issueCount}件あります`
                  : `✓ ${relevance.length}つのキーワードとも、根拠付きで説明できています`}
                <span className="research-verdict-detail">
                  （根拠付き {percent(evaluation.citationCoverage)}・公式の根拠 {percent(evaluation.officialSourceRate)}・AI倫理{' '}
                  {failedEthics.length === 0 ? '問題なし' : `${failedEthics.length}件の問題`}）
                </span>
              </p>
            )}
            <ul className="research-actions">
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
                    <button className="research-action-button" onClick={() => scrollToTopic(topicIndex(keyword))}>
                      解説を見る
                    </button>
                  )}
                </li>
              ))}
              {differences.map((t) => (
                <li key={`diff-${t.title}`}>
                  <span>「{t.title}」は、会話での説明と Web の説明に違いがあります。</span>
                  <button className="research-action-button" onClick={() => scrollToTopic(topicIndex(t.title!))}>
                    違いを読む
                  </button>
                  {t.mentions && t.mentions.items.length > 0 && (
                    <button
                      className="research-action-button"
                      onClick={() =>
                        onOpenTranscription(t.mentions!.items[0].transcriptionId, t.mentions!.items[0].utteranceIndex)
                      }
                    >
                      会話を聞き直す
                    </button>
                  )}
                </li>
              ))}
              {officialPages.map(({ keyword, page }) => (
                <li key={`page-${keyword}`}>
                  <span>「{keyword}」を詳しく知るなら、公式ページから読む: {page.title}</span>
                  <a className="research-action-button" href={page.sourceId} target="_blank" rel="noopener noreferrer">
                    ページを開く
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <p className="research-hint">
            文の後ろの「langchain.com 公式」などは、その文の根拠です。クリックすると、根拠になったページの抜粋を確かめられます。
          </p>

          {/* キーワードごとの解説 */}
          <div className="research-report-body" ref={bodyRef} onClick={handleReportClick}>
            {topics.map((t, i) => (
              <section key={i} id={`research-topic-${i}`} className="research-topic" data-topic={i}>
                {t.title && notAnswered.includes(t.title) && (
                  <p className="research-topic-warning">
                    Web の情報が少なく、この解説は「{t.title}」を十分に説明できていません。
                  </p>
                )}
                <div className="research-report" dangerouslySetInnerHTML={{ __html: t.html }} />
                {removedIn(t.title).length > 0 && (
                  <div className="research-removed-inline">
                    <p className="research-removed-inline-title">根拠を確認できなかったため、表示から除いた文</p>
                    <ul>
                      {removedIn(t.title).map((c, j) => (
                        <li key={j}>
                          <p className="research-removed-claim">{plainClaim(c.claim)}</p>
                          <p className="research-check-detail">
                            {removedReason(c)}
                            {t.pages.length > 0 && '正しいかどうかは、下の「さらに読む」のページで確かめてください。'}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {t.pages.length > 0 && (
                  <div className="research-topic-extra">
                    <h3>さらに読む</h3>
                    <ul className="research-sources">
                      {t.pages.map((c) => (
                        <li key={c.sourceId}>
                          <span className={`research-citation-kind web ${c.official ? 'official' : ''}`}>
                            {c.official ? '公式' : 'Web'}
                          </span>
                          <a href={c.sourceId} target="_blank" rel="noopener noreferrer">
                            {c.title}
                          </a>
                          <span className="research-web-domain">{siteName(c.sourceId)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {t.mentions && t.mentions.total > 0 && (
                  <div className="research-topic-extra">
                    <h3>
                      会話で話題になった箇所
                      {t.mentions.total > t.mentions.items.length && (
                        <span className="research-web-domain">（全{t.mentions.total}か所のうち最初の{t.mentions.items.length}か所）</span>
                      )}
                    </h3>
                    <div className="research-mentions">
                      {t.mentions.items.map((m) => (
                        <button
                          key={`${m.transcriptionId}-${m.utteranceIndex}`}
                          className="research-cite conversation"
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
                className="research-cite-popover"
                style={{ top: openCite.top, left: openCite.left }}
                role="dialog"
              >
                {openCite.numbers.map((n) => {
                  const c = topics[openCite.topic].citations[n - 1];
                  return (
                    <div key={n} className="research-cite-item">
                      {c.sourceKind === 'conversation' ? (
                        <div className="research-citation-meta">
                          <span className="research-citation-kind conversation">
                            会話{conversationNo.get(c.sourceId)}
                          </span>
                          {c.utterance && (
                            <>
                              <span className="research-citation-time">{formatTime(c.utterance.start)}</span>
                              <span className="research-citation-speaker">{c.utterance.speakerName}</span>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="research-citation-meta">
                          <span className={`research-citation-kind web ${c.official ? 'official' : ''}`}>
                            {c.official ? 'Web（公式）' : 'Web'}
                          </span>
                          <span className="research-citation-title">{c.title}</span>
                        </div>
                      )}
                      <CitedText text={quoteText(c)} />
                      {c.sourceKind === 'conversation' ? (
                        <button
                          className="research-citation-open"
                          onClick={() => onOpenTranscription(c.sourceId, c.utterance?.index)}
                        >
                          {c.utterance ? '文字起こしのこの発言を見る →' : '文字起こしを開く →'}
                        </button>
                      ) : (
                        <a className="research-citation-open" href={c.sourceId} target="_blank" rel="noopener noreferrer">
                          ページを開く →
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* この調査の記録（普段は開かなくてよい内容） */}
      <details className="research-section research-record">
        <summary>この調査の記録</summary>
        <section className="research-summary-card">
          <dl>
            <dt>日時</dt>
            <dd>
              {formatDate(job.createdAt)}
              <span className="research-summary-model">{job.models.analysis}</span>
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
            <p className="research-record-line">
              根拠付き {percent(evaluation.citationCoverage)}・裏付けあり {percent(evaluation.supportedRate)}・Webの根拠のうち公式{' '}
              {percent(evaluation.officialSourceRate)}・根拠がなく除いた文 {evaluation.removedClaims.length}件
            </p>
            <ul className="research-checks">
              {evaluation.ethics.map((e) => (
                <li key={e.item} className={e.passed ? 'passed' : 'failed'}>
                  <span className="research-check-mark">{e.passed ? '✓' : '✕'}</span>
                  {e.item}
                </li>
              ))}
            </ul>
            {reviewCount > 0 && (
              <details className="research-removed research-review">
                <summary>評価モデルと Guardrails の判定が分かれた文（{reviewCount}件）</summary>
                <ul>
                  {evaluation.reviewClaims!.map((c, i) => (
                    <li key={i}>
                      <p>{c.claim}</p>
                      <p className="research-check-detail">{c.reason}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {removedInTopics > 0 && (
              <p className="research-record-line">
                根拠を確認できなかった文 {removedInTopics}件は、各キーワードの解説の中に表示しています。
              </p>
            )}
            {removedWithoutTopic.length > 0 && (
              <details className="research-removed">
                <summary>根拠を確認できなかったため、表示から除いた文（{removedWithoutTopic.length}件）</summary>
                <ul>
                  {removedWithoutTopic.map((c, i) => (
                    <li key={i}>
                      <p>{plainClaim(c.claim)}</p>
                      <p className="research-check-detail">{removedReason(c)}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="research-hint">
              評価は、分析とは別のモデル（{evaluation.judgeModel}）が、各文とその根拠を突き合わせて判定しています。評価もAIによるため、重要な判断の前には根拠を確認してください。
            </p>
          </>
        )}
      </details>
    </>
  );
}
