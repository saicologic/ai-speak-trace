import { useCallback, useEffect, useMemo, useState } from 'react';
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
  ResearchJob,
  ResearchJobSummary,
  ResearchStatus,
} from '../types/research';
import { extractKeywords } from '../utils/keywords';
import { buildReport } from '../utils/researchReport';
import { AiGeneratedNotice } from './AiGeneratedNotice';
import './ResearchPage.css';

interface Props {
  onBack: () => void;
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
export function ResearchPage({ onBack }: Props) {
  const [transcriptions, setTranscriptions] = useState<TranscriptionSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<ResearchJobSummary[]>([]);
  const [job, setJob] = useState<ResearchJob | null>(null);
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [customKeyword, setCustomKeyword] = useState('');
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const [customDomain, setCustomDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshJobs = useCallback(async () => {
    try {
      setJobs(await fetchResearchJobs());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    fetchTranscriptions()
      .then(setTranscriptions)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void refreshJobs();
  }, [refreshJobs]);

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
        if (!RUNNING.includes(latest.status)) void refreshJobs();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [jobId, running, refreshJobs]);

  // 提案が届いたら、出現回数の多いキーワードと、すべての公式サイトを選んでおく
  const proposal = job?.status === 'awaiting_confirmation' ? job.proposal : undefined;
  useEffect(() => {
    if (!proposal) return;
    setSelectedKeywords(
      new Set(proposal.keywords.slice(0, DEFAULT_KEYWORD_COUNT).map((k) => k.keyword)),
    );
    setSelectedDomains(new Set(proposal.domains.map((d) => d.domain)));
  }, [proposal]);

  const report = useMemo(
    () => (job?.report && job.status === 'completed' ? buildReport(job.report) : null),
    [job],
  );

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
      void refreshJobs();
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
        await confirmResearch(job.id, Array.from(selectedKeywords), Array.from(selectedDomains)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenJob = async (id: string) => {
    setError(null);
    try {
      setJob(await fetchResearchJob(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** 根拠番号をクリックしたら、根拠の一覧の該当箇所へ移動して強調する */
  const handleReportClick = (e: MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-citation]');
    if (!link) return;
    e.preventDefault();
    const target = document.getElementById(`research-citation-${link.dataset.citation}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('highlight');
    void target.offsetWidth;
    target.classList.add('highlight');
  };

  const addCustomKeyword = () => {
    const value = customKeyword.trim();
    if (!value) return;
    setSelectedKeywords((prev) => new Set(prev).add(value));
    setCustomKeyword('');
  };

  const addCustomDomain = () => {
    const value = customDomain.trim();
    if (!value) return;
    setSelectedDomains((prev) => new Set(prev).add(value));
    setCustomDomain('');
  };

  const customKeywords = Array.from(selectedKeywords).filter(
    (k) => !job?.proposal?.keywords.some((p) => p.keyword === k),
  );
  const customDomains = Array.from(selectedDomains).filter(
    (d) => !job?.proposal?.domains.some((p) => p.domain === d),
  );
  const usedWebSources = (job?.webSources ?? []).filter((s) => s.excerpts.length > 0);

  return (
    <div className="research-page">
      <header className="research-header">
        <button className="research-back-button" onClick={onBack}>
          ← 戻る
        </button>
        <h1>ディープサーチ（ベータ）</h1>
        {job && (
          <button className="research-new-button" onClick={() => setJob(null)}>
            ＋ 新しい調査
          </button>
        )}
      </header>

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
              <button
                className="research-primary-button"
                disabled={selectedIds.size === 0 || busy}
                onClick={handleStart}
              >
                {busy ? '準備中...' : `${selectedIds.size}件の会話で調査を始める`}
              </button>
            </section>

            <section className="research-section">
              <h2>これまでの調査</h2>
              {jobs.length === 0 ? (
                <p className="research-hint">まだ調査はありません</p>
              ) : (
                <ul className="research-jobs">
                  {jobs.map((j) => (
                    <li key={j.id}>
                      <button className="research-job" onClick={() => handleOpenJob(j.id)}>
                        <span className={`research-job-status ${j.status}`}>
                          {STATUS_LABELS[j.status]}
                        </span>
                        <span className="research-job-names">
                          {j.transcriptionIds.map((id) => j.transcriptionNames[id] ?? id).join('、')}
                        </span>
                        {j.keywords.length > 0 && (
                          <span className="research-job-keywords">{j.keywords.join(' ／ ')}</span>
                        )}
                        <span className="research-job-date">
                          {new Date(j.createdAt).toLocaleString('ja-JP')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {job && (
          <section className="research-section">
            <h2>調べている会話</h2>
            <ul className="research-selected-transcriptions">
              {job.transcriptionIds.map((id) => (
                <li key={id}>{job.transcriptionNames[id] ?? id}</li>
              ))}
            </ul>
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
              <h2>② 調べるキーワードを確定する</h2>
              <p className="research-hint">
                AIが会話から提案したキーワードです。回数は選んだ会話全体での出現回数、引用は会話の原文です。
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
            </section>

            <section className="research-section">
              <h2>調べる公式サイト</h2>
              <p className="research-hint">
                Web調査は、ここで選んだサイトに限定して行います。見つからない場合だけ、一般のサイトも調べます。
              </p>
              <ul className="research-domains">
                {job.proposal.domains.map((d) => (
                  <li key={d.domain}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedDomains.has(d.domain)}
                        onChange={() => setSelectedDomains((prev) => toggle(prev, d.domain))}
                      />
                      <span className="research-domain">{d.domain}</span>
                      <span className="research-domain-owner">{d.owner}</span>
                    </label>
                    <p className="research-domain-reason">{d.reason}</p>
                  </li>
                ))}
                {customDomains.map((d) => (
                  <li key={d}>
                    <label>
                      <input
                        type="checkbox"
                        checked
                        onChange={() => setSelectedDomains((prev) => toggle(prev, d))}
                      />
                      <span className="research-domain">{d}</span>
                      <span className="research-domain-owner">追加</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="research-add">
                <input
                  value={customDomain}
                  placeholder="サイトを追加（例: anthropic.com）"
                  onChange={(e) => setCustomDomain(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && addCustomDomain()}
                />
                <button onClick={addCustomDomain}>追加</button>
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
            <h2>確定したキーワード</h2>
            <div className="research-chips">
              {job.confirmed.keywords.map((k) => (
                <span key={k} className="research-chip">
                  {k}
                </span>
              ))}
              {job.confirmed.domains.map((d) => (
                <span key={d} className="research-chip domain">
                  {d}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ⑤ 評価 */}
        {job?.status === 'completed' && job.evaluation && (
          <section className="research-section">
            <h2>⑤ 評価</h2>
            <div className="research-scores">
              <div className="research-score">
                <span className="research-score-value">
                  {percent(job.evaluation.citationCoverage)}
                </span>
                <span className="research-score-label">根拠が付いた主張</span>
              </div>
              <div className="research-score">
                <span className="research-score-value">{percent(job.evaluation.supportedRate)}</span>
                <span className="research-score-label">根拠で裏付けられた主張</span>
              </div>
              <div className="research-score">
                <span className="research-score-value">
                  {percent(job.evaluation.officialSourceRate)}
                </span>
                <span className="research-score-label">Webの根拠のうち公式サイト</span>
              </div>
              <div className="research-score">
                <span className="research-score-value">
                  {job.evaluation.removedClaims.length}件
                </span>
                <span className="research-score-label">根拠がなく除いた主張</span>
              </div>
            </div>
            <ul className="research-checks">
              {job.evaluation.relevance.map((r) => (
                <li key={r.keyword} className={r.answered ? 'passed' : 'failed'}>
                  <span className="research-check-mark">{r.answered ? '✓' : '✕'}</span>
                  論点「{r.keyword}」に答えている
                  <span className="research-check-detail">{r.reason}</span>
                </li>
              ))}
              {job.evaluation.ethics.map((e) => (
                <li key={e.item} className={e.passed ? 'passed' : 'failed'}>
                  <span className="research-check-mark">{e.passed ? '✓' : '✕'}</span>
                  {e.item}
                  <span className="research-check-detail">{e.detail}</span>
                </li>
              ))}
            </ul>
            {job.evaluation.removedClaims.length > 0 && (
              <details className="research-removed">
                <summary>根拠がないため表示から除いた主張（{job.evaluation.removedClaims.length}件）</summary>
                <ul>
                  {job.evaluation.removedClaims.map((c, i) => (
                    <li key={i}>
                      <p>{c.claim}</p>
                      <p className="research-check-detail">{c.reason}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="research-hint">
              評価は、分析とは別のモデル（{job.evaluation.judgeModel}
              ）が、各主張とその根拠を突き合わせて判定しています。評価もAIによるため、重要な判断の前には根拠を確認してください。
            </p>
          </section>
        )}

        {/* ④ 統合分析 */}
        {report && (
          <section className="research-section">
            <h2>④ 統合分析</h2>
            <AiGeneratedNotice basis="根拠" />
            <div
              className="research-report"
              onClick={handleReportClick}
              dangerouslySetInnerHTML={{ __html: report.html }}
            />
            <h3 className="research-subheading">根拠（{report.citations.length}件）</h3>
            <ol className="research-citations">
              {report.citations.map((c) => (
                <li
                  key={c.number}
                  id={`research-citation-${c.number}`}
                  className={`research-citation ${c.sourceKind}`}
                >
                  <span className="research-citation-number">[{c.number}]</span>
                  <span className={`research-citation-kind ${c.sourceKind} ${c.official ? 'official' : ''}`}>
                    {c.sourceKind === 'conversation' ? '会話' : c.official ? 'Web（公式）' : 'Web'}
                  </span>
                  {c.sourceKind === 'web' ? (
                    <a href={c.sourceId} target="_blank" rel="noopener noreferrer">
                      {c.title}
                    </a>
                  ) : (
                    <span>{c.title}</span>
                  )}
                  <blockquote className="research-quote">{c.citedText}</blockquote>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* ③ Web調査 */}
        {usedWebSources.length > 0 && (
          <section className="research-section">
            <h2>③ Web調査で使った情報源（{usedWebSources.length}件）</h2>
            <ul className="research-web-sources">
              {usedWebSources.map((s) => (
                <li key={s.url}>
                  <span className={`research-citation-kind web ${s.official ? 'official' : ''}`}>
                    {s.official ? '公式' : '一般'}
                  </span>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title}
                  </a>
                  <span className="research-web-domain">{s.domain}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
