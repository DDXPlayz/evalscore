import { motion } from "framer-motion";
import { PORTFOLIOS } from "@anantam/shared";
import type { PortfolioType } from "@anantam/shared";
import { useStore } from "../state/store";

const TYPES: PortfolioType[] = ["engineering", "project-management", "enterprise"];

export function Processing() {
  const phase = useStore((s) => s.phase);
  const fileName = useStore((s) => s.fileName);
  const extractProgress = useStore((s) => s.extractProgress);
  const evalProgress = useStore((s) => s.evalProgress);
  const doc = useStore((s) => s.doc);
  const detectedType = useStore((s) => s.detectedType);
  const chosenType = useStore((s) => s.chosenType);
  const choose = useStore((s) => s.choosePortfolioType);
  const start = useStore((s) => s.startEvaluation);

  return (
    <div className="process-screen">
      <motion.div
        className="process-card glass"
        initial={{ opacity: 0, y: 30, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className="file">{fileName}</span>

        {phase === "extracting" && (
          <>
            <h2>Reading your portfolio…</h2>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${(extractProgress.done / Math.max(1, extractProgress.total)) * 100}%`,
                }}
              />
            </div>
            <div className="stage-list">
              <div className="stage active">
                <span className="marker" />
                Extracting text, figures &amp; structure
                <span className="detail">
                  page {extractProgress.done}/{extractProgress.total}
                </span>
              </div>
              <div className="stage">
                <span className="marker" />
                Deterministic terminology scan
              </div>
              <div className="stage">
                <span className="marker" />
                AI evaluation against the official scorecard
              </div>
            </div>
          </>
        )}

        {phase === "confirm" && doc && chosenType && (
          <>
            <h2>Portfolio identified</h2>
            <div className="doc-stats">
              <div className="stat">
                <b className={doc.pageCount > PORTFOLIOS[chosenType].pageLimit ? "warn" : ""}>
                  {doc.pageCount}
                </b>
                <span>pages</span>
              </div>
              <div className="stat">
                <b>{doc.wordCount.toLocaleString()}</b>
                <span>words</span>
              </div>
              <div className="stat">
                <b>{doc.imageCount}</b>
                <span>figures</span>
              </div>
            </div>
            <div className="type-picker">
              {TYPES.map((t) => {
                const spec = PORTFOLIOS[t];
                return (
                  <button
                    key={t}
                    className={`type-option${chosenType === t ? " selected" : ""}`}
                    onClick={() => choose(t)}
                  >
                    <span className="radio" />
                    <span>
                      <div className="t-name">{spec.title}</div>
                      <div className="t-meta">
                        {spec.totalMarks} marks · {spec.criteria.length} criteria · ≤{spec.pageLimit} pages
                      </div>
                    </span>
                    {detectedType === t && <span className="detected">detected</span>}
                  </button>
                );
              })}
            </div>
            <button className="btn-primary" onClick={() => void start()}>
              Begin evaluation
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M5 12h14m-6-6 6 6-6 6" />
              </svg>
            </button>
          </>
        )}

        {phase === "evaluating" && chosenType && (
          <>
            <h2>Judging in progress…</h2>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${evalProgress ? Math.max(6, (evalProgress.groupsDone / evalProgress.groupsTotal) * 100) : 6}%`,
                }}
              />
            </div>
            <div className="stage-list">
              <div className="stage done">
                <span className="marker">✓</span>
                Extraction &amp; deterministic scan complete
              </div>
              <div className={`stage ${evalProgress?.stage === "done" ? "done" : "active"}`}>
                <span className="marker">{evalProgress?.stage === "done" ? "✓" : ""}</span>
                Scoring against the official scorecard
                <span className="detail">
                  {evalProgress
                    ? `${evalProgress.groupsDone}/${evalProgress.groupsTotal} criterion groups`
                    : "warming context cache"}
                </span>
              </div>
              <div className={`stage ${evalProgress?.stage === "done" ? "active" : ""}`}>
                <span className="marker" />
                Assembling your verdict
              </div>
            </div>
            <p style={{ color: "var(--text-faint)", fontSize: 13, lineHeight: 1.6 }}>
              The first pass reads your full portfolio and caches it — every following
              criterion group reuses that context at a fraction of the cost. Typically
              under two minutes.
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
