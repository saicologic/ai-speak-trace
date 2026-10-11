import { normalize } from '../research/research.utils';
import { Utterance } from '../transcription/types/transcription.types';
import { SummaryOutput } from '../claude/summary.service';
import { SummaryEvidence, SummaryKeyPoint } from './types/interview.types';

/**
 * 要約の要点ごとに Claude が挙げた根拠の引用のうち、実際の発言に含まれるものだけを残す
 * （言い換えや作り話の引用を、根拠として表示しないため。空白・全角半角の違いは無視する）
 * 発言は、Claude に送ったものと同じ（伏せ字に置き換えた）文字起こしの発言を渡す
 */
export function verifySummaryEvidence(
  keyPoints: SummaryOutput['key_points'],
  utterances: Utterance[],
): { keyPoints: SummaryKeyPoint[] | undefined; dropped: number } {
  if (!keyPoints) return { keyPoints: undefined, dropped: 0 };
  const normalized = utterances.map((u) => normalize(u.text));
  let dropped = 0;
  const verified = keyPoints.map(({ topic, summary, evidence }) => {
    if (!Array.isArray(evidence)) return { topic, summary };
    const found: SummaryEvidence[] = [];
    for (const quote of evidence) {
      const target = typeof quote === 'string' ? normalize(quote) : '';
      const index = target
        ? normalized.findIndex((t) => t.includes(target))
        : -1;
      if (index < 0) {
        dropped++;
        continue;
      }
      if (found.some((f) => f.quote === quote)) continue;
      found.push({
        quote,
        utteranceIndex: index,
        speakerName: utterances[index].speakerName,
        start: utterances[index].start,
      });
    }
    return { topic, summary, evidence: found };
  });
  return { keyPoints: verified, dropped };
}
