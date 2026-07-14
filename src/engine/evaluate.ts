/* ── Evaluation orchestration ──────────────────────────────────────
 *
 * Splits the scorecard into criterion groups, runs the first group alone to
 * warm the server-side prompt cache (system rubric + document), then fires
 * the remaining groups in parallel so they read the document from cache.
 * Page renders are attached only to the group containing visual criteria.
 */

import { criterionGroups, PORTFOLIOS } from "@anantam/shared";
import type {
  CriterionResult,
  DocumentSignals,
  EvaluateGroupRequest,
  EvaluateGroupResponse,
  Evaluation,
  PortfolioType,
  TokenUsage,
} from "@anantam/shared";
import type { ExtractedDocument } from "./extract";
import { pickVisualPages } from "./signals";

export interface EvaluationProgress {
  stage: "preparing" | "evaluating" | "done";
  groupsTotal: number;
  groupsDone: number;
  currentCriteria: string[];
}

async function callGroup(req: EvaluateGroupRequest): Promise<EvaluateGroupResponse> {
  const res = await fetch("/api/evaluate-group", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Evaluation failed (HTTP ${res.status}).`);
  }
  return (await res.json()) as EvaluateGroupResponse;
}

export async function runEvaluation(
  doc: ExtractedDocument,
  fileName: string,
  portfolioType: PortfolioType,
  signals: DocumentSignals,
  onProgress: (p: EvaluationProgress) => void,
): Promise<Evaluation> {
  const spec = PORTFOLIOS[portfolioType];
  const groups = criterionGroups(portfolioType);

  onProgress({
    stage: "preparing",
    groupsTotal: groups.length,
    groupsDone: 0,
    currentCriteria: groups[0],
  });

  // Render the handful of pages that inform visual criteria (cover + most
  // image-dense pages), downscaled hard: visual judgment doesn't need 300dpi.
  const visualGroup = groups[groups.length - 1];
  const hasVisual = spec.criteria.some((c) => c.visual);
  let pageImages: { page: number; dataUrl: string }[] | undefined;
  if (hasVisual) {
    const pageNums = pickVisualPages(doc);
    pageImages = await Promise.all(
      pageNums.map(async (page) => ({
        page,
        dataUrl: await doc.renderPage(page, 1000, 0.7),
      })),
    );
  }

  const baseRequest = {
    portfolioType,
    pages: doc.pages,
    signals,
  };

  const results: CriterionResult[] = [];
  const usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  let done = 0;

  const mergeResponse = (res: EvaluateGroupResponse) => {
    results.push(...res.results);
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    usage.cacheReadTokens += res.usage.cacheReadTokens;
    usage.cacheWriteTokens += res.usage.cacheWriteTokens;
    done++;
    onProgress({
      stage: "evaluating",
      groupsTotal: groups.length,
      groupsDone: done,
      currentCriteria: groups[Math.min(done, groups.length - 1)] ?? [],
    });
  };

  const requestFor = (group: string[]): EvaluateGroupRequest => ({
    ...baseRequest,
    criterionIds: group,
    pageImages: hasVisual && group === visualGroup ? pageImages : undefined,
  });

  onProgress({
    stage: "evaluating",
    groupsTotal: groups.length,
    groupsDone: 0,
    currentCriteria: groups[0],
  });

  // First call warms the cache; the rest read from it in parallel.
  mergeResponse(await callGroup(requestFor(groups[0])));
  const rest = groups.slice(1);
  const responses = await Promise.all(rest.map((g) => callGroup(requestFor(g))));
  responses.forEach(mergeResponse);

  // Preserve official scorecard order.
  const order = new Map(spec.criteria.map((c, i) => [c.id, i]));
  results.sort((a, b) => (order.get(a.criterionId) ?? 99) - (order.get(b.criterionId) ?? 99));

  const totalScore = results.reduce((sum, r) => sum + r.score, 0);

  onProgress({
    stage: "done",
    groupsTotal: groups.length,
    groupsDone: groups.length,
    currentCriteria: [],
  });

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    fileName,
    portfolioType,
    portfolioTitle: spec.title,
    totalScore,
    totalMax: spec.totalMarks,
    results,
    signals,
    usage,
  };
}
