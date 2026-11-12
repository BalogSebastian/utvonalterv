"use client";

import { useEffect, useMemo, useState } from "react";
import { CARGO_LABEL } from "@/lib/crossings";
import { appleUrl, decodeTrip, driverGeometry, googleLinks, gpxFor, wazeUrl, type DriverTrip } from "@/lib/navlinks";
import { COUNTRY_NAMES } from "@/lib/country-names";
import { dt, dur, flag } from "@/lib/format";

const KIND: Record<string, string> = { break: "☕ 45 perc szünet", rest: "🌙 Napi pihenő", wait: "⏳ Várakozás (tilalom)", ferry: "⛴ Komp / vasút" };
const CARGO_ICON: Record<string, string> = { load: "⬆", unload: "⬇", both: "⇅", none: "•" };

/** Sofőr-oldal: mobilra, nagy gombokkal; a navigáció egy koppintással indul. */
export default function DriverView() {
  // a komponens csak a böngészőben fut (ssr: false), ezért a hash az első rendereléskor olvasható
  const [hash] = useState(() => window.location.hash.match(/#d=(.+)$/)?.[1] ?? "");
  const key = `tesotter-driver-${hash.slice(-24)}`;
  const [trip, setTrip] = useState<DriverTrip | null>(null);
  const [err, setErr] = useState(hash ? "" : "Hiányzó útvonal – kérd újra a linket a diszpécsertől.");
  const [done, setDone] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
  });

  useEffect(() => {
    if (!hash) return;
    decodeTrip(hash).then(setTrip).catch(() => setErr("A link sérült vagy hiányos – kérd újra a diszpécsertől."));
  }, [hash]);

  const links = useMemo(() => (trip ? googleLinks(trip.p) : []), [trip]);
  const stops = trip?.p.filter((p) => p.stop) ?? [];

  const toggleDone = (i: number) => {
    const next = done.includes(i) ? done.filter((x) => x !== i) : [...done, i];
    setDone(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* privát mód */ }
  };

  const gpx = async () => {
    if (!trip) return;
    const text = gpxFor(trip.t, trip.p, driverGeometry(trip));
    const file = new File([text], "utvonal.gpx", { type: "application/gpx+xml" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: trip.t }); return; } catch { /* megszakítva */ }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = "utvonal.gpx";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (err) return <div className="flex h-dvh items-center justify-center p-6 text-center text-slate-600">{err}</div>;
  if (!trip) return <div className="flex h-dvh items-center justify-center text-slate-500">Betöltés…</div>;

  const next = links.findIndex((_, i) => !done.includes(i));

  return (
    <div className="min-h-dvh bg-slate-50 pb-10 dark:bg-slate-950">
      <header className="brand-bar px-4 py-4 text-white">
        <div className="text-[11px] uppercase tracking-wider text-blue-200/80">tesotter routeR · sofőr</div>
        <h1 className="mt-1 text-xl font-bold leading-tight">{trip.t}</h1>
        <div className="mt-1.5 text-sm text-blue-100">
          {trip.km.toLocaleString("hu-HU")} km · {dur(trip.driveMin)} vezetés
        </div>
        <div className="mt-0.5 text-sm text-blue-100">Indulás {dt(trip.dep)} · érkezés ~{dt(trip.arr)}</div>
      </header>

      <main className="mx-auto max-w-xl space-y-4 px-4 pt-4">
        {trip.w.length > 0 && (
          <section className="space-y-1.5 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            {trip.w.map((w, i) => <div key={i}>{w}</div>)}
          </section>
        )}

        <section className="space-y-2">
          {links.map((l, i) => (
            <div key={l.url} className={`flex items-stretch gap-2 ${done.includes(i) ? "opacity-50" : ""}`}>
              <a href={l.url} className={`flex flex-1 items-center gap-3 rounded-2xl px-4 py-4 text-white shadow-lg ${i === next ? "bg-blue-600 shadow-blue-600/30" : "bg-slate-600"}`}>
                <span className="text-2xl">▶</span>
                <span className="min-w-0">
                  <span className="block text-base font-bold">Navigáció indítása{links.length > 1 ? ` · ${l.label}` : ""}</span>
                  <span className="block truncate text-xs text-white/80">Google Maps · {l.from} → {l.to}</span>
                </span>
              </a>
              {links.length > 1 && (
                <button onClick={() => toggleDone(i)} className="w-16 shrink-0 rounded-2xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  {done.includes(i) ? "↺" : "✓ kész"}
                </button>
              )}
            </div>
          ))}
          {links.length > 1 && <p className="px-1 text-xs text-slate-500">A szakaszokat sorban nyisd meg: ha elérted egy szakasz célját, jelöld késznek, és indítsd a következőt.</p>}
          <button onClick={gpx} className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left dark:border-slate-700 dark:bg-slate-900">
            <span className="text-xl">🧭</span>
            <span>
              <span className="block text-sm font-semibold">Pontos kamionos nyomvonal (OsmAnd)</span>
              <span className="block text-xs text-slate-500">GPX → OsmAnd: „Navigáció a nyomvonal mentén”</span>
            </span>
          </button>
        </section>

        <section>
          <h2 className="h3">Megállók</h2>
          <ul className="space-y-2">
            {stops.map((p, i) => (
              <li key={i} className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex items-start gap-2.5">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${i === 0 ? "bg-emerald-500" : i === stops.length - 1 ? "bg-rose-500" : "bg-slate-500"}`}>
                    {i === 0 ? "A" : i === stops.length - 1 ? "B" : i}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold leading-tight">{p.label}</div>
                    {p.cargo && <div className="text-xs text-slate-500">{CARGO_ICON[p.cargo]} {CARGO_LABEL[p.cargo]}</div>}
                  </div>
                </div>
                <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-xs font-medium">
                  <a className="btn !py-2" href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=driving&dir_action=navigate`}>Google</a>
                  <a className="btn !py-2" href={wazeUrl(p)}>Waze</a>
                  <a className="btn !py-2" href={appleUrl(p)}>Apple</a>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 px-1 text-[11px] text-slate-500">A megállónkénti gombok csak a célt adják át (személyautós útvonal) – a kamionos útvonalhoz a fenti „Navigáció indítása” gombot használd.</p>
        </section>

        {trip.s.length > 0 && (
          <section>
            <h2 className="h3">Szünetek, pihenők (tervezett)</h2>
            <ul className="space-y-1 text-sm">
              {trip.s.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 dark:bg-slate-900">
                  <span className="min-w-0">
                    <span className="block">{KIND[s.k] ?? s.k}</span>
                    <span className="block truncate text-xs text-slate-500">{s.place ?? `${flag(s.country)} ${COUNTRY_NAMES[s.country] ?? s.country}`} · {s.km} km</span>
                  </span>
                  <span className="shrink-0 text-xs font-medium tabular-nums">{dt(s.time)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {trip.f.length > 0 && (
          <section>
            <h2 className="h3">Komp / vasút</h2>
            <ul className="space-y-1 text-sm">
              {trip.f.map((f, i) => <li key={i} className="rounded-lg bg-white px-3 py-2 dark:bg-slate-900">⛴ {f.name}: {f.from} → {f.to}</li>)}
            </ul>
          </section>
        )}

        <p className="px-1 text-[11px] leading-relaxed text-slate-500">
          A Google Maps / Waze személyautós útvonalat számol, a kamionos korlátozásokat (magasság, súly, tilalmak) nem ismeri: az irányító pontok a megtervezett útvonalon tartanak, de a táblákat mindig kövesd.
        </p>
      </main>
    </div>
  );
}
