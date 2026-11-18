"use client";

import { Fragment, useMemo, useState } from "react";
import { COUNTRY_NAMES } from "@/lib/country-names";
import { dur, eur2, flag, km } from "@/lib/format";
import type { RoadSection, RouteResult } from "@/lib/types";

interface Props {
  route: RouteResult;
  /** a szakasz fölé érve a térképen kiemelődik */
  onHover: (i: number | null) => void;
  /** a szakaszra kattintva a térkép ráközelít */
  onFocus: (i: number) => void;
  active: number | null;
}

const hm = (iso: string) => iso.slice(11, 16);
const day = (iso: string) => iso.slice(0, 10);

/** útszám-jelvény: autópálya kék, gyorsforgalmi zöld, főút sárga, egyéb fehér */
export function Shield({ s, small }: { s: Pick<RoadSection, "label" | "cls" | "ref"> & { country?: string }; small?: boolean }) {
  const base = `inline-flex shrink-0 items-center justify-center rounded font-bold leading-none tabular-nums ${small ? "min-w-6 px-1 py-0.5 text-[10px]" : "min-w-9 px-1.5 py-1 text-xs"}`;
  const text = s.label.length > 9 ? `${s.label.slice(0, 8)}…` : s.label;
  if (s.cls === "ferry") return <span className={`${base} bg-teal-600 text-white`}>⛴</span>;
  if (s.cls === "motorway") return <span className={`${base} bg-blue-700 text-white ring-1 ring-white/70`}>{text}</span>;
  if (s.cls === "trunk") return <span className={`${base} bg-emerald-700 text-white ring-1 ring-white/70`}>{text}</span>;
  if (s.ref) return <span className={`${base} bg-amber-300 text-slate-900 ring-1 ring-slate-700/40`}>{text}</span>;
  return <span className={`${base} bg-slate-200 text-slate-500 ring-1 ring-slate-400/40 dark:bg-slate-700 dark:text-slate-300`} title={s.label}>{s.label === "Helyi utak" ? "···" : "—"}</span>;
}

const CLS_LABEL: Record<string, string> = {
  motorway: "autópálya", trunk: "gyorsforgalmi / főút", primary: "főút", secondary: "mellékút", minor: "kisebb út", local: "helyi út", ferry: "komp / vasút",
};

interface StopRow { id: string; label: string; time: string; durH?: number; warn?: string; km: number; place?: string }

type Row =
  | { t: "section"; i: number; s: RoadSection; stops: StopRow[] }
  | { t: "border"; from: string; to: string; time: string }
  | { t: "day"; date: string };

const STOP_LABEL: Record<string, string> = { break: "☕ 45 perc szünet", rest: "🌙 Napi pihenő", wait: "⏳ Várakozás (tilalom)", ferry: "⛴ Komp / vasút beszállás" };

/** Az útvonal időrendben: melyik úton hány órakor, hány km-en át, a szünetekkel és a határátlépésekkel. */
export default function RouteTimeline({ route, onHover, onFocus, active }: Props) {
  const [all, setAll] = useState(false);
  const secs = useMemo(() => route.sections ?? [], [route.sections]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const stops = [...route.stops].sort((a, b) => a.f - b.f);
    let si = 0;
    let lastDay = "";
    let lastCountry = "";
    const toRow = (st: (typeof stops)[number]): StopRow => ({
      id: st.id, label: STOP_LABEL[st.kind], time: st.time, durH: st.kind === "break" ? 0.75 : st.durH, warn: st.warn, km: st.km, place: st.place,
    });
    secs.forEach((s, i) => {
      if (day(s.start) !== lastDay) {
        if (lastDay) out.push({ t: "day", date: s.start });
        lastDay = day(s.start);
      }
      if (lastCountry && s.country !== lastCountry) out.push({ t: "border", from: lastCountry, to: s.country, time: s.start });
      lastCountry = s.country;
      // a szakaszon belül eső szünetek / pihenők a szakasz alatt jelennek meg
      const inside: StopRow[] = [];
      while (si < stops.length && (stops[si].f < s.f1 - 1e-9 || (i === secs.length - 1))) inside.push(toRow(stops[si++]));
      out.push({ t: "section", i, s, stops: inside });
    });
    return out;
  }, [route.stops, secs]);

  // „útvonal röviden”: a jelentős számozott utak sorban
  const summary = useMemo(() => {
    const out: RoadSection[] = [];
    for (const s of secs) {
      if (s.cls === "ferry" || (s.km < 4 && !(s.cls === "motorway" && s.km >= 2)) || s.label === "Helyi utak") continue;
      if (!(s.ref || s.km >= 10)) continue;
      const last = out[out.length - 1];
      if (last && last.label === s.label && last.country === s.country) continue;
      out.push(s);
    }
    return out;
  }, [secs]);

  if (!secs.length) return null;
  const totalKm = secs.reduce((t, s) => t + s.km, 0) || 1;
  const major = (s: RoadSection) => s.km >= 3 || s.cls === "ferry" || s.cls === "motorway" || s.cls === "trunk";

  return (
    <section>
      <h3 className="h3">Útvonal – melyik úton, mikor</h3>

      <div className="mb-2 flex flex-wrap items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
        {summary.map((s, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="text-slate-400">›</span>}
            <Shield s={s} small />
          </Fragment>
        ))}
      </div>

      {/* arányos sáv: az egyes utak hossza az összes km-hez képest */}
      <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden>
        {secs.map((s, i) => (
          <div
            key={i}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
            style={{ width: `${(s.km / totalKm) * 100}%` }}
            className={s.cls === "motorway" ? "bg-blue-600" : s.cls === "trunk" ? "bg-emerald-600" : s.cls === "ferry" ? "bg-teal-500" : s.ref ? "bg-amber-400" : "bg-slate-400"}
            title={`${s.label} · ${km(s.km)}`}
          />
        ))}
      </div>

      <ol className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm dark:border-slate-700 dark:bg-slate-900">
        {rows.map((r, k) => {
          if (r.t === "day") {
            return <li key={k} className="bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800">{new Date(`${r.date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("hu-HU", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}</li>;
          }
          if (r.t === "border") {
            return (
              <li key={k} className="flex items-center justify-between gap-2 border-t border-slate-100 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-900 dark:border-slate-800 dark:bg-sky-950/30 dark:text-sky-200">
                <span>🛂 Határ: {flag(r.from)} {COUNTRY_NAMES[r.from] ?? r.from} → {flag(r.to)} {COUNTRY_NAMES[r.to] ?? r.to}</span>
                <span className="tabular-nums">{hm(r.time)}</span>
              </li>
            );
          }
          const s = r.s;
          if (!all && !major(s) && !r.stops.length) return null;
          const isActive = active === r.i;
          return (
            <li
              key={k}
              onMouseEnter={() => onHover(r.i)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onFocus(r.i)}
              className={`flex cursor-pointer gap-3 border-t border-slate-100 px-3 py-2 transition dark:border-slate-800 ${isActive ? "bg-blue-50 dark:bg-blue-950/40" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}
            >
              <div className="w-11 shrink-0 pt-0.5 text-right">
                <div className="font-semibold tabular-nums leading-tight">{hm(s.start)}</div>
                <div className="text-[10px] tabular-nums text-slate-400">{Math.round(s.startKm)}. km</div>
              </div>
              <div className="flex flex-col items-center pt-0.5">
                <Shield s={s} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">
                    {s.ref ? (s.name ?? CLS_LABEL[s.cls]) : s.cls === "ferry" ? "Komp / vasút" : s.label}
                    {s.euro?.length ? <span className="ml-1.5 text-xs font-normal text-slate-500">{s.euro.join(" · ")}</span> : null}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{km(s.km)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                  <span>{flag(s.country)} {COUNTRY_NAMES[s.country] ?? s.country}</span>
                  <span>⏱ {dur(s.h * 60)}</span>
                  {s.cls !== "ferry" && s.speed > 0 && <span>Ø {Math.round(s.speed)} km/h</span>}
                  {s.limit ? <span>korlát {s.limit}</span> : null}
                  {s.tollEur > 0.005 && <span className="font-medium text-amber-700 dark:text-amber-400">💶 {eur2(s.tollEur)}</span>}
                  <span className="ml-auto text-[11px] tabular-nums text-slate-400">→ {hm(s.end)}</span>
                </div>
                {s.via && s.via.length > 0 && <div className="truncate text-xs text-slate-500">{s.via.join(" · ")}</div>}
                {s.toward && <div className="truncate text-xs text-slate-500">irány: {s.toward}</div>}
                {s.exit && <div className="truncate text-xs text-slate-500">↳ {s.exit}</div>}
                {r.stops.map((st) => (
                  <div key={st.id} className={`mt-1.5 rounded-md px-2 py-1 text-xs ${st.warn ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200" : "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"}`}>
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{st.label}{st.durH ? ` · ${dur(st.durH * 60)}` : ""} · ~{Math.round(st.km)}. km</span>
                      <span className="tabular-nums">{hm(st.time)}</span>
                    </div>
                    {st.place && <div className="opacity-80">{st.place}</div>}
                    {st.warn && <div>⚠ {st.warn}</div>}
                  </div>
                ))}
              </div>
            </li>
          );
        })}
        <li className="flex items-center justify-between border-t border-slate-200 bg-emerald-50 px-3 py-2 text-sm font-medium dark:border-slate-700 dark:bg-emerald-950/30">
          <span>🏁 Érkezés · {km(route.distanceKm)}</span>
          <span className="tabular-nums">{hm(route.schedule.arrival)}</span>
        </li>
      </ol>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>Idők: vezetés a szünetekkel együtt, induláskor ({hm(route.sections[0].start)}) kezdve. A sebesség az adott út kamionos sebességmodellje (ország szerinti kamion-korlát).</span>
        <button className="btn shrink-0" onClick={() => setAll((x) => !x)}>{all ? "Csak a főbb utak" : "Minden szakasz"}</button>
      </div>
    </section>
  );
}
