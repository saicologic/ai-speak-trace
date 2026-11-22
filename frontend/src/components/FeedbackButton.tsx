import { useEffect, useState } from 'react';
import { fetchFeedback, submitFeedback } from '../api/client';
import type { Feedback, FeedbackCategory, FeedbackFeature } from '../types';

interface Props {
  feature: FeedbackFeature;
  /** 報告する結果の ID（保存しない結果は空） */
  targetId: string;
  transcriptionId: string;
  /** 結果を作った文字起こしのすべて（ディープサーチのように複数の会話を使う結果だけ） */
  transcriptionIds?: string[];
}

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'factual_error', label: '事実の誤り' },
  { value: 'unsupported', label: '元の会話・出典にない内容' },
  { value: 'personal_judgement', label: '個人の推測・評価' },
  { value: 'inappropriate', label: '不適切な表現' },
  { value: 'other', label: 'その他' },
];

/** 種類・箇所・コメントの入力欄（select と textarea も、画面と同じ字体にする） */
const fieldControlClass = 'rounded-sm border border-gray-300 px-2 py-[0.35rem] text-sm [font-family:inherit]';
/** 「キャンセル」「報告する」に共通の、枠・余白・文字の大きさ */
const actionButtonClass = 'rounded-md border px-[0.8rem] py-[0.3rem] text-sm disabled:cursor-not-allowed disabled:opacity-50';

const categoryLabel = (value: FeedbackCategory) =>
  CATEGORIES.find((c) => c.value === value)?.label ?? value;

/**
 * AI が生成した結果の誤りを報告するボタンとフォーム
 * 報告は端末にだけ保存し、外部には送らない。結果を見直すときに、報告した内容を一緒に表示する
 */
export function FeedbackButton({ feature, targetId, transcriptionId, transcriptionIds }: Props) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>('factual_error');
  const [quote, setQuote] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<Feedback[]>([]);

  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    fetchFeedback(feature, targetId)
      .then((items) => {
        if (!cancelled) setReports(items);
      })
      .catch(() => {
        // 報告の一覧が取れなくても、結果の表示は続ける
      });
    return () => {
      cancelled = true;
    };
  }, [feature, targetId]);

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await submitFeedback({
        feature,
        targetId,
        transcriptionId,
        ...(transcriptionIds && { transcriptionIds }),
        category,
        quote,
        comment,
      });
      setReports((prev) => [saved, ...prev]);
      setOpen(false);
      setQuote('');
      setComment('');
      setCategory('factual_error');
    } catch (e) {
      setError(e instanceof Error ? e.message : '報告の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 text-sm">
      {reports.length > 0 && (
        <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900">
          <div className="mb-1 font-semibold">報告した誤り（{reports.length}件）</div>
          <ul className="m-0 pl-[1.1rem]">
            {reports.map((r) => (
              <li key={r.id} className="my-[0.15rem]">
                <span className="mr-[0.4rem] font-semibold">{categoryLabel(r.category)}</span>
                {r.quote && <span className="mr-[0.4rem]">「{r.quote}」</span>}
                {r.comment && <span className="text-gray-500">{r.comment}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!open ? (
        <button type="button" className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50" onClick={() => setOpen(true)}>
          誤りを報告
        </button>
      ) : (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <p className="mb-2 text-xs text-gray-500">
            報告はこの Mac にだけ保存し、外部には送りません。結果を見直すときに、報告した内容を一緒に表示します。
          </p>
          <label className="mb-2 flex flex-col gap-1">
            <span>種類</span>
            <select
              className={fieldControlClass}
              value={category}
              onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mb-2 flex flex-col gap-1">
            <span>誤りだと思った箇所（任意）</span>
            <input
              type="text"
              className={fieldControlClass}
              value={quote}
              maxLength={1000}
              onChange={(e) => setQuote(e.target.value)}
            />
          </label>
          <label className="mb-2 flex flex-col gap-1">
            <span>コメント（任意）</span>
            <textarea
              className={fieldControlClass}
              value={comment}
              maxLength={2000}
              rows={3}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          {error && <div className="mb-2 text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={`${actionButtonClass} border-gray-300 bg-white`}
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              キャンセル
            </button>
            <button
              type="button"
              className={`${actionButtonClass} border-blue-600 bg-blue-600 text-white`}
              onClick={handleSubmit}
              disabled={saving || (category === 'other' && !quote.trim() && !comment.trim())}
            >
              {saving ? '保存中...' : '報告する'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
