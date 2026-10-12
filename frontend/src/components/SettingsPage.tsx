import { useEffect, useState } from 'react';
import { fetchSettings, updateSettings, openDataFolder } from '../api/client';
import type { ApiKeyStatus, AppSettings } from '../types';
import { missingAiSettings } from '../utils/aiAnalysis';
import './SettingsPage.css';

interface SettingsPageProps {
  onBack: () => void;
}

/** API キーの入力欄（保存済みのキーの値は画面に返らないため、状態と末尾4文字だけを表示する） */
function ApiKeyInput({
  label,
  link,
  status,
  value,
  removing,
  onChange,
  onToggleRemove,
}: {
  label: string;
  link: string;
  status: ApiKeyStatus | undefined;
  value: string;
  removing: boolean;
  onChange: (value: string) => void;
  onToggleRemove: () => void;
}) {
  const [show, setShow] = useState(false);
  const configured = status?.configured ?? false;
  return (
    <div className="settings-input-group">
      <label>
        {label}
        <a
          className="settings-api-key-link"
          href={link}
          target="_blank"
          rel="noopener noreferrer"
        >
          APIキーを取得
        </a>
      </label>
      <div className="settings-api-key-status">
        {removing
          ? '保存すると削除します'
          : configured
            ? `設定済み${status?.last4 ? `（末尾 ${status.last4}）` : ''}`
            : '未設定'}
        {configured && (
          <button
            type="button"
            className="settings-api-key-remove"
            onClick={onToggleRemove}
          >
            {removing ? '削除を取り消す' : '削除'}
          </button>
        )}
      </div>
      <div className="settings-input-with-toggle">
        <input
          type={show ? 'text' : 'password'}
          className="settings-input"
          value={value}
          disabled={removing}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            configured ? '変更する場合だけ、新しいキーを入力' : 'APIキーを入力'
          }
        />
        {value && (
          <button
            type="button"
            className="settings-toggle-visibility"
            onClick={() => setShow((v) => !v)}
          >
            {show ? '隠す' : '表示'}
          </button>
        )}
      </div>
    </div>
  );
}

/** 設定ページ */
export default function SettingsPage({ onBack }: SettingsPageProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // API キーは、入力したときだけ保存する（空のままなら変更しない）
  const [elevenlabsApiKey, setElevenlabsApiKey] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [removeElevenlabsKey, setRemoveElevenlabsKey] = useState(false);
  const [removeAnthropicKey, setRemoveAnthropicKey] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [enableAiAnalysis, setEnableAiAnalysis] = useState(false);
  const [enableGinzaKeywords, setEnableGinzaKeywords] = useState(false);
  const [guardrailId, setGuardrailId] = useState('');
  const [guardrailVersion, setGuardrailVersion] = useState('');
  const [awsProfile, setAwsProfile] = useState('');

  /** 設定値を画面の入力に反映する */
  const applySettings = (s: AppSettings) => {
    setSettings(s);
    setElevenlabsApiKey('');
    setAnthropicApiKey('');
    setRemoveElevenlabsKey(false);
    setRemoveAnthropicKey(false);
    setEnableAiAnalysis(s.enableAiAnalysis ?? false);
    setEnableGinzaKeywords(s.enableGinzaKeywords ?? false);
    setGuardrailId(s.guardrail?.id ?? '');
    setGuardrailVersion(s.guardrail?.version ?? '');
    setAwsProfile(s.awsProfile ?? '');
  };

  // 設定を読み込み
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    fetchSettings()
      .then((s) => {
        if (!cancelled) applySettings(s);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // 保存処理
  const handleSave = async () => {
    setSaving(true);
    setError('');
    setShowSuccess(false);

    // 変更があった項目だけDTOに含める（API キーの空文字は削除）
    const dto: {
      elevenlabsApiKey?: string;
      anthropicApiKey?: string;
      enableAiAnalysis?: boolean;
      enableGinzaKeywords?: boolean;
      bedrockGuardrailId?: string;
      bedrockGuardrailVersion?: string;
      awsProfile?: string;
    } = {};

    if (removeElevenlabsKey) {
      dto.elevenlabsApiKey = '';
    } else if (elevenlabsApiKey.trim()) {
      dto.elevenlabsApiKey = elevenlabsApiKey.trim();
    }
    if (removeAnthropicKey) {
      dto.anthropicApiKey = '';
    } else if (anthropicApiKey.trim()) {
      dto.anthropicApiKey = anthropicApiKey.trim();
    }
    if (enableAiAnalysis !== (settings?.enableAiAnalysis ?? false)) {
      dto.enableAiAnalysis = enableAiAnalysis;
    }
    if (enableGinzaKeywords !== (settings?.enableGinzaKeywords ?? false)) {
      dto.enableGinzaKeywords = enableGinzaKeywords;
    }
    if (guardrailId !== (settings?.guardrail?.id ?? '')) {
      dto.bedrockGuardrailId = guardrailId;
    }
    if (guardrailVersion.trim() !== (settings?.guardrail?.version ?? '')) {
      dto.bedrockGuardrailVersion = guardrailVersion.trim();
    }
    if (awsProfile.trim() !== (settings?.awsProfile ?? '')) {
      dto.awsProfile = awsProfile.trim();
    }

    try {
      const result = await updateSettings(dto);
      // 保存後に入力値を新しい設定値に同期
      applySettings(result.settings);
      setShowSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 変更があるか判定
  const hasChanges = settings
    ? elevenlabsApiKey.trim() !== '' ||
      anthropicApiKey.trim() !== '' ||
      removeElevenlabsKey ||
      removeAnthropicKey ||
      enableAiAnalysis !== (settings.enableAiAnalysis ?? false) ||
      enableGinzaKeywords !== (settings.enableGinzaKeywords ?? false) ||
      guardrailId !== (settings.guardrail?.id ?? '') ||
      guardrailVersion.trim() !== (settings.guardrail?.version ?? '') ||
      awsProfile.trim() !== (settings.awsProfile ?? '')
    : false;

  // サブディレクトリ（相対パス表示）
  const subDirs = [
    { label: '音声ファイル', path: 'audio/' },
    { label: '文字起こし', path: 'transcriptions/' },
    { label: '要約ログ', path: 'summary-logs/' },
    { label: 'Claude の呼び出しの記録', path: 'claude-audit-logs/' },
    { label: '誤りの報告', path: 'feedback/' },
    { label: 'GiNZA のキーワード（ベータ）', path: 'ginza-keywords/' },
  ];

  /** AI 分析に足りない設定（保存済みの設定で判断する） */
  const aiMissing = missingAiSettings(settings);

  const apiKeyStorageHint =
    settings?.apiKeyStorage === 'keychain'
      ? 'APIキーは、この Mac のキーチェーンに保存します（設定ファイルには保存しません）。'
      : 'APIキーは、設定ファイル（settings.json）に暗号化せずに保存します。このフォルダを他人と共有しないでください。';

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back-button" onClick={onBack}>
          ← 戻る
        </button>
        <h1>設定</h1>
      </div>

      <div className="settings-content">
        {loading && <div className="settings-loading">読み込み中...</div>}

        {error && <div className="settings-error">{error}</div>}

        {showSuccess && (
          <div className="settings-success">設定を保存しました。</div>
        )}

        {settings && (
          <>
            {/* 文字起こし */}
            <div className="settings-section">
              <h2>文字起こし</h2>
              <p className="settings-checkbox-hint">{apiKeyStorageHint}</p>

              <ApiKeyInput
                label="ElevenLabs APIキー"
                link="https://elevenlabs.io/app/settings/api-keys"
                status={settings.apiKeys?.elevenlabsApiKey}
                value={elevenlabsApiKey}
                removing={removeElevenlabsKey}
                onChange={(v) => {
                  setElevenlabsApiKey(v);
                  setShowSuccess(false);
                }}
                onToggleRemove={() => {
                  setRemoveElevenlabsKey((v) => !v);
                  setElevenlabsApiKey('');
                  setShowSuccess(false);
                }}
              />
            </div>

            {/* AI 分析（Claude と AWS） */}
            <div className="settings-section">
              <h2>AI 分析（Claude と AWS）</h2>
              <label className="settings-checkbox-label">
                <input
                  type="checkbox"
                  checked={enableAiAnalysis}
                  onChange={(e) => {
                    setEnableAiAnalysis(e.target.checked);
                    setShowSuccess(false);
                  }}
                />
                AI 分析を使う
              </label>
              <p className="settings-checkbox-hint">
                ON にすると、要約・会話分析・発言の文脈・ディープサーチを使えます。Anthropic の API キーと Amazon Bedrock Guardrails（AWS）の両方が必要です。
                Claude に送る内容と Claude の応答は、毎回 Guardrails で確認します（個人情報・プロンプト攻撃など）。
                会話の本文は AWS（APAC リージョン内）でも処理されます。AWS の認証情報は、この Mac の AWS CLI の設定を使います。
                OFF の場合は、Claude にも AWS にも何も送りません（ボタンは押せない状態で表示します）。
              </p>
              {enableAiAnalysis && (
                <>
                  <div
                    className={`settings-ai-status ${aiMissing.length === 0 ? 'ready' : 'missing'}`}
                    role="status"
                  >
                    {aiMissing.length > 0
                      ? `未設定: ${aiMissing.join('・')}`
                      : settings.enableAiAnalysis
                        ? '使えます（保存済みの設定）'
                        : '設定は済んでいます。保存すると使えます'}
                  </div>

                <ApiKeyInput
                  label="Anthropic APIキー"
                  link="https://console.anthropic.com/settings/keys"
                  status={settings.apiKeys?.anthropicApiKey}
                  value={anthropicApiKey}
                  removing={removeAnthropicKey}
                  onChange={(v) => {
                    setAnthropicApiKey(v);
                    setShowSuccess(false);
                  }}
                  onToggleRemove={() => {
                    setRemoveAnthropicKey((v) => !v);
                    setAnthropicApiKey('');
                    setShowSuccess(false);
                  }}
                />

                <h3 className="settings-subheading">Amazon Bedrock Guardrails（AWS）</h3>
                <p className="settings-checkbox-hint">
                  ディープサーチで会話を選んだときは、会話に含まれる個人情報（氏名・電話番号など）も検出します。
                  ディープサーチ・要約・会話分析で Claude に送る前に、検出した文字列を伏せられます。
                </p>
                <div className="settings-input-group">
                  <label>Guardrail ID</label>
                  <input
                    type="text"
                    className="settings-input"
                    value={guardrailId}
                    onChange={(e) => {
                      setGuardrailId(e.target.value);
                      setShowSuccess(false);
                    }}
                    placeholder="未設定の場合、Claude を使う機能は使えません"
                  />
                </div>
                <div className="settings-input-group">
                  <label>バージョン</label>
                  <input
                    type="text"
                    className="settings-input"
                    value={guardrailVersion}
                    onChange={(e) => {
                      setGuardrailVersion(e.target.value);
                      setShowSuccess(false);
                    }}
                    placeholder="DRAFT"
                  />
                  <p className="settings-checkbox-hint">
                    空の場合は DRAFT を使います。DRAFT は AWS のコンソールで編集するとすぐに変わるため、
                    Guardrail のバージョンを作成し、その番号（1 など）を指定することを勧めます。
                    保存する前に、指定したバージョンで確認できることを確かめます。
                    どのバージョンで確認したかは、Claude の呼び出しの記録（claude-audit-logs/）に残ります。
                  </p>
                </div>
                <div className="settings-input-group">
                  <label>AWS プロファイル</label>
                  <input
                    type="text"
                    className="settings-input"
                    value={awsProfile}
                    onChange={(e) => {
                      setAwsProfile(e.target.value);
                      setShowSuccess(false);
                    }}
                    placeholder="default"
                  />
                  <p className="settings-checkbox-hint">
                    AWS の認証情報に使う、~/.aws/credentials のプロファイル名です。空の場合は default を使います。
                    アプリはターミナルの環境変数（AWS_PROFILE など）を使えないため、default 以外を使う場合はここで指定してください。
                    アクセスキーで設定したプロファイルに対応します（SSO などには対応していません）。
                    変えると、保存する前にそのプロファイルで Guardrail を呼べることを確かめます。
                  </p>
                </div>
                </>
              )}
            </div>

            {/* キーワード */}
            <div className="settings-section">
              <h2>キーワード</h2>
              <label className="settings-checkbox-label">
                <input
                  type="checkbox"
                  checked={enableGinzaKeywords}
                  onChange={(e) => {
                    setEnableGinzaKeywords(e.target.checked);
                    setShowSuccess(false);
                  }}
                />
                GiNZA のキーワード抽出を有効にする（ベータ）
              </label>
              <p className="settings-checkbox-hint">
                有効にすると、キーワードの一覧と会話分析で「標準」と「GiNZA」を切り替えられます。
                GiNZA は日本語を解析して、評価・型チェックのような漢字の語も取り出します。
                初めて使うときに Python と GiNZA（約 500MB）をダウンロードします。解析は手元で行い、会話を外部に送りません。AWS は使いません。
              </p>
            </div>

            {/* データ保存先 */}
            <div className="settings-section">
              <div className="settings-section-header">
                <h2>データ保存先</h2>
                <button
                  type="button"
                  className="settings-open-folder-button"
                  onClick={() => openDataFolder()}
                >
                  フォルダを表示
                </button>
              </div>

              <div className="settings-datadir-path">
                {settings.paths.dataDir}
              </div>

              <div className="settings-subdirs">
                <div className="settings-subdirs-title">
                  以下のフォルダに保存されます:
                </div>
                {subDirs.map((dir) => (
                  <div key={dir.label} className="settings-subdir-item">
                    <span className="settings-subdir-label">{dir.label}</span>
                    <span className="settings-subdir-path">{dir.path}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="settings-actions">
              <button
                className="settings-save-button"
                onClick={handleSave}
                disabled={saving || !hasChanges}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
