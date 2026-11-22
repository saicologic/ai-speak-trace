import { useEffect, useState } from 'react';
import { fetchSettings, updateSettings, openDataFolder } from '../api/client';
import type { ApiKeyStatus, AppSettings } from '../types';
import { missingAiSettings } from '../utils/aiAnalysis';
import { PageLayout } from './PageLayout';

interface SettingsPageProps {
  onBack: () => void;
}

/** パスと API キーの状態の字体（等幅） */
const monoClass = "[font-family:'SF_Mono','Menlo',monospace]";
/** 入力欄の項目名 */
const fieldLabelClass = 'mb-[0.4rem] flex items-center gap-2 text-md font-medium text-gray-700';
/** 入力欄：フォーカスすると青い枠にする */
const inputClass =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-md focus:border-primary focus:shadow-[0_0_0_2px] focus:shadow-blue-500/20 focus:outline-none';
/** チェックボックスと入力欄の説明 */
const hintClass = 'mt-[0.4rem] ml-6 text-xs text-gray-500';
/** 設定のカードと、その見出し（見出しの下に線を引く） */
const sectionClass = 'mb-6 rounded-[10px] border border-gray-200 bg-white p-6';
const sectionHeadingClass = 'mb-4 border-b border-gray-100 pb-3 text-lg font-semibold text-gray-800';
/** チェックボックスと、その項目名 */
const checkboxLabelClass = 'flex cursor-pointer items-center gap-2 text-md text-gray-700';
const checkboxClass = 'size-4 cursor-pointer';
/** 白い地に青い枠のボタン：カーソルを乗せると青く塗る */
const outlineButtonClass = 'border-primary bg-white text-primary transition-all duration-150 hover:bg-primary hover:text-white';

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
    <div className="mb-4">
      <label className={fieldLabelClass}>
        {label}
        <a
          className="text-xs font-normal text-primary no-underline hover:underline"
          href={link}
          target="_blank"
          rel="noopener noreferrer"
        >
          APIキーを取得
        </a>
      </label>
      <div className={`mt-[0.3rem] mb-[0.35rem] flex items-center gap-2 text-sm text-gray-500 ${monoClass}`}>
        {removing
          ? '保存すると削除します'
          : configured
            ? `設定済み${status?.last4 ? `（末尾 ${status.last4}）` : ''}`
            : '未設定'}
        {configured && (
          <button
            type="button"
            className="rounded-sm border border-red-200 bg-white px-2 py-[0.1rem] text-xs text-red-700"
            onClick={onToggleRemove}
          >
            {removing ? '削除を取り消す' : '削除'}
          </button>
        )}
      </div>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          // 表示ボタンの分だけ右をあける
          className={`${inputClass} pr-14`}
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
            className={`absolute top-1/2 right-2 z-[1] -translate-y-1/2 rounded-sm border px-[0.6rem] py-1 text-xs ${outlineButtonClass}`}
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
    <PageLayout
      className="bg-gray-50"
      header={
        <div className="flex items-center gap-4 bg-brand px-8 py-4 text-white">
          <button
            className="rounded-md border border-white/30 bg-transparent px-[0.8rem] py-[0.4rem] text-md text-white transition-colors duration-150 hover:bg-white/10"
            onClick={onBack}
          >
            ← 戻る
          </button>
          <h1 className="text-xl font-semibold">設定</h1>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-[700px] flex-1 p-8">
        {loading && <div className="p-12 text-center text-gray-500">読み込み中...</div>}

        {error && <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">{error}</div>}

        {showSuccess && (
          <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-md text-green-800">設定を保存しました。</div>
        )}

        {settings && (
          <>
            {/* 文字起こし */}
            <div className={sectionClass}>
              <h2 className={sectionHeadingClass}>文字起こし</h2>
              <p className={hintClass}>{apiKeyStorageHint}</p>

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
            <div className={sectionClass}>
              <h2 className={sectionHeadingClass}>AI 分析（Claude と AWS）</h2>
              <label className={checkboxLabelClass}>
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={enableAiAnalysis}
                  onChange={(e) => {
                    setEnableAiAnalysis(e.target.checked);
                    setShowSuccess(false);
                  }}
                />
                AI 分析を使う
              </label>
              <p className={hintClass}>
                ON にすると、要約・会話分析・発言の文脈・ディープサーチを使えます。Anthropic の API キーと Amazon Bedrock Guardrails（AWS）の両方が必要です。
                Claude に送る内容と Claude の応答は、毎回 Guardrails で確認します（個人情報・プロンプト攻撃など）。
                会話の本文は AWS（APAC リージョン内）でも処理されます。AWS の認証情報は、この Mac の AWS CLI の設定を使います。
                OFF の場合は、Claude にも AWS にも何も送りません（ボタンは押せない状態で表示します）。
              </p>
              {enableAiAnalysis && (
                <>
                  <div
                    className={`mt-2 mb-3 rounded-lg border px-3 py-2 text-md font-semibold ${
                      aiMissing.length === 0
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
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

                <h3 className="mt-6 mb-2 text-base-plus font-semibold text-gray-700">Amazon Bedrock Guardrails（AWS）</h3>
                <p className={hintClass}>
                  ディープサーチで会話を選んだときは、会話に含まれる個人情報（氏名・電話番号など）も検出します。
                  ディープサーチ・要約・会話分析で Claude に送る前に、検出した文字列を伏せられます。
                </p>
                <div className="mb-4">
                  <label className={fieldLabelClass}>Guardrail ID</label>
                  <input
                    type="text"
                    className={inputClass}
                    value={guardrailId}
                    onChange={(e) => {
                      setGuardrailId(e.target.value);
                      setShowSuccess(false);
                    }}
                    placeholder="未設定の場合、Claude を使う機能は使えません"
                  />
                </div>
                <div className="mb-4">
                  <label className={fieldLabelClass}>バージョン</label>
                  <input
                    type="text"
                    className={inputClass}
                    value={guardrailVersion}
                    onChange={(e) => {
                      setGuardrailVersion(e.target.value);
                      setShowSuccess(false);
                    }}
                    placeholder="DRAFT"
                  />
                  <p className={hintClass}>
                    空の場合は DRAFT を使います。DRAFT は AWS のコンソールで編集するとすぐに変わるため、
                    Guardrail のバージョンを作成し、その番号（1 など）を指定することを勧めます。
                    保存する前に、指定したバージョンで確認できることを確かめます。
                    どのバージョンで確認したかは、Claude の呼び出しの記録（claude-audit-logs/）に残ります。
                  </p>
                </div>
                <div className="mb-4">
                  <label className={fieldLabelClass}>AWS プロファイル</label>
                  <input
                    type="text"
                    className={inputClass}
                    value={awsProfile}
                    onChange={(e) => {
                      setAwsProfile(e.target.value);
                      setShowSuccess(false);
                    }}
                    placeholder="default"
                  />
                  <p className={hintClass}>
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
            <div className={sectionClass}>
              <h2 className={sectionHeadingClass}>キーワード</h2>
              <label className={checkboxLabelClass}>
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={enableGinzaKeywords}
                  onChange={(e) => {
                    setEnableGinzaKeywords(e.target.checked);
                    setShowSuccess(false);
                  }}
                />
                GiNZA のキーワード抽出を有効にする（ベータ）
              </label>
              <p className={hintClass}>
                有効にすると、キーワードの一覧と会話分析で「標準」と「GiNZA」を切り替えられます。
                GiNZA は日本語を解析して、評価・型チェックのような漢字の語も取り出します。
                初めて使うときに Python と GiNZA（約 500MB）をダウンロードします。解析は手元で行い、会話を外部に送りません。AWS は使いません。
              </p>
            </div>

            {/* データ保存先 */}
            <div className={sectionClass}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-800">データ保存先</h2>
                <button
                  type="button"
                  className={`shrink-0 rounded-md border px-[0.8rem] py-[0.3rem] text-sm font-medium ${outlineButtonClass}`}
                  onClick={() => openDataFolder()}
                >
                  フォルダを表示
                </button>
              </div>

              <div className={`rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm break-all text-gray-700 ${monoClass}`}>
                {settings.paths.dataDir}
              </div>

              <div className="mt-4 border-t border-gray-100 pt-4">
                <div className="mb-2 text-sm text-gray-500">
                  以下のフォルダに保存されます:
                </div>
                {subDirs.map((dir) => (
                  <div key={dir.label} className="flex items-center py-[0.3rem]">
                    <span className="w-[140px] shrink-0 text-sm text-gray-500">{dir.label}</span>
                    <span className={`truncate text-sm text-gray-700 ${monoClass}`}>{dir.path}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 flex items-center gap-4">
              <button
                className="rounded-lg border-none bg-primary px-6 py-[0.6rem] text-base font-medium text-white transition-all duration-150 enabled:hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleSave}
                disabled={saving || !hasChanges}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </>
        )}
      </div>
    </PageLayout>
  );
}
