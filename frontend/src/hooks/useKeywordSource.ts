import { useCallback, useEffect, useState } from 'react';
import { fetchGinzaKeywords, fetchGinzaStatus, startGinzaInstall } from '../api/client';
import type { GinzaKeywords, GinzaStatus, KeywordSource } from '../types';

/** インストール中に状態を確かめる間隔 */
const POLL_INTERVAL_MS = 2000;

const storageKey = (transcriptionId: string) => `keywordSource:${transcriptionId}`;

/** 会話ごとに選んだキーワードの出し方を読む（読めなければ標準） */
export function readKeywordSource(transcriptionId: string): KeywordSource {
  try {
    return localStorage.getItem(storageKey(transcriptionId)) === 'ginza' ? 'ginza' : 'standard';
  } catch {
    return 'standard';
  }
}

/** 会話ごとに選んだキーワードの出し方を保存する（保存できなくても画面は動く） */
export function saveKeywordSource(transcriptionId: string, source: KeywordSource): void {
  try {
    localStorage.setItem(storageKey(transcriptionId), source);
  } catch {
    // プライベートウィンドウなどで保存できない場合は、この画面の間だけ使う
  }
}

const toMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface KeywordSourceState {
  /** 今の出し方（ベータ機能が無効なら常に標準） */
  source: KeywordSource;
  setSource: (source: KeywordSource) => void;
  /** GiNZA の準備の状態（GiNZA を選んでいないときは null） */
  status: GinzaStatus | null;
  /** GiNZA で取り出したキーワード（取り出し中・失敗時は null） */
  ginza: GinzaKeywords | null;
  /** GiNZA で解析中か */
  loading: boolean;
  error: string | null;
  /** GiNZA のインストールを始める */
  install: () => void;
}

/**
 * キーワードの出し方（標準 / GiNZA）を切り替える
 * 選んだ出し方は会話ごとに保存する（会話の種類によって、わかりやすい方が変わるため）
 */
export function useKeywordSource(
  transcriptionId: string,
  enabled: boolean,
): KeywordSourceState {
  // この画面で選び直した出し方（会話 ID ごと）。選び直していない会話は保存した値を使う
  const [choices, setChoices] = useState<Record<string, KeywordSource>>({});
  const [status, setStatus] = useState<GinzaStatus | null>(null);
  const [result, setResult] = useState<{ id: string; data: GinzaKeywords } | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  const chosen = choices[transcriptionId] ?? readKeywordSource(transcriptionId);
  const source: KeywordSource = enabled ? chosen : 'standard';

  const setSource = useCallback(
    (next: KeywordSource) => {
      saveKeywordSource(transcriptionId, next);
      setChoices((prev) => ({ ...prev, [transcriptionId]: next }));
    },
    [transcriptionId],
  );

  // GiNZA を選んだら状態を確かめる（インストール中は終わるまで確かめ続ける）
  const installing = status?.state === 'installing';
  useEffect(() => {
    if (source !== 'ginza') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      fetchGinzaStatus()
        .then((s) => {
          if (cancelled) return;
          setStatus(s);
          if (s.state === 'installing') timer = setTimeout(check, POLL_INTERVAL_MS);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError({ id: transcriptionId, message: toMessage(e) });
        });
    };
    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [source, installing, transcriptionId]);

  // 準備ができたらキーワードを取り出す（取り出し済みの会話は取り出し直さない）
  const ready = source === 'ginza' && status?.state === 'ready';
  const fetched = result?.id === transcriptionId;
  useEffect(() => {
    if (!ready || fetched) return;
    let cancelled = false;
    fetchGinzaKeywords(transcriptionId)
      .then((data) => {
        if (!cancelled) setResult({ id: transcriptionId, data });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError({ id: transcriptionId, message: toMessage(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [ready, fetched, transcriptionId]);

  const install = useCallback(() => {
    setError(null);
    startGinzaInstall()
      .then(setStatus)
      .catch((e: unknown) => setError({ id: transcriptionId, message: toMessage(e) }));
  }, [transcriptionId]);

  const ginza = fetched ? result.data : null;
  const currentError = source === 'ginza' && error?.id === transcriptionId ? error.message : null;
  return {
    source,
    setSource,
    status: source === 'ginza' ? status : null,
    ginza: source === 'ginza' ? ginza : null,
    loading: ready && !ginza && !currentError,
    error: currentError,
    install,
  };
}
