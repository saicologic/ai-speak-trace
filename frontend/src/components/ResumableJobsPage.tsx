import { useEffect, useState } from 'react';
import { checkCredits } from '../api/client';
import type { ChunkedJobDetail, CreditInfo } from '../api/client';
import { formatTime, estimateCredits } from '../utils/transcription';
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
  const [creditInfo, setCreditInfo] = useState<CreditInfo | null>(null);
  const [creditCheckLoading, setCreditCheckLoading] = useState(false);

  // ページ表示時にクレジット残量を確認
  useEffect(() => {
    let cancelled = false;
    setCreditCheckLoading(true);
    checkCredits()
      .then((info) => {
        if (!cancelled) setCreditInfo(info);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCreditCheckLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="resumable-jobs-page">
      <div className="resumable-jobs-header">
        <button className="resumable-jobs-back-button" onClick={onBack}>
          ← 戻る
        </button>
        <h1>中断中のジョブ</h1>
      </div>

      <div className="resumable-jobs-content">
        {/* クレジット残量 */}
        <div className="resumable-jobs-credit">
          {creditCheckLoading && (
            <p className="resumable-jobs-credit-loading">クレジット情報を確認中...</p>
          )}
          {creditInfo && (
            <div className={`resumable-jobs-credit-info ${creditInfo.remainingCredits <= 0 ? 'resumable-jobs-credit-insufficient' : ''}`}>
              <span>残りクレジット</span>
              <span>{creditInfo.remainingCredits.toLocaleString()}</span>
            </div>
          )}
        </div>

        {jobs.length === 0 ? (
          <div className="resumable-jobs-empty">
            <p>中断中のジョブはありません</p>
          </div>
        ) : (
          <div className="resumable-jobs-list">
            {jobs.map((job) => {
              const estimated = estimateCredits(job);
              const isSufficient = creditInfo === null || creditInfo.remainingCredits >= estimated;

              return (
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
                  <div className="resumable-job-card-credit">
                    <span>必要クレジット（推定）</span>
                    <span className={!isSufficient ? 'resumable-job-card-credit-insufficient' : ''}>
                      約 {estimated.toLocaleString()}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
