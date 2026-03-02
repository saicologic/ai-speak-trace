import { useState } from 'react';
import { AudioFileList } from './components/AudioFileList';
import { TranscriptionView } from './components/TranscriptionView';
import { SpeakerNameEditor } from './components/SpeakerNameEditor';
import { AudioPlayer } from './components/AudioPlayer';
import { transcribeAudio } from './api/client';
import type { Transcription } from './types';
import './App.css';

function App() {
  const [transcription, setTranscription] = useState<Transcription | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const handleFileSelect = async (fileName: string) => {
    setSelectedFile(fileName);
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

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI Speak Trace</h1>
        <p>音声データの話者分離・文字起こし</p>
      </header>
      <main className="app-main">
        <aside className="app-sidebar">
          <AudioFileList
            selectedFile={selectedFile}
            onFileSelect={handleFileSelect}
            loading={loading}
          />
        </aside>
        <section className="app-content">
          {error && <div className="error-message">{error}</div>}
          {loading && (
            <div className="loading">
              <div className="loading-spinner" />
              <p>文字起こし中...</p>
              <p className="loading-hint">
                音声の長さにより数十秒かかる場合があります
              </p>
            </div>
          )}
          {!loading && !transcription && !error && (
            <div className="empty-state">
              <p>左側のファイル一覧から音声ファイルを選択してください</p>
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
