import { useEffect, useState } from 'react';
import { fetchJobs } from '../api/client';
import type { TranscriptionJob } from '../types';
import './ActiveJobList.css';

/** ポーリング間隔（ミリ秒） */
const POLL_INTERVAL_MS = 5000;

interface ActiveJobListProps {
  onJobClick: (jobId: string) => void;
}

/** サイドバーに表示するアクティブジョブ一覧 */
export function ActiveJobList({ onJobClick }: ActiveJobListProps) {
  const [activeJobs, setActiveJobs] = useState<TranscriptionJob[]>([]);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const jobs = await fetchJobs();
        if (!cancelled) {
          setActiveJobs(jobs.filter((j) => j.status === 'processing'));
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

  if (activeJobs.length === 0) return null;

  return (
    <div className="active-job-list">
      <div className="active-job-list-title">処理中</div>
      {activeJobs.map((job) => (
        <div
          key={job.id}
          className="active-job-item"
          onClick={() => onJobClick(job.id)}
        >
          <div className="active-job-spinner" />
          <span className="active-job-filename">{job.audioFileName}</span>
        </div>
      ))}
    </div>
  );
}
