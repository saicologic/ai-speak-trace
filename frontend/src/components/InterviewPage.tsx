import { useState } from 'react';
import { generateQuestions, analyzeInterview } from '../api/client';
import type { InterviewAnalysis, Keyword, Speaker } from '../types';
import './InterviewPage.css';

interface Props {
  transcriptionId: string;
  speakers: Speaker[];
  keywords: Keyword[];
  onBack: () => void;
}

/** ユーザーインタビュー分析ページ */
export function InterviewPage({
  transcriptionId,
  speakers,
  keywords,
  onBack,
}: Props) {
  const [selectedSpeakerId, setSelectedSpeakerId] = useState(
    speakers[0]?.id ?? '',
  );
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(
    new Set(),
  );
  const [questionsText, setQuestionsText] = useState('');
  const [analysis, setAnalysis] = useState<InterviewAnalysis | null>(null);
  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** キーワードの選択をトグル */
  const toggleKeyword = (text: string) => {
    setSelectedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(text)) {
        next.delete(text);
      } else {
        next.add(text);
      }
      return next;
    });
  };

  // 選択中のキーワードを配列として取得
  const activeKeywords = keywords
    .filter((kw) => selectedKeywords.has(kw.text))
    .map((kw) => kw.text);

  /** 質問文を自動生成 */
  const handleGenerateQuestions = async () => {
    if (activeKeywords.length === 0) {
      setError('キーワードを選択してください');
      return;
    }
    setGeneratingQuestions(true);
    setError(null);
    try {
      const questions = await generateQuestions(
        transcriptionId,
        selectedSpeakerId,
        activeKeywords,
      );
      setQuestionsText(questions.join('\n'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '質問生成に失敗しました');
    } finally {
      setGeneratingQuestions(false);
    }
  };

  /** 分析を実行 */
  const handleAnalyze = async () => {
    const questions = questionsText
      .split('\n')
      .map((q) => q.trim())
      .filter((q) => q.length > 0);

    if (questions.length === 0) {
      setError('質問文を入力してください');
      return;
    }

    setAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeInterview(
        transcriptionId,
        selectedSpeakerId,
        activeKeywords,
        questions,
      );
      setAnalysis(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析に失敗しました');
    } finally {
      setAnalyzing(false);
    }
  };

  const selectedSpeaker = speakers.find((s) => s.id === selectedSpeakerId);

  return (
    <div className="interview-page">
      <header className="interview-header">
        <button className="interview-back-button" onClick={onBack}>
          ← 戻る
        </button>
        <h1>ユーザーインタビュー分析</h1>
      </header>

      <div className="interview-content">
        {error && <div className="interview-error">{error}</div>}

        {/* 話者選択 */}
        <section className="interview-section">
          <h2>話者を選択</h2>
          <select
            className="interview-select"
            value={selectedSpeakerId}
            onChange={(e) => setSelectedSpeakerId(e.target.value)}
          >
            {speakers.map((speaker) => (
              <option key={speaker.id} value={speaker.id}>
                {speaker.name}
              </option>
            ))}
          </select>
        </section>

        {/* キーワード選択 */}
        <section className="interview-section">
          <h2>分析キーワード</h2>
          <p className="interview-hint">
            クリックでキーワードを選択（{selectedKeywords.size}件選択中）
          </p>
          <div className="interview-keywords">
            {keywords.map((kw) => (
              <button
                key={kw.text}
                className={`interview-keyword-tag ${selectedKeywords.has(kw.text) ? 'selected' : ''}`}
                onClick={() => toggleKeyword(kw.text)}
              >
                {kw.text}
              </button>
            ))}
          </div>
        </section>

        {/* 質問生成・編集 */}
        <section className="interview-section">
          <h2>調査質問</h2>
          <textarea
            className="interview-textarea"
            placeholder="「質問を生成」ボタンで質問文を自動生成できます。手動で編集も可能です。"
            value={questionsText}
            onChange={(e) => setQuestionsText(e.target.value)}
            rows={8}
            disabled={generatingQuestions}
          />
          <div className="interview-actions">
            <button
              className="interview-button secondary"
              onClick={handleGenerateQuestions}
              disabled={generatingQuestions || analyzing || activeKeywords.length === 0}
            >
              {generatingQuestions ? '生成中...' : '質問を生成'}
            </button>
            <button
              className="interview-button primary"
              onClick={handleAnalyze}
              disabled={
                analyzing ||
                generatingQuestions ||
                questionsText.trim().length === 0
              }
            >
              {analyzing ? '分析中...' : '分析する'}
            </button>
          </div>
        </section>

        {/* ローディング */}
        {analyzing && (
          <div className="interview-loading">
            <div className="loading-spinner" />
            <p>Claude がWeb検索しながら分析中...</p>
            <p className="interview-loading-hint">
              質問数に応じて数十秒〜数分かかる場合があります
            </p>
          </div>
        )}

        {/* 分析結果 */}
        {analysis && !analyzing && (
          <section className="interview-section">
            <h2>
              分析結果 —{' '}
              <span style={{ color: selectedSpeaker?.color }}>
                {analysis.speakerName}
              </span>
            </h2>
            <div className="interview-results">
              {analysis.results.map((result, i) => (
                <div key={i} className="interview-result-card">
                  <h3 className="result-question">
                    Q{i + 1}: {result.question}
                  </h3>
                  <div className="result-answer">{result.answer}</div>
                  {result.sources.length > 0 && (
                    <div className="result-sources">
                      <span className="result-sources-label">出典:</span>
                      {result.sources.map((source, j) => (
                        <a
                          key={j}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="result-source-link"
                        >
                          {source.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
