import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env } from './env';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.json({
    ok: true,
    model: env.GEMINI_MODEL,
    fallbackModel: env.GEMINI_FALLBACK_MODEL,
  });
}
