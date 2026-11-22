import { fireEvent, render, screen } from '@testing-library/react';
import { ContextAnalysisModal } from '../ContextAnalysisModal';
import { allCss } from '../../test/cssRules';
import type { ContextAnalysisResponse } from '../../types';

vi.mock('../../api/client');

const intents = ['質問', '回答', '同意', '反論', '補足', '提案', '説明', '雑談'];

const analysis: ContextAnalysisResponse = {
  transcriptionId: 't1',
  model: 'claude-test',
  contentWarnings: [],
  results: intents.map((intent, i) => ({
    utteranceIndex: i,
    speakerId: 'speaker_0',
    speakerName: 'Aさん',
    text: `発言${i}`,
    previousUtterance: i === 0 ? null : { speakerName: 'Bさん', text: `直前${i}` },
    intent,
    topic: `話題${i}`,
  })),
};

const speakers = [{ id: 'speaker_0', name: 'Aさん', color: '#3B82F6' }];

describe('ContextAnalysisModal', () => {
  it('閉じるボタンと、外側を押すと閉じる', () => {
    const onClose = vi.fn();
    const { container } = render(<ContextAnalysisModal analysis={analysis} speakers={speakers} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('ContextAnalysisModal の見た目', () => {
  it('画面全体を半透明の黒で覆い、白い箱を真ん中に出す（文字は中央寄せ）', () => {
    const { container } = render(<ContextAnalysisModal analysis={analysis} speakers={speakers} onClose={() => {}} />);
    expect(container.firstElementChild).toHaveClass('fixed', 'top-0', 'left-0', 'z-[1000]', 'flex', 'size-full', 'items-center', 'justify-center', 'bg-black/50');
    expect(container.firstElementChild?.firstElementChild).toHaveClass(
      'w-[90%]',
      'max-w-[440px]',
      'rounded-xl',
      'bg-white',
      'p-8',
      'text-center',
      'shadow-[0_20px_60px]',
      'shadow-black/30',
    );
  });

  it('箱の中の段落（AI が生成した内容の注意など）は、少し大きい灰色の文字にし、下をあける', () => {
    const { container } = render(<ContextAnalysisModal analysis={analysis} speakers={speakers} onClose={() => {}} />);
    expect(container.firstElementChild?.firstElementChild).toHaveClass(
      '[&_p]:mb-6',
      '[&_p]:text-base-plus',
      '[&_p]:leading-[1.7]',
      '[&_p]:text-gray-700',
    );
  });

  it('見出しは赤い大きい文字にし、件数は紫のバッジにする', () => {
    render(<ContextAnalysisModal analysis={analysis} speakers={speakers} onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: '発言の文脈分析' })).toHaveClass('mb-4', 'text-xl-minus', 'text-red-800');
    expect(screen.getByText('8件の発話')).toHaveClass('rounded-[10px]', 'bg-violet-50', 'text-xs', 'font-semibold', 'text-violet-500');
  });

  it('意図のバッジは、意図ごとに色を変える', () => {
    render(<ContextAnalysisModal analysis={analysis} speakers={speakers} onClose={() => {}} />);
    const colors: Record<string, string[]> = {
      質問: ['bg-blue-100', 'text-blue-800'],
      回答: ['bg-green-100', 'text-green-800'],
      同意: ['bg-emerald-100', 'text-emerald-800'],
      反論: ['bg-red-100', 'text-red-800'],
      補足: ['bg-yellow-100', 'text-yellow-800'],
      提案: ['bg-purple-100', 'text-purple-800'],
      説明: ['bg-sky-100', 'text-sky-900'],
      雑談: ['bg-gray-100', 'text-gray-600'],
    };
    for (const [intent, classes] of Object.entries(colors)) {
      expect(screen.getByText(intent)).toHaveClass('rounded-[10px]', 'text-2xs', 'font-semibold', 'whitespace-nowrap', ...classes);
    }
  });

  it('結果のカードは薄い灰色にし、カードの一覧だけをスクロールする', () => {
    render(<ContextAnalysisModal analysis={analysis} speakers={speakers} onClose={() => {}} />);
    const card = screen.getByText('発言0').parentElement;
    expect(card).toHaveClass('rounded-lg', 'border-gray-200', 'bg-neutral-50', 'px-4', 'py-3');
    expect(card?.parentElement).toHaveClass('mb-5', 'flex', 'max-h-[60vh]', 'flex-col', 'gap-3', 'overflow-y-auto');
    expect(screen.getByText('話題1')).toHaveClass('font-medium', 'text-violet-500');
    expect(screen.getByText('「直前1」').parentElement).toHaveClass('rounded-md', 'bg-gray-100', 'text-[0.78rem]', 'text-gray-500');
  });

  it('閉じるボタンは紺にし、カーソルを乗せると少し明るくする', () => {
    render(<ContextAnalysisModal analysis={analysis} speakers={speakers} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: '閉じる' })).toHaveClass(
      'rounded-lg',
      'border-none',
      'bg-brand',
      'px-8',
      'py-[0.6rem]',
      'text-base',
      'text-white',
      'hover:bg-brand-hover',
    );
  });

  it('ContextAnalysisModal.css を残さない（@layer の外の CSS は Tailwind のクラスより強く、クラスが効かなくなる）', () => {
    expect(Object.keys(allCss)).not.toContain('components/ContextAnalysisModal.css');
    expect(Object.keys(allCss)).toContain('index.css');
  });
});
