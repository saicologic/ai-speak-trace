import type { ResearchJob, ResearchResume } from '../types/research';

/** 再開ボタンの文言（どの段階から再開するか、もう一度かかる処理がわかるようにする） */
export function resumeLabel(resume: ResearchResume): string {
  switch (resume.from) {
    case 'proposing':
      return '②キーワードの提案から再開';
    case 'researching':
      return resume.retryKeywords?.length
        ? `失敗した${resume.retryKeywords.length}個のキーワードを調べ直して再開`
        : '③Web調査から再開';
    case 'analyzing':
      return '④統合分析から再開';
    case 'evaluating':
      return '⑤最終確認から再開';
  }
}

/** 終わっている段階（再開したときに、そのまま使うもの） */
export function finishedStages(job: ResearchJob): string[] {
  const stages: string[] = [];
  if (job.proposal) stages.push('キーワードの提案');
  if (job.webSources) {
    const failed = job.resume?.retryKeywords?.length ?? 0;
    stages.push(
      `Web調査（情報源${job.webSources.length}件${failed > 0 ? `・${failed}個のキーワードは未完了` : ''}）`,
    );
  }
  if (job.report) stages.push('統合分析');
  return stages;
}
