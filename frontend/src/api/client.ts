import type { AudioFileInfo, Transcription } from '../types';

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
