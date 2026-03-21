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
import './JobProgressPage.css';

/** ポーリング間隔（ミリ秒） */
const POLL_INTERVAL_MS = 2000;

interface JobProgressPageProps {
  jobId: string;
  onBack: () => void;
  onTranscriptionComplete: (transcription: Transcription) => void;
}

/** チャンク分割文字起こしの処理監視画面 */
export function JobProgressPage({
  jobId,
  onBack,
  onTranscriptionComplete,
}: JobProgressPageProps) {
  const [job, setJob] = useState<ChunkedJobDetail | null>(null);
  const [error, setError] = useState('');
  const [isResuming, setIsResuming] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [hideErrorMessage, setHideErrorMessage] = useState(false);
  const [playingChunkIndex, setPlayingChunkIndex] = useState<number | null>(null);
  const [creditInfo, setCreditInfo] = useState<CreditInfo | null>(null);
  const [creditCheckLoading, setCreditCheckLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const completedRef = useRef(false);
  const initialStatusChecked = useRef(false);

  // ポーリングでジョブ詳細を取得
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const detail = await fetchJobDetail(jobId);
      if (cancelled) return;
      if (detail) {
        setJob(detail);
        // 初回取得時: updatedAt が30秒以内ならアクティブ処理中と判断しタイマー開始
        if (!initialStatusChecked.current) {
          initialStatusChecked.current = true;
          const isActive = detail.status === 'splitting' || detail.status === 'transcribing' || detail.status === 'merging';
          if (isActive) {
            const lastUpdate = new Date(detail.updatedAt).getTime();
            const isRecentlyActive = Date.now() - lastUpdate < 30_000;
            if (isRecentlyActive) {
              setIsTimerRunning(true);
            }
          }
        }
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
    setCreditCheckLoading(true);
    checkCredits()
      .then((info) => {
        if (!cancelled) setCreditInfo(info);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCreditCheckLoading(false);
      });
    return () => { cancelled = true; };
  }, [jobId]);

  // 経過時間カウンター（タイマー開始フラグで制御）
  useEffect(() => {
    if (!isTimerRunning) return;
    // 完了・失敗時はタイマー停止
    if (job?.status === 'completed' || job?.status === 'failed') {
      setIsTimerRunning(false);
      return;
    }
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isTimerRunning, job?.status]);

  // 完了検知: transcriptionId がセットされたら結果を取得
  useEffect(() => {
    if (!job || completedRef.current) return;
    if (job.status === 'completed' && job.transcriptionId) {
      completedRef.current = true;
      fetchTranscription(job.transcriptionId)
        .then((result) => {
          onTranscriptionComplete(result);
        })
        .catch((err) => {
          setError(
            err instanceof Error ? err.message : '結果の取得に失敗しました',
          );
        });
    }
  }, [job?.status, job?.transcriptionId, onTranscriptionComplete]);

  // 中断判定: status が transcribing だが updatedAt が30秒以上前
  const isStale =
    job?.status === 'transcribing' &&
    Date.now() - new Date(job.updatedAt).getTime() >= 30_000;

  /** 中断/失敗ジョブを再開 */
  const handleResume = () => {
    setIsResuming(true);
    setError('');
    setHideErrorMessage(true);
    setElapsedSeconds(0);
    setIsTimerRunning(true);

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
        setError(err instanceof Error ? err.message : '再開に失敗しました');
        setIsTimerRunning(false);
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

  // ステータステキスト
  const getStatusText = () => {
    if (!job) return '読み込み中...';
    switch (job.status) {
      case 'splitting':
        return '音声ファイルを分割中...';
      case 'transcribing':
        if (isStale) return '文字起こしが中断されました';
        return `チャンク ${job.currentChunkIndex + 1}/${job.totalChunks} を文字起こし中...`;
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

  // 再開可能かどうか（transcribing は中断時のみ再開可能）
  const canResume =
    job &&
    (job.status === 'failed' || (job.status === 'transcribing' && isStale)) &&
    !isResuming;

  // プログレスバーの割合
  const progressPercent =
    job && job.totalChunks > 0
      ? (job.completedChunks.length / job.totalChunks) * 100
      : 0;

  // 完了チャンクをインデックス順にソート
  const sortedChunks = job
    ? [...job.completedChunks].sort((a, b) => a.index - b.index)
    : [];

  return (
    <div className="job-progress-page">
      <div className="job-progress-header">
        <button className="job-progress-back-button" onClick={onBack}>
          ← 戻る
        </button>
        <h1>文字起こし処理中</h1>
      </div>

      <div className="job-progress-content">
        {error && (
          <div className="job-progress-error">
            <p>{error}</p>
          </div>
        )}

        {/* ステータスセクション */}
        {job && (
          <div className="job-progress-status-section">
            <div className="job-progress-file-info">
              <span className="job-progress-file-name">{job.audioFileName}</span>
              {job.totalDurationSec > 0 && (
                <span className="job-progress-file-duration">
                  ({formatDuration(job.totalDurationSec)})
                </span>
              )}
            </div>

            <p className="job-progress-status-text">
              {getStatusText()}
              {isTimerRunning && (
                <span className="job-progress-elapsed">
                  {' '}{formatTime(elapsedSeconds)} 経過
                </span>
              )}
            </p>

            {job.totalChunks > 0 && (
              <>
                <div className="job-progress-bar">
                  <div
                    className="job-progress-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="job-progress-chunk-count">
                  完了: {job.completedChunks.length}/{job.totalChunks} チャンク
                </p>
              </>
            )}

            {/* クレジット情報 + 再開ボタン */}
            {canResume && (() => {
              const estimatedCredits = estimateCredits(job);
              const isCreditSufficient = creditInfo === null || creditInfo.remainingCredits >= estimatedCredits;

              return (
                <>
                  <div className="job-progress-credit-section">
                    {creditCheckLoading && (
                      <p className="job-progress-credit-loading">クレジット情報を確認中...</p>
                    )}
                    {creditInfo && (
                      <div className={`job-progress-credit-info ${!isCreditSufficient ? 'job-progress-credit-insufficient' : ''}`}>
                        <div className="job-progress-credit-row">
                          <span>残りクレジット</span>
                          <span>{creditInfo.remainingCredits.toLocaleString()}</span>
                        </div>
                        <div className="job-progress-credit-row">
                          <span>今回必要なクレジット（推定）</span>
                          <span>約 {estimatedCredits.toLocaleString()}</span>
                        </div>
                        {!isCreditSufficient && (
                          <p className="job-progress-credit-warning">
                            クレジットが不足しています。プランをアップグレードするか、クレジットが回復するまでお待ちください。
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    className="job-progress-resume-button"
                    onClick={handleResume}
                    disabled={isResuming || !isCreditSufficient}
                  >
                    {isResuming ? '再開中...' : '途中から再開する'}
                  </button>
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
                <p className="job-progress-error-detail">{filtered}</p>
              ) : null;
            })()}
          </div>
        )}

        {/* 途中経過テキスト */}
        {sortedChunks.length > 0 && (
          <div className="job-progress-chunks-section">
            <h2>途中経過テキスト</h2>
            <div className="chunk-text-list">
              {sortedChunks.map((chunk) => (
                <div key={chunk.index} className="chunk-text-item">
                  <div className="chunk-text-header">
                    <span className="chunk-text-label">
                      チャンク {chunk.index + 1}
                      <span className="chunk-text-time">
                        ({formatTime(chunk.startTimeSec)} - {formatTime(chunk.startTimeSec + (job?.chunkDurationSec ?? 600))})
                      </span>
                    </span>
                    <button
                      className={`chunk-play-button ${playingChunkIndex === chunk.index ? 'chunk-play-active' : ''}`}
                      onClick={() => handlePlayChunk(chunk.index)}
                      title={playingChunkIndex === chunk.index ? '停止' : '再生'}
                    >
                      {playingChunkIndex === chunk.index ? '■ 停止' : '▶ 再生'}
                    </button>
                  </div>
                  <div className="chunk-text-body">{chunk.text}</div>
                </div>
              ))}

              {/* 処理中のチャンク表示（中断状態では非表示） */}
              {job && job.status === 'transcribing' && !isStale && job.currentChunkIndex >= sortedChunks.length && (
                <div className="chunk-text-item chunk-text-processing">
                  <div className="chunk-text-header">
                    <span className="chunk-text-label">
                      チャンク {job.currentChunkIndex + 1}
                      <span className="chunk-text-time">
                        ({formatTime(job.currentChunkIndex * (job.chunkDurationSec ?? 600))} - {formatTime((job.currentChunkIndex + 1) * (job.chunkDurationSec ?? 600))})
                      </span>
                    </span>
                  </div>
                  <div className="chunk-text-body chunk-text-placeholder">
                    <span className="chunk-spinner" />
                    文字起こし中...
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* チャンク音声プレイヤー（画面下部に固定表示） */}
        {playingChunkIndex !== null && (
          <div className="chunk-audio-player">
            <p className="chunk-audio-label">
              チャンク {playingChunkIndex + 1} を再生中
            </p>
            <audio
              ref={audioRef}
              controls
              autoPlay
              src={getChunkAudioUrl(jobId, playingChunkIndex)}
              onEnded={() => setPlayingChunkIndex(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
