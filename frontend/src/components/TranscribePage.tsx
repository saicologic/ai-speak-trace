import { useCallback, useEffect, useRef, useState } from 'react';
import {
  uploadAudioFile,
  transcribeAudio,
  fetchActiveJob,
  checkCredits,
  checkAudioFileExists,
  deleteAllResourcesByFileName,
  BASE_URL,
} from '../api/client';
import type { ChunkedJobStatus, CreditInfo } from '../api/client';
import type { Transcription } from '../types';
import { CREDITS_PER_MINUTE, formatTime, formatDuration } from '../utils/transcription';
import './TranscribePage.css';

// Podcastキャッシュフォルダの相対パス（HOMEからの相対）
const PODCAST_CACHE_RELATIVE =
  'Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache';

/** チャンク進捗ポーリング間隔（ミリ秒） */
const CHUNK_POLL_INTERVAL_MS = 2000;

/** ファイルサイズを読みやすい形式にフォーマット */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * 推定処理時間を計算（秒）
 * ElevenLabsはリアルタイムの20〜50倍速で処理する。
 * アップロード時間も考慮して控えめに20倍速で見積もる。
 */
function estimateProcessingTime(audioDurationSec: number): number {
  return Math.ceil(audioDurationSec / 20);
}

/** 拡張子からMIMEタイプを推定 */
function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    aac: 'audio/aac',
    mp4: 'video/mp4',
    webm: 'audio/webm',
  };
  return mimeTypes[ext || ''] || 'audio/mpeg';
}

interface TranscribePageProps {
  onBack: () => void;
  onTranscriptionComplete: (transcription: Transcription) => void;
  onNavigateSettings: () => void;
  onChunkedJobStarted?: (jobId: string) => void;
}

type Step = 'select' | 'preview' | 'transcribing' | 'done';

/** 音声ファイルの文字起こしページ */
export function TranscribePage({
  onBack,
  onTranscriptionComplete,
  onNavigateSettings,
  onChunkedJobStarted,
}: TranscribePageProps) {
  const [step, setStep] = useState<Step>('select');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [isApiKeyMissing, setIsApiKeyMissing] = useState(false);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioDurationSec, setAudioDurationSec] = useState<number | null>(null);
  const [chunkProgress, setChunkProgress] = useState<ChunkedJobStatus | null>(null);

  const [creditInfo, setCreditInfo] = useState<CreditInfo | null>(null);
  const [creditCheckLoading, setCreditCheckLoading] = useState(false);
  const [creditCheckError, setCreditCheckError] = useState<string | null>(null);

  // JobProgressPageに遷移済みフラグ（遷移後はtranscribeAudioの結果を無視する）
  const navigatedToJobProgressRef = useRef(false);

  // 推定必要クレジット数（音声の長さから算出）
  const estimatedCredits = audioDurationSec !== null
    ? Math.ceil((audioDurationSec / 60) * CREDITS_PER_MINUTE)
    : null;

  // クレジット十分かどうか
  const isCreditSufficient = creditInfo !== null && estimatedCredits !== null
    ? creditInfo.remainingCredits >= estimatedCredits
    : true; // 情報が取得できていない場合はブロックしない

  // previewUrl のメモリ解放
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // 文字起こし中の経過時間カウンター
  useEffect(() => {
    if (step !== 'transcribing') {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [step]);

  // プレビューステップでクレジット残量を確認
  useEffect(() => {
    if (step !== 'preview') {
      setCreditInfo(null);
      setCreditCheckError(null);
      return;
    }

    let cancelled = false;
    const doCheck = async () => {
      setCreditCheckLoading(true);
      setCreditCheckError(null);
      try {
        const info = await checkCredits();
        if (!cancelled) setCreditInfo(info);
      } catch (err) {
        if (!cancelled) {
          // APIキー未設定は既存フローで処理されるのでスキップ
          if (err instanceof Error && err.name === 'ApiKeyMissingError') {
            return;
          }
          setCreditCheckError(
            err instanceof Error ? err.message : 'クレジット情報の取得に失敗しました',
          );
        }
      } finally {
        if (!cancelled) setCreditCheckLoading(false);
      }
    };
    doCheck();
    return () => { cancelled = true; };
  }, [step]);

  // 文字起こし中のチャンク進捗ポーリング
  // チャンクジョブが検出されたらJobProgressPageに遷移
  useEffect(() => {
    if (step !== 'transcribing' || !file) return;
    let navigated = false;
    const interval = setInterval(async () => {
      const job = await fetchActiveJob(file.name);
      if (job) {
        setChunkProgress(job);
        // チャンクジョブが開始されたらJobProgressPageに遷移
        if (!navigated && job.totalChunks > 1 && onChunkedJobStarted) {
          navigated = true;
          navigatedToJobProgressRef.current = true;
          onChunkedJobStarted(job.id);
        }
      }
    }, CHUNK_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [step, file, onChunkedJobStarted]);

  /** Tauri環境でのファイル選択（ネイティブダイアログ） */
  const handleTauriFileSelect = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const { homeDir } = await import('@tauri-apps/api/path');

      // デフォルトパスをPodcastキャッシュフォルダに設定
      const home = await homeDir();
      // homeDir()の末尾スラッシュの有無を正規化
      const homePath = home.endsWith('/') ? home : `${home}/`;
      const defaultPath = `${homePath}${PODCAST_CACHE_RELATIVE}`;

      const selected = await open({
        defaultPath,
      });

      if (!selected) return; // キャンセル

      // ダイアログの戻り値からファイルパスを取得
      // Tauri v2ではstring or FilePathオブジェクトの場合がある
      let filePath: string;
      if (typeof selected === 'string') {
        filePath = selected;
      } else if (typeof selected === 'object' && selected !== null && 'path' in selected) {
        filePath = (selected as any).path;
      } else {
        filePath = String(selected);
      }

      const fileName = filePath.split('/').pop() || 'audio.mp3';
      const mimeType = getMimeType(fileName);

      // ファイルを読み込んでFileオブジェクトを作成
      const bytes = await readFile(filePath);
      const blob = new Blob([bytes], { type: mimeType });
      const fileObj = new File([blob], fileName, { type: mimeType });

      // 前のプレビューURLを解放
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setFile(fileObj);
      setPreviewUrl(URL.createObjectURL(blob));
      setError('');
      setStep('preview');
    } catch (err) {
      // エラー詳細を表示
      const detail = err instanceof Error ? err.message : JSON.stringify(err);
      setError(`ファイルの読み込みに失敗しました: ${detail}`);
    }
  };

  /** audioメタデータ読み込み時に長さを取得 */
  const handleLoadedMetadata = useCallback(
    (e: React.SyntheticEvent<HTMLAudioElement>) => {
      const duration = e.currentTarget.duration;
      if (duration && isFinite(duration)) {
        setAudioDurationSec(duration);
      }
    },
    [],
  );

  /** ファイル選択ボタンのクリック処理 */
  const handleSelectClick = () => {
    handleTauriFileSelect();
  };

  /** 文字起こし実行（アップロード→文字起こし） */
  const handleTranscribe = async () => {
    if (!file) return;

    // 既存ファイルの上書き確認
    const fileExists = await checkAudioFileExists(file.name);
    if (fileExists) {
      const { confirm } = await import('@tauri-apps/plugin-dialog');
      const confirmed = await confirm(
        `「${file.name}」は既に文字起こし済みです。\n上書きして新しく文字起こししますか？\n\n※ 既存のチャンクデータと文字起こし結果（履歴）は全て削除されます。`,
        { title: '上書き確認', kind: 'warning' },
      );

      if (!confirmed) {
        // キャンセルされた場合は何もしない
        return;
      }

      // 全リソースを削除
      try {
        await deleteAllResourcesByFileName(file.name);
      } catch (deleteErr) {
        console.error('リソース削除に失敗:', deleteErr);
        setError('既存ファイルの削除に失敗しました。再度お試しください。');
        return;
      }
    }

    setError('');
    setChunkProgress(null);
    setStep('transcribing');
    navigatedToJobProgressRef.current = false;
    try {
      // 0. サーバーの疎通確認
      try {
        await fetch(`${BASE_URL}/audio-files`);
      } catch {
        throw new Error('バックエンドサーバーに接続できません。sidecarが起動しているか確認してください。');
      }
      // 1. サーバーにアップロード
      const fileName = await uploadAudioFile(file);
      // 2. 文字起こし実行
      const result = await transcribeAudio(fileName);
      // JobProgressPageに遷移済みなら結果を無視
      if (navigatedToJobProgressRef.current) return;
      onTranscriptionComplete(result);
      setStep('done');
    } catch (err) {
      // JobProgressPageに遷移済みならエラーを無視
      if (navigatedToJobProgressRef.current) return;
      const detail = err instanceof Error ? err.message : String(err);
      const errorName = err instanceof Error ? err.name : 'Unknown';
      const stack = err instanceof Error ? err.stack : '';
      console.error('[TranscribePage] 文字起こしエラー:', {
        name: errorName,
        message: detail,
        stack,
        error: err,
      });
      setIsApiKeyMissing(false);
      setIsQuotaExceeded(false);

      if (errorName === 'ApiKeyMissingError') {
        setIsApiKeyMissing(true);
        setError(detail);
      } else if (errorName === 'QuotaExceededError') {
        setIsQuotaExceeded(true);
        setError(detail);
      } else if (errorName === 'FfmpegMissingError') {
        setError(detail);
      } else {
        setError(`文字起こしに失敗しました: ${detail}`);
      }
      setStep('preview');
    }
  };


  /** 別のファイルを選択し直す */
  const handleReset = () => {
    navigatedToJobProgressRef.current = false;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setStep('select');
    setFile(null);
    setPreviewUrl('');
    setError('');
    setIsApiKeyMissing(false);
    setIsQuotaExceeded(false);
    setAudioDurationSec(null);
    setChunkProgress(null);
    setCreditInfo(null);
    setCreditCheckLoading(false);
    setCreditCheckError(null);
  };

  return (
    <div className="transcribe-page">
      <div className="transcribe-header">
        <button className="transcribe-back-button" onClick={onBack}>
          ← 戻る
        </button>
        <h1>音声ファイルの文字起こし</h1>
      </div>

      <div className="transcribe-content">
        {error && (
          <div className="transcribe-error">
            {isQuotaExceeded ? (
              <>
                <p className="transcribe-error-title">クレジット不足</p>
                <p className="transcribe-error-detail">{error}</p>
                <p>ElevenLabsのクレジットが不足しています。プランをアップグレードするか、クレジットが回復するまでお待ちください。</p>
              </>
            ) : (
              <p>{error}</p>
            )}
            {isApiKeyMissing && (
              <button
                className="transcribe-settings-link"
                onClick={onNavigateSettings}
              >
                設定画面を開く
              </button>
            )}

          </div>
        )}

        {/* ステップ1: ファイル選択 */}
        {step === 'select' && (
          <div className="transcribe-section">
            <h2>音声ファイルを選択</h2>
            <button
              className="transcribe-select-button"
              onClick={handleSelectClick}
            >
              ファイルを選択
            </button>
            <p className="transcribe-formats">
              対応形式: MP3, WAV, M4A, OGG, FLAC, AAC, MP4, WebM
            </p>
          </div>
        )}

        {/* ステップ2: プレビュー再生 + 文字起こし */}
        {step === 'preview' && file && (
          <div className="transcribe-section">
            <h2>音声ファイルの確認</h2>
            <div className="transcribe-file-info">
              <span className="transcribe-file-name">{file.name}</span>
              <span className="transcribe-file-size">({formatFileSize(file.size)})</span>
              <button
                className="transcribe-file-change"
                onClick={handleReset}
              >
                変更
              </button>
            </div>
            {audioDurationSec !== null && (
              <p className="transcribe-audio-duration">
                音声の長さ: {formatDuration(audioDurationSec)}
                （推定処理時間: 約{formatDuration(estimateProcessingTime(audioDurationSec))}）
              </p>
            )}
            {/* クレジット情報 */}
            {creditCheckLoading && (
              <p className="transcribe-credit-loading">クレジット情報を確認中...</p>
            )}
            {creditCheckError && (
              <p className="transcribe-credit-error">
                クレジット確認エラー: {creditCheckError}
              </p>
            )}
            {creditInfo && (
              <div className={`transcribe-credit-info ${!isCreditSufficient ? 'transcribe-credit-insufficient' : ''}`}>
                <div className="transcribe-credit-row">
                  <span>残りクレジット</span>
                  <span>{creditInfo.remainingCredits.toLocaleString()} / {creditInfo.characterLimit.toLocaleString()}</span>
                </div>
                {estimatedCredits !== null && (
                  <div className="transcribe-credit-row">
                    <span>推定必要クレジット</span>
                    <span>{estimatedCredits.toLocaleString()}</span>
                  </div>
                )}
                {!isCreditSufficient && (
                  <div className="transcribe-credit-warning">
                    <p>クレジットが不足しています。</p>
                    <a
                      href="https://elevenlabs.io/subscription"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="transcribe-credit-link"
                    >
                      ElevenLabsダッシュボードでプランを確認
                    </a>
                    {creditInfo.nextResetDate && (
                      <p className="transcribe-credit-reset">
                        次回リセット: {new Date(creditInfo.nextResetDate).toLocaleDateString('ja-JP', {
                          year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="transcribe-preview-player">
              <audio controls src={previewUrl} onLoadedMetadata={handleLoadedMetadata} />
            </div>
            <button
              className="transcribe-start-button"
              onClick={handleTranscribe}
              disabled={creditCheckLoading || !creditInfo || !isCreditSufficient}
            >
              文字起こしを実行
            </button>
          </div>
        )}

        {/* ステップ3: 文字起こし中 */}
        {step === 'transcribing' && (
          <div className="transcribe-section">
            <div className="transcribe-processing">
              <div className="transcribe-spinner" />
              {chunkProgress && chunkProgress.totalChunks > 1 ? (
                <>
                  <p className="transcribe-processing-text">
                    {chunkProgress.status === 'initializing'
                      ? '文字起こしを準備中...'
                      : chunkProgress.status === 'splitting'
                        ? '音声ファイルを分割中...'
                        : chunkProgress.status === 'merging'
                          ? '結果をマージ中...'
                          : `チャンク ${chunkProgress.currentChunkIndex + 1}/${chunkProgress.totalChunks} を文字起こし中...`}
                    {' '}{formatTime(elapsedSeconds)} 経過
                  </p>
                  <div className="transcribe-progress-bar">
                    <div
                      className="transcribe-progress-fill"
                      style={{
                        width: `${(chunkProgress.completedChunks.length / chunkProgress.totalChunks) * 100}%`,
                      }}
                    />
                  </div>
                  <p className="transcribe-processing-hint">
                    完了: {chunkProgress.completedChunks.length}/{chunkProgress.totalChunks} チャンク
                  </p>
                </>
              ) : (
                <>
                  <p className="transcribe-processing-text">
                    文字起こし中... {formatTime(elapsedSeconds)} 経過
                  </p>
                  {audioDurationSec !== null ? (
                    <p className="transcribe-processing-hint">
                      推定残り時間: 約{formatDuration(Math.max(0, estimateProcessingTime(audioDurationSec) - elapsedSeconds))}
                    </p>
                  ) : (
                    <p className="transcribe-processing-hint">
                      音声の長さやファイルサイズにより数分かかる場合があります。
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ステップ4: 完了 */}
        {step === 'done' && (
          <div className="transcribe-section">
            <div className="transcribe-done">
              <div className="transcribe-done-icon">✓</div>
              <p className="transcribe-done-text">文字起こしが完了しました</p>
              <p className="transcribe-done-hint">
                「履歴」タブから結果を確認できます
              </p>
              <div className="transcribe-done-actions">
                <button
                  className="transcribe-back-to-main"
                  onClick={onBack}
                >
                  履歴を確認する
                </button>
                <button
                  className="transcribe-another"
                  onClick={handleReset}
                >
                  別のファイルを文字起こし
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
