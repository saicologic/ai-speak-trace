import { useEffect, useState } from 'react';
import { deleteTranscription, fetchTranscriptions } from '../api/client';
import { confirmDialog } from '../utils/platform';
import type { TranscriptionSummary } from '../types';

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 文字起こしを削除したとき */
  onDeleted?: (id: string) => void;
  loading: boolean;
}

/** 音声ファイルの項目：選んだ項目は濃い緑の枠にし、カーソルを乗せても色を変えない */
const itemClass =
  'flex w-full flex-col gap-[0.15rem] rounded-lg border px-3 py-[0.6rem] text-left transition-all duration-150';
const selectedItemClass = 'border-green-500 bg-green-50';
const unselectedItemClass = 'border-gray-200 bg-white hover:border-green-300 hover:bg-green-50';

/** 削除ボタン：ふだんは見えず、項目にカーソルを乗せたとき・フォーカスしたとき・削除しているあいだだけ見える */
const deleteButtonClass =
  'absolute top-[0.4rem] right-[0.4rem] rounded-sm border border-red-200 bg-white px-[0.4rem] py-[0.1rem] text-2xs text-red-700 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 disabled:border-gray-200 disabled:text-gray-400';

/** 日時を読みやすい形式に変換 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hour = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${hour}:${min}`;
}

/** 文字起こし一覧コンポーネント */
export function TranscriptionList({ selectedId, onSelect, onDeleted, loading }: Props) {
  const [items, setItems] = useState<TranscriptionSummary[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /** 文字起こしと、その会話から作ったデータを削除する */
  const handleDelete = async (item: TranscriptionSummary) => {
    const confirmed = await confirmDialog(
      `「${item.audioFileName}」の文字起こしを削除しますか？\n\nこの会話を使った要約・会話分析・ディープサーチの結果、誤りの報告、個人情報チェックの結果も削除されます。ほかの文字起こしで使っていない音声ファイルも削除されます。\n\n※ 外部サービス（ElevenLabs・Anthropic・AWS）に送信済みのデータは、このアプリからは削除できません。`,
      { title: '文字起こしの削除', kind: 'warning' },
    );
    if (!confirmed) return;
    setDeletingId(item.id);
    setFetchError(null);
    try {
      await deleteTranscription(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      onDeleted?.(item.id);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : '削除に失敗しました');
    } finally {
      setDeletingId(null);
    }
  };

  const loadItems = async () => {
    try {
      setFetchError(null);
      console.log('[TranscriptionList] 履歴一覧の取得を開始');
      const result = await fetchTranscriptions();
      console.log('[TranscriptionList] 履歴一覧の取得完了:', result.length, '件');
      setItems(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '取得に失敗しました';
      console.error('[TranscriptionList] 履歴一覧の取得エラー:', msg, e);
      setFetchError(msg);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        console.log('[TranscriptionList] 履歴一覧の取得を開始');
        const result = await fetchTranscriptions();
        if (!cancelled) {
          console.log('[TranscriptionList] 履歴一覧の取得完了:', result.length, '件');
          setItems(result);
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : '取得に失敗しました';
          console.error('[TranscriptionList] 履歴一覧の取得エラー:', msg, e);
          setFetchError(msg);
        }
      }
    };
    void init();
    return () => { cancelled = true; };
  }, []);

  return (
    // サイドバーの残りの高さを使い、音声ファイルの一覧だけをスクロールする（画面が低くても、一覧を見られる高さは保つ）。
    // transcription-list は、サイドバーの直接の子であることをテストで確かめるための目印
    <div className="transcription-list flex min-h-40 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h2 className="text-lg font-semibold">文字起こし履歴</h2>
        <button
          className="px-[0.6em] py-[0.3em] text-xs"
          onClick={loadItems}
          disabled={loading}
        >
          更新
        </button>
      </div>

      {fetchError && (
        <div className="mb-2 rounded-md bg-red-50 p-2 text-sm text-red-800">{fetchError}</div>
      )}

      {items.length === 0 && !fetchError && (
        <p className="py-4 text-center text-md text-gray-400">
          文字起こし履歴がありません。<br />
          音声ファイルから文字起こしを実行してください。
        </p>
      )}

      <ul className="min-h-0 flex-1 list-none overflow-y-auto">
        {items.map((item) => (
          <li key={item.id} className="group relative mb-1">
            <button
              className={`${itemClass} ${selectedId === item.id ? selectedItemClass : unselectedItemClass}`}
              onClick={() => onSelect(item.id)}
              disabled={loading}
            >
              <span className="pr-10 text-md font-medium break-all">
                {item.audioFileName}
              </span>
              <span className="text-xs text-gray-400">
                {formatDate(item.createdAt)}
              </span>
            </button>
            <button
              type="button"
              className={`${deleteButtonClass} ${deletingId === item.id ? 'opacity-100' : 'opacity-0'}`}
              onClick={() => handleDelete(item)}
              disabled={loading || deletingId !== null}
              aria-label={`${item.audioFileName} の文字起こしを削除`}
              title="削除"
            >
              {deletingId === item.id ? '削除中' : '削除'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
