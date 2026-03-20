import { useEffect, useState } from 'react';
import { uploadAudioFile, transcribeAudio } from '../api/client';
import type { Transcription } from '../types';
import './TranscribePage.css';

// Podcastキャッシュフォルダの相対パス（HOMEからの相対）
const PODCAST_CACHE_RELATIVE =
  'Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache';

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
}

type Step = 'select' | 'preview' | 'transcribing' | 'done';

/** 音声ファイルの文字起こしページ */
export function TranscribePage({
  onBack,
  onTranscriptionComplete,
}: TranscribePageProps) {
  const [step, setStep] = useState<Step>('select');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');

  // previewUrl のメモリ解放
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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

  /** ファイル選択ボタンのクリック処理 */
  const handleSelectClick = () => {
    handleTauriFileSelect();
  };

  /** 文字起こし実行（アップロード→文字起こし） */
  const handleTranscribe = async () => {
    if (!file) return;
    setError('');
    setStep('transcribing');
    try {
      // 0. サーバーの疎通確認
      try {
        await fetch('http://localhost:3000/api/audio-files');
      } catch {
        throw new Error('バックエンドサーバーに接続できません。sidecarが起動しているか確認してください。');
      }
      // 1. サーバーにアップロード
      const fileName = await uploadAudioFile(file);
      // 2. 文字起こし実行
      const result = await transcribeAudio(fileName);
      onTranscriptionComplete(result);
      setStep('done');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const errorName = err instanceof Error ? err.name : 'Unknown';
      const stack = err instanceof Error ? err.stack : '';
      console.error('[TranscribePage] 文字起こしエラー:', {
        name: errorName,
        message: detail,
        stack,
        error: err,
      });
      setError(`文字起こしに失敗しました: ${detail}`);
      setStep('preview');
    }
  };

  /** 別のファイルを選択し直す */
  const handleReset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setStep('select');
    setFile(null);
    setPreviewUrl('');
    setError('');
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
        {error && <div className="transcribe-error">{error}</div>}

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
              <button
                className="transcribe-file-change"
                onClick={handleReset}
              >
                変更
              </button>
            </div>
            <div className="transcribe-preview-player">
              <audio controls src={previewUrl} />
            </div>
            <button
              className="transcribe-start-button"
              onClick={handleTranscribe}
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
              <p className="transcribe-processing-text">文字起こし中...</p>
              <p className="transcribe-processing-hint">
                アップロードと文字起こしを実行しています。
                音声の長さにより数十秒かかる場合があります。
              </p>
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
