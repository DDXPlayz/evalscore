/* ── Shared contracts between client engine and evaluation server ── */

export type PortfolioType = "engineering" | "project-management" | "enterprise";

export interface ScoreBand {
  min: number;
  max: number;
  label: string;
  description: string;
}

export interface Criterion {
  id: string;
  name: string;
  maxMarks: number;
  /** What judges look at, straight from the official scorecard. */
  focus: string[];
  /** Evidence the scorecard expects to find. */
  expectedEvidence: string[];
  bands: ScoreBand[];
  /** Terminology whose presence is a deterministic signal for this criterion. */
  keywords: string[];
  /** Whether page images meaningfully inform this criterion (visual quality). */
  visual?: boolean;
}

export interface PortfolioSpec {
  type: PortfolioType;
  title: string;
  totalMarks: number;
  pageLimit: number;
  pageLimitNote: string;
  /** Keywords used to auto-detect which portfolio a PDF is. */
  detectKeywords: string[];
  criteria: Criterion[];
}

/* ── Deterministic scan (computed client-side, zero tokens) ── */

export interface KeywordHit {
  term: string;
  count: number;
  pages: number[];
}

export interface CriterionSignals {
  criterionId: string;
  hits: KeywordHit[];
  /** Pages ranked most relevant to this criterion (1-indexed). */
  relevantPages: number[];
}

export interface DocumentSignals {
  pageCount: number;
  withinPageLimit: boolean;
  imageCount: number;
  imagesPerPage: number[];
  wordCount: number;
  criteria: CriterionSignals[];
}

/* ── Evaluation request / response ── */

export interface PageText {
  page: number;
  text: string;
}

export interface EvaluateGroupRequest {
  portfolioType: PortfolioType;
  criterionIds: string[];
  pages: PageText[];
  signals: DocumentSignals;
  /** Downscaled page renders (dataURL JPEG), only for visual criteria groups. */
  pageImages?: { page: number; dataUrl: string }[];
}

export interface EvidenceRef {
  quote: string;
  page: number;
}

export interface CriterionResult {
  criterionId: string;
  score: number;
  band: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  strengths: string[];
  weaknesses: string[];
  evidenceFound: EvidenceRef[];
  missingEvidence: string[];
  improvements: string[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface EvaluateGroupResponse {
  results: CriterionResult[];
  usage: TokenUsage;
}

/* ── Completed evaluation (stored in history) ── */

export interface Evaluation {
  id: string;
  createdAt: string;
  fileName: string;
  portfolioType: PortfolioType;
  portfolioTitle: string;
  totalScore: number;
  totalMax: number;
  results: CriterionResult[];
  signals: DocumentSignals;
  usage: TokenUsage;
}
