/* ── POST /api/archive — best-effort internal archival endpoint ─────
 *
 * Any tool's frontend (EvalScore, AeroVision, Tech Verify) may POST a
 * bundle of result artifacts here AFTER they have already been shown to
 * the user. The call is fire-and-forget, so nothing the user sees depends
 * on it.
 *
 * The request is validated. Malformed requests are rejected gracefully
 * (logged, no upload attempted). The endpoint ALWAYS responds 200 and NEVER
 * exposes an internal error, a Drive error, or a server error. It cannot
 * block, crash, or break the calling application.
 *
 * Body:
 *   {
 *     tool: "EvalScore" | "AeroVision" | "Tech Verify",
 *     uploadId?: string,          // UUID; generated server-side if absent
 *     timestamp?: string,         // ISO 8601; generated server-side if absent
 *     meta?: object,              // merged into the server-authored metadata.json
 *     files?: [                   // artifacts, e.g. analysis.json / thumbnail.webp
 *       { name, mimeType?, content? | contentBase64? }
 *     ]
 *   }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { archiveBundle } from "./_archive";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "8mb",
    },
  },
};

const FileSchema = z
  .object({
    name: z.string().min(1).max(200),
    mimeType: z.string().max(150).optional(),
    content: z.string().max(6_000_000).optional(),
    contentBase64: z.string().max(6_000_000).optional(),
  })
  .refine((f) => f.content !== undefined || f.contentBase64 !== undefined, {
    message: "each file needs `content` or `contentBase64`",
  });

const BundleSchema = z.object({
  tool: z.enum(["EvalScore", "AeroVision", "Tech Verify"]),
  uploadId: z.string().max(80).optional(),
  timestamp: z.string().max(40).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  files: z.array(FileSchema).max(12).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      res.status(200).json({ ok: true, skipped: "method" });
      return;
    }

    const parsed = BundleSchema.safeParse(req.body);
    if (!parsed.success) {
      // Malformed request — reject gracefully. Never attempt an upload, never
      // expose validation details to the caller.
      console.warn(
        "[Google Drive Archive] Rejected malformed request:",
        parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", "),
      );
      res.status(200).json({ ok: false, reason: "invalid request" });
      return;
    }

    // Await with the module's internal timeouts. The client is not waiting on
    // us (fire-and-forget), so this never blocks the user's experience.
    await archiveBundle(parsed.data);
  } catch (err) {
    // The endpoint must never surface archival failures.
    console.warn(
      "[Google Drive Archive] endpoint swallowed error:",
      err instanceof Error ? err.message : err,
    );
  }

  // Invariant: always a clean success. Archival status is invisible to users.
  res.status(200).json({ ok: true });
}
