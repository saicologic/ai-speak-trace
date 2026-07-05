import type {
  AppSettings,
  AudioFileInfo,
  ContextAnalysisResponse,
  DeepSearchAnalysis,
  DeepSearchResponse,
  DocumentInfo,
  InterviewAnalysis,
  InterviewAnalysisSummary,
  Transcription,
  TranscriptionSummary,
  TranscriptionSummaryLog,
  SummaryConfig,
} from '../types';

/**
 * バックエンドのベースURL
 *
 * - 本番（Tauri sidecar）: initBackendUrl() で動的に設定される
 * - 開発（Vite dev server）: Vite proxy 経由のため相対パス /api のまま
 *
 * アプリ起動時に initBackendUrl() を呼び出してから API を使用すること。
 */
export let BASE_URL = '/api';

/**
 * バックエンドURLを初期化する
 * - 本番: Tauri invoke('get_backend_port') でポートを取得してBASE_URLを更新
 * - 開発: Vite proxy が /api を転送するため何もしない
 */
export async function initBackendUrl(): Promise<void> {
  // Tauri環境（本番）かどうかを判定
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!isTauri) {
    // Vite dev server経由: proxy が /api を転送するため相対パスのまま
    console.log('[API] 開発モード: Vite proxy 経由 (BASE_URL=/api)');
    return;
  }

  // Tauri invoke でポートを取得（sidecarが起動してPORT=を出力するまで待機）
  const { invoke } = await import('@tauri-apps/api/core');
  const MAX_WAIT_MS = 30_000;
  const INTERVAL_MS = 200;
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS) {
    const port: number | null = await invoke('get_backend_port');
    if (port !== null) {
      BASE_URL = `http://127.0.0.1:${port}/api`;
      console.log(`[API] バックエンドポート確定: ${port} (BASE_URL=${BASE_URL})`);
      return;
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }

  // タイムアウト: 開発時はVite proxyにフォールバック
  // （.backend-portが存在しない状態でtauri devが先に起動した場合など）
  if (import.meta.env.DEV) {
    console.warn('[API] ポート取得タイムアウト。Vite proxy にフォールバックします (BASE_URL=/api)');
    BASE_URL = '/api';
    return;
  }

  throw new Error('[API] バックエンドの起動がタイムアウトしました（30秒）');
}

// リトライ設定（sidecar起動待ち用）
const RETRY_MAX = 5;
const RETRY_INITIAL_DELAY_MS = 500;

/** ネットワークエラー時にリトライ付きでfetchを実行する */
async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      lastError = err;
      // ネットワークエラー（サーバー未起動など）の場合のみリトライ
      const delay = RETRY_INITIAL_DELAY_MS * 2 ** attempt;
      console.warn(
        `[API] 接続失敗 (${attempt + 1}/${RETRY_MAX}), ${delay}ms後にリトライ:`,
        err,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/** 音声ファイル一覧を取得 */
export async function fetchAudioFiles(): Promise<AudioFileInfo[]> {
  console.log('[API] fetchAudioFiles:', `${BASE_URL}/audio-files`);
  const res = await fetchWithRetry(`${BASE_URL}/audio-files`);
  console.log('[API] fetchAudioFiles status:', res.status);
  if (!res.ok) {
    const body = await res.text();
    console.error('[API] fetchAudioFiles error body:', body);
    throw new Error(`音声ファイル一覧の取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  console.log('[API] fetchAudioFiles result:', data);
  return data.files;
}

/** アップロード用署名付きURLを取得 */
async function getUploadUrl(fileName: string): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/audio-files/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName }),
  });
  if (!res.ok) {
    console.error('[API] getUploadUrl failed:', res.status);
    return null;
  }
  const data = await res.json();
  return data.url;
}

/** 音声ファイルをアップロード（S3の場合は署名付きURLで直接アップロード） */
export async function uploadAudioFile(file: File): Promise<string> {
  console.log('[API] uploadAudioFile:', file.name, file.size, file.type);

  // 署名付きURLを取得（S3モードならURLが返る、ローカルならnull）
  const uploadUrl = await getUploadUrl(file.name);

  if (uploadUrl) {
    // S3に直接アップロード
    console.log('[API] uploading directly to S3');
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[API] S3 upload error:', res.status, body);
      throw new Error(`S3へのアップロードに失敗しました: ${res.status}`);
    }
    console.log('[API] S3 upload success');
    return file.name;
  }

  // ローカルモード: 従来のmultipartアップロード
  console.log('[API] uploading via multipart');
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/audio-files`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('[API] uploadAudioFile error body:', body);
    throw new Error(`音声ファイルのアップロードに失敗しました: ${res.status} ${body}`);
  }
  const data = await res.json();
  console.log('[API] uploadAudioFile result:', data);
  return data.fileName;
}

/** 音声ファイルの再生用URLを取得 */
export async function fetchAudioFileUrl(fileName: string): Promise<string> {
  const res = await fetch(
    `${BASE_URL}/audio-files/${encodeURIComponent(fileName)}/url`,
  );
  if (!res.ok) {
    throw new Error(`音声ファイルURLの取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  // ローカルモードでは "/audio/..." 形式のパスが返るため、ベースURLを補完する
  // S3モードでは完全なURLが返るためそのまま使用する
  const url: string = data.url;
  if (url.startsWith('/')) {
    // BASE_URL から origin 部分を取り出す（例: "http://127.0.0.1:52341/api" → "http://127.0.0.1:52341"）
    const origin = BASE_URL.startsWith('http')
      ? new URL(BASE_URL).origin
      : window.location.origin;
    return `${origin}${url}`;
  }
  return url;
}

/** 音声ファイルを文字起こし */
export async function transcribeAudio(
  fileName: string,
): Promise<Transcription> {
  const url = `${BASE_URL}/transcribe`;
  console.log('[API] transcribeAudio 開始:', { url, fileName });

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName }),
  });

  console.log('[API] transcribeAudio レスポンス:', { status: res.status, statusText: res.statusText });

  if (!res.ok) {
    // レスポンスボディはストリームなので一度だけ読む
    const rawText = await res.text().catch(() => '');
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(rawText);
    } catch {
      // JSONパース失敗時はrawTextをそのまま使う
    }
    console.error('[API] transcribeAudio エラーレスポンス:', { status: res.status, body, rawText });
    if (body?.code === 'QUOTA_EXCEEDED') {
      const error = new Error(typeof body.message === 'string' ? body.message : rawText);
      error.name = 'QuotaExceededError';
      throw error;
    }
    if (body?.code === 'TRANSCRIPTION_TIMEOUT') {
      const error = new Error(typeof body.message === 'string' ? body.message : rawText);
      error.name = 'TranscriptionTimeoutError';
      throw error;
    }
    if (body?.code === 'API_KEY_MISSING') {
      const error = new Error(typeof body.message === 'string' ? body.message : rawText);
      error.name = 'ApiKeyMissingError';
      throw error;
    }
    if (body?.code === 'FFMPEG_MISSING') {
      const error = new Error(typeof body.message === 'string' ? body.message : rawText);
      error.name = 'FfmpegMissingError';
      throw error;
    }
    const serverMessage = (typeof body?.message === 'string' ? body.message : null) || rawText || res.statusText;
    throw new Error(`文字起こしに失敗しました (${res.status}): ${serverMessage}`);
  }
  const data = await res.json();
  console.log('[API] transcribeAudio 完了:', { id: data.transcription?.id });
  return data.transcription;
}

/** チャンク分割ジョブの進捗状態 */
export interface ChunkedJobStatus {
  id: string;
  audioFileName: string;
  status: 'initializing' | 'splitting' | 'transcribing' | 'merging' | 'completed' | 'failed';
  totalChunks: number;
  currentChunkIndex: number;
  completedChunks: { index: number }[];
  errorMessage?: string;
}

/** 進行中のチャンクジョブを取得 */
export async function fetchActiveJob(
  fileName: string,
): Promise<ChunkedJobStatus | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/transcribe/jobs/active?fileName=${encodeURIComponent(fileName)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.job;
  } catch {
    return null;
  }
}

/** 同名ファイルの未完了ジョブを検索（上書き確認用） */
export async function checkExistingJob(
  fileName: string,
): Promise<ChunkedJobDetail | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/chunked-jobs/check/${encodeURIComponent(fileName)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.job;
  } catch {
    return null;
  }
}

/** 音声ファイルの存在確認 */
export async function checkAudioFileExists(fileName: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${BASE_URL}/audio-files/exists/${encodeURIComponent(fileName)}`,
    );
    if (!res.ok) return false;
    const data = await res.json();
    return data.exists;
  } catch {
    return false;
  }
}

/** 同名ファイルの全リソースを削除（音声ファイル + 全チャンクジョブ） */
export async function deleteAllResourcesByFileName(
  fileName: string,
): Promise<void> {
  const res = await fetch(
    `${BASE_URL}/audio-files/${encodeURIComponent(fileName)}/all`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    throw new Error(`リソース削除に失敗しました: ${res.status}`);
  }
}

/** 失敗したチャンクジョブを再開 */
export async function resumeTranscription(
  jobId: string,
): Promise<Transcription> {
  const res = await fetch(`${BASE_URL}/transcribe/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId }),
  });

  if (!res.ok) {
    const rawText = await res.text().catch(() => '');
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(rawText);
    } catch {
      // JSONパース失敗時はrawTextをそのまま使う
    }
    if (body?.code === 'QUOTA_EXCEEDED') {
      const error = new Error(typeof body.message === 'string' ? body.message : rawText);
      error.name = 'QuotaExceededError';
      throw error;
    }
    if (body?.code === 'TRANSCRIPTION_TIMEOUT') {
      const error = new Error(typeof body.message === 'string' ? body.message : rawText);
      error.name = 'TranscriptionTimeoutError';
      throw error;
    }
    const serverMessage = (typeof body?.message === 'string' ? body.message : null) || rawText || res.statusText;
    throw new Error(`文字起こしの再開に失敗しました (${res.status}): ${serverMessage}`);
  }

  const data = await res.json();
  return data.transcription;
}

/** ElevenLabsクレジット情報 */
export interface CreditInfo {
  characterCount: number;
  characterLimit: number;
  remainingCredits: number;
  nextResetDate: string;
}

/** ElevenLabsクレジット残量を確認 */
export async function checkCredits(): Promise<CreditInfo> {
  const res = await fetch(`${BASE_URL}/credits/check`);
  if (!res.ok) {
    const rawText = await res.text().catch(() => '');
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(rawText);
    } catch {
      // パース失敗
    }
    if (body?.code === 'API_KEY_MISSING') {
      const error = new Error(
        typeof body.message === 'string' ? body.message : rawText,
      );
      error.name = 'ApiKeyMissingError';
      throw error;
    }
    throw new Error(
      `クレジット情報の取得に失敗しました: ${res.status}`,
    );
  }
  const data = await res.json();
  return data.creditInfo;
}

/** 完了済みチャンクの情報 */
export interface CompletedChunkInfo {
  index: number;
  chunkFileName: string;
  startTimeSec: number;
  text: string;
  languageCode: string;
}

/** チャンク分割ジョブの詳細（テキスト含む） */
export interface ChunkedJobDetail {
  id: string;
  audioFileName: string;
  createdAt: string;
  status: 'initializing' | 'splitting' | 'transcribing' | 'merging' | 'completed' | 'failed';
  totalDurationSec: number;
  chunkDurationSec: number;
  totalChunks: number;
  currentChunkIndex: number;
  completedChunks: CompletedChunkInfo[];
  errorMessage?: string;
  updatedAt: string;
  transcriptionId?: string;
  isProcessing?: boolean;
}

/** 再開可能なジョブ一覧を取得 */
export async function fetchResumableJobs(): Promise<ChunkedJobDetail[]> {
  try {
    const res = await fetchWithRetry(`${BASE_URL}/transcribe/jobs`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.jobs;
  } catch {
    return [];
  }
}

/** ジョブを削除 */
export async function deleteChunkedJob(jobId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/transcribe/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`ジョブの削除に失敗しました: ${res.status}`);
  }
}

/** ジョブ詳細を取得（テキスト含む） */
export async function fetchJobDetail(
  jobId: string,
): Promise<ChunkedJobDetail | null> {
  try {
    const res = await fetch(`${BASE_URL}/transcribe/jobs/${encodeURIComponent(jobId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.job;
  } catch {
    return null;
  }
}

/** チャンク音声のURLを取得 */
export function getChunkAudioUrl(jobId: string, chunkIndex: number): string {
  return `${BASE_URL}/transcribe/jobs/${encodeURIComponent(jobId)}/chunks/${chunkIndex}/audio`;
}

/** 文字起こし一覧を取得 */
export async function fetchTranscriptions(): Promise<TranscriptionSummary[]> {
  const url = `${BASE_URL}/transcriptions`;
  console.log('[API] fetchTranscriptions 開始:', url);

  const res = await fetchWithRetry(url);

  console.log('[API] fetchTranscriptions レスポンス:', { status: res.status, statusText: res.statusText });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[API] fetchTranscriptions エラーレスポンス:', { status: res.status, body });
    throw new Error(`文字起こし一覧の取得に失敗しました: ${res.status} ${body}`);
  }
  const data = await res.json();
  console.log('[API] fetchTranscriptions 完了:', { count: data.transcriptions?.length });
  return data.transcriptions;
}

/** 文字起こし結果を取得 */
export async function fetchTranscription(
  id: string,
): Promise<Transcription> {
  const url = `${BASE_URL}/transcriptions/${encodeURIComponent(id)}`;
  console.log('[API] fetchTranscription 開始:', { url, id });

  const res = await fetchWithRetry(url);

  console.log('[API] fetchTranscription レスポンス:', { status: res.status, statusText: res.statusText });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[API] fetchTranscription エラーレスポンス:', { status: res.status, body });
    throw new Error(`文字起こし結果の取得に失敗しました: ${res.status} ${body}`);
  }
  const data = await res.json();
  console.log('[API] fetchTranscription 完了:', { id: data.transcription?.id });
  return data.transcription;
}

/** 調査質問文を自動生成 */
export async function generateQuestions(
  transcriptionId: string,
  speakerId: string,
  keywords: string[],
): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/interview/generate-questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcriptionId, speakerId, keywords }),
  });
  if (!res.ok) {
    throw new Error(`質問生成に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.questions;
}

/** Web検索付き会話分析を実行 */
export async function analyzeInterview(
  transcriptionId: string,
  speakerId: string,
  keywords: string[],
  questions: string[],
): Promise<InterviewAnalysis> {
  const res = await fetch(`${BASE_URL}/interview/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcriptionId, speakerId, keywords, questions }),
  });
  if (!res.ok) {
    throw new Error(`分析に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.analysis;
}

/** 分析ログ一覧（サマリー）を取得 */
export async function fetchAnalysisLogs(): Promise<InterviewAnalysisSummary[]> {
  const res = await fetch(`${BASE_URL}/interview/logs`);
  if (!res.ok) {
    throw new Error(`分析ログ一覧の取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.logs;
}

/** 分析ログ詳細を取得 */
export async function fetchAnalysisLog(id: string): Promise<InterviewAnalysis> {
  const res = await fetch(`${BASE_URL}/interview/logs/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(`分析ログの取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.log;
}

/** プロンプトプレビューを取得 */
export async function previewPrompts(
  transcriptionId: string,
  speakerId: string,
  keywords: string[],
  questions: string[],
): Promise<{ generateQuestionsPrompt: string; analyzePrompts: string[] }> {
  const res = await fetch(`${BASE_URL}/interview/preview-prompts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcriptionId, speakerId, keywords, questions }),
  });
  if (!res.ok) {
    throw new Error(`プロンプト取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.prompts;
}

/** 話者名を更新 */
export async function updateSpeakerNames(
  id: string,
  speakers: { id: string; name: string }[],
): Promise<Transcription> {
  const res = await fetch(`${BASE_URL}/transcriptions/${encodeURIComponent(id)}/speakers`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ speakers }),
  });
  if (!res.ok) {
    throw new Error(`話者名の更新に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.transcription;
}

/** 発言の文脈を分析 */
export async function analyzeUtteranceContext(
  transcriptionId: string,
  utteranceIndices: number[],
): Promise<ContextAnalysisResponse> {
  const res = await fetch(`${BASE_URL}/interview/analyze-context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcriptionId, utteranceIndices }),
  });
  if (!res.ok) {
    throw new Error(`文脈分析に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.analysis;
}

// === PDFドキュメント管理 ===

/** PDFドキュメント一覧を取得 */
export async function fetchDocuments(): Promise<DocumentInfo[]> {
  const res = await fetch(`${BASE_URL}/documents`);
  if (!res.ok) {
    throw new Error(`ドキュメント一覧の取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.documents;
}

/** PDFをアップロード */
export async function uploadDocument(file: File): Promise<DocumentInfo> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/documents`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PDFのアップロードに失敗しました: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.document;
}

/** ドキュメントの処理ステータスを取得 */
export async function fetchDocumentStatus(
  id: string,
): Promise<DocumentInfo> {
  const res = await fetch(`${BASE_URL}/documents/${id}/status`);
  if (!res.ok) {
    throw new Error(`ステータスの取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.document;
}

/** ドキュメントを削除 */
export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/documents/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`ドキュメントの削除に失敗しました: ${res.status}`);
  }
}

// === ディープサーチ ===

/** ディープサーチ実行 */
export async function deepSearch(
  keywords: string[],
  transcriptionIds: string[],
  includePdfs: boolean,
  includeWeb: boolean,
): Promise<DeepSearchResponse> {
  const res = await fetch(`${BASE_URL}/deep-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords, transcriptionIds, includePdfs, includeWeb }),
  });
  if (!res.ok) {
    throw new Error(`ディープサーチに失敗しました: ${res.status}`);
  }
  return res.json();
}

/** ディープサーチ結果をClaude分析 */
export async function analyzeDeepSearchResults(
  keywords: string[],
  results: { sourceType: string; sourceName: string; text: string; url?: string }[],
): Promise<DeepSearchAnalysis> {
  const res = await fetch(`${BASE_URL}/deep-search/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords, results }),
  });
  if (!res.ok) {
    throw new Error(`分析に失敗しました: ${res.status}`);
  }
  return res.json();
}

// === Podcastファイル ===

/** Podcastキャッシュファイル情報 */
export interface PodcastFileInfo {
  fileName: string;
  sizeBytes: number;
  lastModified: string;
}

/** Podcastキャッシュファイル一覧を取得 */
export async function fetchPodcastFiles(): Promise<{
  exists: boolean;
  files: PodcastFileInfo[];
}> {
  const res = await fetchWithRetry(`${BASE_URL}/podcast-files`);
  if (!res.ok) {
    throw new Error(`Podcastファイル一覧の取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  console.log('[API] fetchPodcastFiles:', data);
  return data;
}

/** Podcastファイルのストリーミング再生URLを取得 */
export function getPodcastFileStreamUrl(fileName: string): string {
  return `${BASE_URL}/podcast-files/${encodeURIComponent(fileName)}/stream`;
}

/** Podcastファイルを文字起こし */
export async function transcribePodcastFile(
  fileName: string,
): Promise<Transcription> {
  const res = await fetch(`${BASE_URL}/podcast-transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body?.code === 'QUOTA_EXCEEDED') {
      const error = new Error(body.message);
      error.name = 'QuotaExceededError';
      throw error;
    }
    if (body?.code === 'API_KEY_MISSING') {
      const error = new Error(body.message);
      error.name = 'ApiKeyMissingError';
      throw error;
    }
    throw new Error(`Podcast文字起こしに失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.transcription;
}

// === 要約 ===

/** 要約設定（デフォルトプロンプト・モデル一覧）を取得 */
export async function fetchSummaryConfig(): Promise<SummaryConfig> {
  const res = await fetch(`${BASE_URL}/interview/summary-config`);
  if (!res.ok) {
    throw new Error(`要約設定の取得に失敗しました: ${res.status}`);
  }
  return res.json();
}

/** 要約を生成 */
export async function summarizeTranscription(
  transcriptionId: string,
  model: string,
  prompt: string,
): Promise<TranscriptionSummaryLog> {
  const res = await fetch(`${BASE_URL}/interview/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcriptionId, model, prompt }),
  });
  if (!res.ok) {
    throw new Error(`要約の生成に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.summary;
}

/** 要約ログ一覧を取得 */
export async function fetchSummaryLogs(): Promise<TranscriptionSummaryLog[]> {
  const res = await fetch(`${BASE_URL}/interview/summary-logs`);
  if (!res.ok) {
    throw new Error(`要約ログ一覧の取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.logs;
}

/** 要約ログ詳細を取得 */
export async function fetchSummaryLog(id: string): Promise<TranscriptionSummaryLog> {
  const res = await fetch(`${BASE_URL}/interview/summary-logs/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(`要約ログの取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.log;
}

// === 設定 ===

/** アプリ設定を取得 */
export async function fetchSettings(): Promise<AppSettings> {
  const res = await fetchWithRetry(`${BASE_URL}/settings`);
  if (!res.ok) {
    throw new Error(`設定の取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.settings;
}

/** データフォルダをFinderで開く */
export async function openDataFolder(): Promise<void> {
  await fetch(`${BASE_URL}/settings/open-folder`, { method: 'POST' });
}

/** アプリ設定を更新 */
export async function updateSettings(
  dto: {
    dataDir?: string;
    elevenlabsApiKey?: string;
    anthropicApiKey?: string;
    enableDeepSearch?: boolean;
    enableContextAnalysis?: boolean;
  },
): Promise<{ settings: AppSettings; restartRequired: boolean }> {
  const res = await fetch(`${BASE_URL}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });
  if (!res.ok) {
    throw new Error(`設定の更新に失敗しました: ${res.status}`);
  }
  return res.json();
}
