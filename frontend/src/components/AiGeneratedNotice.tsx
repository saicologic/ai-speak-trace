import './AiGeneratedNotice.css';

interface Props {
  /** 根拠として確認してほしいもの（例: 「出典」「元の発言」） */
  basis: string;
}

/** AIが生成した内容であることと、根拠の確認を促す表示 */
export function AiGeneratedNotice({ basis }: Props) {
  return (
    <p className="ai-generated-notice" role="note">
      AIが生成した内容です。誤りを含むことがあるため、{basis}を確認してから使ってください。
    </p>
  );
}
