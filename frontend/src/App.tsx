import { useMemo, useState } from 'react';
import { AudioFileList } from './components/AudioFileList';
import { TranscriptionList } from './components/TranscriptionList';
import { TranscriptionView } from './components/TranscriptionView';
import { SpeakerNameEditor } from './components/SpeakerNameEditor';
import { AudioPlayer } from './components/AudioPlayer';
import { KeywordList } from './components/KeywordList';
import { InterviewPage } from './components/InterviewPage';
import { transcribeAudio, fetchTranscription } from './api/client';
import { extractKeywords } from './utils/keywords';
import type { Transcription } from './types';
import './App.css';

type SidebarTab = 'audio' | 'history';
type Page = 'main' | 'interview';

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
  const [highlightedKeywords, setHighlightedKeywords] = useState<Set<string>>(
    new Set(),
  );
  const [page, setPage] = useState<Page>('main');

  /** 文字起こしテキストからキーワードを抽出（メモ化） */
  const keywords = useMemo(
    () => (transcription ? extractKeywords(transcription.fullText) : []),
    [transcription],
  );

  /** キーワードのハイライトをトグル */
  const toggleKeywordHighlight = (keyword: string) => {
    setHighlightedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(keyword)) {
        next.delete(keyword);
      } else {
        next.add(keyword);
      }
      return next;
    });
  };

  /** 音声ファイルを選択して文字起こし実行 */
  const handleFileSelect = async (fileName: string) => {
    setSelectedFile(fileName);
    setSelectedTranscriptionId(null);
    setLoading(true);
    setError(null);
    setHighlightedKeywords(new Set());

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
    setHighlightedKeywords(new Set());

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

  /** インタビューページの場合 */
  if (page === 'interview' && transcription) {
    return (
      <InterviewPage
        transcriptionId={transcription.id}
        speakers={transcription.speakers}
        keywords={keywords}
        onBack={() => setPage('main')}
      />
    );
  }

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
              <TranscriptionView
                transcription={transcription}
                highlightedKeywords={highlightedKeywords}
              />
            </>
          )}
        </section>
        {transcription && !loading && (
          <aside className="app-sidebar-right">
            <KeywordList
              keywords={keywords}
              highlightedKeywords={highlightedKeywords}
              onToggleKeyword={toggleKeywordHighlight}
              onNavigateInterview={() => setPage('interview')}
            />
          </aside>
        )}
      </main>
    </div>
  );
}

export default App;
