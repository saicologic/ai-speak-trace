import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchPrivacy, scanPrivacy, updatePrivacyMasks } from '../api/client';
import type { PiiFinding, PrivacyStatus } from '../types';

/** チェック中に結果を取得し直す間隔 */
const POLL_INTERVAL_MS = 3000;

/**
 * 結果のバッジの色
 * 今までの CSS と同じく、まだ確認していない（灰色）・要確認がある（黄色）・伏せるものがある（青）の順に優先し、どれでもなければ緑にする
 */
const badgeColorOf = ({ scanned, review, masked }: { scanned: boolean; review: boolean; masked: boolean }): string => {
  if (!scanned) return 'border-gray-200 bg-gray-50 text-gray-500';
  if (review) return 'border-amber-200 bg-amber-50 text-amber-800';
  if (masked) return 'border-blue-200 bg-blue-50 text-blue-800';
  return 'border-emerald-200 bg-emerald-50 text-emerald-800';
};

/** 説明と確認日時の文 */
const noteClass = 'mb-3 text-sm leading-[1.6]';
/** 表の見出しとセル */
const cellClass = 'border-b border-gray-100 px-2 py-[0.4rem] text-left';
const headerCellClass = `${cellClass} font-medium text-gray-500`;

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
  /** 見出しに表示する会話の名前 */
  title?: string;
}

/**
 * 会話の個人情報チェック（ディープサーチで会話を選んだときに表示する）
 * まだ確認していない会話は自動で検出し、検出した個人情報ごとに、Claude に送るときに伏せるかを選べる
 */
export function PrivacyPanel({ transcriptionId, title }: PrivacyPanelProps) {
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

  // まだ確認していない会話は、選んだときに1回だけ自動で検出する
  const autoScanned = useRef(false);
  useEffect(() => {
    if (!status || autoScanned.current) return;
    if (!status.configured || status.scan || status.scanning) return;
    autoScanned.current = true;
    void run(() => scanPrivacy(transcriptionId));
    // run は毎回作り直されるため、依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, transcriptionId]);
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
    <div className="mb-6 rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-3 border-none bg-transparent px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="text-base font-semibold text-gray-900">{title ? `個人情報チェック: ${title}` : '個人情報チェック'}</span>
        <span
          className={`rounded-[999px] border px-[0.6rem] py-[0.1rem] text-xs ${badgeColorOf({
            scanned: !!status.scan,
            review: reviewCount > 0,
            masked: findings.some((f) => f.mask),
          })}`}
        >
          {summary}
        </span>
        <span className="ml-auto text-2xs text-gray-500">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          {!status.configured ? (
            <p className={`${noteClass} text-gray-600`}>
              設定画面で Amazon Bedrock Guardrails の ID を設定すると、会話に含まれる個人情報を検出し、
              Claude に送る前に伏せられます。未設定の場合、ディープサーチ・要約・会話分析は使えません。
            </p>
          ) : (
            <p className={`${noteClass} text-gray-600`}>
              Amazon Bedrock Guardrails で検出しました。「伏せる」を選んだ文字列は、ディープサーチ・要約・会話分析で
              Claude に送るときに [氏名] のように置き換えます。元の文字起こしは変わりません。
              電話番号・メールアドレスなどは最初から伏せます。氏名・住所などは製品名や国名も検出されるため「要確認」とし、
              選ぶまでは伏せずに送ります。
            </p>
          )}

          {(error || status.error) && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error ?? status.error}</div>
          )}

          {findings.length > 0 && (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={headerCellClass}>伏せる</th>
                  <th className={headerCellClass}>種類</th>
                  <th className={headerCellClass}>検出した文字列</th>
                  <th className={headerCellClass}>回数</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f: PiiFinding) => (
                  <tr key={keyOf(f)}>
                    <td className={cellClass}>
                      <input
                        type="checkbox"
                        aria-label={`${f.text} を伏せる`}
                        checked={masks.get(keyOf(f)) ?? f.mask}
                        onChange={(e) =>
                          setMasks((prev) => new Map(prev).set(keyOf(f), e.target.checked))
                        }
                      />
                    </td>
                    <td className={cellClass}>
                      {f.label}
                      {f.needsReview && <span className="ml-[0.4rem] rounded-sm border border-amber-200 bg-amber-50 px-[0.3rem] text-2xs text-amber-800">要確認</span>}
                    </td>
                    <td className={`${cellClass} break-all`}>{f.text}</td>
                    <td className={cellClass}>{f.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {status.scan && (
            <p className={`${noteClass} mt-2 text-gray-500`}>
              確認日時: {new Date(status.scan.scannedAt).toLocaleString('ja-JP')}
            </p>
          )}

          <div className="mt-3 flex gap-2">
            {findings.length > 0 && (
              <button
                type="button"
                className="border-none bg-primary text-sm text-white enabled:hover:bg-primary-hover"
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
                className="text-sm"
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

/** Guardrail ID が設定されていないため、Claude に送れないことを知らせる */
export function GuardrailMissingNotice() {
  return (
    <p className="my-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      個人情報チェック（Guardrail ID）が設定されていないため、Claude に送れません。設定画面で設定してください。
    </p>
  );
}
