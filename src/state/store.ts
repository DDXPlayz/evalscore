import { create } from "zustand";
import type { DocumentSignals, Evaluation, PortfolioType } from "@anantam/shared";
import type { ExtractedDocument } from "../engine/extract";
import { detectPortfolioType, scanSignals } from "../engine/signals";
import { extractPdf } from "../engine/extract";
import { runEvaluation, type EvaluationProgress } from "../engine/evaluate";
import { loadHistory, removeFromHistory, saveToHistory } from "../engine/history";
import { archiveEvaluation } from "../engine/archive";

export type Phase =
  | "landing"
  | "extracting"
  | "confirm"
  | "evaluating"
  | "results"
  | "error";

interface AppState {
  phase: Phase;
  fileName: string;
  doc: ExtractedDocument | null;
  detectedType: PortfolioType | null;
  chosenType: PortfolioType | null;
  signals: DocumentSignals | null;
  extractProgress: { done: number; total: number };
  evalProgress: EvaluationProgress | null;
  evaluation: Evaluation | null;
  /** Thumbnails of the evaluated document (kept for evidence navigation). */
  thumbnails: string[];
  error: string | null;
  history: Evaluation[];
  compare: Evaluation | null;

  ingest: (file: File) => Promise<void>;
  choosePortfolioType: (type: PortfolioType) => void;
  startEvaluation: () => Promise<void>;
  openHistory: (evaluation: Evaluation) => void;
  setCompare: (evaluation: Evaluation | null) => void;
  deleteHistory: (id: string) => void;
  reset: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  phase: "landing",
  fileName: "",
  doc: null,
  detectedType: null,
  chosenType: null,
  signals: null,
  extractProgress: { done: 0, total: 1 },
  evalProgress: null,
  evaluation: null,
  thumbnails: [],
  error: null,
  history: loadHistory(),
  compare: null,

  ingest: async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      set({ phase: "error", error: "EvalScore evaluates PDF portfolios — please upload a .pdf file." });
      return;
    }
    set({
      phase: "extracting",
      fileName: file.name,
      error: null,
      evaluation: null,
      compare: null,
      extractProgress: { done: 0, total: 1 },
    });
    try {
      const doc = await extractPdf(file, (done, total) =>
        set({ extractProgress: { done, total } }),
      );
      if (doc.wordCount < 40) {
        set({
          phase: "error",
          error:
            "Very little text could be extracted from this PDF — it may be a scanned/flattened document. EvalScore needs a digitally exported portfolio.",
        });
        return;
      }
      const { type } = detectPortfolioType(doc.pages);
      set({
        doc,
        thumbnails: doc.thumbnails,
        detectedType: type,
        chosenType: type,
        phase: "confirm",
      });
    } catch (err) {
      console.error(err);
      set({ phase: "error", error: "Could not read this PDF — the file may be corrupted or encrypted." });
    }
  },

  choosePortfolioType: (type) => set({ chosenType: type }),

  startEvaluation: async () => {
    const { doc, chosenType, fileName } = get();
    if (!doc || !chosenType) return;
    const signals = scanSignals(doc, chosenType);
    set({ phase: "evaluating", signals, evalProgress: null });
    try {
      const evaluation = await runEvaluation(doc, fileName, chosenType, signals, (p) =>
        set({ evalProgress: p }),
      );
      const history = saveToHistory(evaluation);
      set({ phase: "results", evaluation, history });
      // Internal archival only — best-effort, never blocks or affects the user.
      archiveEvaluation(evaluation);
    } catch (err) {
      console.error(err);
      set({
        phase: "error",
        error: err instanceof Error ? err.message : "Evaluation failed unexpectedly.",
      });
    }
  },

  openHistory: (evaluation) => {
    set({
      phase: "results",
      evaluation,
      fileName: evaluation.fileName,
      // Historical evaluations don't retain page renders.
      thumbnails: [],
      doc: null,
      compare: null,
    });
  },

  setCompare: (evaluation) => set({ compare: evaluation }),

  deleteHistory: (id) => set({ history: removeFromHistory(id) }),

  reset: () =>
    set({
      phase: "landing",
      fileName: "",
      doc: null,
      detectedType: null,
      chosenType: null,
      signals: null,
      evalProgress: null,
      evaluation: null,
      thumbnails: [],
      error: null,
      compare: null,
    }),
}));
