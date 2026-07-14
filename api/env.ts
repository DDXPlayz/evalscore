import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  GEMINI_API_KEY: z
    .string()
    .min(10, "GEMINI_API_KEY looks invalid — copy .env.example to .env and set your key"),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_FALLBACK_MODEL: z.string().default("gemini-3-pro-preview"),
  PORT: z.coerce.number().int().positive().default(8787),
  NODE_ENV: z.string().default("development"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("\n✖ EvalScore server configuration error:\n");
  for (const issue of parsed.error.issues) {
    console.error(`  • ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("\n  Copy .env.example to .env and fill in the values.\n");
  process.exit(1);
}

export const env = parsed.data;
