"use client";

import { useState } from "react";
import { COUNTRY_NAMES } from "@/lib/country-names";
import { dt, dur, eur, eur2, flag, huf, km } from "@/lib/format";
import type { CostInputs, RouteResult, Waypoint } from "@/lib/types";
import DriverSend from "./DriverSend";

interface Props {
  routes: RouteResult[];
  selected: number;
  onSelect: (i: number) => void;
  costs: CostInputs;
  onAddStop: (kind: "break" | "rest") => void;
  onRemoveStop: (id: string) => void;
  onResetStops: () => void;
  edited: boolean;
  onSnapParking: () => void;
  parkStatus: string;
  waypoints: Waypoint[];
  departure: string;
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
    ["Közúti km", r.roadKm.toFixed(1), ""],
    ["Díjköteles km", r.tollKm.toFixed(1), ""],
    ["Útdíj (nettó)", r.tollTotalEur, r.tollTotalEur * c.eurHuf],
    ["Komp / vasút", r.ferryTotalEur, r.ferryTotalEur * c.eurHuf],
    ["Üzemanyag", r.fuelCostEur, r.fuelCostEur * c.eurHuf],
    ["Sofőr", r.driverCostEur, r.driverCostEur * c.eurHuf],
    ["Jármű (km-költség)", r.vehicleCostEur, r.vehicleCostEur * c.eurHuf],
    ["ÖSSZESEN", r.totalEur, r.totalEur * c.eurHuf],
    [],
    ["Ország", "Díjköteles km", "EUR/km", "Fix díj EUR", "Útdíj EUR"],
    ...r.tollBreakdown.map((t) => [COUNTRY_NAMES[t.country] ?? t.country, t.tollKm.toFixed(1), t.perKm.toFixed(3), t.fixed.toFixed(2), t.total.toFixed(2)]),
    ...r.specials.filter((x) => x.modelled).map((x) => [x.name, x.km.toFixed(1), "", "", x.fee.toFixed(2)]),
    ...r.ferries.map((f) => [`${f.name} (${f.from} → ${f.to})`, f.km.toFixed(1), "", "", f.priceEur.toFixed(2)]),
    [],
    ["Megálló", "Idő", "Km", "Hely"],
    ...r.stops.map((st) => [st.kind, st.time.replace("T", " "), st.km.toFixed(0), st.place ?? ""]),
    ["Érkezés", r.schedule.arrival.replace("T", " "), r.distanceKm.toFixed(0), ""],
  ];
  return rows.map((row) => row.join(";")).join("\n");
}

const KIND: Record<string, string> = { break: "☕ 45 perc szünet", rest: "🌙 Napi pihenő", wait: "⏳ Várakozás", ferry: "⛴ Komp / vasút" };

export default function Results({ routes, selected, onSelect, costs, onAddStop, onRemoveStop, onResetStops, edited, onSnapParking, parkStatus, waypoints, departure }: Props) {
  const [showSteps, setShowSteps] = useState(false);
  const [margin, setMargin] = useState(15);
  const [roundTrip, setRoundTrip] = useState(false);
  const r = routes[selected];
  if (!r) return null;
  const cheapest = Math.min(...routes.map((x) => x.totalEur));
  const fastest = Math.min(...routes.map((x) => x.drivingMin));

  const parts = [
    { label: "Útdíj", v: r.tollTotalEur, color: "bg-amber-500" },
    ...(r.ferryTotalEur > 0 ? [{ label: "Komp / vasút", v: r.ferryTotalEur, color: "bg-teal-500" }] : []),
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
              className={`rounded-2xl border bg-white p-3 text-left shadow-sm transition dark:bg-slate-900 ${i === selected ? "border-blue-600 ring-2 ring-blue-600/30" : "border-slate-200 hover:border-slate-400 dark:border-slate-700"}`}
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
                <b>{km(x.roadKm)}</b> · útdíj <b>{eur(x.tollTotalEur)}</b> · {dur(x.drivingMin)} vezetés · érkezés {dt(x.schedule.arrival)}
              </div>
            </button>
          ))}
        </div>
      )}

      {r.noGo.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
          {r.noGo.map((z) => (
            <div key={z.name}>⛔ Az útvonal {km(z.km)}-t halad a(z) <b>{z.name}</b> No-Go zónában{z.unavoidable ? " – egy útpont a zónán belül van, vagy nincs kikerülő út." : " – nem sikerült teljesen elkerülni."}</div>
          ))}
        </div>
      )}

      {r.crossings.some((c) => c.used && !c.allowed) && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
          {r.crossings.filter((c) => c.used && !c.allowed).map((c) => (
            <div key={c.id}>🛂 Az útvonal a(z) <b>{c.name}</b> átkelőn halad át. {c.reason}</div>
          ))}
        </div>
      )}

      <section className="grid grid-cols-2 gap-2">
        <Fact k="Távolság (közúton)" v={km(r.roadKm)} sub={r.ferries.length ? `+ ${km(r.distanceKm - r.roadKm)} komp / vasút` : `ebből díjköteles ${km(r.tollKm)}`} />
        <Fact k="Útdíj (nettó)" v={eur2(r.tollTotalEur)} sub={`${huf(r.tollTotalEur * costs.eurHuf)} · ${r.tollKm > 0 ? eur2(r.tollTotalEur / Math.max(r.tollKm, 1)) + "/díjas km" : ""}`} accent />
        <Fact k="Várható érkezés" v={dt(r.schedule.arrival)} sub={r.schedule.arrivalLocal ? `helyi idő: ${dt(r.schedule.arrivalLocal)}` : `${r.schedule.totalH.toFixed(1)} óra az indulástól`} />
        <Fact k="Útdíj-pontosság" v={`~${Math.min(99, Math.round(r.tollConfidence * 100))}%`} sub={r.tollConfidence >= 0.95 ? "hivatalos 2026-os tarifák" : "részben becsült tarifák"} good={r.tollConfidence >= 0.95} />
      </section>

      <section className="rounded-2xl bg-gradient-to-br from-[#12306a] via-[#0f1f3d] to-[#0b1426] p-4 text-white shadow-lg shadow-blue-900/20 ring-1 ring-white/10">
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
        <div className="mt-2 text-xs text-slate-400">Üzemanyag: {Math.round(r.fuelLiters)} liter · {r.schedule.days} naptári nap (napi költségek) · útdíj nettó, ÁFA nélkül</div>
      </section>

      <section className="card">
        <h3 className="h3">Ajánlati ár számítás</h3>
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
          <h3 className="h3">Forgalmi korlátozások az útvonalon</h3>
          {[...r.warnings].sort((a, b) => (a.severity === "danger" ? -1 : 1) - (b.severity === "danger" ? -1 : 1)).map((w, i) => (
            <div key={i} className={`rounded-lg border px-3 py-2 text-sm ${w.severity === "danger" ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200" : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"}`}>
              {w.severity === "danger" ? "⛔ " : "ℹ️ "}{w.text}
            </div>
          ))}
          <p className="text-xs text-slate-500">A hétvégi/éjszakai tilalmak tájékoztató jellegűek (ünnepnapok, nyári és helyi tilalmak nélkül). Indulás előtt ellenőrizd a hatósági forrásnál.</p>
        </section>
      )}

      {r.ferries.length > 0 && (
        <section className="space-y-2">
          <h3 className="h3">Komp / vasút</h3>
          {r.ferries.map((f) => (
            <div key={f.id + f.f0} className={`rounded-lg border px-3 py-2 text-sm ${f.priced === "estimate" && !f.priceEur ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40" : "border-teal-300 bg-teal-50 dark:border-teal-800 dark:bg-teal-950/30"}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{f.kind === "rail" ? "🚆" : "⛴"} {f.name}</span>
                <span className="font-bold tabular-nums">{f.priceEur ? eur2(f.priceEur) : "nincs ár"}</span>
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400">{f.from} → {f.to} · {dur(f.durationH * 60)} + {dur(f.checkInH * 60)} beszállás · {f.berth ? "fekhellyel (napi pihenőnek számíthat)" : "fekhely nélkül"} · {f.priced === "user" ? "saját ár" : f.priced === "catalog" ? "katalógusár" : "becslés"}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">{f.note}</div>
            </div>
          ))}
        </section>
      )}

      <section>
        <h3 className="h3">Útdíj országonként</h3>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800">
              <tr><th className="px-3 py-2 text-left">Ország</th><th className="px-2 py-2 text-right">Díjas km</th><th className="px-2 py-2 text-right">€/km</th><th className="px-3 py-2 text-right">Díj</th></tr>
            </thead>
            <tbody>
              {r.tollBreakdown.map((t) => (
                <tr key={t.country} className="border-t border-slate-100 align-top dark:border-slate-800" title={t.note}>
                  <td className="px-3 py-2">{flag(t.country)} {COUNTRY_NAMES[t.country] ?? t.country}
                    {t.fixed > 0 && <div className="text-[11px] text-slate-500">időalapú díj: {eur2(t.fixed)} / nap</div>}
                    {t.roads.length > 0 && <div className="text-[11px] text-slate-500">{t.roads.join(", ")}</div>}
                    {t.confidence !== "none" && (
                      <span className={`mt-0.5 inline-block rounded px-1.5 py-px text-[10px] font-semibold ${t.confidence === "official" ? "bg-emerald-100 text-emerald-800" : t.confidence === "source" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800"}`} title={`${t.asOf}`}>
                        {t.confidence === "official" ? "hivatalos tarifa" : t.confidence === "source" ? "forrás szerint" : "becslés"}
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
        {r.specials.length > 0 && (
          <div className="mt-3 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Alagút- és szakaszdíjak</h4>
            {r.specials.map((sp) => (
              <div key={sp.id} title={sp.asOf} className={`rounded-lg border px-3 py-2 text-sm ${sp.modelled ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30" : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">🚇 {sp.name}</span>
                  <span className="font-bold tabular-nums">{sp.modelled ? eur2(sp.fee) : "nincs bekalkulálva"}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{sp.note}</div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-1.5 text-xs text-slate-500">
          <b>Hivatalos tarifa</b>: a 2026-os hivatalos díjtáblából; <b>forrás szerint</b>: hivatalos díjpéldákból számolt átlag (kapus rendszerek); <b>becslés</b>: nincs megbízható forrás. Minden összeg nettó (ÁFA nélkül). Egérrel a sorra állva a részletek láthatók. A felismert alagút-/híd-/szakaszdíjak külön szerepelnek (az útdíj összegben benne vannak).
          {r.tollAccuracy === "maneuver" && " ⚠ Ennél az útnál a díjköteles szakaszok pontossága csökkent (a részletes úthálózati adat nem volt elérhető)."}
        </p>
      </section>

      <section>
        <h3 className="h3">Menetrend (EU 561/2006 szerint)</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Stat k="Vezetési idő" v={dur(r.schedule.drivingH * 60)} />
          <Stat k="Összes idő pihenőkkel" v={`${r.schedule.totalH.toFixed(1)} óra`} />
          <Stat k="45 perces szünetek" v={`${r.schedule.breaks45} db`} />
          <Stat k="Napi pihenők" v={`${r.schedule.dailyRests} db`} />
          {r.schedule.waitH > 0 && <Stat k="Tilalom miatti várakozás" v={dur(r.schedule.waitH * 60)} />}
          {r.schedule.ferryH > 0 && <Stat k="Komp / vasút (beszállással)" v={dur(r.schedule.ferryH * 60)} />}
          <Stat k="Várható érkezés" v={`${dt(r.schedule.arrival)}${r.schedule.arrivalLocal ? ` (helyi: ${dt(r.schedule.arrivalLocal)})` : ""}`} wide />
        </div>
      </section>

      <section>
        <h3 className="h3">Szünetek és pihenők</h3>
        <p className="mb-2 text-xs text-slate-500">Az automatikus terv a legkorábbi jogszerű érkezést adja (4,5 óránként 45 perc, napi 9 – hetente 2× 10 – óra vezetés, 11 – hetente 3× 9 – órás pihenő, a tilalmak kivárásával). Húzd a ☕ / 🌙 jelölőket a térképen: az útvonal mentén csúsztatva csak a menetrend számolódik újra; ha egy másik városba engeded el, ott köztes pont lesz, és az útvonal is újraszámolódik rajta át.</p>
        <ul className="space-y-1 text-sm">
          {r.stops.map((st) => (
            <li key={st.id} className={`rounded-lg px-3 py-1.5 ${st.warn ? "bg-red-50 dark:bg-red-950/40" : st.kind === "wait" ? "bg-amber-50 dark:bg-amber-950/30" : st.kind === "ferry" ? "bg-teal-50 dark:bg-teal-950/30" : "bg-slate-50 dark:bg-slate-800/60"}`}>
              <div className="flex items-center justify-between gap-2">
                <span>{KIND[st.kind]}{st.kind !== "break" && st.durH ? ` (${dur(st.durH * 60)})` : ""}{st.anchored ? " 📍" : ""} · {st.day}. nap · {flag(st.country)} ~{Math.round(st.km)}. km</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{dt(st.time)}</span>
                  {(st.kind === "break" || st.kind === "rest") && <button className="text-slate-400 hover:text-red-600" title="Törlés" onClick={() => onRemoveStop(st.id)}>✕</button>}
                </span>
              </div>
              {st.place && <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{st.place}</div>}
              {st.warn && <div className="mt-0.5 text-xs text-red-700 dark:text-red-300">⚠ {st.warn}</div>}
            </li>
          ))}
          <li className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-1.5 font-medium dark:bg-emerald-950/30">
            <span>🏁 Érkezés · {km(r.distanceKm)}</span><span className="text-xs">{dt(r.schedule.arrival)}</span>
          </li>
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="btn" onClick={() => onAddStop("break")}>+ ☕ Szünet</button>
          <button className="btn" onClick={() => onAddStop("rest")}>+ 🌙 Pihenő</button>
          <button className="btn" onClick={onSnapParking} title="A szüneteket és pihenőket a határidő előtti legközelebbi valós kamionparkolóhoz / pihenőhöz illeszti">🅿 Valós kamionparkolókhoz illesztés</button>
          {edited && <button className="btn" onClick={onResetStops}>↺ Alaphelyzet</button>}
        </div>
        {parkStatus && <p className="mt-1.5 text-xs text-slate-500">{parkStatus}</p>}
      </section>

      <section>
        <h3 className="h3">Áthaladás országonként</h3>
        <ul className="space-y-1 text-sm">
          {r.countries.map((c, i) => (
            <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 dark:bg-slate-800/60">
              <span>{flag(c.country)} {COUNTRY_NAMES[c.country] ?? c.country} · {km(c.km)}{c.tollKm > 0 ? <span className="text-xs text-slate-500"> (díjas {km(c.tollKm)})</span> : null}</span>
              <span className="text-xs text-slate-500">{dt(c.enter)} → {dt(c.leave)}</span>
            </li>
          ))}
        </ul>
      </section>

      {r.crossings.length > 0 && (
        <section>
          <h3 className="h3">Feltételes határátkelők az útvonal mentén</h3>
          <ul className="space-y-1 text-sm">
            {r.crossings.map((c) => (
              <li key={c.id} className={`rounded-lg px-3 py-1.5 ${c.used && !c.allowed ? "bg-red-50 dark:bg-red-950/40" : c.used ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-slate-50 dark:bg-slate-800/60"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span>{c.used ? (c.allowed ? "✅" : "⛔") : c.allowed ? "➖" : "↪"} <b>{c.name}</b> {c.countries.map(flag).join("–")}</span>
                  <span className="shrink-0 text-xs text-slate-500">{c.used ? "használja" : c.allowed ? `nem érinti (${km(c.distKm)})` : `elkerülve (${km(c.distKm)})`}</span>
                </div>
                <div className="text-xs text-slate-500">{c.reason}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <DriverSend route={r} waypoints={waypoints} departure={departure} />

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

function Fact({ k, v, sub, accent, good }: { k: string; v: string; sub?: string; accent?: boolean; good?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 shadow-sm ${accent ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{k}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums leading-tight ${good === false ? "text-amber-600" : good ? "text-emerald-600" : ""}`}>{v}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-tight text-slate-500">{sub}</div>}
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
