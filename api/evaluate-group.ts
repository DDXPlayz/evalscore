import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { evaluateGroup, EvaluationError } from './evaluator';
import { PORTFOLIOS } from '@anantam/shared';
import type { EvaluateGroupRequest } from '@anantam/shared';

const EvaluateSchema = z.object({
  portfolioType: z.enum(["engineering", "project-management", "enterprise"]),
  criterionIds: z.array(z.string()).min(1).max(6),
  pages: z
    .array(z.object({ page: z.number().int().positive(), text: z.string() }))
    .min(1)
    .max(40),
  signals: z.object({
    pageCount: z.number(),
    withinPageLimit: z.boolean(),
    imageCount: z.number(),
    imagesPerPage: z.array(z.number()),
    wordCount: z.number(),
    criteria: z.array(
      z.object({
        criterionId: z.string(),
        hits: z.array(
          z.object({
            term: z.string(),
            count: z.number(),
            pages: z.array(z.number()),
          }),
        ),
        relevantPages: z.array(z.number()),
      }),
    ),
  }),
  pageImages: z
    .array(z.object({ page: z.number(), dataUrl: z.string().max(2_000_000) }))
    .max(6)
    .optional(),
});

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '40mb',
    },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const parsed = EvaluateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid evaluation request." });
    return;
  }

  // Reject criterion ids that don't belong to the portfolio type.
  const spec = PORTFOLIOS[parsed.data.portfolioType];
  const known = new Set(spec.criteria.map((c) => c.id));
  if (!parsed.data.criterionIds.every((id) => known.has(id))) {
    res.status(400).json({ error: "Unknown criterion for this portfolio type." });
    return;
  }

  try {
    const result = await evaluateGroup(parsed.data as EvaluateGroupRequest);
    res.json(result);
  } catch (err) {
    if (err instanceof EvaluationError) {
      res.status(err.status).json({ error: err.message });
    } else if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes("api key") || msg.includes("authentication") || msg.includes("401")) {
        res.status(500).json({ error: "Server API key is invalid — check GEMINI_API_KEY." });
      } else if (msg.includes("rate limit") || msg.includes("429") || msg.includes("resource exhausted")) {
        res.status(429).json({ error: "Rate limited by the AI provider — wait a moment and retry." });
      } else if (msg.includes("fetch") || msg.includes("econnrefused") || msg.includes("network")) {
        res.status(502).json({ error: "Could not reach the AI provider — check connectivity." });
      } else {
        console.error("Gemini API error:", err.message);
        res.status(502).json({ error: "AI provider error — please retry." });
      }
    } else {
      console.error("Evaluation failed:", err);
      res.status(500).json({ error: "Evaluation failed unexpectedly." });
    }
  }
}
