"use client";

import { useEffect, useState } from "react";

const WORD_A = "tesotter";
const WORD_B = "route";
const IN_MS = 7000; // ennyi ideig tart a bevezető
const OUT_MS = 950; // íriszzárás

/** Világító útvonalak (viewBox 1600x900) */
const ROUTES = [
  "M110 720 C 380 520, 520 780, 820 570 S 1190 300, 1500 210",
  "M190 210 C 470 300, 560 110, 870 330 S 1190 580, 1470 650",
  "M70 430 C 380 380, 520 540, 770 450 S 1110 720, 1520 470",
  "M310 880 C 520 650, 770 700, 990 520 S 1250 170, 1390 90",
  "M0 600 C 300 640, 600 420, 900 640 S 1300 760, 1600 560",
];
/** Csomópontok (városok) */
const NODES: [number, number, number][] = [
  [110, 720, 0.6], [820, 570, 1.5], [1500, 210, 2.6],
  [190, 210, 0.9], [870, 330, 1.8], [1470, 650, 2.8],
  [70, 430, 1.1], [770, 450, 2.0], [1520, 470, 3.0],
  [310, 880, 1.3], [990, 520, 2.3], [1390, 90, 3.1],
];

/** Determinisztikus "véletlen" (SSR/hydration biztos) */
const frac = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
// 2 tizedesre kerekítve: a szerver és a kliens azonos stringet rendereljen (hydration-biztos)
const r2 = (n: number) => Math.round(n * 100) / 100;
const STARS = Array.from({ length: 90 }, (_, i) => ({
  left: r2(frac(i + 1) * 100),
  top: r2(frac(i + 91) * 100),
  size: 1 + Math.floor(frac(i + 181) * 3),
  delay: r2(frac(i + 271) * 4),
  dur: r2(2 + frac(i + 361) * 3),
}));

const STATUS = [
  { at: 0, text: "Térképadatok betöltése…" },
  { at: 24, text: "Útdíj-tarifák betöltése…" },
  { at: 48, text: "Alagút- és szakaszdíjak…" },
  { at: 68, text: "Kamionos tiltások és korlátok…" },
  { at: 86, text: "Útvonaltervező indítása…" },
  { at: 98, text: "Készen áll!" },
];
const CHIPS = ["Útvonal", "Útdíj", "Tiltások", "Menetrend", "Alagútdíjak", "Fuvarköltség"];

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

/** Filmszerű nyitóanimáció: "tesotter routeR". Kattintásra / billentyűre átugorható. */
export default function Splash() {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("in");
  const [pct, setPct] = useState(0);
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const r = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduce(r);
    const total = r ? 3200 : IN_MS;
    const t = setTimeout(() => setPhase((p) => (p === "in" ? "out" : p)), total);
    const skip = () => setPhase((p) => (p === "in" ? "out" : p));
    window.addEventListener("keydown", skip);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const x = Math.min(1, (now - start) / (total - 500));
      // lassú indulás, gyors közép, finom befejezés
      const eased = x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
      setPct(Math.round(eased * 100));
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", skip);
    };
  }, []);

  useEffect(() => {
    if (phase !== "out") return;
    const t = setTimeout(() => setPhase("gone"), OUT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "gone") return null;

  const status = [...STATUS].reverse().find((s) => pct >= s.at)!.text;

  return (
    <div
      className="splash"
      data-phase={phase}
      data-reduce={reduce || undefined}
      role="presentation"
      onClick={() => setPhase((p) => (p === "in" ? "out" : p))}
      aria-hidden={phase === "out"}
    >
      {/* háttér */}
      <div className="splash-grid" />
      <div className="splash-glow" />
      <div className="splash-glow splash-glow-2" />
      <div className="splash-stars" aria-hidden>
        {STARS.map((s, i) => (
          <i key={i} style={{ left: `${s.left}%`, top: `${s.top}%`, width: `${s.size}px`, height: `${s.size}px`, animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }} />
        ))}
      </div>

      {/* világító útvonalhálózat */}
      <svg className="splash-net" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <defs>
          <linearGradient id="rg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1600" y2="0">
            <stop offset="0" stopColor="#38bdf8" />
            <stop offset="0.55" stopColor="#818cf8" />
            <stop offset="1" stopColor="#fbbf24" />
          </linearGradient>
        </defs>
        {ROUTES.map((d, i) => (
          <g key={i} style={{ ["--d" as string]: `${0.25 + i * 0.28}s` }}>
            <path className="net-glow" d={d} stroke="url(#rg)" />
            <path className="net-line" d={d} stroke="url(#rg)" />
            <path className="net-pulse" d={d} stroke="#ffffff" />
          </g>
        ))}
        {NODES.map(([x, y, t], i) => (
          <g key={i} className="net-node" style={{ ["--t" as string]: `${t}s` }} transform={`translate(${x} ${y})`}>
            <circle className="net-ring" r="10" />
            <circle className="net-halo" r="11" />
            <circle className="net-dot" r="5" />
          </g>
        ))}
      </svg>

      {/* közép */}
      <div className="splash-center">
        <div className="splash-markwrap">
          <span className="splash-wave" />
          <span className="splash-wave w2" />
          <span className="splash-wave w3" />
          <svg className="splash-mark" viewBox="0 0 64 64" fill="none" aria-hidden>
            <defs>
              <linearGradient id="sg" x1="0" y1="0" x2="64" y2="64">
                <stop stopColor="#fbbf24" />
                <stop offset="1" stopColor="#f97316" />
              </linearGradient>
            </defs>
            <rect x="2" y="2" width="60" height="60" rx="16" fill="#0f1f3d" stroke="url(#sg)" strokeWidth="2" />
            <path className="splash-path" d="M14 44c8-2 8-16 17-16s9 12 19 8" stroke="url(#sg)" strokeWidth="4" strokeLinecap="round" />
            <circle className="splash-dot s" cx="14" cy="44" r="4.5" fill="#34d399" />
            <circle className="splash-dot e" cx="50" cy="36" r="4.5" fill="#f43f5e" />
          </svg>
        </div>

        <h1 className="splash-word" aria-label="tesotter routeR">
          <span className="splash-a"><Letters text={WORD_A} offset={0} /></span>
          <span className="splash-b">
            <Letters text={WORD_B} offset={WORD_A.length} />
            <span className="splash-letter splash-R" style={{ ["--i" as string]: WORD_A.length + WORD_B.length }}>R</span>
          </span>
        </h1>

        <p className="splash-tag">
          {["Kamion", "útvonal", "·", "útdíj", "·", "fuvarköltség"].map((w, i) => (
            <span key={i} style={{ ["--w" as string]: i }}>{w}&nbsp;</span>
          ))}
        </p>

        <div className="splash-chips" aria-hidden>
          {CHIPS.map((c, i) => (
            <span key={c} style={{ ["--c" as string]: i }}>{c}</span>
          ))}
        </div>

        <div className="splash-load">
          <div className="splash-bar" aria-hidden><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
          <div className="splash-status">
            <span>{status}</span>
            <b>{pct}%</b>
          </div>
        </div>
      </div>

      {/* út + teherautó */}
      <div className="splash-road" aria-hidden>
        <div className="splash-truckwrap">
          <svg className="splash-truck" viewBox="-70 0 330 60" fill="none">
            <defs>
              <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
                <stop stopColor="#fde68a" stopOpacity="0.75" />
                <stop offset="1" stopColor="#fde68a" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* sebességcsíkok */}
            <g className="speed">
              <rect x="-68" y="14" width="46" height="2" rx="1" />
              <rect x="-52" y="26" width="38" height="2" rx="1" />
              <rect x="-64" y="38" width="50" height="2" rx="1" />
            </g>
            {/* fényszóró */}
            <path className="beam" d="M108 36 L260 14 L260 58 Z" fill="url(#beam)" />
            <rect x="2" y="8" width="68" height="30" rx="4" fill="#1e3a6e" stroke="#60a5fa" strokeWidth="1.5" />
            <path d="M2 24h60" stroke="#f59e0b" strokeWidth="2" strokeDasharray="6 5" />
            <path d="M70 18h22l14 12v8H70V18z" fill="#2563eb" stroke="#93c5fd" strokeWidth="1.5" />
            <path d="M76 22h14l8 8H76v-8z" fill="#bfdbfe" />
            <circle cx="104" cy="34" r="2.6" fill="#fef3c7" />
            <circle className="splash-wheel" cx="22" cy="42" r="8" fill="#0b1426" stroke="#e2e8f0" strokeWidth="2.5" />
            <circle className="splash-wheel" cx="46" cy="42" r="8" fill="#0b1426" stroke="#e2e8f0" strokeWidth="2.5" />
            <circle className="splash-wheel" cx="92" cy="42" r="8" fill="#0b1426" stroke="#e2e8f0" strokeWidth="2.5" />
          </svg>
        </div>
        <div className="splash-lane" />
      </div>

      <div className="splash-vignette" />
      <button className="splash-skip" onClick={(e) => { e.stopPropagation(); setPhase("out"); }}>
        Kihagyás →
      </button>
    </div>
  );
}
