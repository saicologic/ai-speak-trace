import { useEffect, useState } from 'react';
import { fetchTranscriptions } from '../api/client';
import type { TranscriptionSummary } from '../types';
import './TranscriptionList.css';

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}

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
export function TranscriptionList({ selectedId, onSelect, loading }: Props) {
  const [items, setItems] = useState<TranscriptionSummary[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

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
    <div className="transcription-list">
      <div className="transcription-list-header">
        <h2>文字起こし履歴</h2>
        <button
          className="reload-button"
          onClick={loadItems}
          disabled={loading}
        >
          更新
        </button>
      </div>

      {fetchError && (
        <div className="transcription-list-error">{fetchError}</div>
      )}

      {items.length === 0 && !fetchError && (
        <p className="transcription-list-empty">
          文字起こし履歴がありません。<br />
          音声ファイルから文字起こしを実行してください。
        </p>
      )}

      <ul className="transcription-list-items">
        {items.map((item) => (
          <li key={item.id}>
            <button
              className={`transcription-item ${selectedId === item.id ? 'selected' : ''}`}
              onClick={() => onSelect(item.id)}
              disabled={loading}
            >
              <span className="transcription-item-name">
                {item.audioFileName}
              </span>
              <span className="transcription-item-date">
                {formatDate(item.createdAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
