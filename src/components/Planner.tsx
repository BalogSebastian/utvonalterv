"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Results from "./Results";
import WaypointInput from "./WaypointInput";
import { Card, Ico, Num, Toggle } from "./ui";
import { addStop, applyPlan, cumulative, defaultStops, snapToRoute, type PlanStop } from "@/lib/schedule";
import { DEFAULT_COSTS, VEHICLE_PRESETS } from "@/lib/presets";
import type { CostInputs, EuroClass, RouteOptions, RouteResult, Vehicle, Waypoint } from "@/lib/types";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-slate-500">Térkép betöltése…</div>,
});

const LS = "tesotter-truck-planner-v1";

function nextDeparture() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(6, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function loadSaved(): { vehicle?: Vehicle; costs?: CostInputs } {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? "{}");
  } catch {
    return {};
  }
}

interface Recent { label: string; waypoints: Waypoint[] }
const RECENT = "tesotter-truck-recent-v1";

function loadRecent(): Recent[] {
  try { return JSON.parse(localStorage.getItem(RECENT) ?? "[]"); } catch { return []; }
}

interface Shared { w?: Waypoint[]; v?: Vehicle; o?: Partial<RouteOptions> }
function readHash(): Shared {
  try {
    const m = window.location.hash.match(/#s=(.+)$/);
    return m ? (JSON.parse(decodeURIComponent(atob(m[1]))) as Shared) : {};
  } catch {
    return {};
  }
}
const shortLabel = (l: string) => l.split(/[—,]/)[0].trim();

export default function Planner() {
  const [shared] = useState<Shared>(readHash);
  const [waypoints, setWaypoints] = useState<(Waypoint | null)[]>(() => (shared.w && shared.w.length >= 2 ? shared.w : [null, null]));
  const [vehicle, setVehicle] = useState<Vehicle>(() => shared.v ?? loadSaved().vehicle ?? VEHICLE_PRESETS[0].v);
  const [costs, setCosts] = useState<CostInputs>(() => loadSaved().costs ?? DEFAULT_COSTS);
  const [options, setOptions] = useState<RouteOptions>(() => ({ avoidTolls: false, avoidHighways: false, departure: nextDeparture(), ...shared.o }));
  const [recent, setRecent] = useState<Recent[]>(loadRecent);
  const [showParking, setShowParking] = useState(false);
  const [copied, setCopied] = useState(false);
  const autoRan = useRef(false);
  const [rawRoutes, setRoutes] = useState<RouteResult[]>([]);
  const [plans, setPlans] = useState<Record<number, PlanStop[]>>({});
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRestr, setShowRestr] = useState(false);
  const [pickIdx, setPickIdx] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify({ vehicle, costs })); } catch { /* privát mód */ }
  }, [vehicle, costs]);

  const setWp = (i: number, w: Waypoint | null) => setWaypoints((ws) => ws.map((x, j) => (j === i ? w : x)));

  const onPick = useCallback(async (lat: number, lon: number) => {
    const i = pickIdx;
    if (i === null) return;
    setPickIdx(null);
    const fallback = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    setWaypoints((ws) => ws.map((x, j) => (j === i ? { lat, lon, label: fallback } : x)));
    try {
      const r = await fetch(`/api/geocode?lat=${lat}&lon=${lon}`);
      const j = await r.json();
      const label = j.results?.[0]?.label;
      if (label) setWaypoints((ws) => ws.map((x, k) => (k === i && x?.lat === lat ? { ...x, label } : x)));
    } catch { /* marad a koordináta */ }
  }, [pickIdx]);

  const ready = waypoints.every(Boolean);

  const calc = async (wpsIn: (Waypoint | null)[] = waypoints, carry?: PlanStop[]) => {
    if (!wpsIn.every(Boolean)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waypoints: wpsIn, vehicle, costs, options }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Ismeretlen hiba");
      setRoutes(j.routes);
      setPlans(carry ? Object.fromEntries((j.routes as RouteResult[]).map((_, i) => [i, carry])) : {});
      setSelected(0);
      const wps = wpsIn as Waypoint[];
      const entry: Recent = { label: `${shortLabel(wps[0].label)} → ${shortLabel(wps[wps.length - 1].label)}`, waypoints: wps };
      const next = [entry, ...recent.filter((r) => r.label !== entry.label)].slice(0, 5);
      setRecent(next);
      try { localStorage.setItem(RECENT, JSON.stringify(next)); } catch { /* privát mód */ }
    } catch (e) {
      setRoutes([]);
      setPlans({});
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoRan.current || !shared.w || shared.w.length < 2) return;
    autoRan.current = true;
    const t = setTimeout(() => { void calc(); }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const share = async () => {
    const payload = btoa(encodeURIComponent(JSON.stringify({ w: waypoints, v: vehicle, o: { avoidTolls: options.avoidTolls, avoidHighways: options.avoidHighways } })));
    const url = `${window.location.origin}${window.location.pathname}#s=${payload}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt("Másold ki a linket:", url); }
  };

  const onContext = useCallback(async (kind: "from" | "to" | "via", lat: number, lon: number) => {
    const wp: Waypoint = { lat, lon, label: `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
    setWaypoints((ws) => {
      const copy = [...ws];
      if (kind === "from") { copy[0] = wp; }
      else if (kind === "to") { copy[copy.length - 1] = wp; }
      else { copy.splice(copy.length - 1, 0, wp); }
      return copy;
    });
    try {
      const r = await fetch(`/api/geocode?lat=${lat}&lon=${lon}`);
      const j = await r.json();
      const label = j.results?.[0]?.label;
      if (label) setWaypoints((ws) => ws.map((x) => (x && x.lat === lat && x.lon === lon ? { ...x, label } : x)));
    } catch { /* marad a koordináta */ }
  }, []);

  const routes = useMemo(
    () => rawRoutes.map((r, i) => applyPlan(r, plans[i] ?? defaultStops(r), options.departure, vehicle.weight, costs.driverHourly)),
    [rawRoutes, plans, options.departure, vehicle.weight, costs.driverHourly],
  );
  const currentPlan = (): PlanStop[] => plans[selected] ?? (rawRoutes[selected] ? defaultStops(rawRoutes[selected]) : []);
  const setPlan = (p: PlanStop[]) => setPlans((all) => ({ ...all, [selected]: p }));
  const sameSpot = (w: Waypoint | null, a?: [number, number]) => !!w && !!a && Math.abs(w.lon - a[0]) < 1e-9 && Math.abs(w.lat - a[1]) < 1e-9;
  /** a megálló köztes pontjának eltávolítása a pontlistából (ha volt) */
  const withoutAnchor = (st?: PlanStop) => waypoints.filter((w) => !sameSpot(w, st?.anchor));
  const relabel = async (lat: number, lon: number) => {
    try {
      const r = await fetch(`/api/geocode?lat=${lat}&lon=${lon}&place=1`);
      const j = await r.json();
      const label = j.results?.[0]?.label;
      if (label) setWaypoints((ws) => ws.map((x) => (x && x.lat === lat && x.lon === lon ? { ...x, label } : x)));
    } catch { /* marad a koordináta */ }
  };

  const onStopMove = (id: string, f: number) => {
    const plan = currentPlan();
    const st = plan.find((x) => x.id === id);
    const next = plan.map((x) => (x.id === id ? { ...x, f, anchor: undefined } : x));
    setPlan(next);
    if (st?.anchor) {
      // a megálló visszakerült az útvonalra: a hozzá tartozó köztes pont megszűnik, új útvonal
      const wps = withoutAnchor(st);
      setWaypoints(wps);
      void calc(wps, next);
    }
  };
  /** szabadon elengedett megálló: új köztes pont az útvonalon (a megálló oda kötődik) */
  const onStopDrop = (id: string, lng: number, lat: number) => {
    const route = rawRoutes[selected];
    if (!route) return;
    const plan = currentPlan();
    const st = plan.find((x) => x.id === id);
    const wps = withoutAnchor(st);
    if (wps.length >= 12) { setError("Legfeljebb 12 útpont engedélyezett."); return; }
    const cum = cumulative(route.geometry);
    const fNew = snapToRoute(route.geometry, cum, [lng, lat]).f;
    const fs = wps.map((w, i) => (i === 0 ? 0 : i === wps.length - 1 ? 1 : snapToRoute(route.geometry, cum, [w!.lon, w!.lat]).f));
    let at = wps.length - 1;
    for (let i = 1; i < wps.length - 1; i++) if (fs[i] > fNew) { at = i; break; }
    const wp: Waypoint = { lat, lon: lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
    const nextWps = [...wps.slice(0, at), wp, ...wps.slice(at)];
    const nextPlan = plan.map((x) => (x.id === id ? { ...x, anchor: [lng, lat] as [number, number], f: fNew } : x));
    setPlan(nextPlan);
    setWaypoints(nextWps);
    void calc(nextWps, nextPlan);
    void relabel(lat, lng);
  };
  const onAddStop = (kind: "break" | "rest") => setPlan(addStop(currentPlan(), kind));
  const onRemoveStop = (id: string) => {
    const plan = currentPlan();
    const st = plan.find((x) => x.id === id);
    const next = plan.filter((x) => x.id !== id);
    setPlan(next);
    if (st?.anchor) {
      const wps = withoutAnchor(st);
      setWaypoints(wps);
      void calc(wps, next);
    }
  };
  const onResetStops = () => {
    const anchored = currentPlan().filter((x) => x.anchor);
    setPlans((all) => { const c = { ...all }; delete c[selected]; return c; });
    if (anchored.length) {
      const wps = waypoints.filter((w) => !anchored.some((a) => sameSpot(w, a.anchor)));
      setWaypoints(wps);
      void calc(wps);
    }
  };

  const onWaypointDrag = async (i: number, lat: number, lon: number) => {
    const moved = waypoints.map((x, j) => (j === i ? { lat, lon, label: `${lat.toFixed(5)}, ${lon.toFixed(5)}` } : x));
    setWaypoints(moved);
    void calc(moved);
    try {
      const r = await fetch(`/api/geocode?lat=${lat}&lon=${lon}`);
      const j = await r.json();
      const label = j.results?.[0]?.label;
      if (label) setWaypoints((ws) => ws.map((x, k) => (k === i && x?.lat === lat ? { ...x, label } : x)));
    } catch { /* marad a koordináta */ }
  };

  const presetId = useMemo(
    () => VEHICLE_PRESETS.find((p) => JSON.stringify(p.v) === JSON.stringify(vehicle))?.id ?? "custom",
    [vehicle],
  );
  const num = (k: keyof Vehicle) => (e: React.ChangeEvent<HTMLInputElement>) => setVehicle({ ...vehicle, [k]: parseFloat(e.target.value) || 0 });

  const best = routes[selected];

  return (
    <div className="flex h-dvh w-full flex-col md:flex-row">
      <aside className={`z-10 flex w-full flex-col bg-slate-50 shadow-2xl shadow-slate-900/10 md:w-[460px] md:shrink-0 dark:bg-slate-950 ${panelOpen ? "h-[64dvh] md:h-full" : "h-[68px] md:h-full"}`}>
        <header className="brand-bar relative shrink-0 overflow-hidden px-5 py-3.5 text-white">
          <div className="relative flex items-center gap-3">
            <Logo />
            <div className="min-w-0 flex-1">
              <h1 className="brand-word text-[22px] leading-none">tesotter <span className="text-amber-400">route<b>R</b></span></h1>
              <p className="mt-1 text-[11px] tracking-wide text-blue-200/80">Kamion útvonal · útdíj · fuvarköltség</p>
            </div>
            <button className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-blue-100 hover:bg-white/10 md:hidden" onClick={() => setPanelOpen((o) => !o)}>
              {panelOpen ? "Térkép ▾" : "Panel ▴"}
            </button>
          </div>
        </header>

        <div className={`flex-1 space-y-3.5 overflow-y-auto px-4 pb-5 pt-4 ${panelOpen ? "" : "hidden md:block"}`}>
          <Card icon="route" title="Útvonal" hint="Jobb klikk a térképen: indulás / köztes pont / cél">
            <div className="relative space-y-2">
              <div className="absolute bottom-4 left-[13px] top-4 w-px border-l-2 border-dashed border-slate-300 dark:border-slate-600" />
              {waypoints.map((w, i) => {
                const first = i === 0;
                const last = i === waypoints.length - 1;
                return (
                  <WaypointInput
                    key={`${i}-${waypoints.length}-${w?.label ?? ""}`}
                    badge={first ? "A" : last ? "B" : String(i)}
                    badgeClass={first ? "bg-emerald-500" : last ? "bg-rose-500" : "bg-slate-500"}
                    placeholder={first ? "Indulás (város, cím…)" : last ? "Érkezés" : "Köztes pont"}
                    value={w}
                    picking={pickIdx === i}
                    onChange={(nw) => setWp(i, nw)}
                    onPickToggle={() => setPickIdx(pickIdx === i ? null : i)}
                    onRemove={!first && !last ? () => setWaypoints((ws) => ws.filter((_, j) => j !== i)) : undefined}
                  />
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <button className="btn flex-1" onClick={() => setWaypoints((ws) => [...ws.slice(0, -1), null, ws[ws.length - 1]])} disabled={waypoints.length >= 10}>
                <Ico name="plus" /> Köztes pont
              </button>
              <button className="btn flex-1" onClick={() => setWaypoints((ws) => [...ws].reverse())}>
                <Ico name="swap" className="h-4 w-4 rotate-0" /> Megfordít
              </button>
            </div>
            {recent.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-400">Legutóbbi</span>
                {recent.map((r) => (
                  <button key={r.label} className="chip" onClick={() => setWaypoints(r.waypoints)}>{r.label}</button>
                ))}
              </div>
            )}
          </Card>

          <Card icon="truck" title="Jármű" hint="A routing ezek alapján kerüli a tiltott utakat">
            <select
              className="field mb-3 w-full font-medium"
              value={presetId}
              onChange={(e) => {
                const p = VEHICLE_PRESETS.find((x) => x.id === e.target.value);
                if (p) setVehicle(p.v);
              }}
            >
              {presetId === "custom" && <option value="custom">Egyéni beállítás</option>}
              {VEHICLE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="grid grid-cols-3 gap-2.5">
              <Num label="Össztömeg" unit="t" value={vehicle.weight} onChange={num("weight")} step={0.5} />
              <Num label="Tengelyterh." unit="t" value={vehicle.axleLoad} onChange={num("axleLoad")} step={0.5} />
              <Num label="Tengelyek" unit="db" value={vehicle.axles} onChange={num("axles")} step={1} />
              <Num label="Magasság" unit="m" value={vehicle.height} onChange={num("height")} step={0.05} />
              <Num label="Szélesség" unit="m" value={vehicle.width} onChange={num("width")} step={0.05} />
              <Num label="Hosszúság" unit="m" value={vehicle.length} onChange={num("length")} step={0.25} />
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">EURO norma</span>
                <select className="field w-full" value={vehicle.euro} onChange={(e) => setVehicle({ ...vehicle, euro: e.target.value as EuroClass })}>
                  <option value="euro6">EURO VI</option><option value="euro5">EURO V / EEV</option>
                  <option value="euro4">EURO IV</option><option value="older">EURO III vagy régebbi</option>
                </select>
              </label>
              <Num label="Fogyasztás" unit="l/100" value={vehicle.consumption} onChange={num("consumption")} step={0.5} />
            </div>
            <div className="mt-2.5">
              <Toggle checked={vehicle.hazmat} onChange={(v) => setVehicle({ ...vehicle, hazmat: v })} label="Veszélyes áru (ADR)" icon="ban" />
            </div>
          </Card>

          <Card icon="sliders" title="Indulás és beállítások">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Indulás ideje (a tilalmi idősávokhoz és menetrendhez)</span>
              <input type="datetime-local" className="field w-full" value={options.departure} onChange={(e) => setOptions({ ...options, departure: e.target.value })} />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Toggle checked={options.avoidTolls} onChange={(v) => setOptions({ ...options, avoidTolls: v })} label="Útdíjmentes út" icon="coin" />
              <Toggle checked={options.avoidHighways} onChange={(v) => setOptions({ ...options, avoidHighways: v })} label="Autópálya kerülése" icon="road" />
              <Toggle checked={showRestr} onChange={setShowRestr} label="Tiltások a térképen" icon="ban" />
              <Toggle checked={showParking} onChange={setShowParking} label="Kamionparkolók" icon="parking" />
            </div>
          </Card>

          <details className="card group">
            <summary className="flex cursor-pointer list-none items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-600/30"><Ico name="euro" /></span>
              <span className="flex-1 text-[13px] font-semibold tracking-tight">Költségparaméterek</span>
              <Ico name="chevron" className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <Num label="Gázolaj" unit="€/l" value={costs.fuelPrice} step={0.01} onChange={(e) => setCosts({ ...costs, fuelPrice: parseFloat(e.target.value) || 0 })} />
              <Num label="Sofőr" unit="€/óra" value={costs.driverHourly} step={0.5} onChange={(e) => setCosts({ ...costs, driverHourly: parseFloat(e.target.value) || 0 })} />
              <Num label="Jármű-költség" unit="€/km" value={costs.vehicleKm} step={0.01} onChange={(e) => setCosts({ ...costs, vehicleKm: parseFloat(e.target.value) || 0 })} />
              <Num label="EUR/HUF" unit="Ft" value={costs.eurHuf} step={1} onChange={(e) => setCosts({ ...costs, eurHuf: parseFloat(e.target.value) || 0 })} />
            </div>
          </details>

          {routes.length > 0 && (
            <>
              <button className="btn w-full" onClick={share}>
                <Ico name="link" /> {copied ? "Link a vágólapon ✓" : "Megosztható link másolása"}
              </button>
              <Results routes={routes} selected={selected} onSelect={setSelected} costs={costs} onAddStop={onAddStop} onRemoveStop={onRemoveStop} onResetStops={onResetStops} edited={!!plans[selected]} />
            </>
          )}

          <p className="px-1 pt-1 text-[11px] leading-relaxed text-slate-400">
            Térkép és úthálózat: © OpenStreetMap közreműködők. Útvonaltervezés: Valhalla. Geokódolás: Photon.
            Az útdíjak és tilalmak tájékoztató jellegű adatok – fuvar előtt ellenőrizd a hivatalos díjtáblákat és rendeleteket.
          </p>
        </div>

        <footer className={`shrink-0 border-t border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 ${panelOpen ? "" : "hidden md:block"}`}>
          {error && <div className="mb-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">{error}</div>}
          {best && !loading && (
            <div className="mb-2 flex items-center justify-between rounded-lg bg-slate-100 px-3 py-1.5 text-xs dark:bg-slate-800">
              <span className="text-slate-500">{Math.round(best.distanceKm)} km · {Math.floor(best.drivingMin / 60)} ó {Math.round(best.drivingMin % 60)} p</span>
              <span className="font-bold tabular-nums">{Math.round(best.totalEur).toLocaleString("hu-HU")} EUR</span>
            </div>
          )}
          <button onClick={() => calc()} disabled={!ready || loading} className="cta">
            {loading ? (<><span className="spinner" /> Számítás… (hosszú útnál ~10–30 mp)</>) : ready ? (<><Ico name="route" className="h-[18px] w-[18px]" /> Útvonal és költség számítása</>) : "Add meg az indulást és az érkezést"}
          </button>
        </footer>
      </aside>

      <main className={`relative min-h-0 flex-1 ${panelOpen ? "h-[36dvh] md:h-full" : "h-full"}`}>
        <MapView
          waypoints={waypoints}
          routes={routes}
          selected={selected}
          vehicle={vehicle}
          showRestrictions={showRestr}
          showParking={showParking}
          onContext={onContext}
          pickMode={pickIdx}
          onPick={onPick}
          onSelectRoute={setSelected}
          onStopMove={onStopMove}
          onStopDrop={onStopDrop}
          onWaypointDrag={onWaypointDrag}
        />
      </main>
    </div>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 64 64" className="h-10 w-10 shrink-0 drop-shadow-lg" fill="none" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="64" y2="64"><stop stopColor="#fbbf24" /><stop offset="1" stopColor="#f97316" /></linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#0f1f3d" stroke="url(#lg)" strokeWidth="2" />
      <path d="M14 44c8-2 8-16 17-16s9 12 19 8" stroke="url(#lg)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="14" cy="44" r="4.5" fill="#34d399" />
      <circle cx="50" cy="36" r="4.5" fill="#f43f5e" />
    </svg>
  );
}
