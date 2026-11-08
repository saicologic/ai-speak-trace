import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string) => invoke(cmd) }));

const TOKEN = 'a'.repeat(64);

/** Tauri の画面として client.ts を読み込み直し、ポートとトークンを受け取った状態にする */
async function loadInTauri() {
  vi.resetModules();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  invoke.mockImplementation(async (cmd: string) =>
    cmd === 'get_backend_port' ? 50000 : cmd === 'get_api_token' ? TOKEN : null,
  );
  const client = await import('./client');
  await client.initBackendUrl();
  return client;
}

describe('sidecar の API のトークン', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it('API を呼ぶときは、トークンをヘッダーに付ける', async () => {
    const client = await loadInTauri();
    await client.fetchTranscriptions();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:50000/api/transcriptions');
    expect(new Headers(init?.headers).get('X-Api-Token')).toBe(TOKEN);
  });

  it('呼び出し元が付けたヘッダーも残す', async () => {
    const client = await loadInTauri();
    await client.apiFetch('http://127.0.0.1:50000/api/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Api-Token')).toBe(TOKEN);
  });

  it('<audio src> の URL には、トークンをクエリで付ける', async () => {
    const client = await loadInTauri();
    expect(client.getChunkAudioUrl('j1', 2)).toBe(
      `http://127.0.0.1:50000/api/transcribe/jobs/j1/chunks/2/audio?token=${TOKEN}`,
    );
    expect(client.getPodcastFileStreamUrl('a b.mp3')).toBe(
      `http://127.0.0.1:50000/api/podcast-files/a%20b.mp3/stream?token=${TOKEN}`,
    );
  });

  it('ブラウザ（開発時）では、トークンを付けない', async () => {
    vi.resetModules();
    const client = await import('./client');
    await client.initBackendUrl();
    await client.apiFetch('/api/transcriptions');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has('X-Api-Token')).toBe(false);
    expect(client.getChunkAudioUrl('j1', 0)).not.toContain('token=');
  });
});
