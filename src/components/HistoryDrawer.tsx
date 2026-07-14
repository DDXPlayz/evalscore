import { AnimatePresence, motion } from "framer-motion";
import { PORTFOLIOS } from "@anantam/shared";
import type { Evaluation } from "@anantam/shared";
import { useStore } from "../state/store";

export function HistoryDrawer({
  open,
  onClose,
  compareBaseId,
}: {
  open: boolean;
  onClose: () => void;
  /** When set, "Compare" pins the current evaluation and compares against a pick. */
  compareBaseId?: string;
}) {
  const history = useStore((s) => s.history);
  const openHistory = useStore((s) => s.openHistory);
  const setCompare = useStore((s) => s.setCompare);
  const deleteHistory = useStore((s) => s.deleteHistory);

  const pick = (e: Evaluation, mode: "open" | "compare") => {
    if (mode === "open") openHistory(e);
    else setCompare(e);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="history-drawer"
          initial={{ x: "104%" }}
          animate={{ x: 0 }}
          exit={{ x: "104%" }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3>Evaluation history</h3>
            <button className="icon-btn" onClick={onClose} aria-label="Close history">
              ✕
            </button>
          </div>
          {history.length === 0 && (
            <p className="empty">
              No evaluations yet. Your results are saved locally on this device —
              nothing is sent anywhere but the judge.
            </p>
          )}
          {history.map((e) => {
            const spec = PORTFOLIOS[e.portfolioType];
            const sameType = compareBaseId
              ? history.find((h) => h.id === compareBaseId)?.portfolioType === e.portfolioType
              : false;
            return (
              <div className="history-item" key={e.id}>
                <div className="row1">
                  <span className="fname">{e.fileName}</span>
                  <span className="hscore">
                    {e.totalScore}/{e.totalMax}
                  </span>
                </div>
                <div className="row2">
                  <span>{spec.title}</span>
                  <span>·</span>
                  <span>{new Date(e.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="hactions">
                  <button onClick={() => pick(e, "open")}>Open</button>
                  {compareBaseId && e.id !== compareBaseId && sameType && (
                    <button onClick={() => pick(e, "compare")}>Compare</button>
                  )}
                  <button className="danger" onClick={() => deleteHistory(e.id)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
