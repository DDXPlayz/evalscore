import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { PORTFOLIOS } from "@anantam/shared";
import { exportJson, exportMarkdown } from "../engine/history";
import { useStore } from "../state/store";
import { CriterionCard } from "./CriterionCard";
import { PageViewer } from "./PageViewer";
import { ScoreRing } from "./ScoreRing";

export function Results({ onOpenHistory }: { onOpenHistory: () => void }) {
  const evaluation = useStore((s) => s.evaluation);
  const compare = useStore((s) => s.compare);
  const setCompare = useStore((s) => s.setCompare);
  const thumbnails = useStore((s) => s.thumbnails);
  const reset = useStore((s) => s.reset);
  const [query, setQuery] = useState("");
  const [viewPage, setViewPage] = useState<number | null>(null);

  const spec = evaluation ? PORTFOLIOS[evaluation.portfolioType] : null;

  const filtered = useMemo(() => {
    if (!evaluation || !spec) return [];
    const q = query.trim().toLowerCase();
    return evaluation.results.filter((r) => {
      if (!q) return true;
      const c = spec.criteria.find((c) => c.id === r.criterionId);
      const haystack = [
        c?.name,
        r.reasoning,
        r.band,
        ...r.strengths,
        ...r.weaknesses,
        ...r.missingEvidence,
        ...r.improvements,
        ...r.evidenceFound.map((e) => e.quote),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [evaluation, spec, query]);

  if (!evaluation || !spec) return null;

  const pct = Math.round((evaluation.totalScore / evaluation.totalMax) * 100);
  const totalTokens = evaluation.usage.inputTokens + evaluation.usage.cacheReadTokens + evaluation.usage.cacheWriteTokens;
  const cacheShare = totalTokens > 0 ? Math.round((evaluation.usage.cacheReadTokens / totalTokens) * 100) : 0;
  const canJump = thumbnails.length > 0;

  return (
    <div className="results">
      <motion.header
        className="results-header"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="score-hero">
          <ScoreRing score={evaluation.totalScore} max={evaluation.totalMax} />
        </div>
        <div className="meta">
          <span className="chip">
            <span className="dot" />
            {spec.title}
          </span>
          <h1>{evaluation.fileName}</h1>
          <p className="sub">
            Scored {evaluation.totalScore} of {evaluation.totalMax} marks ({pct}%) across{" "}
            {evaluation.results.length} official criteria ·{" "}
            {new Date(evaluation.createdAt).toLocaleString()}
          </p>
          <div className="actions">
            <button className="btn-ghost" onClick={() => exportMarkdown(evaluation)}>
              Export report
            </button>
            <button className="btn-ghost" onClick={() => exportJson(evaluation)}>
              Export JSON
            </button>
            <button className="btn-ghost" onClick={onOpenHistory}>
              History &amp; compare
            </button>
            <button className="btn-primary" onClick={reset}>
              New evaluation
            </button>
          </div>
        </div>
      </motion.header>

      {compare && (
        <motion.div
          className="compare-banner"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          Comparing against <b>{compare.fileName}</b>
          <span className="mono" style={{ color: "var(--text-faint)" }}>
            ({compare.totalScore}/{compare.totalMax} · {new Date(compare.createdAt).toLocaleDateString()})
          </span>
          <span className={`delta ${evaluation.totalScore > compare.totalScore ? "up" : evaluation.totalScore < compare.totalScore ? "down" : "flat"}`}>
            {evaluation.totalScore > compare.totalScore ? "▲" : evaluation.totalScore < compare.totalScore ? "▼" : "＝"}{" "}
            {evaluation.totalScore - compare.totalScore >= 0 ? "+" : ""}
            {evaluation.totalScore - compare.totalScore} marks overall
          </span>
          <button className="btn-ghost" onClick={() => setCompare(null)}>
            Stop comparing
          </button>
        </motion.div>
      )}

      <motion.div
        className="usage-strip"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.8 }}
      >
        <span>
          Pipeline efficiency — <b>{totalTokens.toLocaleString()}</b> input tokens
        </span>
        <span>
          <b>{evaluation.usage.outputTokens.toLocaleString()}</b> output
        </span>
        <span className="save">
          {cacheShare}% served from context cache
        </span>
        <span>
          deterministic scan: <b>0 tokens</b>
        </span>
      </motion.div>

      <div className="criteria-toolbar">
        <input
          type="search"
          placeholder="Search criteria, evidence, improvements…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search criteria"
        />
        <span style={{ color: "var(--text-faint)", fontSize: 12, fontFamily: "var(--mono)" }}>
          {filtered.length}/{evaluation.results.length} criteria
        </span>
      </div>

      <div className="criteria-grid">
        {filtered.map((r, i) => {
          const criterion = spec.criteria.find((c) => c.id === r.criterionId);
          if (!criterion) return null;
          return (
            <CriterionCard
              key={r.criterionId}
              criterion={criterion}
              result={r}
              compareResult={compare?.results.find((c) => c.criterionId === r.criterionId)}
              index={i}
              canJump={canJump}
              onJumpToPage={setViewPage}
            />
          );
        })}
      </div>

      <PageViewer
        page={viewPage}
        thumbnails={thumbnails}
        onNavigate={setViewPage}
        onClose={() => setViewPage(null)}
      />
    </div>
  );
}
