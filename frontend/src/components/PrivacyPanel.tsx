import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchPrivacy, scanPrivacy, updatePrivacyMasks } from '../api/client';
import type { PiiFinding, PrivacyStatus } from '../types';
import './PrivacyPanel.css';

/** チェック中に結果を取得し直す間隔 */
const POLL_INTERVAL_MS = 3000;

const keyOf = (f: { type: string; text: string }) => `${f.type}\u0000${f.text}`;

/** 文字起こしの個人情報チェックの状態を取得する（チェック中は定期的に取得し直す） */
function usePrivacyStatus(transcriptionId: string) {
  const [status, setStatus] = useState<PrivacyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setStatus(await fetchPrivacy(transcriptionId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [transcriptionId]);

  // 文字起こしを切り替えたときは、呼び出し側で key を変えて作り直す
  useEffect(() => {
    let cancelled = false;
    fetchPrivacy(transcriptionId)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [transcriptionId]);

  const scanning = status?.scanning ?? false;
  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(() => void reload(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [scanning, reload]);

  return { status, setStatus, error, setError, reload };
}

interface PrivacyPanelProps {
  transcriptionId: string;
}

/**
 * 文字起こしの個人情報チェック
 * 検出した個人情報ごとに、Claude に送るときに伏せるかを選べる
 */
export function PrivacyPanel({ transcriptionId }: PrivacyPanelProps) {
  const { status, setStatus, error, setError } = usePrivacyStatus(transcriptionId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [masks, setMasks] = useState<Map<string, boolean>>(new Map());

  const findings = useMemo(() => status?.scan?.findings ?? [], [status]);
  useEffect(() => {
    setMasks(new Map(findings.map((f) => [keyOf(f), f.mask])));
  }, [findings]);

  const reviewCount = findings.filter((f) => f.needsReview).length;
  // 選択を変えたとき、または要確認のものがあるとき（そのままの選択で確認済みにできる）に保存できる
  const changed = findings.some((f) => masks.get(keyOf(f)) !== f.mask) || reviewCount > 0;
  const maskedCount = findings.filter((f) => masks.get(keyOf(f))).length;

  const run = async (action: () => Promise<PrivacyStatus>) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleScan = () => run(() => scanPrivacy(transcriptionId));
  const handleSave = () =>
    run(() =>
      updatePrivacyMasks(
        transcriptionId,
        findings.map((f) => ({ type: f.type, text: f.text, mask: masks.get(keyOf(f)) ?? f.mask })),
      ),
    );

  if (!status) return null;

  const summary = (() => {
    if (!status.configured && !status.scan) return '未設定';
    if (status.scanning || busy) return '確認中...';
    if (!status.scan) return '未確認';
    if (findings.length === 0) return '見つかりませんでした';
    const masked = findings.filter((f) => f.mask).length;
    return reviewCount > 0
      ? `${findings.length}件を検出（${masked}件を伏せる・要確認${reviewCount}件）`
      : `${findings.length}件を検出（${masked}件を伏せて送ります）`;
  })();

  return (
    <div className="privacy-panel">
      <button
        type="button"
        className="privacy-panel-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="privacy-panel-title">個人情報チェック</span>
        <span
          className={`privacy-panel-badge ${
            findings.some((f) => f.mask) ? 'privacy-panel-badge--masked' : ''
          } ${reviewCount > 0 ? 'privacy-panel-badge--review' : ''} ${
            !status.scan ? 'privacy-panel-badge--muted' : ''
          }`}
        >
          {summary}
        </span>
        <span className="privacy-panel-toggle">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="privacy-panel-body">
          {!status.configured ? (
            <p className="privacy-panel-hint">
              設定画面で Amazon Bedrock Guardrails の ID を設定すると、会話に含まれる個人情報を検出し、
              Claude に送る前に伏せられます。未設定の場合、会話分析・要約・ディープサーチは使えません。
            </p>
          ) : (
            <p className="privacy-panel-hint">
              Amazon Bedrock Guardrails で検出しました。「伏せる」を選んだ文字列は、会話分析・要約・ディープサーチで
              Claude に送るときに [氏名] のように置き換えます。元の文字起こしは変わりません。
              電話番号・メールアドレスなどは最初から伏せます。氏名・住所などは製品名や国名も検出されるため「要確認」とし、
              選ぶまでは伏せずに送ります。
            </p>
          )}

          {(error || status.error) && (
            <div className="privacy-panel-error">{error ?? status.error}</div>
          )}

          {findings.length > 0 && (
            <table className="privacy-panel-table">
              <thead>
                <tr>
                  <th>伏せる</th>
                  <th>種類</th>
                  <th>検出した文字列</th>
                  <th>回数</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f: PiiFinding) => (
                  <tr key={keyOf(f)}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${f.text} を伏せる`}
                        checked={masks.get(keyOf(f)) ?? f.mask}
                        onChange={(e) =>
                          setMasks((prev) => new Map(prev).set(keyOf(f), e.target.checked))
                        }
                      />
                    </td>
                    <td>
                      {f.label}
                      {f.needsReview && <span className="privacy-panel-review">要確認</span>}
                    </td>
                    <td className="privacy-panel-text">{f.text}</td>
                    <td>{f.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {status.scan && (
            <p className="privacy-panel-meta">
              確認日時: {new Date(status.scan.scannedAt).toLocaleString('ja-JP')}
            </p>
          )}

          <div className="privacy-panel-actions">
            {findings.length > 0 && (
              <button
                type="button"
                className="privacy-panel-save"
                disabled={!changed || busy}
                onClick={handleSave}
              >
                {reviewCount > 0
                  ? `確認して保存（${maskedCount}件を伏せる）`
                  : `保存（${maskedCount}件を伏せる）`}
              </button>
            )}
            {status.configured && (
              <button
                type="button"
                className="privacy-panel-scan"
                disabled={busy || status.scanning}
                onClick={handleScan}
              >
                {status.scan ? 'もう一度確認する' : '確認する'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface PrivacySendNoticeProps {
  transcriptionIds: string[];
}

/** 送る前の注意書き: 選んだ会話の個人情報チェックの状況 */
export function PrivacySendNotice({ transcriptionIds }: PrivacySendNoticeProps) {
  const [statuses, setStatuses] = useState<PrivacyStatus[] | null>(null);
  const idsKey = transcriptionIds.join('\n');

  useEffect(() => {
    let cancelled = false;
    const ids = idsKey ? idsKey.split('\n') : [];
    Promise.all(ids.map((id) => fetchPrivacy(id)))
      .then((list) => {
        if (!cancelled) setStatuses(list);
      })
      .catch(() => {
        if (!cancelled) setStatuses(null);
      });
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  if (!statuses || statuses.length === 0) return null;
  const configured = statuses.some((s) => s.configured);
  const unchecked = statuses.filter((s) => !s.scan).length;
  const masked = statuses.reduce(
    (sum, s) => sum + (s.scan?.findings.filter((f) => f.mask).length ?? 0),
    0,
  );
  const review = statuses.reduce(
    (sum, s) => sum + (s.scan?.findings.filter((f) => f.needsReview).length ?? 0),
    0,
  );

  if (!configured && unchecked === statuses.length) {
    return (
      <p className="privacy-send-notice privacy-send-notice--warning">
        個人情報チェック（Guardrail ID）が設定されていないため、Claude に送れません。設定画面で設定してください。
      </p>
    );
  }
  return (
    <p
      className={`privacy-send-notice ${
        unchecked > 0 || review > 0 ? 'privacy-send-notice--warning' : ''
      }`}
    >
      個人情報チェック: {masked}件を伏せて送ります
      {review > 0 && `。要確認の${review}件（氏名など）は伏せずに送ります`}
      {unchecked > 0 && `。チェックしていない会話が${unchecked}件あり、そのまま送られます`}
      。選択は文字起こしの画面の「個人情報チェック」で変えられます。
    </p>
  );
}
