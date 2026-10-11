import { useEffect, useState } from 'react';
import { fetchPrivacy } from '../api/client';
import type { PrivacyStatus } from '../types';

/** 会話ごとの個人情報チェックの状態を取得する（取得できなかった場合は null） */
export function usePrivacyStatuses(transcriptionIds: string[]): PrivacyStatus[] | null {
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

  return statuses;
}

/**
 * Claude に送れるか（Guardrail ID が設定されているか）
 * 取得中・取得できなかった場合は null を返す（送信時にバックエンドで確認するため、ボタンは止めない）
 */
export function useGuardrailConfigured(transcriptionIds: string[]): boolean | null {
  const statuses = usePrivacyStatuses(transcriptionIds);
  if (!statuses || statuses.length === 0) return null;
  return statuses.some((s) => s.configured);
}
