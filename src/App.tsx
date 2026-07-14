import { useState } from "react";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { Landing } from "./components/Landing";
import { Processing } from "./components/Processing";
import { Results } from "./components/Results";
import { useStore } from "./state/store";
import { Navbar } from "@anantam/ui";

export default function App() {
  const phase = useStore((s) => s.phase);
  const error = useStore((s) => s.error);
  const evaluation = useStore((s) => s.evaluation);
  const reset = useStore((s) => s.reset);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="shell">
      <Navbar
        appTitle="EvalScore"
        onHomeClick={(e) => {
          e.preventDefault();
          reset();
        }}
        rightElement={
          <button className="btn-ghost" onClick={() => setHistoryOpen(true)}>
            History
          </button>
        }
      />

      {phase === "landing" && <Landing />}
      {(phase === "extracting" || phase === "confirm" || phase === "evaluating") && <Processing />}
      {phase === "results" && <Results onOpenHistory={() => setHistoryOpen(true)} />}

      {phase === "error" && (
        <div className="error-screen">
          <div className="sigil">!</div>
          <h2>That didn't go to plan</h2>
          <p>{error}</p>
          <button className="btn-primary" onClick={reset}>
            Back to start
          </button>
        </div>
      )}

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        compareBaseId={phase === "results" ? evaluation?.id : undefined}
      />
    </div>
  );
}
