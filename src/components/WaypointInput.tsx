"use client";

import { useEffect, useRef, useState } from "react";
import type { Waypoint } from "@/lib/types";
import { Ico } from "./ui";

interface Result { label: string; lat: number; lon: number }

interface Props {
  badge: string;
  badgeClass: string;
  placeholder: string;
  value: Waypoint | null;
  picking: boolean;
  onChange: (w: Waypoint | null) => void;
  onPickToggle: () => void;
  onRemove?: () => void;
}

export default function WaypointInput({ badge, badgeClass, placeholder, value, picking, onChange, onPickToggle, onRemove }: Props) {
  const [text, setText] = useState(value?.label ?? "");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); ctrl.current?.abort(); }, []);

  const search = (q: string) => {
    setText(q);
    if (value) onChange(null);
    if (timer.current) clearTimeout(timer.current);
    ctrl.current?.abort();
    if (q.trim().length < 2) { setResults([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      ctrl.current = new AbortController();
      setBusy(true);
      try {
        const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: ctrl.current.signal });
        const j = await r.json();
        setResults(j.results ?? []);
        setOpen(true);
      } catch { /* megszakítva */ }
      finally { setBusy(false); }
    }, 350);
  };

  return (
    <div className="relative flex items-center gap-2">
      <span className={`relative z-[1] flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ring-4 ring-white dark:ring-slate-900 ${badgeClass}`}>{badge}</span>
      <div className="relative min-w-0 flex-1">
        <input
          value={text}
          onChange={(e) => search(e.target.value)}
          onFocus={() => results.length && !value && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className={`field w-full pr-8 ${value ? "!border-emerald-500/50 !bg-emerald-50/50 dark:!bg-emerald-950/20" : ""}`}
        />
        {busy && <span className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />}
        {open && results.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setText(r.label);
                    setOpen(false);
                    onChange({ lat: r.lat, lon: r.lon, label: r.label });
                  }}
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        title="Pont kijelölése a térképen"
        onClick={onPickToggle}
        className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border transition ${picking ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-800"}`}
      >
        <Ico name="crosshair" className="h-4 w-4" />
      </button>
      {onRemove && (
        <button type="button" title="Útpont törlése" onClick={onRemove} className="flex h-[34px] w-6 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-rose-600"><Ico name="x" className="h-4 w-4" /></button>
      )}
    </div>
  );
}
