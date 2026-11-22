import { render, screen } from '@testing-library/react';
import { AudioPlayer } from '../AudioPlayer';
import { fetchAudioFileUrl } from '../../api/client';
import { allCss } from '../../test/cssRules';

vi.mock('../../api/client');

describe('AudioPlayer の見た目', () => {
  beforeEach(() => {
    vi.mocked(fetchAudioFileUrl).mockResolvedValue('http://localhost/audio/a.mp3');
  });

  it('音声と「会話にジャンプ」ボタンを横に並べ、音声は残りの幅を使う', async () => {
    const { container } = render(<AudioPlayer fileName="a.mp3" onJumpToUtterance={() => {}} />);
    const button = await screen.findByRole('button');
    expect(container.firstElementChild).toHaveClass('mb-6', 'flex', 'items-center', 'gap-3');
    expect(container.querySelector('audio')).toHaveClass('flex-1', 'rounded-lg');
    expect(button).toHaveClass(
      'size-[2.2rem]',
      'shrink-0',
      'rounded-full',
      'border-gray-300',
      'bg-transparent',
      'p-0',
      'text-xl-minus',
      'leading-none',
      'hover:border-gray-400',
      'hover:bg-gray-100',
    );
  });

  it('読み込み中も、同じ余白をとる', () => {
    vi.mocked(fetchAudioFileUrl).mockReturnValue(new Promise(() => {}));
    render(<AudioPlayer fileName="a.mp3" />);
    expect(screen.getByText('読み込み中...')).toHaveClass('mb-6', 'flex', 'items-center', 'gap-3');
  });

  it('AudioPlayer.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/AudioPlayer.css');
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
