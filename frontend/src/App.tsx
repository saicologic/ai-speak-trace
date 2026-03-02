import { useState } from 'react';
import { AudioFileList } from './components/AudioFileList';
import { TranscriptionList } from './components/TranscriptionList';
import { TranscriptionView } from './components/TranscriptionView';
import { SpeakerNameEditor } from './components/SpeakerNameEditor';
import { AudioPlayer } from './components/AudioPlayer';
import { transcribeAudio, fetchTranscription } from './api/client';
import type { Transcription } from './types';
import './App.css';

type SidebarTab = 'audio' | 'history';

function App() {
  const [transcription, setTranscription] = useState<Transcription | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedTranscriptionId, setSelectedTranscriptionId] = useState<
    string | null
  >(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('audio');

  /** 音声ファイルを選択して文字起こし実行 */
  const handleFileSelect = async (fileName: string) => {
    setSelectedFile(fileName);
    setSelectedTranscriptionId(null);
    setLoading(true);
    setError(null);

    try {
      const result = await transcribeAudio(fileName);
      setTranscription(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '文字起こしに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  /** 文字起こし履歴を選択して結果を表示 */
  const handleTranscriptionSelect = async (id: string) => {
    setSelectedTranscriptionId(id);
    setSelectedFile(null);
    setLoading(true);
    setError(null);

    try {
      const result = await fetchTranscription(id);
      setTranscription(result);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : '文字起こし結果の取得に失敗しました',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI Speak Trace</h1>
        <p>音声データの話者分離・文字起こし</p>
      </header>
      <main className="app-main">
        <aside className="app-sidebar">
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab ${sidebarTab === 'audio' ? 'active' : ''}`}
              onClick={() => setSidebarTab('audio')}
            >
              音声ファイル
            </button>
            <button
              className={`sidebar-tab ${sidebarTab === 'history' ? 'active' : ''}`}
              onClick={() => setSidebarTab('history')}
            >
              履歴
            </button>
          </div>
          {sidebarTab === 'audio' && (
            <AudioFileList
              selectedFile={selectedFile}
              onFileSelect={handleFileSelect}
              loading={loading}
            />
          )}
          {sidebarTab === 'history' && (
            <TranscriptionList
              selectedId={selectedTranscriptionId}
              onSelect={handleTranscriptionSelect}
              loading={loading}
            />
          )}
        </aside>
        <section className="app-content">
          {error && <div className="error-message">{error}</div>}
          {loading && (
            <div className="loading">
              <div className="loading-spinner" />
              <p>
                {sidebarTab === 'audio' ? '文字起こし中...' : '読み込み中...'}
              </p>
              {sidebarTab === 'audio' && (
                <p className="loading-hint">
                  音声の長さにより数十秒かかる場合があります
                </p>
              )}
            </div>
          )}
          {!loading && !transcription && !error && (
            <div className="empty-state">
              <p>
                {sidebarTab === 'audio'
                  ? '音声ファイルを選択して文字起こしを実行してください'
                  : '文字起こし履歴を選択してください'}
              </p>
            </div>
          )}
          {transcription && !loading && (
            <>
              <SpeakerNameEditor
                transcriptionId={transcription.id}
                speakers={transcription.speakers}
                onUpdate={setTranscription}
              />
              <AudioPlayer fileName={transcription.audioFileName} />
              <TranscriptionView transcription={transcription} />
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
