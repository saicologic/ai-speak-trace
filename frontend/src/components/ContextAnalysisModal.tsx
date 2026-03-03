import type { ContextAnalysisResponse, Speaker } from '../types';
import './ContextAnalysisModal.css';

interface Props {
  analysis: ContextAnalysisResponse;
  speakers: Speaker[];
  onClose: () => void;
}

/** 意図に応じたバッジCSSクラスを返す */
function getIntentClass(intent: string): string {
  switch (intent) {
    case '質問':
      return 'intent-question';
    case '回答':
      return 'intent-answer';
    case '同意':
      return 'intent-agree';
    case '反論':
      return 'intent-disagree';
    case '補足':
      return 'intent-supplement';
    case '提案':
      return 'intent-proposal';
    case '説明':
      return 'intent-explain';
    default:
      return 'intent-other';
  }
}

/** 発言の文脈分析結果モーダル */
export function ContextAnalysisModal({ analysis, speakers, onClose }: Props) {
  /** 話者の色を取得 */
  const getSpeakerColor = (speakerId: string): string => {
    const speaker = speakers.find((s) => s.id === speakerId);
    return speaker?.color ?? '#6B7280';
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content context-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="context-modal-header">
          <h3>発言の文脈分析</h3>
          <span className="context-modal-count">
            {analysis.results.length}件の発話
          </span>
        </div>

        <div className="context-results">
          {analysis.results.map((result) => (
            <div key={result.utteranceIndex} className="context-card">
              <div className="context-card-header">
                <span
                  className="context-speaker-name"
                  style={{ color: getSpeakerColor(result.speakerId) }}
                >
                  {result.speakerName}
                </span>
                <span
                  className={`context-intent-badge ${getIntentClass(result.intent)}`}
                >
                  {result.intent}
                </span>
              </div>

              <div className="context-topic">
                <span className="context-topic-label">話題:</span>
                <span className="context-topic-text">{result.topic}</span>
              </div>

              <div className="context-utterance-text">{result.text}</div>

              {result.previousUtterance && (
                <div className="context-previous">
                  <span className="context-previous-label">直前の発言:</span>
                  <span className="context-previous-speaker">
                    {result.previousUtterance.speakerName}
                  </span>
                  <span className="context-previous-text">
                    「{result.previousUtterance.text}」
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="context-modal-footer">
          <button className="modal-close-button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
