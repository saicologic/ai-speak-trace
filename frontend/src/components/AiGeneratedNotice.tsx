import type { ContentWarning } from '../types';
import './AiGeneratedNotice.css';

interface Props {
  /** 根拠として確認してほしいもの（例: 「出典」「元の発言」） */
  basis: string;
  /** 生成に使ったモデル（以前の結果など、わからない場合は表示しない） */
  model?: string;
  /** 応答に検出された不適切な表現（Guardrails のコンテンツフィルター） */
  warnings?: ContentWarning[];
}

/** コンテンツフィルターの種類の表示名 */
const CONTENT_LABELS: Record<string, string> = {
  HATE: 'ヘイト',
  INSULTS: '侮辱',
  SEXUAL: '性的な表現',
  VIOLENCE: '暴力',
  MISCONDUCT: '不正行為',
};

/** AIが生成した内容であることと、根拠の確認を促す表示 */
export function AiGeneratedNotice({ basis, model, warnings = [] }: Props) {
  return (
    <>
      <p className="ai-generated-notice" role="note">
        AIが生成した内容です{model && `（モデル: ${model}）`}。誤りを含むことがあるため、{basis}を確認してから使ってください。
      </p>
      {warnings.length > 0 && (
        <p className="ai-generated-warning" role="alert">
          この結果に、不適切な表現（
          {warnings.map((w) => CONTENT_LABELS[w.type] ?? w.type).join('、')}
          ）が含まれている可能性があります（Amazon Bedrock Guardrails の判定）。内容を確認してから使ってください。
        </p>
      )}
    </>
  );
}
