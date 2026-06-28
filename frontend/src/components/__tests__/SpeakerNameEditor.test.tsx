import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpeakerNameEditor } from '../SpeakerNameEditor';
import { updateSpeakerNames } from '../../api/client';
import type { Speaker, Transcription } from '../../types';

vi.mock('../../api/client');

const sampleSpeakers: Speaker[] = [
  { id: 'speaker_0', name: 'Aさん', color: '#3B82F6' },
  { id: 'speaker_1', name: 'Bさん', color: '#EF4444' },
];

const updatedTranscription: Transcription = {
  id: 'test',
  audioFileName: 'test.mp3',
  createdAt: '2024-01-01T00:00:00Z',
  languageCode: 'ja',
  fullText: '',
  speakers: [
    { id: 'speaker_0', name: '田中さん', color: '#3B82F6' },
    { id: 'speaker_1', name: 'Bさん', color: '#EF4444' },
  ],
  words: [],
  utterances: [],
};

const defaultProps = {
  transcriptionId: 'test',
  speakers: sampleSpeakers,
  onUpdate: vi.fn(),
};

describe('SpeakerNameEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('話者名の入力フィールドを表示する', () => {
    render(<SpeakerNameEditor {...defaultProps} />);

    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveValue('Aさん');
    expect(inputs[1]).toHaveValue('Bさん');
  });

  it('「保存」ボタンを表示する', () => {
    render(<SpeakerNameEditor {...defaultProps} />);
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
  });

  it('話者の色のドットを表示する', () => {
    const { container } = render(<SpeakerNameEditor {...defaultProps} />);
    const dots = container.querySelectorAll('.speaker-color-dot');
    expect(dots).toHaveLength(2);
    expect(dots[0]).toHaveStyle({ backgroundColor: '#3B82F6' });
    expect(dots[1]).toHaveStyle({ backgroundColor: '#EF4444' });
  });

  it('入力フィールドで話者名を編集できる', async () => {
    const user = userEvent.setup();
    render(<SpeakerNameEditor {...defaultProps} />);

    const inputs = screen.getAllByRole('textbox');
    await user.clear(inputs[0]);
    await user.type(inputs[0], '田中さん');

    expect(inputs[0]).toHaveValue('田中さん');
  });

  it('保存ボタンをクリックするとupdateSpeakerNamesが呼ばれる', async () => {
    vi.mocked(updateSpeakerNames).mockResolvedValue(updatedTranscription);
    const user = userEvent.setup();
    render(<SpeakerNameEditor {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(updateSpeakerNames).toHaveBeenCalledWith('test', [
      { id: 'speaker_0', name: 'Aさん' },
      { id: 'speaker_1', name: 'Bさん' },
    ]);
  });

  it('保存成功後にonUpdateが呼ばれる', async () => {
    vi.mocked(updateSpeakerNames).mockResolvedValue(updatedTranscription);
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(<SpeakerNameEditor {...defaultProps} onUpdate={onUpdate} />);

    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(updatedTranscription);
    });
  });

  it('保存中はボタンが「保存中...」になり無効化される', async () => {
    vi.mocked(updateSpeakerNames).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<SpeakerNameEditor {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByRole('button', { name: '保存中...' })).toBeDisabled();
  });

  it('保存完了後にボタンが「保存」に戻る', async () => {
    vi.mocked(updateSpeakerNames).mockResolvedValue(updatedTranscription);
    const user = userEvent.setup();
    render(<SpeakerNameEditor {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    });
  });

  it('名前を変更して保存すると変更後の名前が送信される', async () => {
    vi.mocked(updateSpeakerNames).mockResolvedValue(updatedTranscription);
    const user = userEvent.setup();
    render(<SpeakerNameEditor {...defaultProps} />);

    const inputs = screen.getAllByRole('textbox');
    await user.clear(inputs[0]);
    await user.type(inputs[0], '田中さん');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(updateSpeakerNames).toHaveBeenCalledWith('test', [
      { id: 'speaker_0', name: '田中さん' },
      { id: 'speaker_1', name: 'Bさん' },
    ]);
  });
});
