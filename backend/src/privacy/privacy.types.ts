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
  /**
   * Claude などに送るときに伏せるか
   * 初期値は種類で決める（連絡先などは伏せる。誤検出の多い氏名などは伏せずに要確認にする）
   */
  mask: boolean;
  /** 利用者がまだ確認していないか（誤検出の多い種類だけ true で始まる） */
  needsReview: boolean;
}

/** 文字起こしの個人情報チェックの結果 */
export interface PrivacyScan {
  transcriptionId: string;
  scannedAt: string;
  guardrailId: string;
  guardrailVersion: string;
  findings: PiiFinding[];
  /**
   * チェックした話者名のハッシュ（hashSpeakerNames）
   * MCP で、チェックの後に話者名が変わっていないか確かめる。この項目を足す前に保存した結果にはない
   */
  speakerNamesHash?: string;
  /**
   * チェックした文字起こしの作成日時（Transcription.createdAt）
   * 同じ音声ファイル名で文字起こしし直すと、同じ id で別の文字起こしになるため、作成日時で見分ける。この項目を足す前に保存した結果にはない
   */
  transcriptionCreatedAt?: string;
  /**
   * チェックした本文（話者名を除く）のハッシュ（hashTranscriptionBody）
   * MCP で、チェックの後に本文が変わっていないか確かめる。この項目を足す前に保存した結果にはない
   */
  bodyHash?: string;
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
