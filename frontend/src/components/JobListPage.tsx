import { useEffect, useState } from 'react';
import { fetchJobs, deleteJob } from '../api/client';
import type { TranscriptionJob } from '../types';
import './JobListPage.css';

/** ポーリング間隔（ミリ秒） */
const POLL_INTERVAL_MS = 3000;

interface JobListPageProps {
  onBack: () => void;
  onViewResult: (transcriptionId: string) => void;
  onJobClick: (jobId: string) => void;
}

/** 日時を読みやすい形式にフォーマット */
function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('ja-JP', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** ジョブ一覧ページ */
export function JobListPage({ onBack, onViewResult, onJobClick }: JobListPageProps) {
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const result = await fetchJobs();
        if (!cancelled) {
          setJobs(result);
        }
      } catch {
        // ポーリングエラーは無視
      }
    };

    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const handleDelete = async (e: React.MouseEvent, jobId: string) => {
    e.stopPropagation();
    try {
      await deleteJob(jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch {
      // 削除エラーは無視
    }
  };

  return (
    <div className="job-list-page">
      <header className="job-list-header">
        <button className="job-list-back-button" onClick={onBack}>
          ← 戻る
        </button>
        <h1>ジョブ状況</h1>
      </header>

      <div className="job-list-content">
        {jobs.length === 0 ? (
          <div className="job-list-empty">
            ジョブはありません
          </div>
        ) : (
          jobs.map((job) => (
            <div
              key={job.id}
              className="job-list-item"
              onClick={() => {
                if (job.status === 'processing') {
                  onJobClick(job.id);
                } else if (job.status === 'completed' && job.transcriptionId) {
                  onViewResult(job.transcriptionId);
                }
              }}
            >
              <div className="job-list-item-status">
                {job.status === 'processing' && (
                  <div className="job-list-item-spinner" />
                )}
                {job.status === 'completed' && (
                  <span className="job-list-item-icon--completed">✓</span>
                )}
                {job.status === 'failed' && (
                  <span className="job-list-item-icon--failed">!</span>
                )}
              </div>

              <div className="job-list-item-info">
                <div className="job-list-item-filename">{job.audioFileName}</div>
                <div className="job-list-item-meta">
                  {formatDateTime(job.createdAt)}
                  {job.status === 'processing' && ' — 処理中'}
                  {job.status === 'completed' && ' — 完了'}
                  {job.status === 'failed' && ' — 失敗'}
                </div>
                {job.status === 'failed' && job.errorMessage && (
                  <div className="job-list-item-error" title={job.errorMessage}>
                    {job.errorMessage}
                  </div>
                )}
              </div>

              {job.status === 'completed' && job.transcriptionId && (
                <button
                  className="job-list-item-action job-list-item-action--view"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewResult(job.transcriptionId!);
                  }}
                >
                  結果を確認
                </button>
              )}

              {job.status !== 'processing' && (
                <button
                  className="job-list-item-action job-list-item-action--delete"
                  onClick={(e) => handleDelete(e, job.id)}
                >
                  削除
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
