import { useState } from 'react';
import { deleteChunkedJob } from '../api/client';
import type { ChunkedJobDetail } from '../api/client';
import { formatTime } from '../utils/transcription';
import { confirmDialog } from '../utils/platform';
import { PageLayout } from './PageLayout';

interface ResumableJobsPageProps {
  jobs: ChunkedJobDetail[];
  onBack: () => void;
  onSelectJob: (jobId: string) => void;
  onJobsDeleted: (deletedIds: string[]) => void;
}

/** ジョブの状態ごとのバッジの色 */
const statusColorOf = (job: ChunkedJobDetail): string => {
  if (job.status === 'completed') return 'bg-green-50 text-green-600';
  if (job.status === 'failed') return 'bg-red-50 text-red-600';
  return job.isProcessing ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600';
};

/** ジョブ進捗確認ページ */
export function ResumableJobsPage({
  jobs,
  onBack,
  onSelectJob,
  onJobsDeleted,
}: ResumableJobsPageProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  /** チェックボックスの切り替え */
  const handleToggle = (jobId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  /** 全選択 / 全解除 */
  const handleToggleAll = () => {
    if (selectedIds.size === jobs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(jobs.map((j) => j.id)));
    }
  };

  /** 選択したジョブを削除 */
  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = await confirmDialog(
      `${selectedIds.size}件のジョブを削除しますか？\n削除したジョブは復元できません。`,
      { title: 'ジョブの削除', kind: 'warning' },
    );
    if (!confirmed) return;

    setIsDeleting(true);
    const deletedIds: string[] = [];
    for (const jobId of selectedIds) {
      try {
        await deleteChunkedJob(jobId);
        deletedIds.push(jobId);
      } catch (err) {
        console.error(`ジョブ削除失敗: ${jobId}`, err);
      }
    }
    setSelectedIds(new Set());
    setIsDeleting(false);
    if (deletedIds.length > 0) {
      onJobsDeleted(deletedIds);
    }
  };

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
          <h1 className="text-xl font-semibold">ジョブ進捗確認</h1>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-[720px] flex-1 p-8">
        {jobs.length === 0 ? (
          <div className="py-12 text-center text-base-plus text-gray-500">
            <p>進行中のジョブはありません</p>
          </div>
        ) : (
          <>
            {/* 全選択・削除バー */}
            <div className="mb-4 flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-[0.4rem] text-md text-gray-700 select-none">
                <input
                  type="checkbox"
                  className="size-4 cursor-pointer"
                  checked={selectedIds.size === jobs.length}
                  onChange={handleToggleAll}
                />
                全選択
              </label>
              {selectedIds.size > 0 && (
                <button
                  className="rounded-md border-none bg-danger px-4 py-[0.4rem] text-md font-semibold text-white transition-colors duration-150 enabled:hover:bg-danger-hover disabled:cursor-not-allowed disabled:bg-gray-400"
                  onClick={handleDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? '削除中...' : `${selectedIds.size}件を削除`}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-3">
              {jobs.map((job) => (
                <div key={job.id} className="flex items-stretch gap-3">
                  <label
                    className="flex cursor-pointer items-center px-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      className="size-[18px] cursor-pointer"
                      checked={selectedIds.has(job.id)}
                      onChange={() => handleToggle(job.id)}
                    />
                  </label>
                  <button
                    className="flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded-lg border border-gray-200 bg-white px-5 py-4 text-left transition-[border-color,box-shadow] duration-150 hover:border-primary hover:shadow-[0_1px_4px] hover:shadow-blue-500/15"
                    onClick={() => onSelectJob(job.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-base-plus font-semibold text-gray-900">
                        {job.audioFileName}
                      </span>
                      <span
                        className={`shrink-0 rounded-sm px-2 py-[0.15rem] text-xs font-semibold ${statusColorOf(job)}`}
                      >
                        {job.status === 'completed' ? '完了'
                          : job.status === 'failed' ? '失敗'
                          : job.isProcessing ? '処理中'
                          : '中断'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-gray-200">
                        <div
                          className="h-full rounded-[3px] bg-primary transition-[width] duration-300"
                          style={{
                            width: `${
                              job.totalChunks > 0
                                ? (job.completedChunks.length / job.totalChunks) *
                                  100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                      <span className="shrink-0 text-sm text-gray-500">
                        {job.completedChunks.length}/{job.totalChunks} チャンク完了
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-400">
                      <span>
                        音声の長さ: {formatTime(job.totalDurationSec)}
                      </span>
                      <span>
                        {new Date(job.createdAt).toLocaleDateString('ja-JP', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </PageLayout>
  );
}
