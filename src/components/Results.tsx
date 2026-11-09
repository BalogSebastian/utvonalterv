"use client";

import { useState } from "react";
import { COUNTRY_NAMES } from "@/lib/country-names";
import { dt, dur, eur, eur2, flag, huf, km } from "@/lib/format";
import type { CostInputs, RouteResult } from "@/lib/types";

interface Props {
  routes: RouteResult[];
  selected: number;
  onSelect: (i: number) => void;
  costs: CostInputs;
  onAddStop: (kind: "break" | "rest") => void;
  onRemoveStop: (id: string) => void;
  onResetStops: () => void;
  edited: boolean;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function gpx(r: RouteResult) {
  const pts = r.geometry.map(([lo, la]) => `<trkpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Tesotter Kamion Tervező" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Kamion útvonal ${km(r.distanceKm)}</name><trkseg>${pts}</trkseg></trk></gpx>`;
}

function csv(r: RouteResult, c: CostInputs) {
  const rows = [
    ["Tétel", "EUR", "HUF"],
    ["Útdíj", r.tollTotalEur, r.tollTotalEur * c.eurHuf],
    ["Üzemanyag", r.fuelCostEur, r.fuelCostEur * c.eurHuf],
    ["Sofőr", r.driverCostEur, r.driverCostEur * c.eurHuf],
    ["Jármű (km-költség)", r.vehicleCostEur, r.vehicleCostEur * c.eurHuf],
    ["ÖSSZESEN", r.totalEur, r.totalEur * c.eurHuf],
    [],
    ["Ország", "Díjköteles km", "EUR/km", "Fix díj EUR", "Útdíj EUR"],
    ...r.tollBreakdown.map((t) => [COUNTRY_NAMES[t.country] ?? t.country, t.tollKm.toFixed(1), t.perKm.toFixed(3), t.fixed, t.total.toFixed(2)]),
  ];
  return rows.map((row) => row.join(";")).join("\n");
}

export default function Results({ routes, selected, onSelect, costs, onAddStop, onRemoveStop, onResetStops, edited }: Props) {
  const [showSteps, setShowSteps] = useState(false);
  const [margin, setMargin] = useState(15);
  const [roundTrip, setRoundTrip] = useState(false);
  const r = routes[selected];
  if (!r) return null;
  const cheapest = Math.min(...routes.map((x) => x.totalEur));
  const fastest = Math.min(...routes.map((x) => x.drivingMin));

  const parts = [
    { label: "Útdíj", v: r.tollTotalEur, color: "bg-amber-500" },
    { label: "Üzemanyag", v: r.fuelCostEur, color: "bg-sky-500" },
    { label: "Sofőr", v: r.driverCostEur, color: "bg-violet-500" },
    { label: "Jármű", v: r.vehicleCostEur, color: "bg-emerald-500" },
  ];

  return (
    <div className="space-y-4">
      {routes.length > 1 && (
        <div className="grid gap-2">
          {routes.map((x, i) => (
            <button
              key={i}
              onClick={() => onSelect(i)}
              className={`rounded-xl border p-3 text-left transition ${i === selected ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600 dark:bg-blue-950/40" : "border-slate-200 hover:border-slate-400 dark:border-slate-700"}`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold">
                  {i === 0 ? "Ajánlott" : `Alternatíva ${i}`}
                  {x.totalEur === cheapest && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">LEGOLCSÓBB</span>}
                  {x.drivingMin === fastest && <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">LEGGYORSABB</span>}
                </span>
                <span className="text-base font-bold">{eur(x.totalEur)}</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                {km(x.distanceKm)} · {dur(x.drivingMin)} vezetés · útdíj {eur(x.tollTotalEur)}
              </div>
            </button>
          ))}
        </div>
      )}

      <section className="rounded-xl bg-slate-900 p-4 text-white">
        <div className="text-xs uppercase tracking-wide text-slate-400">Teljes fuvarköltség</div>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="text-3xl font-bold">{eur(r.totalEur)}</span>
          <span className="text-sm text-slate-300">{huf(r.totalEur * costs.eurHuf)}</span>
        </div>
        <div className="mt-1 text-sm text-slate-300">
          {eur2(r.totalEur / Math.max(r.distanceKm, 1))} / km · {km(r.distanceKm)} · {dur(r.drivingMin)}
        </div>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-700">
          {parts.map((p) => (
            <div key={p.label} className={p.color} style={{ width: `${(p.v / r.totalEur) * 100}%` }} title={`${p.label}: ${eur(p.v)}`} />
          ))}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          {parts.map((p) => (
            <div key={p.label} className="flex items-center justify-between">
              <dt className="flex items-center gap-1.5 text-slate-300"><span className={`h-2 w-2 rounded-full ${p.color}`} />{p.label}</dt>
              <dd className="font-medium">{eur(p.v)}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-2 text-xs text-slate-400">Üzemanyag: {Math.round(r.fuelLiters)} liter</div>
      </section>

      <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <h3 className="mb-2 text-sm font-semibold">Ajánlati ár számítás</h3>
        {(() => {
          const base = r.totalEur * (roundTrip ? 2 : 1);
          const price = base * (1 + margin / 100);
          const dist = r.distanceKm * (roundTrip ? 2 : 1);
          return (
            <>
              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2">Árrés
                  <input type="number" min={0} max={200} value={margin} onChange={(e) => setMargin(parseFloat(e.target.value) || 0)} className="field w-16" /> %
                </label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} />Üres visszaút (×2, becslés)</label>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-sm text-slate-500">Javasolt nettó fuvardíj</span>
                <span className="text-2xl font-bold">{eur(price)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>{huf(price * costs.eurHuf)}</span>
                <span>{eur2(price / Math.max(dist, 1))} / km · önköltség {eur(base)}</span>
              </div>
            </>
          );
        })()}
      </section>

      {r.warnings.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Forgalmi korlátozások az útvonalon</h3>
          {[...r.warnings].sort((a, b) => (a.severity === "danger" ? -1 : 1) - (b.severity === "danger" ? -1 : 1)).map((w, i) => (
            <div key={i} className={`rounded-lg border px-3 py-2 text-sm ${w.severity === "danger" ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200" : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"}`}>
              {w.severity === "danger" ? "⛔ " : "ℹ️ "}{w.text}
            </div>
          ))}
          <p className="text-xs text-slate-500">A hétvégi/éjszakai tilalmak tájékoztató jellegűek (ünnepnapok, nyári és helyi tilalmak nélkül). Indulás előtt ellenőrizd a hatósági forrásnál.</p>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">Útdíj országonként</h3>
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800">
              <tr><th className="px-3 py-2 text-left">Ország</th><th className="px-2 py-2 text-right">Díjas km</th><th className="px-2 py-2 text-right">€/km</th><th className="px-3 py-2 text-right">Díj</th></tr>
            </thead>
            <tbody>
              {r.tollBreakdown.map((t) => (
                <tr key={t.country} className="border-t border-slate-100 align-top dark:border-slate-800" title={t.note}>
                  <td className="px-3 py-2">{flag(t.country)} {COUNTRY_NAMES[t.country] ?? t.country}
                    {t.fixed > 0 && <div className="text-[11px] text-slate-500">időalapú díj</div>}
                    {t.roads.length > 0 && <div className="text-[11px] text-slate-500">{t.roads.join(", ")}</div>}
                    {t.confidence !== "none" && (
                      <span className={`mt-0.5 inline-block rounded px-1.5 py-px text-[10px] font-semibold ${t.confidence === "source" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`} title={`${t.asOf}`}>
                        {t.confidence === "source" ? "forrás szerint" : "becslés"}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{t.tollKm ? km(t.tollKm) : "–"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{t.perKm ? t.perKm.toFixed(3) : "–"}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{t.total ? eur2(t.total) : "–"}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold dark:border-slate-700 dark:bg-slate-800">
                <td className="px-3 py-2" colSpan={3}>Összesen</td>
                <td className="px-3 py-2 text-right tabular-nums">{eur2(r.tollTotalEur)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          <b>Forrás szerint</b>: 2026-os, nyilvános (másodlagos) forrásból ellenőrzött tarifa; <b>becslés</b>: nincs megbízható forrás. Egérrel a sorra állva a részletek láthatók. A tarifák a <code>src/lib/tolls.ts</code> fájlban frissíthetők. Alagút-, híd- és szakaszfelárak nincsenek benne.
          {r.tollAccuracy === "maneuver" && " ⚠ Ennél az útnál a díjköteles szakaszok pontossága csökkent (a részletes úthálózati adat nem volt elérhető)."}
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Menetrend (EU 561/2006 szerint)</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Stat k="Vezetési idő" v={dur(r.schedule.drivingH * 60)} />
          <Stat k="Összes idő pihenőkkel" v={`${r.schedule.totalH.toFixed(1)} óra`} />
          <Stat k="45 perces szünetek" v={`${r.schedule.breaks45} db`} />
          <Stat k="Napi pihenők (11 óra)" v={`${r.schedule.dailyRests} db`} />
          <Stat k="Várható érkezés" v={dt(r.schedule.arrival)} wide />
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold">Szünetek és pihenők</h3>
        <p className="mb-2 text-xs text-slate-500">Húzd a ☕ / 🌙 jelölőket a térképen az útvonal mentén – az idők, az országonkénti áthaladás, a tilalmak és a sofőrköltség azonnal újraszámolódnak.</p>
        <ul className="space-y-1 text-sm">
          {r.stops.map((st) => (
            <li key={st.id} className={`rounded-lg px-3 py-1.5 ${st.warn ? "bg-red-50 dark:bg-red-950/40" : "bg-slate-50 dark:bg-slate-800/60"}`}>
              <div className="flex items-center justify-between gap-2">
                <span>{st.kind === "rest" ? "🌙 Napi pihenő" : "☕ 45 perc szünet"} · {st.day}. nap · {flag(st.country)} ~{Math.round(st.km)}. km</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{dt(st.time)}</span>
                  <button className="text-slate-400 hover:text-red-600" title="Törlés" onClick={() => onRemoveStop(st.id)}>✕</button>
                </span>
              </div>
              {st.warn && <div className="mt-0.5 text-xs text-red-700 dark:text-red-300">⚠ {st.warn}</div>}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="btn" onClick={() => onAddStop("break")}>+ ☕ Szünet</button>
          <button className="btn" onClick={() => onAddStop("rest")}>+ 🌙 Pihenő</button>
          {edited && <button className="btn" onClick={onResetStops}>↺ Alaphelyzet</button>}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Áthaladás országonként</h3>
        <ul className="space-y-1 text-sm">
          {r.countries.map((c, i) => (
            <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 dark:bg-slate-800/60">
              <span>{flag(c.country)} {COUNTRY_NAMES[c.country] ?? c.country} · {km(c.km)}</span>
              <span className="text-xs text-slate-500">{dt(c.enter)} → {dt(c.leave)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => download("kamion-utvonal.gpx", gpx(r), "application/gpx+xml")}>GPX letöltés</button>
        <button className="btn" onClick={() => download("fuvarkoltseg.csv", "﻿" + csv(r, costs), "text/csv;charset=utf-8")}>CSV költségtábla</button>
        <button className="btn" onClick={() => window.print()}>Nyomtatás</button>
        <button className="btn" onClick={() => setShowSteps((s) => !s)}>{showSteps ? "Útvonalleírás elrejtése" : "Útvonalleírás"}</button>
      </section>

      {showSteps && (
        <ol className="space-y-1 text-sm">
          {r.maneuvers.map((m, i) => (
            <li key={i} className="flex justify-between gap-3 border-b border-slate-100 py-1 dark:border-slate-800">
              <span>{m.text}</span>
              <span className="shrink-0 text-xs text-slate-500">{km(m.km)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Stat({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className={`rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60 ${wide ? "col-span-2" : ""}`}>
      <div className="text-xs text-slate-500">{k}</div>
      <div className="font-medium">{v}</div>
    </div>
  );
}
