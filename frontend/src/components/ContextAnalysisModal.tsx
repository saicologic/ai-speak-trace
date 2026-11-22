import type { ContextAnalysisResponse, Speaker } from '../types';
import { AiGeneratedNotice } from './AiGeneratedNotice';
import { FeedbackButton } from './FeedbackButton';

interface Props {
  analysis: ContextAnalysisResponse;
  speakers: Speaker[];
  onClose: () => void;
}

/** 意図に応じたバッジの色のクラスを返す */
function getIntentClass(intent: string): string {
  switch (intent) {
    case '質問':
      return 'bg-blue-100 text-blue-800';
    case '回答':
      return 'bg-green-100 text-green-800';
    case '同意':
      return 'bg-emerald-100 text-emerald-800';
    case '反論':
      return 'bg-red-100 text-red-800';
    case '補足':
      return 'bg-yellow-100 text-yellow-800';
    case '提案':
      return 'bg-purple-100 text-purple-800';
    case '説明':
      return 'bg-sky-100 text-sky-900';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

/**
 * モーダルの白い箱
 * 今までの画面と同じく、幅は 440px までにし、文字は中央に寄せる。
 * 画面が低くても見出しと「閉じる」に届くよう、高さは画面の 90% までにし、箱の中をスクロールする。
 * 中の段落すべてに効く指定は付けない（AI が生成した内容の注意・誤りの報告の案内の見た目を、それぞれの部品に任せる）
 */
const contentClass =
  'max-h-[90vh] w-[90%] max-w-[440px] overflow-y-auto rounded-xl bg-white p-8 text-center shadow-[0_20px_60px] shadow-black/30';

/** 発言の文脈分析結果モーダル */
export function ContextAnalysisModal({ analysis, speakers, onClose }: Props) {
  /** 話者の色を取得 */
  const getSpeakerColor = (speakerId: string): string => {
    const speaker = speakers.find((s) => s.id === speakerId);
    return speaker?.color ?? '#6B7280';
  };

  return (
    <div
      className="fixed top-0 left-0 z-[1000] flex size-full items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className={contentClass}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center gap-3">
          <h3 className="mb-4 text-xl-minus text-red-800">発言の文脈分析</h3>
          <span className="rounded-[10px] bg-violet-50 px-2 py-[0.15rem] text-xs font-semibold text-violet-500">
            {analysis.results.length}件の発話
          </span>
        </div>

        <AiGeneratedNotice
          basis="元の発言"
          model={analysis.model}
          warnings={analysis.contentWarnings}
        />
        <div className="mb-5 flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          {analysis.results.map((result) => (
            <div key={result.utteranceIndex} className="rounded-lg border border-gray-200 bg-neutral-50 px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span
                  className="text-md font-semibold"
                  style={{ color: getSpeakerColor(result.speakerId) }}
                >
                  {result.speakerName}
                </span>
                <span
                  className={`rounded-[10px] px-2 py-[0.15rem] text-2xs font-semibold whitespace-nowrap ${getIntentClass(result.intent)}`}
                >
                  {result.intent}
                </span>
              </div>

              <div className="text-[0.78rem] text-gray-500">
                <span className="mr-[0.3rem] font-semibold">話題:</span>
                <span className="font-medium text-violet-500">{result.topic}</span>
              </div>

              <div className="mb-2 text-base leading-[1.6] text-gray-800">{result.text}</div>

              {result.previousUtterance && (
                <div className="mb-2 rounded-md bg-gray-100 px-[0.6rem] py-[0.4rem] text-[0.78rem] leading-normal text-gray-500">
                  <span className="mr-[0.3rem] font-semibold">直前の発言:</span>
                  <span className="mr-1 font-semibold">
                    {result.previousUtterance.speakerName}
                  </span>
                  <span className="text-gray-600">
                    「{result.previousUtterance.text}」
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        <FeedbackButton
          feature="context"
          targetId=""
          transcriptionId={analysis.transcriptionId}
        />

        <div className="text-center">
          <button
            className="rounded-lg border-none bg-brand px-8 py-[0.6rem] text-base text-white transition-colors duration-150 hover:bg-brand-hover"
            onClick={onClose}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
