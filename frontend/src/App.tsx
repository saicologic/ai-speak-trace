import { useEffect, useMemo, useState } from 'react';
import { TranscriptionList } from './components/TranscriptionList';
import { TranscriptionView } from './components/TranscriptionView';
import { SpeakerNameEditor } from './components/SpeakerNameEditor';
import { AudioPlayer } from './components/AudioPlayer';
import { KeywordList } from './components/KeywordList';
import { InterviewPage } from './components/InterviewPage';
import { DeepSearchPage } from './components/DeepSearchPage';
import { TranscribePage } from './components/TranscribePage';
import { JobProgressPage } from './components/JobProgressPage';
import { ResumableJobsPage } from './components/ResumableJobsPage';
import { ContextAnalysisModal } from './components/ContextAnalysisModal';
import SettingsPage from './components/SettingsPage';
import {
  fetchTranscription,
  analyzeUtteranceContext,
  fetchSettings,
  fetchResumableJobs,
} from './api/client';
import type { ChunkedJobDetail } from './api/client';
import { extractKeywords } from './utils/keywords';
import type { Transcription, ContextAnalysisResponse } from './types';
import './App.css';

type Page = 'main' | 'transcribe' | 'interview' | 'deep-search' | 'settings' | 'job-progress' | 'resumable-jobs';

function App() {
  const [transcription, setTranscription] = useState<Transcription | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTranscriptionId, setSelectedTranscriptionId] = useState<
    string | null
  >(null);
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
  const [enableDeepSearch, setEnableDeepSearch] = useState(false);
  const [enableContextAnalysis, setEnableContextAnalysis] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [resumableJobs, setResumableJobs] = useState<ChunkedJobDetail[]>([]);

  /** 起動時にベータ機能の設定を読み込み + 中断ジョブを確認 */
  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setEnableDeepSearch(s.enableDeepSearch ?? false);
        setEnableContextAnalysis(s.enableContextAnalysis ?? false);
      })
      .catch(() => {});

    // 中断されたジョブがあるか確認
    fetchResumableJobs()
      .then((jobs) => setResumableJobs(jobs))
      .catch(() => {});
  }, []);

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

  /** 文字起こし履歴を選択して結果を表示 */
  const handleTranscriptionSelect = async (id: string) => {
    setSelectedTranscriptionId(id);
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

  /** 文字起こしページの場合 */
  if (page === 'transcribe') {
    return (
      <TranscribePage
        onBack={() => setPage('main')}
        onTranscriptionComplete={(result) => {
          setTranscription(result);
        }}
        onNavigateSettings={() => setPage('settings')}
        onChunkedJobStarted={(jobId) => {
          setActiveJobId(jobId);
          setPage('job-progress');
        }}
      />
    );
  }

  /** 文字起こし進捗ページの場合 */
  if (page === 'job-progress' && activeJobId) {
    return (
      <JobProgressPage
        jobId={activeJobId}
        onBack={() => {
          setActiveJobId(null);
          setPage('resumable-jobs');
        }}
        onTranscriptionComplete={(result) => {
          setTranscription(result);
          setActiveJobId(null);
          setResumableJobs((prev) => prev.filter((j) => j.id !== activeJobId));
          setPage('main');
        }}
      />
    );
  }

  /** ジョブ進捗確認ページの場合 */
  if (page === 'resumable-jobs') {
    return (
      <ResumableJobsPage
        jobs={resumableJobs}
        onBack={() => setPage('main')}
        onSelectJob={(jobId) => {
          setActiveJobId(jobId);
          setPage('job-progress');
        }}
        onJobsDeleted={(deletedIds) => {
          setResumableJobs((prev) => prev.filter((j) => !deletedIds.includes(j.id)));
        }}
      />
    );
  }

  /** ディープサーチページの場合 */
  if (page === 'deep-search') {
    return (
      <DeepSearchPage
        initialTranscriptionId={transcription?.id}
        initialKeywords={Array.from(highlightedKeywords)}
        onBack={() => setPage('main')}
      />
    );
  }

  /** 設定ページの場合 */
  if (page === 'settings') {
    return <SettingsPage onBack={async () => {
      // 設定変更を反映するために再読み込み
      try {
        const s = await fetchSettings();
        setEnableDeepSearch(s.enableDeepSearch ?? false);
        setEnableContextAnalysis(s.enableContextAnalysis ?? false);
      } catch {
        // 取得失敗時はログのみ（メイン画面に遷移は継続）
        console.warn('設定の再読み込みに失敗しました');
      }
      setPage('main');
    }} />;
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
        <div className="app-header-left">
          <h1>AI Speak Trace</h1>
          <p>音声データの話者分離・文字起こし</p>
        </div>
        <button
          className="app-header-settings-button"
          onClick={() => setPage('settings')}
          title="設定"
        >
          設定
        </button>
      </header>
      <main className="app-main">
        <aside className="app-sidebar">
          <div className="sidebar-tabs">
            <button
              className="sidebar-tab-action"
              onClick={() => setPage('transcribe')}
            >
              音声ファイルの文字起こし
            </button>
          </div>
          <div className="sidebar-tabs">
            <button
              className="sidebar-tab-action sidebar-tab-action--warning"
              onClick={() => setPage('resumable-jobs')}
            >
              ジョブ進捗確認（{resumableJobs.length}件）
            </button>
          </div>
          <div className="sidebar-section-title">履歴</div>
          <TranscriptionList
            selectedId={selectedTranscriptionId}
            onSelect={handleTranscriptionSelect}
            loading={loading}
          />
        </aside>
        <section className="app-content">
          {error && <div className="error-message">{error}</div>}
          {loading && (
            <div className="loading">
              <div className="loading-spinner" />
              <p>読み込み中...</p>
            </div>
          )}
          {!loading && !transcription && !error && (
            <div className="empty-state">
              <p>文字起こし履歴を選択してください</p>
            </div>
          )}
          {transcription && !loading && (
            <>
              <div className="app-content-fixed">
                <AudioPlayer fileName={transcription.audioFileName} />
              </div>
              <div className="app-content-scroll">
                <SpeakerNameEditor
                  transcriptionId={transcription.id}
                  speakers={transcription.speakers}
                  onUpdate={setTranscription}
                />
                <TranscriptionView
                  transcription={transcription}
                  highlightedKeywords={highlightedKeywords}
                  filterActive={filterActive}
                  contextSelectMode={contextSelectMode}
                  selectedUtteranceIndices={selectedUtteranceIndices}
                  onToggleUtteranceSelection={toggleUtteranceSelection}
                />
              </div>
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
              onNavigateDeepSearch={enableDeepSearch ? () => setPage('deep-search') : undefined}
              onToggleContextMode={enableContextAnalysis ? toggleContextMode : undefined}
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
