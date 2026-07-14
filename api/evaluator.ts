/* ── AI evaluation engine (Gemini) ──────────────────────────────────
 *
 * Model tiering strategy:
 *
 *   PRIMARY   = gemini-2.5-flash  — fast, cost-effective, excellent for
 *               structured JSON extraction and scoring against well-defined
 *               rubrics. Handles the bulk of criterion-group evaluations.
 *
 *   FALLBACK  = gemini-3-pro-preview — deeper reasoning, used automatically
 *               when the primary model fails (rate limits, overload, transient
 *               errors). Also available as an explicit upgrade for complex
 *               evaluation tasks.
 *
 * Prompt architecture:
 *
 *   systemInstruction = judge persona + full official rubric for the portfolio
 *                       type. Stable per portfolio type.
 *   contents[0]       = the cleaned, page-tagged document + deterministic scan
 *                       results. Stable per document.
 *   contents[1+]      = (visual group only) a handful of downscaled page renders.
 *   contents[n]       = the per-call instruction naming which criteria to score.
 *
 * Structured output via responseSchema guarantees parseable JSON.
 * Automatic retry with fallback model on transient failures.
 */

import { GoogleGenAI, Type } from "@google/genai";
import { env } from "./env";
import { getCriterion, getPortfolio } from "@anantam/shared";
import type {
  CriterionResult,
  EvaluateGroupRequest,
  EvaluateGroupResponse,
} from "@anantam/shared";

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

/* ── Structured output schema (Gemini format) ── */

const RESULT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    results: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          criterionId: { type: Type.STRING },
          score: { type: Type.INTEGER },
          band: { type: Type.STRING },
          confidence: { type: Type.STRING, enum: ["high", "medium", "low"] },
          reasoning: { type: Type.STRING },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
          evidenceFound: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                quote: { type: Type.STRING },
                page: { type: Type.INTEGER },
              },
              required: ["quote", "page"],
            },
          },
          missingEvidence: { type: Type.ARRAY, items: { type: Type.STRING } },
          improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          "criterionId",
          "score",
          "band",
          "confidence",
          "reasoning",
          "strengths",
          "weaknesses",
          "evidenceFound",
          "missingEvidence",
          "improvements",
        ],
      },
    },
  },
  required: ["results"],
};

/* ── Prompt construction ── */

function buildSystemPrompt(portfolioType: EvaluateGroupRequest["portfolioType"]): string {
  const spec = getPortfolio(portfolioType);
  const rubric = spec.criteria
    .map((c) => {
      const bands = c.bands
        .map((b) => `    ${b.min}-${b.max} (${b.label}): ${b.description}`)
        .join("\n");
      return [
        `## ${c.name} [id: ${c.id}] — max ${c.maxMarks} marks`,
        `  Assessment focus: ${c.focus.join("; ")}`,
        `  Expected evidence: ${c.expectedEvidence.join("; ")}`,
        `  Score bands:\n${bands}`,
      ].join("\n");
    })
    .join("\n\n");

  return `You are an official STEM Racing competition judge with deep experience in engineering education, evaluating a team's ${spec.title} against the official 2026 judging scorecard.

# Portfolio specification
- Total available marks: ${spec.totalMarks}
- Page limit: ${spec.pageLimit} pages (${spec.pageLimitNote})

# Official scorecard
${rubric}

# Judging standards
- Score strictly against the band descriptions. A score in a band means the portfolio demonstrably meets that band's description; pick the exact mark within the band based on how fully it is met.
- Reward evidence, not claims. "We tested extensively" without method or data is a claim; a table of run times is evidence.
- Every judgment must cite actual portfolio content: quote short verbatim fragments (under 15 words) with their page numbers in evidenceFound.
- The deterministic scan results were computed programmatically and are trustworthy signals of terminology presence and page relevance — use them to locate content quickly, but judge quality yourself from the text.
- Text was extracted automatically from a designed A3 document, so reading order may be imperfect and figures appear only as captions or fragments. Do not penalise layout artefacts of extraction; judge presentation criteria from the page images when provided.
- List missing evidence concretely (what the scorecard expects that you could not find), and give specific, actionable improvements a student team could apply.
- Set confidence to "low" when your score depends on visual content you cannot see, "medium" when text evidence is partial, "high" when text evidence is decisive.
- Be fair but rigorous: the top band is for genuinely excellent work.`;
}

function buildDocumentBlock(req: EvaluateGroupRequest): string {
  const pages = req.pages
    .map((p) => `<page ${p.page}>\n${p.text || "(no extractable text on this page)"}\n</page ${p.page}>`)
    .join("\n\n");

  const signalLines = req.signals.criteria
    .map((c) => {
      const hits = c.hits
        .filter((h) => h.count > 0)
        .map((h) => `${h.term}×${h.count}(p${h.pages.join(",")})`)
        .join(" ");
      return `- ${c.criterionId}: relevant pages [${c.relevantPages.join(", ")}] ${hits ? `| terms: ${hits}` : "| no terminology matches"}`;
    })
    .join("\n");

  return `# Portfolio document (extracted text, page-tagged)

${pages}

# Deterministic scan results (computed programmatically)
- Pages: ${req.signals.pageCount} (${req.signals.withinPageLimit ? "within" : "EXCEEDS"} the official page limit)
- Embedded images: ${req.signals.imageCount} total; per page: [${req.signals.imagesPerPage.join(", ")}]
- Word count: ${req.signals.wordCount}

Per-criterion terminology scan:
${signalLines}`;
}

function buildInstruction(req: EvaluateGroupRequest): string {
  const names = req.criterionIds
    .map((id) => {
      const c = getCriterion(req.portfolioType, id);
      return c ? `- ${c.name} [id: ${c.id}] — max ${c.maxMarks}` : `- ${id}`;
    })
    .join("\n");

  const visualNote = req.pageImages?.length
    ? `\nPage renders are attached for pages [${req.pageImages.map((i) => i.page).join(", ")}] — use them to judge visual presentation, layout quality, consistency, and branding.`
    : "";

  return `Evaluate ONLY the following criteria in this call, one result object per criterion, in order:
${names}
${visualNote}
Return the evaluation as structured JSON.`;
}

/* ── Retry logic with model fallback ── */

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 6000]; // ms

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("rate limit") ||
      msg.includes("429") ||
      msg.includes("503") ||
      msg.includes("500") ||
      msg.includes("overloaded") ||
      msg.includes("temporarily") ||
      msg.includes("resource exhausted") ||
      msg.includes("quota") ||
      msg.includes("capacity")
    );
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ── Evaluation ── */

export async function evaluateGroup(
  req: EvaluateGroupRequest,
): Promise<EvaluateGroupResponse> {
  // Build content parts for Gemini
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  // Document text
  parts.push({ text: buildDocumentBlock(req) });

  // Page images (for visual criteria)
  for (const img of req.pageImages ?? []) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(img.dataUrl);
    if (!match) continue;
    parts.push({ text: `Render of page ${img.page}:` });
    parts.push({
      inlineData: {
        mimeType: match[1],
        data: match[2],
      },
    });
  }

  // Evaluation instruction
  parts.push({ text: buildInstruction(req) });

  const systemInstruction = buildSystemPrompt(req.portfolioType);

  // Try primary model, then fallback model on retryable errors
  const models = [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL];
  let lastError: Error | null = null;

  for (const model of models) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(
          `  ⤷ Evaluating [${req.criterionIds.join(", ")}] with ${model} (attempt ${attempt + 1})`,
        );

        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction,
            maxOutputTokens: 32000,
            responseMimeType: "application/json",
            responseSchema: RESULT_SCHEMA,
            thinkingConfig: { thinkingBudget: 8000 },
          },
        });

        const text = response.text;
        if (!text) {
          throw new EvaluationError(502, "Model returned no evaluation content.");
        }

        // Check for blocked content
        const candidate = response.candidates?.[0];
        if (candidate?.finishReason === "SAFETY") {
          throw new EvaluationError(422, "The model declined to evaluate this document due to safety filters.");
        }
        if (candidate?.finishReason === "MAX_TOKENS") {
          throw new EvaluationError(502, "Evaluation output was truncated — please retry.");
        }

        const parsed = JSON.parse(text) as { results: CriterionResult[] };

        // Clamp scores into the official range and keep only requested criteria.
        const results = parsed.results
          .filter((r) => req.criterionIds.includes(r.criterionId))
          .map((r) => {
            const criterion = getCriterion(req.portfolioType, r.criterionId);
            const max = criterion?.maxMarks ?? 20;
            return { ...r, score: Math.max(0, Math.min(max, Math.round(r.score))) };
          });

        // Extract token usage from Gemini's metadata
        const usage = {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          cacheReadTokens: response.usageMetadata?.cachedContentTokenCount ?? 0,
          cacheWriteTokens: 0,
        };

        console.log(
          `  ✓ ${req.criterionIds.join(", ")} scored (${model}, ${usage.inputTokens}+${usage.outputTokens} tokens)`,
        );

        return { results, usage };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (err instanceof EvaluationError) {
          throw err; // Don't retry explicit evaluation errors (422, safety, etc.)
        }

        if (isRetryableError(err) && attempt < MAX_RETRIES - 1) {
          const delay = RETRY_DELAYS[attempt] ?? 6000;
          console.warn(
            `  ⚠ ${model} attempt ${attempt + 1} failed (${lastError.message}), retrying in ${delay}ms...`,
          );
          await sleep(delay);
          continue;
        }

        // If all retries exhausted for this model, break to try fallback
        if (attempt === MAX_RETRIES - 1 && model !== models[models.length - 1]) {
          console.warn(
            `  ↻ ${model} exhausted retries, falling back to ${models[models.indexOf(model) + 1]}...`,
          );
        }
        break;
      }
    }
  }

  // If we get here, both models failed
  throw new EvaluationError(
    502,
    `Evaluation failed after retries on all models: ${lastError?.message ?? "unknown error"}`,
  );
}

export class EvaluationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
