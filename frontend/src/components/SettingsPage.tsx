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
  const [showSuccess, setShowSuccess] = useState(false);
  const [showRestart, setShowRestart] = useState(false);

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

    try {
      const result = await updateSettings({ dataDir });
      setSettings(result.settings);
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
  const hasChanges = settings ? dataDir !== settings.paths.dataDir : false;

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
            ⚠ 変更を反映するにはアプリの再起動が必要です
          </div>
        )}

        {settings && (
          <>
            {/* データ保存先 */}
            <div className="settings-section">
              <h2>データ保存先</h2>

              <div className="settings-path-input-group">
                <label>データディレクトリ</label>
                <input
                  type="text"
                  className="settings-path-input"
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

              <div className="settings-actions">
                <button
                  className="settings-save-button"
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
