/* ── Deterministic analysis — everything we can verify without AI ──
 *
 * Portfolio-type detection, per-criterion terminology scanning, and
 * relevance ranking of pages. All of this ships to the model as compact,
 * pre-verified signals so it never has to re-derive them from raw text.
 */

import { PORTFOLIOS } from "@anantam/shared";
import type {
  CriterionSignals,
  DocumentSignals,
  KeywordHit,
  PageText,
  PortfolioType,
} from "@anantam/shared";
import type { ExtractedDocument } from "./extract";

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

/** Detect which official portfolio this document is, by keyword density. */
export function detectPortfolioType(pages: PageText[]): {
  type: PortfolioType;
  scores: Record<PortfolioType, number>;
} {
  const text = pages.map((p) => p.text).join("\n").toLowerCase();
  const scores = {} as Record<PortfolioType, number>;
  for (const spec of Object.values(PORTFOLIOS)) {
    scores[spec.type] = spec.detectKeywords.reduce(
      (sum, kw) => sum + Math.min(countOccurrences(text, kw.toLowerCase()), 8),
      0,
    );
  }
  const best = (Object.entries(scores) as [PortfolioType, number][]).sort(
    (a, b) => b[1] - a[1],
  )[0][0];
  return { type: best, scores };
}

export function scanSignals(
  doc: ExtractedDocument,
  type: PortfolioType,
): DocumentSignals {
  const spec = PORTFOLIOS[type];
  const lowerPages = doc.pages.map((p) => p.text.toLowerCase());

  const criteria: CriterionSignals[] = spec.criteria.map((criterion) => {
    const hits: KeywordHit[] = [];
    const pageScores = new Array<number>(doc.pageCount).fill(0);

    for (const term of criterion.keywords) {
      const needle = term.toLowerCase();
      const pagesWith: number[] = [];
      let total = 0;
      lowerPages.forEach((text, i) => {
        const n = countOccurrences(text, needle);
        if (n > 0) {
          pagesWith.push(i + 1);
          total += n;
          pageScores[i] += Math.min(n, 5);
        }
      });
      if (total > 0) hits.push({ term, count: total, pages: pagesWith });
    }

    const relevantPages = pageScores
      .map((score, i) => ({ page: i + 1, score }))
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((p) => p.page)
      .sort((a, b) => a - b);

    return { criterionId: criterion.id, hits, relevantPages };
  });

  return {
    pageCount: doc.pageCount,
    withinPageLimit: doc.pageCount <= spec.pageLimit,
    imageCount: doc.imageCount,
    imagesPerPage: doc.imagesPerPage,
    wordCount: doc.wordCount,
    criteria,
  };
}

/** Pick the pages whose renders best inform visual criteria: cover, plus the
 *  most image-dense interior pages. */
export function pickVisualPages(doc: ExtractedDocument, max = 4): number[] {
  const picks = new Set<number>([1]);
  const ranked = doc.imagesPerPage
    .map((n, i) => ({ page: i + 1, n }))
    .filter((p) => p.page !== 1)
    .sort((a, b) => b.n - a.n);
  for (const { page } of ranked) {
    if (picks.size >= max) break;
    picks.add(page);
  }
  // Fallback: spread across the document if there were no image-dense pages.
  let cursor = Math.ceil(doc.pageCount / 2);
  while (picks.size < Math.min(max, doc.pageCount)) {
    picks.add(cursor);
    cursor = cursor < doc.pageCount ? cursor + 1 : 2;
  }
  return [...picks].sort((a, b) => a - b);
}
