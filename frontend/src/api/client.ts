import type {
  AppSettings,
  AudioFileInfo,
  ContextAnalysisResponse,
  DeepSearchAnalysis,
  DeepSearchResponse,
  DocumentInfo,
  InterviewAnalysis,
  Transcription,
  TranscriptionSummary,
} from '../types';

// Tauri環境では直接localhost:3000のsidecarに接続、Web環境ではプロキシ経由
const isTauri = !!(window as any).__TAURI_INTERNALS__;
const BASE_URL = isTauri
  ? 'http://localhost:3000/api'
  : (import.meta.env.VITE_API_BASE_URL || '/api');

/** 音声ファイル一覧を取得 */
export async function fetchAudioFiles(): Promise<AudioFileInfo[]> {
  console.log('[API] fetchAudioFiles:', `${BASE_URL}/audio-files`);
  const res = await fetch(`${BASE_URL}/audio-files`);
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
  return data.url;
}

/** 音声ファイルを文字起こし */
export async function transcribeAudio(
  fileName: string,
): Promise<Transcription> {
  const res = await fetch(`${BASE_URL}/transcribe`, {
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
    throw new Error(`文字起こしに失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.transcription;
}

/** 文字起こし一覧を取得 */
export async function fetchTranscriptions(): Promise<TranscriptionSummary[]> {
  const res = await fetch(`${BASE_URL}/transcriptions`);
  if (!res.ok) {
    throw new Error(`文字起こし一覧の取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.transcriptions;
}

/** 文字起こし結果を取得 */
export async function fetchTranscription(
  id: string,
): Promise<Transcription> {
  const res = await fetch(`${BASE_URL}/transcriptions/${id}`);
  if (!res.ok) {
    throw new Error(`文字起こし結果の取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
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
  const res = await fetch(`${BASE_URL}/transcriptions/${id}/speakers`, {
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

// === 設定 ===

/** アプリ設定を取得 */
export async function fetchSettings(): Promise<AppSettings> {
  const res = await fetch(`${BASE_URL}/settings`);
  if (!res.ok) {
    throw new Error(`設定の取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.settings;
}

/** アプリ設定を更新 */
export async function updateSettings(
  dto: { dataDir?: string },
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
