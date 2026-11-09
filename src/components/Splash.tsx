"use client";

import { useEffect, useState } from "react";

const WORD_A = "tesotter";
const WORD_B = "route";

function Letters({ text, offset }: { text: string; offset: number }) {
  return (
    <>
      {[...text].map((ch, i) => (
        <span key={i} className="splash-letter" style={{ ["--i" as string]: i + offset }}>
          {ch}
        </span>
      ))}
    </>
  );
}

/** Nyitóanimáció: "tesotter routeR". Kattintásra / billentyűre átugorható. */
export default function Splash() {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("in");

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t1 = setTimeout(() => setPhase("out"), reduce ? 2600 : 3300);
    const t2 = setTimeout(() => setPhase("gone"), reduce ? 3200 : 3900);
    const skip = () => setPhase((p) => (p === "in" ? "out" : p));
    window.addEventListener("keydown", skip);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("keydown", skip);
    };
  }, []);

  useEffect(() => {
    if (phase !== "out") return;
    const t = setTimeout(() => setPhase("gone"), 600);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div
      className="splash"
      data-phase={phase}
      role="presentation"
      onClick={() => setPhase((p) => (p === "in" ? "out" : p))}
      aria-hidden={phase === "out"}
    >
      <div className="splash-grid" />
      <div className="splash-glow" />

      <div className="splash-center">
        <svg className="splash-mark" viewBox="0 0 64 64" fill="none" aria-hidden>
          <defs>
            <linearGradient id="sg" x1="0" y1="0" x2="64" y2="64">
              <stop stopColor="#fbbf24" />
              <stop offset="1" stopColor="#f97316" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="60" height="60" rx="16" fill="#0f1f3d" stroke="url(#sg)" strokeWidth="2" />
          <path className="splash-path" d="M14 44c8-2 8-16 17-16s9 12 19 8" stroke="url(#sg)" strokeWidth="4" strokeLinecap="round" />
          <circle cx="14" cy="44" r="4.5" fill="#34d399" />
          <circle cx="50" cy="36" r="4.5" fill="#f43f5e" />
        </svg>

        <h1 className="splash-word" aria-label="tesotter routeR">
          <span className="splash-a"><Letters text={WORD_A} offset={0} /></span>
          <span className="splash-b">
            <Letters text={WORD_B} offset={WORD_A.length} />
            <span className="splash-letter splash-R" style={{ ["--i" as string]: WORD_A.length + WORD_B.length }}>R</span>
          </span>
        </h1>

        <p className="splash-tag">Kamion útvonal · útdíj · fuvarköltség</p>

        <div className="splash-bar" aria-hidden><i /></div>
      </div>

      <div className="splash-road" aria-hidden>
        <svg className="splash-truck" viewBox="0 0 120 56" fill="none">
          <rect x="2" y="8" width="68" height="30" rx="4" fill="#1e3a6e" stroke="#60a5fa" strokeWidth="1.5" />
          <path d="M70 18h22l14 12v8H70V18z" fill="#2563eb" stroke="#93c5fd" strokeWidth="1.5" />
          <path d="M76 22h14l8 8H76v-8z" fill="#bfdbfe" />
          <circle className="splash-wheel" cx="22" cy="42" r="8" fill="#0b1426" stroke="#e2e8f0" strokeWidth="2.5" />
          <circle className="splash-wheel" cx="46" cy="42" r="8" fill="#0b1426" stroke="#e2e8f0" strokeWidth="2.5" />
          <circle className="splash-wheel" cx="92" cy="42" r="8" fill="#0b1426" stroke="#e2e8f0" strokeWidth="2.5" />
          <path d="M2 24h60" stroke="#f59e0b" strokeWidth="2" strokeDasharray="6 5" />
        </svg>
        <div className="splash-lane" />
      </div>

      <button className="splash-skip" onClick={(e) => { e.stopPropagation(); setPhase("out"); }}>
        Kihagyás →
      </button>
    </div>
  );
}
