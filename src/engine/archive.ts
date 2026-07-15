/* ── Best-effort, fire-and-forget archival (client side) ────────────
 *
 * Sends a bundle (metadata + full results) of a completed evaluation to the
 * internal Google Drive archive via POST /api/archive. Purely
 * administrative: never awaited by any render path, swallows every error,
 * and shows nothing to the user. If it fails for any reason — offline,
 * server down, Drive misconfigured — the app is completely unaffected.
 */

import type { Evaluation } from "@anantam/shared";

export function archiveEvaluation(evaluation: Evaluation): void {
  try {
    const base = (evaluation.fileName || "portfolio").replace(/\.[^.]+$/, "");

    const meta = {
      fileName: evaluation.fileName,
      portfolioType: evaluation.portfolioType,
      totalScore: evaluation.totalScore,
      criteria: evaluation.results?.length ?? 0,
      source: "EvalScore web app",
    };

    const body = {
      tool: "EvalScore",
      uploadId: evaluation.id, // stable UUID from the evaluation
      timestamp: evaluation.createdAt, // already an ISO 8601 string
      meta,
      files: [
        {
          name: "analysis.json",
          mimeType: "application/json",
          content: safeJson(evaluation),
        },
        {
          name: `${base}.metadata.json`,
          mimeType: "application/json",
          content: safeJson(meta),
        },
      ],
    };

    // Not awaited. `keepalive` lets it complete even if the user navigates away.
    void fetch("/api/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      /* best-effort archival — ignore all failures */
    });
  } catch {
    /* archival must never throw into the app */
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}
