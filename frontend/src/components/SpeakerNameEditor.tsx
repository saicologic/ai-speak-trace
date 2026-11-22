import { useState } from 'react';
import { updateSpeakerNames } from '../api/client';
import type { Speaker, Transcription } from '../types';

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
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-base font-semibold">話者名</h3>
      <div className="flex flex-wrap items-center gap-4">
        {speakers.map((speaker) => (
          <div key={speaker.id} className="flex items-center gap-2">
            {/* speaker-color-dot は、テストで色の丸を探すための目印 */}
            <span
              className="speaker-color-dot size-3 shrink-0 rounded-full"
              style={{ backgroundColor: speaker.color }}
            />
            <input
              type="text"
              className="w-[120px]"
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
          className="border-none bg-primary text-sm text-white hover:bg-primary-hover"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}
