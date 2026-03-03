import type {
  AudioFileInfo,
  InterviewAnalysis,
  Transcription,
  TranscriptionSummary,
} from '../types';

const BASE_URL = '/api';

/** 音声ファイル一覧を取得 */
export async function fetchAudioFiles(): Promise<AudioFileInfo[]> {
  const res = await fetch(`${BASE_URL}/audio-files`);
  if (!res.ok) {
    throw new Error(`音声ファイル一覧の取得に失敗しました: ${res.status}`);
  }
  const data = await res.json();
  return data.files;
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
