import type { ReportCitation, ReportSegment } from '../types/research';

/**
 * 関連リンク（調査結果の「さらに読む」と「次にできること」）の共通設定
 * どの会話・どのキーワードの調査でも、同じ決まりでリンクを選ぶ
 */
export const RELATED_LINK_RULES = {
  /** キーワードごとに表示する最大件数 */
  maxLinks: 3,
  /** 2件目以降に表示するページが、根拠に使われた最小の回数（1件目は回数によらず表示する） */
  minCitationsForExtra: 2,
  /** 公式サイト（② でキーワードごとに選んだサイト）のページがあれば、公式だけを表示する */
  officialOnlyWhenAvailable: true,
  /** 同じ組織（サブドメインを含む）のページは1件だけ表示する */
  onePerOrganization: true,
};

export type RelatedLinkRules = typeof RELATED_LINK_RULES;

/** 2段のトップレベルドメイン（例: co.jp）。組織を取り出すときに、その1つ上までを組織とする */
const SECOND_LEVEL_DOMAINS = new Set([
  'co.jp',
  'ne.jp',
  'or.jp',
  'ac.jp',
  'go.jp',
  'ed.jp',
  'gr.jp',
  'lg.jp',
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.kr',
  'com.cn',
  'com.tw',
  'co.nz',
  'com.br',
  'co.in',
]);

/**
 * URL から組織（登録されたドメイン）を取り出す
 * 例: docs.anthropic.com → anthropic.com、www.oreilly.co.jp → oreilly.co.jp
 */
export function organizationOf(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
  const parts = host.replace(/^www\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  return SECOND_LEVEL_DOMAINS.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

/** 関連リンクと、そのページを根拠に使った回数 */
export interface RelatedLink {
  citation: ReportCitation;
  count: number;
}

/**
 * 論点の解説が根拠に使った Web ページから、関連リンクを選ぶ
 * 公式サイトのページを優先し、根拠に使った回数の多い順に、同じ組織は1件ずつ、最大件数まで選ぶ
 */
export function selectRelatedLinks(
  segments: ReportSegment[],
  rules: RelatedLinkRules = RELATED_LINK_RULES,
): RelatedLink[] {
  const byUrl = new Map<string, RelatedLink>();
  for (const segment of segments) {
    for (const citation of segment.citations) {
      if (citation.sourceKind !== 'web') continue;
      const link = byUrl.get(citation.sourceId);
      if (link) link.count++;
      else byUrl.set(citation.sourceId, { citation, count: 1 });
    }
  }
  let pages = Array.from(byUrl.values());
  if (rules.officialOnlyWhenAvailable && pages.some((p) => p.citation.official)) {
    pages = pages.filter((p) => p.citation.official);
  }
  // 回数が同じなら、解説で先に引用したページを先にする（sort は安定）
  pages.sort((a, b) => b.count - a.count);
  const organizations = new Set<string>();
  const picked: RelatedLink[] = [];
  for (const page of pages) {
    if (picked.length >= rules.maxLinks) break;
    if (picked.length > 0 && page.count < rules.minCitationsForExtra) continue;
    const organization = organizationOf(page.citation.sourceId);
    if (rules.onePerOrganization && organizations.has(organization)) continue;
    organizations.add(organization);
    picked.push(page);
  }
  return picked;
}
