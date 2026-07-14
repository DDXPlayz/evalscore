import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { HeroScene } from "../scene/HeroScene";
import { UploadZone } from "./UploadZone";

const reveal = {
  initial: { opacity: 0, y: 46 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: false, amount: 0.4 },
  transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] as const },
};

interface Chapter {
  index: string;
  title: string;
  body: string;
  facts?: { value: string; label: string }[];
  side: "left" | "right";
}

const CHAPTERS: Chapter[] = [
  {
    index: "01 — INGESTION",
    title: "Every page, understood.",
    body: "Your portfolio never leaves the browser as a file. EvalScore reads each A3 page locally — text, figures, structure — and separates the signal from the layout before a single token is spent.",
    facts: [
      { value: "0", label: "uploads stored" },
      { value: "<2s", label: "typical parse" },
      { value: "100%", label: "in-browser" },
    ],
    side: "left",
  },
  {
    index: "02 — THE SCORECARD",
    title: "The official judging matrix, encoded.",
    body: "All three STEM Racing scorecards — Design & Engineering, Project Management, Enterprise — live inside EvalScore as data. Every band, every mark, every expected piece of evidence. Your pages are mapped to the criteria they answer.",
    facts: [
      { value: "3", label: "portfolios" },
      { value: "25", label: "criteria" },
      { value: "450", label: "total marks" },
    ],
    side: "right",
  },
  {
    index: "03 — ANALYSIS",
    title: "A judge that reads everything. Twice.",
    body: "A deterministic engine scans for engineering terminology, iterations, schedules, and evidence — programmatically, verifiably. Then the AI judge scores each criterion against the official bands, citing the exact pages and passages that earned the marks.",
    facts: [
      { value: "2-stage", label: "pipeline" },
      { value: "cached", label: "context reuse" },
      { value: "cited", label: "every claim" },
    ],
    side: "left",
  },
  {
    index: "04 — THE VERDICT",
    title: "Marks assemble. Transparently.",
    body: "No black box. Every criterion returns its score, its band, the evidence found, the evidence missing, and exactly how to earn the next band. The way a real judge would explain it — if you could sit next to one.",
    side: "right",
  },
];

export function Landing() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const storyRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HeroScene | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new HeroScene(canvasRef.current);
    sceneRef.current = scene;

    const onScroll = () => {
      const el = storyRef.current;
      if (!el) return;
      const total = el.scrollHeight - window.innerHeight;
      scene.setProgress(total > 0 ? window.scrollY / total : 0);
    };
    const onPointer = (e: PointerEvent) => {
      scene.setPointer(
        (e.clientX / window.innerWidth) * 2 - 1,
        (e.clientY / window.innerHeight) * 2 - 1,
      );
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onPointer, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointer);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="hero-canvas" aria-hidden />
      <div className="story" ref={storyRef}>
        {/* ── Hero ── */}
        <section className="panel hero">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15 }}
          >
            <span className="chip">
              <span className="dot" />
              Anantam Engineering Platform
            </span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.0, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            Judge-grade portfolio <span className="accent">evaluation.</span>
          </motion.h1>
          <motion.p
            className="sub"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.55 }}
          >
            EvalScore reads your STEM Racing portfolio the way an official judge does —
            criterion by criterion, band by band, with every mark explained and every
            piece of evidence cited.
          </motion.p>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.9 }}
            className="scroll-cue"
          >
            <span>Scroll to see how</span>
            <span className="line" />
          </motion.div>
        </section>

        {/* ── Story chapters ── */}
        {CHAPTERS.map((ch) => (
          <section key={ch.index} className={`panel${ch.side === "right" ? " right" : ""}`}>
            <motion.div className="chapter glass" {...reveal}>
              <span className="index">{ch.index}</span>
              <h2>{ch.title}</h2>
              <p>{ch.body}</p>
              {ch.facts && (
                <div className="facts">
                  {ch.facts.map((f) => (
                    <div className="fact" key={f.label}>
                      <b>{f.value}</b>
                      <span>{f.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </section>
        ))}

        {/* ── Conclusion: the upload ── */}
        <section className="panel conclude">
          <motion.h2 {...reveal}>Now let a judge read yours.</motion.h2>
          <motion.p className="sub" {...reveal}>
            Drop in a Design &amp; Engineering, Project Management, or Enterprise
            portfolio. EvalScore detects which one it is.
          </motion.p>
          <motion.div {...reveal}>
            <UploadZone />
          </motion.div>
          <motion.div className="portfolio-badges" {...reveal}>
            <span className="pbadge"><b>Design &amp; Engineering</b> · 180 marks</span>
            <span className="pbadge"><b>Project Management</b> · 90 marks</span>
            <span className="pbadge"><b>Enterprise</b> · 180 marks</span>
          </motion.div>
        </section>

        <footer className="landing-footer">
          EvalScore · Anantam Engineering Platform · STEM Racing 2026 Scorecards
        </footer>
      </div>
    </>
  );
}
