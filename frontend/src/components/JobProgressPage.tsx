import { useEffect, useRef, useState } from 'react';
import {
  fetchJobDetail,
  fetchTranscription,
  resumeTranscription,
  getChunkAudioUrl,
  checkCredits,
} from '../api/client';
import type { ChunkedJobDetail, CreditInfo } from '../api/client';
import type { Transcription } from '../types';
import { formatTime, formatDuration, estimateCredits } from '../utils/transcription';
import { PageLayout } from './PageLayout';

/** ポーリング間隔（ミリ秒） */
const POLL_INTERVAL_MS = 2000;

interface JobProgressPageProps {
  jobId: string;
  onBack: () => void;
  onTranscriptionComplete: (transcription: Transcription) => void;
}

/** 状態と途中経過の白いカード */
const sectionClass = 'rounded-[10px] border border-gray-200 bg-white p-6';
/** 「トップに戻る」と再開のボタンに共通の、余白・文字の大きさ */
const actionButtonClass = 'rounded-md border-none px-[1.2rem] py-[0.6rem] text-base font-semibold text-white transition-colors duration-150';
/** チャンクの読み込み中の丸 */
const chunkSpinnerClass = 'inline-block size-[14px] animate-spin-fast rounded-full border-2 border-gray-200 border-t-primary';
/** チャンクのカードと、その見出し・本文 */
const chunkItemClass = 'overflow-hidden rounded-lg border';
const chunkHeaderClass = 'flex items-center justify-between border-b border-gray-200 bg-gray-100 px-4 py-2';
const chunkLabelClass = 'text-md font-semibold text-gray-700';
const chunkTimeClass = 'ml-2 font-normal text-gray-400';
const chunkBodyClass = 'max-h-[200px] overflow-y-auto px-4 py-3 text-md leading-[1.7] whitespace-pre-wrap';

/** チャンク分割文字起こしの処理監視画面 */
export function JobProgressPage({
  jobId,
  onBack,
  onTranscriptionComplete,
}: JobProgressPageProps) {
  const [job, setJob] = useState<ChunkedJobDetail | null>(null);
  const [error, setError] = useState('');
  const [isResuming, setIsResuming] = useState(false);
  const [hideErrorMessage, setHideErrorMessage] = useState(false);
  const [playingChunkIndex, setPlayingChunkIndex] = useState<number | null>(null);
  const [creditInfo, setCreditInfo] = useState<CreditInfo | null>(null);
  const [creditCheckLoading, setCreditCheckLoading] = useState(false);
  const [completedTranscription, setCompletedTranscription] = useState<Transcription | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const completedRef = useRef(false);

  // ポーリングでジョブ詳細を取得
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const detail = await fetchJobDetail(jobId);
      if (cancelled) return;
      if (detail) {
        setJob(detail);
      }
    };

    // 初回即時取得
    poll();

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId]);

  // ページ表示時にクレジット残量を確認
  useEffect(() => {
    let cancelled = false;
    const loadCredits = async () => {
      setCreditCheckLoading(true);
      try {
        const info = await checkCredits();
        if (!cancelled) setCreditInfo(info);
      } catch {
        // クレジット確認失敗は無視
      } finally {
        if (!cancelled) setCreditCheckLoading(false);
      }
    };
    void loadCredits();
    return () => { cancelled = true; };
  }, [jobId]);

  // 完了検知: transcriptionId がセットされたら結果を取得して保持（自動遷移しない）
  useEffect(() => {
    if (!job || completedRef.current) return;
    if (job.status === 'completed' && job.transcriptionId) {
      completedRef.current = true;
      fetchTranscription(job.transcriptionId)
        .then((result) => {
          setCompletedTranscription(result);
        })
        .catch((err) => {
          setError(
            err instanceof Error ? err.message : '結果の取得に失敗しました',
          );
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- job全体ではなくstatus/transcriptionIdの変化のみ監視
  }, [job?.status, job?.transcriptionId]);

  /** トップに戻るボタンクリック時 */
  const handleGoToTop = () => {
    if (completedTranscription) {
      onTranscriptionComplete(completedTranscription);
    } else {
      onBack();
    }
  };

  /** 処理開始/再開 */
  const handleResume = () => {
    setIsResuming(true);
    setError('');
    setHideErrorMessage(true);

    // Fire-and-forget: バックエンドの処理は長時間かかるためレスポンスを待たない
    // 完了検知はポーリング（fetchJobDetail 2秒間隔）で行う
    resumeTranscription(jobId)
      .catch((err) => {
        // TypeError（"Load failed"等）= WebViewのコネクションタイムアウト
        // バックエンドは処理を継続しているためエラー表示しない
        if (err instanceof TypeError) {
          console.warn('[JobProgressPage] コネクション切断（バックエンド処理継続中）');
          return;
        }
        // クォータ超過などの即座エラーは表示
        setError(err instanceof Error ? err.message : '処理の開始に失敗しました');
      });

    // リクエスト送信後、短い遅延でisResumingを解除
    // ジョブ状態はポーリングで更新される
    setTimeout(() => setIsResuming(false), 2000);
  };

  /** チャンク音声の再生/停止 */
  const handlePlayChunk = (chunkIndex: number) => {
    if (playingChunkIndex === chunkIndex) {
      // 同じチャンクをクリック → 停止
      audioRef.current?.pause();
      setPlayingChunkIndex(null);
      return;
    }
    setPlayingChunkIndex(chunkIndex);
  };

  // 手動開始が必要かどうか: バックエンドで処理中でなく、未完了状態
  const needsManualStart = job
    ? !job.isProcessing && !isResuming &&
      (job.status === 'initializing' || job.status === 'splitting' || job.status === 'transcribing')
    : false;

  // ステータステキスト
  const getStatusText = () => {
    if (!job) return '読み込み中...';

    // 手動開始が必要な場合（ボタンが表示されている = まだ開始していない）
    if (needsManualStart) {
      return '文字起こしの開始を待機中...';
    }

    switch (job.status) {
      case 'initializing':
        return '文字起こしを準備中...';
      case 'splitting':
        return '音声ファイルを分割中...';
      case 'transcribing':
        return '文字起こし中...';
      case 'merging':
        return '結果をマージ中...';
      case 'completed':
        return '文字起こし完了';
      case 'failed':
        return '文字起こしが失敗しました';
      default:
        return '';
    }
  };

  // 開始/再開ボタンの表示条件
  const canResume = job && (job.status === 'failed' || needsManualStart) && !isResuming;

  // ボタンのラベル
  const getResumeButtonLabel = () => {
    if (isResuming) return '開始中...';
    if (needsManualStart) return '文字起こしを開始';
    return '途中から再開する';
  };

  // プログレスバーの割合
  const progressPercent =
    job && job.totalChunks > 0
      ? (job.completedChunks.length / job.totalChunks) * 100
      : 0;

  // 完了チャンクをインデックス順にソート
  const sortedChunks = job
    ? [...job.completedChunks].sort((a, b) => a.index - b.index)
    : [];

  // 処理中のチャンク表示の判定
  const showProcessingChunk = job && job.isProcessing &&
    (job.status === 'transcribing' || job.status === 'splitting' || job.status === 'initializing');

  return (
    <PageLayout
      className="bg-gray-50"
      header={
        <div className="flex items-center gap-4 bg-brand px-8 py-4 text-white">
          <button
            className="rounded-md border border-white/30 bg-transparent px-[0.8rem] py-[0.4rem] text-md text-white transition-colors duration-150 hover:bg-white/10"
            onClick={onBack}
          >
            ← 戻る
          </button>
          <h1 className="text-xl font-semibold">文字起こし処理中</h1>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-[800px] flex-1 p-8">
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
            <p>{error}</p>
          </div>
        )}

        {/* ステータスセクション */}
        {job && (
          <div className={`${sectionClass} mb-6`}>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-base-plus font-semibold break-all text-gray-800">{job.audioFileName}</span>
              {job.totalDurationSec > 0 && (
                <span className="text-sm text-gray-500">
                  ({formatDuration(job.totalDurationSec)})
                </span>
              )}
            </div>

            <p className="mb-3 flex items-center gap-2 text-base-plus font-medium text-gray-700">
              {job.isProcessing && job.status !== 'completed' && (
                <span className={chunkSpinnerClass} />
              )}
              {getStatusText()}
            </p>

            {job.totalChunks > 0 && (
              <>
                <div className="mb-2 h-2 w-full overflow-hidden rounded-sm bg-gray-200">
                  <div
                    className="h-full rounded-sm bg-primary transition-[width] duration-500 ease-[ease]"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="text-sm text-gray-400">
                  完了: {job.completedChunks.length}/{job.totalChunks} チャンク
                </p>
              </>
            )}

            {/* 完了時: トップに戻るボタン */}
            {job.status === 'completed' && (
              <div className="mt-4 flex gap-3">
                <button
                  className={`${actionButtonClass} bg-primary hover:bg-primary-hover`}
                  onClick={handleGoToTop}
                >
                  トップに戻る
                </button>
              </div>
            )}

            {/* クレジット情報 + 再開ボタン */}
            {canResume && (() => {
              const estimatedCredits = estimateCredits(job);
              const isCreditSufficient = creditInfo === null || creditInfo.remainingCredits >= estimatedCredits;

              return (
                <>
                  <div className="mt-4">
                    {creditCheckLoading && (
                      <p className="text-sm font-medium text-blue-600">クレジット情報を確認中...</p>
                    )}
                    {creditInfo && (
                      <div
                        className={`rounded-md border px-4 py-[0.6rem] ${
                          isCreditSufficient ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                        }`}
                      >
                        <div className="flex justify-between text-md text-gray-700">
                          <span>残りクレジット</span>
                          <span>{creditInfo.remainingCredits.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-md text-gray-700">
                          <span>今回必要なクレジット（推定）</span>
                          <span>約 {estimatedCredits.toLocaleString()}</span>
                        </div>
                        {!isCreditSufficient && (
                          <p className="mt-2 text-sm text-red-800">
                            クレジットが不足しています。プランをアップグレードするか、クレジットが回復するまでお待ちください。
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-4 flex gap-3">
                    <button
                      className={`${actionButtonClass} bg-amber-500 enabled:hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-gray-400`}
                      onClick={handleResume}
                      disabled={isResuming || creditCheckLoading || !creditInfo || !isCreditSufficient}
                    >
                      {getResumeButtonLabel()}
                    </button>
                  </div>
                </>
              );
            })()}

            {/* 失敗理由（failed の場合のみ表示、再開ボタン押下後は非表示） */}
            {job.status === 'failed' && job.errorMessage && !hideErrorMessage && (() => {
              const filtered = job.errorMessage
                .split('\n')
                .filter((line) => !/^(プラン上限|残りクレジット|今回必要なクレジット)/.test(line.trim()))
                .join('\n')
                .trim();
              return filtered ? (
                <p className="mt-2 rounded-sm bg-black/4 p-2 font-[monospace] text-sm whitespace-pre-wrap text-red-800">{filtered}</p>
              ) : null;
            })()}
          </div>
        )}

        {/* 途中経過テキスト */}
        {(sortedChunks.length > 0 || showProcessingChunk) && (
          <div className={`${sectionClass} mb-20`}>
            <h2 className="mb-4 text-lg font-semibold text-gray-800">途中経過テキスト</h2>
            <div className="flex flex-col gap-4">
              {sortedChunks.map((chunk) => (
                <div key={chunk.index} className={`${chunkItemClass} border-gray-200`}>
                  <div className={chunkHeaderClass}>
                    <span className={chunkLabelClass}>
                      チャンク {chunk.index + 1}
                      <span className={chunkTimeClass}>
                        ({formatTime(chunk.startTimeSec)} - {formatTime(chunk.startTimeSec + (job?.chunkDurationSec ?? 600))})
                      </span>
                    </span>
                    <button
                      className={`rounded-sm border px-[0.6rem] py-1 text-xs font-medium transition-all duration-150 ${
                        playingChunkIndex === chunk.index
                          ? 'border-red-200 bg-red-50 text-red-800'
                          : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700'
                      }`}
                      onClick={() => handlePlayChunk(chunk.index)}
                      title={playingChunkIndex === chunk.index ? '停止' : '再生'}
                    >
                      {playingChunkIndex === chunk.index ? '■ 停止' : '▶ 再生'}
                    </button>
                  </div>
                  <div className={`${chunkBodyClass} text-gray-700`}>{chunk.text}</div>
                </div>
              ))}

              {/* 処理中のチャンク表示（バックエンドで処理中の場合） */}
              {job && showProcessingChunk && job.currentChunkIndex >= sortedChunks.length && (
                <div className={`${chunkItemClass} border-dashed border-blue-300`}>
                  <div className={chunkHeaderClass}>
                    <span className={chunkLabelClass}>
                      チャンク {job.currentChunkIndex + 1}
                      {job.totalChunks > 0 && (
                        <span className={chunkTimeClass}>
                          ({formatTime(job.currentChunkIndex * (job.chunkDurationSec ?? 600))} - {formatTime((job.currentChunkIndex + 1) * (job.chunkDurationSec ?? 600))})
                        </span>
                      )}
                    </span>
                  </div>
                  <div className={`${chunkBodyClass} flex items-center gap-2 text-gray-400`}>
                    <span className={chunkSpinnerClass} />
                    文字起こし中...
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* チャンク音声プレイヤー（画面下部に固定表示） */}
        {playingChunkIndex !== null && (
          <div className="fixed right-0 bottom-0 left-0 z-[100] flex items-center gap-4 bg-brand px-8 py-3">
            <p className="text-sm whitespace-nowrap text-gray-300">
              チャンク {playingChunkIndex + 1} を再生中
            </p>
            <audio
              ref={audioRef}
              className="h-8 flex-1"
              controls
              autoPlay
              src={getChunkAudioUrl(jobId, playingChunkIndex)}
              onEnded={() => setPlayingChunkIndex(null)}
            />
          </div>
        )}
      </div>
    </PageLayout>
  );
}
