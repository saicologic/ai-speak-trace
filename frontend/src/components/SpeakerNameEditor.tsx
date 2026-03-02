import { useState } from 'react';
import { updateSpeakerNames } from '../api/client';
import type { Speaker, Transcription } from '../types';
import './SpeakerNameEditor.css';

interface Props {
  transcriptionId: string;
  speakers: Speaker[];
  onUpdate: (transcription: Transcription) => void;
}

/** 話者名編集コンポーネント */
export function SpeakerNameEditor({
  transcriptionId,
  speakers,
  onUpdate,
}: Props) {
  const [names, setNames] = useState<Record<string, string>>(
    Object.fromEntries(speakers.map((s) => [s.id, s.name])),
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const speakerUpdates = speakers.map((s) => ({
        id: s.id,
        name: names[s.id] || s.name,
      }));
      const updated = await updateSpeakerNames(
        transcriptionId,
        speakerUpdates,
      );
      onUpdate(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : '更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="speaker-name-editor">
      <h3>話者名</h3>
      <div className="speaker-name-fields">
        {speakers.map((speaker) => (
          <div key={speaker.id} className="speaker-name-field">
            <span
              className="speaker-color-dot"
              style={{ backgroundColor: speaker.color }}
            />
            <input
              type="text"
              value={names[speaker.id] || ''}
              onChange={(e) =>
                setNames((prev) => ({
                  ...prev,
                  [speaker.id]: e.target.value,
                }))
              }
            />
          </div>
        ))}
        <button
          className="speaker-name-save"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}
