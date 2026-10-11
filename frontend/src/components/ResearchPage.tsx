import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  confirmResearch,
  fetchResearchJob,
  fetchResearchJobs,
  fetchTranscription,
  fetchTranscriptions,
  startResearch,
} from '../api/client';
import type { TranscriptionSummary } from '../types';
import type {
  DomainProposal,
  ReportCitation,
  ResearchJob,
  ResearchJobSummary,
  ResearchStatus,
} from '../types/research';
import { extractKeywords } from '../utils/keywords';
import { buildReport, splitTopics } from '../utils/researchReport';
import type { NumberedCitation } from '../utils/researchReport';
import { AiGeneratedNotice } from './AiGeneratedNotice';
import { PrivacySendNotice } from './PrivacyPanel';
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
  { label: '会話の読み込み', detail: '選んだ会話の全文を読む' },
  { label: 'キーワード', detail: 'AIが提案し、あなたが確定する' },
  { label: 'Web調査', detail: '公式サイトを中心に調べる' },
  { label: '統合分析', detail: '会話とWebを論点ごとに統合する' },
  { label: '評価', detail: '根拠・ハルシネーション・AI倫理を確かめる' },
];

/** 状態ごとの、完了した段階の数と実行中の段階 */
function stepState(status: ResearchStatus | undefined): { done: number; active: number | null } {
  switch (status) {
    case 'proposing':
      return { done: 0, active: 1 };
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
  evaluating: '評価中',
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

/** ディープサーチ（会話の読み込み → キーワード → Web調査 → 統合分析 → 評価） */
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
                {selectedIds.size > 0 && (
                  <PrivacySendNotice transcriptionIds={Array.from(selectedIds)} />
                )}
                <button
                  className="research-primary-button"
                  disabled={selectedIds.size === 0 || busy}
                  onClick={handleStart}
                >
                  {busy ? '準備中...' : `${selectedIds.size}件の会話で調査を始める`}
                </button>
              </section>

            </>
          )}

          {job && (
            <section className="research-section">
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
              <PreSendChecksView job={job} />
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
                  選んだキーワードごとに、調べる公式サイトを選べます。サイトを選ばなかったキーワードや、選んだサイトで見つからなかったキーワードは、一般のサイトも調べます。
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
                <ResearchResult job={resultJob} onOpenTranscription={onOpenTranscription} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 送る前の確認に、注意が必要な項目（個人情報チェックをしていない会話など）があるか */
function hasPreSendWarning(job: ResearchJob): boolean {
  const checks = job.preSendChecks;
  if (!checks) return false;
  return !checks.privacyConfigured || checks.privacy.some((p) => !p.scanned || p.needsReview > 0);
}

/**
 * 送る前の確認（① 会話の読み込みの後、Claude に送る前と、キーワード提案の直後に行った確認）
 * 出力のハルシネーション・AI倫理は、出力を見て判定するため、⑤ 評価で確認する
 */
function PreSendChecksView({ job }: { job: ResearchJob }) {
  const checks = job.preSendChecks!;
  const name = (id: string) => `会話${job.transcriptionIds.indexOf(id) + 1}`;
  const items: { ok: boolean; text: string }[] = [];
  if (!checks.privacyConfigured) {
    items.push({ ok: false, text: '個人情報チェック（Guardrail ID）が設定されていないため、会話は伏せずにそのまま送りました' });
  } else {
    for (const p of checks.privacy) {
      if (!p.scanned) {
        items.push({ ok: false, text: `${name(p.transcriptionId)}: 個人情報チェックをしていないため、伏せずにそのまま送りました` });
        continue;
      }
      items.push({
        ok: p.needsReview === 0,
        text:
          `${name(p.transcriptionId)}: ` +
          (p.maskedKinds > 0
            ? `個人情報 ${p.maskedKinds}種類（${p.maskedCount}か所）を伏せて送りました`
            : '伏せる個人情報はありませんでした') +
          (p.needsReview > 0 ? `。要確認の ${p.needsReview}件は伏せずに送りました` : ''),
      });
    }
  }
  if (checks.droppedFrequentWords !== undefined) {
    items.push({
      ok: true,
      text:
        checks.droppedFrequentWords > 0
          ? `伏せた文字列を含む頻出語 ${checks.droppedFrequentWords}件は、キーワード提案の参考として送りませんでした`
          : '頻出語に、伏せた文字列は含まれていませんでした',
    });
  }
  if (checks.droppedKeywords !== undefined) {
    items.push({
      ok: true,
      text:
        checks.droppedKeywords.length > 0
          ? `会話に出てこないキーワード ${checks.droppedKeywords.length}件（${checks.droppedKeywords.join('、')}）を、提案から外しました`
          : '提案されたキーワードは、すべて会話に出てきます',
    });
  }
  if (checks.droppedQuotes !== undefined) {
    items.push({
      ok: true,
      text:
        checks.droppedQuotes > 0
          ? `会話の原文と一致しない引用 ${checks.droppedQuotes}件を、提案から外しました`
          : '提案の引用は、すべて会話の原文と一致しました',
    });
  }
  return (
    <>
      <ul className="research-checks">
        {items.map((item, i) => (
          <li key={i} className={item.ok ? 'passed' : 'warning'}>
            <span className="research-check-mark">{item.ok ? '✓' : '!'}</span>
            {item.text}
          </li>
        ))}
      </ul>
      <p className="research-hint">
        分析の出力のハルシネーションと AI 倫理は、出力を見て判定するため、調査の最後の評価で確認します。
      </p>
    </>
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
  return (
    <ul className="research-targets">
      {targets.map((t) => (
        <li key={t.keyword}>
          <span className="research-chip">{t.keyword}</span>
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
function ResearchResult({
  job,
  onOpenTranscription,
}: {
  job: ResearchJob;
  onOpenTranscription: Props['onOpenTranscription'];
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
      return { title: topic.title, ...built, pages, mentions };
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
  const failedChecks = evaluation
    ? evaluation.relevance.filter((r) => !r.answered).length +
      evaluation.ethics.filter((e) => !e.passed).length
    : 0;
  const reviewCount = evaluation?.reviewClaims?.length ?? 0;

  return (
    <>
      {/* 何を調べたか */}
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
        <details className="research-section research-eval-details" open={hasPreSendWarning(job)}>
          <summary>送る前の確認</summary>
          <PreSendChecksView job={job} />
        </details>
      )}

      {job.status === 'failed' && (
        <>
          <StepFlow status={job.status} />
          <div className="research-error">調査に失敗しました: {job.error}</div>
        </>
      )}

      {/* 信頼度のまとめ */}
      {evaluation && (
        <div className={`research-trust ${failedChecks > 0 ? 'warning' : ''}`}>
          <span>
            根拠付き <strong>{percent(evaluation.citationCoverage)}</strong>
          </span>
          <span>
            裏付けあり <strong>{percent(evaluation.supportedRate)}</strong>
          </span>
          <span>
            Webの根拠のうち公式 <strong>{percent(evaluation.officialSourceRate)}</strong>
          </span>
          <span>
            AI倫理{' '}
            <strong>
              {evaluation.ethics.filter((e) => e.passed).length}/{evaluation.ethics.length} 合格
            </strong>
          </span>
          <span>
            根拠がなく除いた主張 <strong>{evaluation.removedClaims.length}件</strong>
          </span>
          {failedChecks > 0 && (
            <span className="research-trust-alert">確認が必要な項目が{failedChecks}件あります（評価の詳細）</span>
          )}
          {reviewCount > 0 && (
            <span className="research-trust-alert">要確認の主張が{reviewCount}件あります（評価の詳細）</span>
          )}
        </div>
      )}

      {topics.length > 0 && (
        <>
          {/* 目次 */}
          {topics.filter((t) => t.title).length > 1 && (
            <nav className="research-toc">
              {topics.map((t, i) =>
                t.title ? (
                  <button key={i} onClick={() => scrollToTopic(i)}>
                    {t.title}
                  </button>
                ) : null,
              )}
            </nav>
          )}

          <AiGeneratedNotice basis="根拠" />
          <p className="research-hint">
            文の後ろの「langchain.com 公式」などは、その文の根拠です。クリックすると、根拠になったページの抜粋を確かめられます。
          </p>

          {/* キーワードごとの解説 */}
          <div className="research-report-body" ref={bodyRef} onClick={handleReportClick}>
            {topics.map((t, i) => (
              <section key={i} id={`research-topic-${i}`} className="research-topic" data-topic={i}>
                <div className="research-report" dangerouslySetInnerHTML={{ __html: t.html }} />
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

      {/* 評価の詳細（確認が必要な項目があるときは開いておく） */}
      {evaluation && (
        <details className="research-section research-eval-details" open={failedChecks > 0 || reviewCount > 0}>
          <summary>評価の詳細</summary>
          <ul className="research-checks">
            {evaluation.relevance.map((r) => (
              <li key={r.keyword} className={r.answered ? 'passed' : 'failed'}>
                <span className="research-check-mark">{r.answered ? '✓' : '✕'}</span>
                「{r.keyword}」を説明している
                <span className="research-check-detail">{r.reason}</span>
              </li>
            ))}
            {evaluation.ethics.map((e) => (
              <li key={e.item} className={e.passed ? 'passed' : 'failed'}>
                <span className="research-check-mark">{e.passed ? '✓' : '✕'}</span>
                {e.item}
                <span className="research-check-detail">{e.detail}</span>
              </li>
            ))}
          </ul>
          {reviewCount > 0 && (
            <details className="research-removed research-review" open>
              <summary>評価モデルと Guardrails の判定が分かれた主張（要確認・{reviewCount}件）</summary>
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
          {evaluation.removedClaims.length > 0 && (
            <details className="research-removed">
              <summary>根拠がないため表示から除いた主張（{evaluation.removedClaims.length}件）</summary>
              <ul>
                {evaluation.removedClaims.map((c, i) => (
                  <li key={i}>
                    <p>{c.claim}</p>
                    <p className="research-check-detail">{c.reason}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="research-hint">
            評価は、分析とは別のモデル（{evaluation.judgeModel}
            ）が、各主張とその根拠を突き合わせて判定しています。評価もAIによるため、重要な判断の前には根拠を確認してください。
            {evaluation.guardrails
              ? ` 出力の個人情報・不適切な表現は Amazon Bedrock Guardrails でも確認しています。${
                  evaluation.guardrails.groundingChecked > 0
                    ? `英語の主張${evaluation.guardrails.groundingChecked}件は、Guardrails の根拠スコア（しきい値 ${evaluation.guardrails.groundingThreshold}）でも確認し、両方が「根拠と合わない」と判定したものだけを除いています。`
                    : 'Guardrails の根拠スコアは英語の主張だけが対象のため、今回は使っていません。'
                }`
              : ' Amazon Bedrock Guardrails の Guardrail ID が設定されていないため、Guardrails による確認は行っていません。'}
          </p>
        </details>
      )}
    </>
  );
}
