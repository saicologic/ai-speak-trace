import { useState } from 'react';
import { deleteChunkedJob } from '../api/client';
import type { ChunkedJobDetail } from '../api/client';
import { formatTime } from '../utils/transcription';
import './ResumableJobsPage.css';

interface ResumableJobsPageProps {
  jobs: ChunkedJobDetail[];
  onBack: () => void;
  onSelectJob: (jobId: string) => void;
  onJobsDeleted: (deletedIds: string[]) => void;
}

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
    // Tauri WebView では window.confirm がブロッキングしないため plugin-dialog を使用
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const confirmed = await confirm(
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
    <div className="resumable-jobs-page">
      <div className="resumable-jobs-header">
        <button className="resumable-jobs-back-button" onClick={onBack}>
          ← 戻る
        </button>
        <h1>ジョブ進捗確認</h1>
      </div>

      <div className="resumable-jobs-content">
        {jobs.length === 0 ? (
          <div className="resumable-jobs-empty">
            <p>進行中のジョブはありません</p>
          </div>
        ) : (
          <>
            {/* 全選択・削除バー */}
            <div className="resumable-jobs-toolbar">
              <label className="resumable-jobs-select-all">
                <input
                  type="checkbox"
                  checked={selectedIds.size === jobs.length}
                  onChange={handleToggleAll}
                />
                全選択
              </label>
              {selectedIds.size > 0 && (
                <button
                  className="resumable-jobs-delete-button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? '削除中...' : `${selectedIds.size}件を削除`}
                </button>
              )}
            </div>

            <div className="resumable-jobs-list">
              {jobs.map((job) => (
                <div key={job.id} className="resumable-job-card-wrapper">
                  <label
                    className="resumable-job-checkbox"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(job.id)}
                      onChange={() => handleToggle(job.id)}
                    />
                  </label>
                  <button
                    className="resumable-job-card"
                    onClick={() => onSelectJob(job.id)}
                  >
                    <div className="resumable-job-card-header">
                      <span className="resumable-job-card-name">
                        {job.audioFileName}
                      </span>
                      <span
                        className={`resumable-job-card-status ${
                          job.status === 'completed'
                            ? 'resumable-job-card-status--completed'
                            : job.status === 'failed'
                              ? 'resumable-job-card-status--failed'
                              : job.isProcessing
                                ? 'resumable-job-card-status--processing'
                                : 'resumable-job-card-status--interrupted'
                        }`}
                      >
                        {job.status === 'completed' ? '完了'
                          : job.status === 'failed' ? '失敗'
                          : job.isProcessing ? '処理中'
                          : '中断'}
                      </span>
                    </div>
                    <div className="resumable-job-card-progress">
                      <div className="resumable-job-card-progress-bar">
                        <div
                          className="resumable-job-card-progress-fill"
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
                      <span className="resumable-job-card-progress-text">
                        {job.completedChunks.length}/{job.totalChunks} チャンク完了
                      </span>
                    </div>
                    <div className="resumable-job-card-meta">
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
    </div>
  );
}
