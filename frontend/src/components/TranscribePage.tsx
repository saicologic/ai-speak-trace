import { useCallback, useEffect, useRef, useState } from 'react';
import {
  uploadAudioFile,
  transcribeAudio,
  fetchActiveJob,
  checkCredits,
  checkAudioFileExists,
  deleteAllResourcesByFileName,
  BASE_URL,
  apiFetch,
} from '../api/client';
import type { ChunkedJobStatus, CreditInfo } from '../api/client';
import type { Transcription } from '../types';
import { CREDITS_PER_MINUTE, formatTime, formatDuration } from '../utils/transcription';
import { confirmDialog, isTauri } from '../utils/platform';
import { PageLayout } from './PageLayout';

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

/** 手順ごとの白いカードと、その見出し */
const sectionClass = 'rounded-[10px] border border-gray-200 bg-white p-6';
const sectionHeadingClass = 'mb-4 text-lg font-semibold text-gray-800';
/** 文字起こし中の状態の文と、補足 */
const processingTextClass = 'mb-2 text-lg font-medium text-gray-700';
const processingHintClass = 'text-center text-sm text-gray-400';
/** クレジットが足りないときの文（次回リセットの日時も、今までの CSS と同じく同じ見た目にする） */
const creditWarningTextClass = 'mb-1 text-sm font-medium text-red-800';
/** 完了の画面のボタンに共通の、余白・文字の大きさ */
const doneButtonClass = 'rounded-lg px-6 py-[0.6rem] text-base font-medium transition-all duration-150';

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
  // 録音されている人の同意を確認したか（確認するまで文字起こしを実行できない）
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  // JobProgressPageに遷移済みフラグ（遷移後はtranscribeAudioの結果を無視する）
  const navigatedToJobProgressRef = useRef(false);
  // ブラウザ（開発サーバー）で使うファイル選択
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        filePath = (selected as { path: string }).path;
      } else {
        filePath = String(selected);
      }

      const fileName = filePath.split('/').pop() || 'audio.mp3';
      const mimeType = getMimeType(fileName);

      // ファイルを読み込んでFileオブジェクトを作成
      const bytes = await readFile(filePath);
      const blob = new Blob([bytes], { type: mimeType });
      const fileObj = new File([blob], fileName, { type: mimeType });

      loadSelectedFile(fileObj);
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

  /** 選んだファイルを読み込んで、プレビューの段階に進む */
  const loadSelectedFile = (fileObj: File) => {
    // 前のプレビューURLを解放
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(fileObj);
    setPreviewUrl(URL.createObjectURL(fileObj));
    setError('');
    setStep('preview');
  };

  /** ブラウザ（開発サーバー）でのファイル選択 */
  const handleBrowserFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    // 同じファイルを選び直しても change が起きるよう、選択を空に戻す
    e.target.value = '';
    if (selected) loadSelectedFile(selected);
  };

  /** ファイル選択ボタンのクリック処理（Tauri ではネイティブダイアログ、ブラウザではファイル選択） */
  const handleSelectClick = () => {
    if (isTauri()) {
      void handleTauriFileSelect();
    } else {
      fileInputRef.current?.click();
    }
  };

  /** 文字起こし実行（アップロード→文字起こし） */
  const handleTranscribe = async () => {
    if (!file) return;

    // 既存ファイルの上書き確認
    const fileExists = await checkAudioFileExists(file.name);
    if (fileExists) {
      const confirmed = await confirmDialog(
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
        await apiFetch(`${BASE_URL}/audio-files`);
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
    setConsentConfirmed(false);
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
          <h1 className="text-xl font-semibold">音声ファイルの文字起こし</h1>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-[600px] flex-1 p-8">
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800 [&_p]:mb-2 [&_p:last-child]:mb-0">
            {isQuotaExceeded ? (
              <>
                <p className="text-base-plus font-semibold">クレジット不足</p>
                <p className="rounded-sm bg-black/4 p-2 font-[monospace] text-sm whitespace-pre-wrap">{error}</p>
                <p>ElevenLabsのクレジットが不足しています。プランをアップグレードするか、クレジットが回復するまでお待ちください。</p>
              </>
            ) : (
              <p>{error}</p>
            )}
            {isApiKeyMissing && (
              <button
                className="inline-block rounded-md border-none bg-primary px-4 py-[0.4rem] text-md font-medium text-white transition-colors duration-150 hover:bg-primary-hover"
                onClick={onNavigateSettings}
              >
                設定画面を開く
              </button>
            )}

          </div>
        )}

        {/* ステップ1: ファイル選択 */}
        {step === 'select' && (
          <div className={sectionClass}>
            <h2 className={sectionHeadingClass}>音声ファイルを選択</h2>
            <button
              className="mb-3 w-full rounded-xl border-2 border-dashed border-gray-300 bg-[#fafbfc] p-6 text-lg font-medium text-gray-700 transition-all duration-150 hover:border-blue-300 hover:bg-blue-50 hover:text-gray-800"
              onClick={handleSelectClick}
            >
              ファイルを選択
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/mp4,video/webm,.mp3,.wav,.m4a,.ogg,.flac,.aac,.mp4,.webm"
              hidden
              onChange={handleBrowserFileChange}
            />
            <p className="text-center text-xs text-gray-400">
              対応形式: MP3, WAV, M4A, OGG, FLAC, AAC, MP4, WebM
            </p>
          </div>
        )}

        {/* ステップ2: プレビュー再生 + 文字起こし */}
        {step === 'preview' && file && (
          <div className={sectionClass}>
            <h2 className={sectionHeadingClass}>音声ファイルの確認</h2>
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
              <span className="flex-1 text-base font-medium break-all text-green-800">{file.name}</span>
              <span className="text-sm whitespace-nowrap text-gray-500">({formatFileSize(file.size)})</span>
              <button
                className="rounded-sm border border-gray-300 bg-white px-2 py-1 text-xs text-gray-500 transition-all duration-150 hover:bg-gray-100 hover:text-gray-700"
                onClick={handleReset}
              >
                変更
              </button>
            </div>
            {audioDurationSec !== null && (
              <p className="mb-2 text-sm text-gray-500">
                音声の長さ: {formatDuration(audioDurationSec)}
                （推定処理時間: 約{formatDuration(estimateProcessingTime(audioDurationSec))}）
              </p>
            )}
            {/* クレジット情報 */}
            {creditCheckLoading && (
              <p className="mb-2 text-sm font-medium text-blue-600">クレジット情報を確認中...</p>
            )}
            {creditCheckError && (
              <p className="mb-2 text-sm text-amber-600">
                クレジット確認エラー: {creditCheckError}
              </p>
            )}
            {creditInfo && (
              <div
                className={`mb-4 rounded-lg border px-4 py-3 text-md ${
                  isCreditSufficient ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                }`}
              >
                <div className={`flex justify-between py-[0.2rem] ${isCreditSufficient ? 'text-gray-700' : 'text-red-800'}`}>
                  <span>残りクレジット</span>
                  <span>{creditInfo.remainingCredits.toLocaleString()} / {creditInfo.characterLimit.toLocaleString()}</span>
                </div>
                {estimatedCredits !== null && (
                  <div className={`flex justify-between py-[0.2rem] ${isCreditSufficient ? 'text-gray-700' : 'text-red-800'}`}>
                    <span>推定必要クレジット</span>
                    <span>{estimatedCredits.toLocaleString()}</span>
                  </div>
                )}
                {!isCreditSufficient && (
                  <div className="mt-2 border-t border-red-200 pt-2">
                    <p className={creditWarningTextClass}>クレジットが不足しています。</p>
                    <a
                      href="https://elevenlabs.io/subscription"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mb-1 inline-block text-sm text-primary underline hover:text-primary-hover"
                    >
                      ElevenLabsダッシュボードでプランを確認
                    </a>
                    {creditInfo.nextResetDate && (
                      <p className={creditWarningTextClass}>
                        次回リセット: {new Date(creditInfo.nextResetDate).toLocaleDateString('ja-JP', {
                          year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="mb-4">
              <audio className="w-full" controls src={previewUrl} onLoadedMetadata={handleLoadedMetadata} />
            </div>
            <label className="mt-4 mb-3 flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-left text-md text-gray-700">
              <input
                type="checkbox"
                className="mt-[0.2rem] shrink-0"
                checked={consentConfirmed}
                onChange={(e) => setConsentConfirmed(e.target.checked)}
              />
              <span>
                録音されている全員から、録音と文字起こし（音声を ElevenLabs に送信して処理すること）の同意を得ています。または、一般に公開されている音声です
              </span>
            </label>
            <button
              className="w-full rounded-lg border-none bg-primary p-3 text-lg font-semibold text-white transition-colors duration-150 enabled:hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-400"
              onClick={handleTranscribe}
              disabled={
                creditCheckLoading ||
                !creditInfo ||
                !isCreditSufficient ||
                !consentConfirmed
              }
            >
              文字起こしを実行
            </button>
          </div>
        )}

        {/* ステップ3: 文字起こし中 */}
        {step === 'transcribing' && (
          <div className={sectionClass}>
            <div className="flex flex-col items-center px-4 py-12">
              <div className="mb-4 size-10 animate-spin-fast rounded-full border-3 border-gray-200 border-t-primary" />
              {chunkProgress && chunkProgress.totalChunks > 1 ? (
                <>
                  <p className={processingTextClass}>
                    {chunkProgress.status === 'initializing'
                      ? '文字起こしを準備中...'
                      : chunkProgress.status === 'splitting'
                        ? '音声ファイルを分割中...'
                        : chunkProgress.status === 'merging'
                          ? '結果をマージ中...'
                          : `チャンク ${chunkProgress.currentChunkIndex + 1}/${chunkProgress.totalChunks} を文字起こし中...`}
                    {' '}{formatTime(elapsedSeconds)} 経過
                  </p>
                  <div className="my-3 h-2 w-full overflow-hidden rounded-sm bg-gray-200">
                    <div
                      className="h-full rounded-sm bg-primary transition-[width] duration-500 ease-[ease]"
                      style={{
                        width: `${(chunkProgress.completedChunks.length / chunkProgress.totalChunks) * 100}%`,
                      }}
                    />
                  </div>
                  <p className={processingHintClass}>
                    完了: {chunkProgress.completedChunks.length}/{chunkProgress.totalChunks} チャンク
                  </p>
                </>
              ) : (
                <>
                  <p className={processingTextClass}>
                    文字起こし中... {formatTime(elapsedSeconds)} 経過
                  </p>
                  {audioDurationSec !== null ? (
                    <p className={processingHintClass}>
                      推定残り時間: 約{formatDuration(Math.max(0, estimateProcessingTime(audioDurationSec) - elapsedSeconds))}
                    </p>
                  ) : (
                    <p className={processingHintClass}>
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
          <div className={sectionClass}>
            <div className="flex flex-col items-center px-4 py-8">
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-green-100 text-2xl font-bold text-green-600">✓</div>
              <p className="mb-1 text-lg-plus font-semibold text-green-800">文字起こしが完了しました</p>
              <p className="mb-6 text-md text-gray-500">
                「履歴」タブから結果を確認できます
              </p>
              <div className="flex gap-3">
                <button
                  className={`${doneButtonClass} border-none bg-brand text-white hover:bg-brand-hover`}
                  onClick={onBack}
                >
                  履歴を確認する
                </button>
                <button
                  className={`${doneButtonClass} border border-gray-300 bg-white text-gray-700 hover:bg-gray-100`}
                  onClick={handleReset}
                >
                  別のファイルを文字起こし
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
