/** 会話から検出した個人情報（同じ種類・同じ文字列ごとにまとめる） */
export interface PiiFinding {
  /** Guardrails の種類名（NAME・PHONE など。独自の正規表現は JP_MY_NUMBER など） */
  type: string;
  /** 表示名（氏名・電話番号など） */
  label: string;
  /** 検出された文字列 */
  text: string;
  /** 会話に出てくる回数 */
  count: number;
  /** Claude などに送るときに伏せるか（初期値は伏せる） */
  mask: boolean;
}

/** 文字起こしの個人情報チェックの結果 */
export interface PrivacyScan {
  transcriptionId: string;
  scannedAt: string;
  guardrailId: string;
  guardrailVersion: string;
  findings: PiiFinding[];
}

/** 個人情報チェックの状態（画面表示用） */
export interface PrivacyStatus {
  /** Guardrail ID が設定されているか */
  configured: boolean;
  /** チェック中か */
  scanning: boolean;
  /** 最後のチェックで失敗した場合のエラー */
  error?: string;
  scan: PrivacyScan | null;
}
