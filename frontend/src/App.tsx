import { useMemo, useState } from 'react';
import { AudioFileList } from './components/AudioFileList';
import { TranscriptionList } from './components/TranscriptionList';
import { TranscriptionView } from './components/TranscriptionView';
import { SpeakerNameEditor } from './components/SpeakerNameEditor';
import { AudioPlayer } from './components/AudioPlayer';
import { KeywordList } from './components/KeywordList';
import { InterviewPage } from './components/InterviewPage';
import { ContextAnalysisModal } from './components/ContextAnalysisModal';
import {
  transcribeAudio,
  fetchTranscription,
  analyzeUtteranceContext,
} from './api/client';
import { extractKeywords } from './utils/keywords';
import type { Transcription, ContextAnalysisResponse } from './types';
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
  const [filterActive, setFilterActive] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [contextSelectMode, setContextSelectMode] = useState(false);
  const [selectedUtteranceIndices, setSelectedUtteranceIndices] = useState<
    Set<number>
  >(new Set());
  const [contextAnalysis, setContextAnalysis] =
    useState<ContextAnalysisResponse | null>(null);
  const [contextAnalyzing, setContextAnalyzing] = useState(false);

  /** 文字起こしテキストからキーワードを抽出（メモ化） */
  const keywords = useMemo(
    () => (transcription ? extractKeywords(transcription.fullText) : []),
    [transcription],
  );

  /** 発話選択のトグル */
  const toggleUtteranceSelection = (index: number) => {
    setSelectedUtteranceIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  /** 文脈選択モードのON/OFF */
  const toggleContextMode = () => {
    setContextSelectMode((prev) => {
      if (prev) {
        // OFFにするとき選択もクリア
        setSelectedUtteranceIndices(new Set());
      }
      return !prev;
    });
  };

  /** 選択された発話の文脈を分析 */
  const handleAnalyzeContext = async () => {
    if (!transcription || selectedUtteranceIndices.size === 0) return;
    setContextAnalyzing(true);
    try {
      const result = await analyzeUtteranceContext(
        transcription.id,
        Array.from(selectedUtteranceIndices).sort((a, b) => a - b),
      );
      setContextAnalysis(result);
      // 分析完了後、選択モードを解除
      setContextSelectMode(false);
      setSelectedUtteranceIndices(new Set());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : '文脈分析に失敗しました',
      );
    } finally {
      setContextAnalyzing(false);
    }
  };

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
    setFilterActive(false);

    try {
      const result = await transcribeAudio(fileName);
      setTranscription(result);
    } catch (e) {
      if (e instanceof Error && e.name === 'QuotaExceededError') {
        setQuotaError(e.message);
      } else {
        setError(e instanceof Error ? e.message : '文字起こしに失敗しました');
      }
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
    setFilterActive(false);

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

  /** 会話分析ページの場合 */
  if (page === 'interview' && transcription) {
    return (
      <InterviewPage
        transcriptionId={transcription.id}
        speakers={transcription.speakers}
        utterances={transcription.utterances}
        onBack={() => setPage('main')}
      />
    );
  }

  return (
    <div className="app">
      {quotaError && (
        <div className="modal-overlay" onClick={() => setQuotaError(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>ご利用枠の上限に達しました</h3>
            {quotaError && (
              <p className="modal-quota-detail">{quotaError}</p>
            )}
            <p>
              現在の文字起こしプランの利用枠を超えたため、処理を実行できません。プランの変更が必要です。<br />
              <a href="https://elevenlabs.io/pricing" target="_blank" rel="noopener noreferrer">プランの詳細をご覧ください。</a>
            </p>
            <button
              className="modal-close-button"
              onClick={() => setQuotaError(null)}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
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
                filterActive={filterActive}
                contextSelectMode={contextSelectMode}
                selectedUtteranceIndices={selectedUtteranceIndices}
                onToggleUtteranceSelection={toggleUtteranceSelection}
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
              filterActive={filterActive}
              onToggleFilter={() => setFilterActive((prev) => !prev)}
              onNavigateInterview={() => setPage('interview')}
              onToggleContextMode={toggleContextMode}
              contextSelectMode={contextSelectMode}
            />
          </aside>
        )}
      </main>

      {/* 文脈分析：フローティング分析ボタン */}
      {contextSelectMode && selectedUtteranceIndices.size > 0 && (
        <button
          className="context-floating-button"
          onClick={handleAnalyzeContext}
        >
          分析する（{selectedUtteranceIndices.size}件）
        </button>
      )}

      {/* 文脈分析：ローディング */}
      {contextAnalyzing && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="loading-spinner" />
            <p>発言の文脈を分析中...</p>
          </div>
        </div>
      )}

      {/* 文脈分析：結果モーダル */}
      {contextAnalysis && transcription && (
        <ContextAnalysisModal
          analysis={contextAnalysis}
          speakers={transcription.speakers}
          onClose={() => setContextAnalysis(null)}
        />
      )}
    </div>
  );
}

export default App;
