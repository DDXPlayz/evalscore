# EvalScore

EvalScore — part of the **Anantam Engineering Platform** (alongside AeroVision and Tech Verify). AI-powered STEM Racing portfolio evaluation against the official 2026 judging scorecards: upload a Design & Engineering, Project Management, or Enterprise portfolio PDF and receive a transparent, criterion-by-criterion score breakdown with cited evidence.

## Run

```bash
npm install
cp .env.example .env        # add your ANTHROPIC_API_KEY
npm run dev                 # web on :5173, API on :8787
```

Production:

```bash
npm run build
npm start                   # serves the built client + API on :8787
```

## Architecture

```
shared/
  rubric.ts          Official scorecards as data (3 portfolios, 25 criteria,
                     bands, expected evidence, terminology signals)
  types.ts           Contracts shared by client and server
server/
  env.ts             Zod-validated environment (key never reaches the client)
  evaluator.ts       Claude evaluation engine: cached rubric + cached document,
                     grouped criterion calls, structured JSON output
  index.ts           Express API + production static serving
src/
  engine/
    extract.ts       In-browser PDF ingestion (pdf.js): per-page text,
                     header/footer stripping, image census, page renders
    signals.ts       Deterministic scan: portfolio-type detection, terminology
                     hits, per-criterion page relevance — zero tokens
    evaluate.ts      Orchestration: warm cache with group 1, parallel rest
    history.ts       Local evaluation history + Markdown/JSON export
  scene/HeroScene.ts Scroll-choreographed three.js hero (scatter → judging
                     grid → analysis scan → score columns)
  components/        Landing, Processing, Results, CriterionCard, ...
  state/store.ts     Zustand app state machine
```

### Evaluation pipeline (accuracy ↑, tokens ↓)

1. **Extract locally.** The PDF never leaves the browser as a file. pdf.js pulls
   page-tagged text, strips repeated header/footer noise, counts embedded
   figures, and renders thumbnails.
2. **Scan deterministically.** Portfolio type detection, page-limit compliance,
   and per-criterion terminology/relevance mapping are computed in JS and shipped
   to the model as compact pre-verified signals — the model never re-derives them.
3. **Evaluate in cached groups.** The system prompt (official rubric) and the
   document block carry prompt-cache breakpoints. The first criterion group pays
   for the document once; the remaining groups run in parallel and read it from
   cache at ~10% of the input price.
4. **See only what matters.** Page renders (downscaled JPEGs) are attached only
   to the group containing visual criteria (Document Presentation, Team Identity).
5. **Structured verdicts.** Responses are schema-constrained JSON: score, band,
   confidence, reasoning, cited evidence with page numbers, missing evidence,
   and concrete improvements. Scores are clamped server-side to official ranges.

Token usage (including cache share) is reported on every result page.

### Principles

- **Transparent** — every mark maps to an official band, with quoted evidence
  you can click to open the exact page.
- **Deterministic first** — anything verifiable without AI is verified without AI.
- **Secrets stay server-side** — the Anthropic key lives in `.env`, validated at
  boot, and is never exposed to the client.
- **Rubrics are data** — new seasons drop into `shared/rubric.ts` without
  touching the pipeline.
