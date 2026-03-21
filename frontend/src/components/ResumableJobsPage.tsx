import type { ChunkedJobDetail } from '../api/client';
import { formatTime } from '../utils/transcription';
import './ResumableJobsPage.css';

interface ResumableJobsPageProps {
  jobs: ChunkedJobDetail[];
  onBack: () => void;
  onSelectJob: (jobId: string) => void;
}

/** 中断中のジョブ一覧ページ */
export function ResumableJobsPage({
  jobs,
  onBack,
  onSelectJob,
}: ResumableJobsPageProps) {
  return (
    <div className="resumable-jobs-page">
      <div className="resumable-jobs-header">
        <button className="resumable-jobs-back-button" onClick={onBack}>
          ← 戻る
        </button>
        <h1>中断中のジョブ</h1>
      </div>

      <div className="resumable-jobs-content">
        {jobs.length === 0 ? (
          <div className="resumable-jobs-empty">
            <p>中断中のジョブはありません</p>
          </div>
        ) : (
          <div className="resumable-jobs-list">
            {jobs.map((job) => (
                <button
                  key={job.id}
                  className="resumable-job-card"
                  onClick={() => onSelectJob(job.id)}
                >
                  <div className="resumable-job-card-header">
                    <span className="resumable-job-card-name">
                      {job.audioFileName}
                    </span>
                    <span
                      className={`resumable-job-card-status ${
                        job.status === 'failed'
                          ? 'resumable-job-card-status--failed'
                          : 'resumable-job-card-status--interrupted'
                      }`}
                    >
                      {job.status === 'failed' ? '失敗' : '中断'}
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
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
