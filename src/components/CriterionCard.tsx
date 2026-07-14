import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type { Criterion, CriterionResult } from "@anantam/shared";

export function CriterionCard({
  criterion,
  result,
  compareResult,
  index,
  canJump,
  onJumpToPage,
}: {
  criterion: Criterion;
  result: CriterionResult;
  compareResult?: CriterionResult;
  index: number;
  canJump: boolean;
  onJumpToPage: (page: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const pct = (result.score / criterion.maxMarks) * 100;
  const delta = compareResult ? result.score - compareResult.score : null;

  return (
    <motion.div
      className={`criterion-card glass${open ? " open" : ""}`}
      initial={{ opacity: 0, y: 26 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.12 + index * 0.07, ease: [0.22, 1, 0.36, 1] }}
    >
      <button className="criterion-head" onClick={() => setOpen(!open)}>
        <div className="info">
          <h3>{criterion.name}</h3>
          <div className="band-line">
            <span className={`band-tag ${result.band.split(/\s/)[0]}`}>{result.band}</span>
            <span className={`conf-dot ${result.confidence}`}>{result.confidence} confidence</span>
          </div>
        </div>
        <div className="score-cell">
          <div>
            <b>{result.score}</b>
            <span> / {criterion.maxMarks}</span>
            {delta !== null && (
              <span className={`delta ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}`}>
                {delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${delta}` : "＝"}
              </span>
            )}
          </div>
          <div className="score-bar">
            <motion.i
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 1.1, delay: 0.3 + index * 0.07, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        </div>
        <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div className="criterion-body">
              <p className="reasoning">{result.reasoning}</p>

              {result.evidenceFound.length > 0 && (
                <div className="detail-block">
                  <h4 style={{ color: "var(--text-dim)" }}>Evidence detected</h4>
                  <div className="evidence-list">
                    {result.evidenceFound.map((ev, i) => (
                      <button
                        key={i}
                        className={`evidence-item${canJump ? " clickable" : ""}`}
                        onClick={() => canJump && onJumpToPage(ev.page)}
                        disabled={!canJump}
                        title={canJump ? `Open page ${ev.page}` : undefined}
                      >
                        <q>{ev.quote}</q>
                        <span className="pg">p.{ev.page} {canJump ? "↗" : ""}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="detail-grid">
                {result.strengths.length > 0 && (
                  <div className="detail-block strengths">
                    <h4>Strengths</h4>
                    <ul>{result.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {result.weaknesses.length > 0 && (
                  <div className="detail-block weaknesses">
                    <h4>Weaknesses</h4>
                    <ul>{result.weaknesses.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {result.missingEvidence.length > 0 && (
                  <div className="detail-block missing">
                    <h4>Missing evidence</h4>
                    <ul>{result.missingEvidence.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {result.improvements.length > 0 && (
                  <div className="detail-block improve">
                    <h4>How to gain marks</h4>
                    <ul>{result.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
              </div>

              <div className="detail-block">
                <h4 style={{ color: "var(--text-faint)" }}>Official score bands</h4>
                <div className="rubric-bands">
                  {criterion.bands.map((b) => (
                    <div
                      key={b.label}
                      className={`rubric-band${result.score >= b.min && result.score <= b.max ? " active" : ""}`}
                    >
                      <span className="range">{b.min}–{b.max}</span>
                      <span>{b.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
