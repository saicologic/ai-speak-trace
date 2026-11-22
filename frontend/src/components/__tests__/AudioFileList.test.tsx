import { render, screen } from '@testing-library/react';
import { AudioFileList } from '../AudioFileList';
import { fetchAudioFiles } from '../../api/client';
import { allCss } from '../../test/cssRules';
import type { AudioFileInfo } from '../../types';

vi.mock('../../api/client');

const files = [
  { fileName: 'a.mp3', sizeBytes: 2048 },
  { fileName: 'b.mp3', sizeBytes: 4096 },
] as AudioFileInfo[];

describe('AudioFileList の見た目', () => {
  beforeEach(() => {
    vi.mocked(fetchAudioFiles).mockResolvedValue(files);
  });

  it('選んだ音声ファイルは青い枠にし、カーソルを乗せても色を変えない', async () => {
    render(<AudioFileList selectedFile="a.mp3" onFileSelect={() => {}} loading={false} />);
    const selected = (await screen.findByText('a.mp3')).closest('button');
    expect(selected).toHaveClass('flex', 'w-full', 'flex-col', 'rounded-lg', 'border', 'text-left', 'border-blue-500', 'bg-blue-50');
    expect(Array.from(selected!.classList).filter((c) => c.startsWith('hover:'))).toEqual([]);

    const other = screen.getByText('b.mp3').closest('button');
    expect(other).toHaveClass('border-gray-200', 'bg-white', 'hover:border-blue-300', 'hover:bg-blue-50');
    expect(screen.getByText('a.mp3')).toHaveClass('text-md', 'font-medium', 'break-all');
    expect(screen.getByText('2.0 KB')).toHaveClass('text-xs', 'text-gray-400');
  });

  it('アップロードのボタンは青い横いっぱいのボタンにし、押せないときは薄い青にする', async () => {
    render(<AudioFileList selectedFile={null} onFileSelect={() => {}} loading={false} />);
    expect(await screen.findByRole('button', { name: 'ファイルをアップロード' })).toHaveClass(
      'w-full',
      'rounded-lg',
      'border-none',
      'bg-primary',
      'p-2',
      'text-md',
      'font-medium',
      'text-white',
      'enabled:hover:bg-primary-hover',
      'disabled:bg-blue-300',
    );
    expect(screen.getByRole('button', { name: '更新' })).toHaveClass('px-[0.6em]', 'py-[0.3em]', 'text-xs');
    expect(screen.getByRole('heading', { name: '音声ファイル' })).toHaveClass('text-lg', 'font-semibold');
  });

  it('AudioFileList.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/AudioFileList.css');
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
