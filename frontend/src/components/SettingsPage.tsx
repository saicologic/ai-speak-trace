import { useEffect, useState } from 'react';
import { fetchSettings, updateSettings } from '../api/client';
import type { AppSettings } from '../types';
import './SettingsPage.css';

interface SettingsPageProps {
  onBack: () => void;
}

/** 設定ページ */
export default function SettingsPage({ onBack }: SettingsPageProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dataDir, setDataDir] = useState('');
  const [elevenlabsApiKey, setElevenlabsApiKey] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [showRestart, setShowRestart] = useState(false);
  const [showElevenlabsKey, setShowElevenlabsKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);

  // 設定を読み込み
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    fetchSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setDataDir(s.paths.dataDir);
        if (s.apiKeys?.elevenlabsApiKey) {
          setElevenlabsApiKey(s.apiKeys.elevenlabsApiKey);
        }
        if (s.apiKeys?.anthropicApiKey) {
          setAnthropicApiKey(s.apiKeys.anthropicApiKey);
        }
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

    // 変更があった項目だけDTOに含める
    const dto: {
      dataDir?: string;
      elevenlabsApiKey?: string;
      anthropicApiKey?: string;
    } = {};

    if (settings && dataDir !== settings.paths.dataDir) {
      dto.dataDir = dataDir;
    }
    if (elevenlabsApiKey !== (settings?.apiKeys?.elevenlabsApiKey || '')) {
      dto.elevenlabsApiKey = elevenlabsApiKey;
    }
    if (anthropicApiKey !== (settings?.apiKeys?.anthropicApiKey || '')) {
      dto.anthropicApiKey = anthropicApiKey;
    }

    try {
      const result = await updateSettings(dto);
      setSettings(result.settings);
      // 保存後に入力値を新しい設定値に同期
      setElevenlabsApiKey(result.settings.apiKeys?.elevenlabsApiKey || '');
      setAnthropicApiKey(result.settings.apiKeys?.anthropicApiKey || '');
      setShowSuccess(true);
      if (result.restartRequired) {
        setShowRestart(true);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // 変更があるか判定
  const hasChanges = settings
    ? dataDir !== settings.paths.dataDir ||
      elevenlabsApiKey !== (settings.apiKeys?.elevenlabsApiKey || '') ||
      anthropicApiKey !== (settings.apiKeys?.anthropicApiKey || '')
    : false;

  // dataDirからサブディレクトリのパスを計算
  const subDirs = [
    { label: '音声ファイル', path: `${dataDir}/outputs` },
    { label: '文字起こし', path: `${dataDir}/transcriptions` },
    { label: 'PDFドキュメント', path: `${dataDir}/documents` },
    { label: 'メタデータ', path: `${dataDir}/document-metadata` },
  ];

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

        {showRestart && (
          <div className="settings-restart-notice">
            変更を反映するにはアプリの再起動が必要です
          </div>
        )}

        {settings && (
          <>
            {/* APIキー設定 */}
            <div className="settings-section">
              <h2>APIキー設定</h2>

              <div className="settings-input-group">
                <label>
                  ElevenLabs APIキー
                  <a
                    className="settings-api-key-link"
                    href="https://elevenlabs.io/app/settings/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    APIキーを取得
                  </a>
                </label>
                <div className="settings-input-with-toggle">
                  <input
                    type={showElevenlabsKey ? 'text' : 'password'}
                    className="settings-input"
                    value={elevenlabsApiKey}
                    onChange={(e) => {
                      setElevenlabsApiKey(e.target.value);
                      setShowSuccess(false);
                      setShowRestart(false);
                    }}
                    placeholder="APIキーを入力"
                  />
                  {elevenlabsApiKey && (
                    <button
                      type="button"
                      className="settings-toggle-visibility"
                      onClick={() => setShowElevenlabsKey((v) => !v)}
                    >
                      {showElevenlabsKey ? '隠す' : '表示'}
                    </button>
                  )}
                </div>
              </div>

              <div className="settings-input-group">
                <label>
                  Anthropic APIキー
                  <a
                    className="settings-api-key-link"
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    APIキーを取得
                  </a>
                </label>
                <div className="settings-input-with-toggle">
                  <input
                    type={showAnthropicKey ? 'text' : 'password'}
                    className="settings-input"
                    value={anthropicApiKey}
                    onChange={(e) => {
                      setAnthropicApiKey(e.target.value);
                      setShowSuccess(false);
                      setShowRestart(false);
                    }}
                    placeholder="APIキーを入力"
                  />
                  {anthropicApiKey && (
                    <button
                      type="button"
                      className="settings-toggle-visibility"
                      onClick={() => setShowAnthropicKey((v) => !v)}
                    >
                      {showAnthropicKey ? '隠す' : '表示'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* データ保存先 */}
            <div className="settings-section">
              <h2>データ保存先</h2>

              <div className="settings-input-group">
                <label>データディレクトリ</label>
                <input
                  type="text"
                  className="settings-input settings-input-mono"
                  value={dataDir}
                  onChange={(e) => {
                    setDataDir(e.target.value);
                    setShowSuccess(false);
                    setShowRestart(false);
                  }}
                />
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
