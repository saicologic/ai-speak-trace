import { useEffect, useState } from 'react';
import { fetchJob } from '../api/client';
import type { TranscriptionJob } from '../types';
import './JobProgressPage.css';

/** ポーリング間隔（ミリ秒） */
const POLL_INTERVAL_MS = 3000;

interface JobProgressPageProps {
  jobId: string;
  onBack: () => void;
  onViewResult: (transcriptionId: string) => void;
  onRetry: (audioFileName: string) => void;
}

/** ジョブ進捗画面 */
export function JobProgressPage({
  jobId,
  onBack,
  onViewResult,
  onRetry,
}: JobProgressPageProps) {
  const [job, setJob] = useState<TranscriptionJob | null>(null);

  // ジョブステータスをポーリング
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const result = await fetchJob(jobId);
        if (!cancelled) {
          setJob(result);
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
  }, [jobId]);

  return (
    <div className="job-progress-page">
      <header className="job-progress-header">
        <button className="job-progress-back-button" onClick={onBack}>
          戻る
        </button>
        <h1>ジョブ進捗</h1>
      </header>

      <div className="job-progress-content">
        <div className="job-progress-card">
          {!job ? (
            <>
              <div className="job-progress-spinner" />
              <div className="job-progress-status">読み込み中...</div>
            </>
          ) : (
            <>
              <div className="job-progress-filename">{job.audioFileName}</div>

              {job.status === 'processing' && (
                <>
                  <div className="job-progress-spinner" />
                  <div className="job-progress-status">文字起こし処理中...</div>
                </>
              )}

              {job.status === 'completed' && (
                <>
                  <div className="job-progress-completed">
                    文字起こしが完了しました
                  </div>
                  <div className="job-progress-actions">
                    <button
                      className="job-progress-action-button job-progress-action-button--primary"
                      onClick={() =>
                        job.transcriptionId &&
                        onViewResult(job.transcriptionId)
                      }
                    >
                      結果を確認する
                    </button>
                    <button
                      className="job-progress-action-button job-progress-action-button--secondary"
                      onClick={onBack}
                    >
                      メイン画面に戻る
                    </button>
                  </div>
                </>
              )}

              {job.status === 'failed' && (
                <>
                  <div className="job-progress-error">
                    {job.errorMessage || '文字起こしに失敗しました'}
                  </div>
                  <div className="job-progress-actions">
                    <button
                      className="job-progress-action-button job-progress-action-button--primary"
                      onClick={() => onRetry(job.audioFileName)}
                    >
                      再試行する
                    </button>
                    <button
                      className="job-progress-action-button job-progress-action-button--secondary"
                      onClick={onBack}
                    >
                      メイン画面に戻る
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
