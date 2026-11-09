"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Results from "./Results";
import WaypointInput from "./WaypointInput";
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
  const [routes, setRoutes] = useState<RouteResult[]>([]);
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

  const calc = async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waypoints, vehicle, costs, options }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Ismeretlen hiba");
      setRoutes(j.routes);
      setSelected(0);
      const wps = waypoints as Waypoint[];
      const entry: Recent = { label: `${shortLabel(wps[0].label)} → ${shortLabel(wps[wps.length - 1].label)}`, waypoints: wps };
      const next = [entry, ...recent.filter((r) => r.label !== entry.label)].slice(0, 5);
      setRecent(next);
      try { localStorage.setItem(RECENT, JSON.stringify(next)); } catch { /* privát mód */ }
    } catch (e) {
      setRoutes([]);
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

  const presetId = useMemo(
    () => VEHICLE_PRESETS.find((p) => JSON.stringify(p.v) === JSON.stringify(vehicle))?.id ?? "custom",
    [vehicle],
  );
  const num = (k: keyof Vehicle) => (e: React.ChangeEvent<HTMLInputElement>) => setVehicle({ ...vehicle, [k]: parseFloat(e.target.value) || 0 });

  return (
    <div className="flex h-dvh w-full flex-col md:flex-row">
      <aside className={`z-10 flex w-full flex-col border-slate-200 bg-white md:w-[440px] md:shrink-0 md:border-r dark:border-slate-700 dark:bg-slate-900 ${panelOpen ? "h-[62dvh] md:h-full" : "h-12 md:h-full"}`}>
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div>
            <h1 className="text-base font-bold leading-tight">🚛 Kamion útvonaltervező</h1>
            <p className="text-xs text-slate-500">Útvonal · tiltások · útdíj · fuvarköltség</p>
          </div>
          <button className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 md:hidden dark:hover:bg-slate-800" onClick={() => setPanelOpen((o) => !o)}>
            {panelOpen ? "Térkép ▾" : "Panel ▴"}
          </button>
        </header>

        <div className={`flex-1 space-y-5 overflow-y-auto p-4 ${panelOpen ? "" : "hidden md:block"}`}>
          <section className="space-y-2">
            <h2 className="sec">Útvonal <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">· jobb klikk a térképen: indulás / köztes pont / cél</span></h2>
            {waypoints.map((w, i) => {
              const first = i === 0;
              const last = i === waypoints.length - 1;
              return (
                <WaypointInput
                  key={`${i}-${waypoints.length}-${w?.label ?? ""}`}
                  badge={first ? "A" : last ? "B" : String(i)}
                  badgeClass={first ? "bg-green-600" : last ? "bg-red-600" : "bg-slate-500"}
                  placeholder={first ? "Indulás (város, cím…)" : last ? "Érkezés" : "Köztes pont"}
                  value={w}
                  picking={pickIdx === i}
                  onChange={(nw) => setWp(i, nw)}
                  onPickToggle={() => setPickIdx(pickIdx === i ? null : i)}
                  onRemove={!first && !last ? () => setWaypoints((ws) => ws.filter((_, j) => j !== i)) : undefined}
                />
              );
            })}
            <div className="flex gap-2">
              <button className="btn" onClick={() => setWaypoints((ws) => [...ws.slice(0, -1), null, ws[ws.length - 1]])} disabled={waypoints.length >= 10}>+ Köztes pont</button>
              <button className="btn" onClick={() => setWaypoints((ws) => [...ws].reverse())}>⇅ Megfordít</button>
            </div>
            {recent.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                <span className="text-slate-500">Legutóbbi:</span>
                {recent.map((r) => (
                  <button key={r.label} className="rounded-full border border-slate-300 px-2.5 py-1 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800" onClick={() => setWaypoints(r.waypoints)}>{r.label}</button>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="sec">Jármű</h2>
            <select
              className="field w-full"
              value={presetId}
              onChange={(e) => {
                const p = VEHICLE_PRESETS.find((x) => x.id === e.target.value);
                if (p) setVehicle(p.v);
              }}
            >
              {presetId === "custom" && <option value="custom">Egyéni beállítás</option>}
              {VEHICLE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="grid grid-cols-3 gap-2">
              <Num label="Össztömeg (t)" value={vehicle.weight} onChange={num("weight")} step={0.5} />
              <Num label="Tengelyterh. (t)" value={vehicle.axleLoad} onChange={num("axleLoad")} step={0.5} />
              <Num label="Tengelyek" value={vehicle.axles} onChange={num("axles")} step={1} />
              <Num label="Magasság (m)" value={vehicle.height} onChange={num("height")} step={0.05} />
              <Num label="Szélesség (m)" value={vehicle.width} onChange={num("width")} step={0.05} />
              <Num label="Hosszúság (m)" value={vehicle.length} onChange={num("length")} step={0.25} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="lbl">EURO norma
                <select className="field w-full" value={vehicle.euro} onChange={(e) => setVehicle({ ...vehicle, euro: e.target.value as EuroClass })}>
                  <option value="euro6">EURO VI</option><option value="euro5">EURO V / EEV</option>
                  <option value="euro4">EURO IV</option><option value="older">EURO III vagy régebbi</option>
                </select>
              </label>
              <Num label="Fogyasztás (l/100 km)" value={vehicle.consumption} onChange={num("consumption")} step={0.5} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={vehicle.hazmat} onChange={(e) => setVehicle({ ...vehicle, hazmat: e.target.checked })} />
              Veszélyes áru (ADR)
            </label>
          </section>

          <section className="space-y-2">
            <h2 className="sec">Indulás és beállítások</h2>
            <label className="lbl">Indulás ideje (a tilalmi idősávok ellenőrzéséhez)
              <input type="datetime-local" className="field w-full" value={options.departure} onChange={(e) => setOptions({ ...options, departure: e.target.value })} />
            </label>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={options.avoidTolls} onChange={(e) => setOptions({ ...options, avoidTolls: e.target.checked })} />Útdíjmentes útvonal</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={options.avoidHighways} onChange={(e) => setOptions({ ...options, avoidHighways: e.target.checked })} />Autópálya kerülése</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={showRestr} onChange={(e) => setShowRestr(e.target.checked)} />Tiltások a térképen</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={showParking} onChange={(e) => setShowParking(e.target.checked)} />Kamionparkolók</label>
            </div>
          </section>

          <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <summary className="cursor-pointer text-sm font-semibold">Költségparaméterek</summary>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Num label="Gázolaj (€/l)" value={costs.fuelPrice} step={0.01} onChange={(e) => setCosts({ ...costs, fuelPrice: parseFloat(e.target.value) || 0 })} />
              <Num label="Sofőr (€/óra)" value={costs.driverHourly} step={0.5} onChange={(e) => setCosts({ ...costs, driverHourly: parseFloat(e.target.value) || 0 })} />
              <Num label="Jármű-költség (€/km)" value={costs.vehicleKm} step={0.01} onChange={(e) => setCosts({ ...costs, vehicleKm: parseFloat(e.target.value) || 0 })} />
              <Num label="EUR/HUF árfolyam" value={costs.eurHuf} step={1} onChange={(e) => setCosts({ ...costs, eurHuf: parseFloat(e.target.value) || 0 })} />
            </div>
          </details>

          <button
            onClick={calc}
            disabled={!ready || loading}
            className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white shadow transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Számítás… (hosszú útnál ~10–30 mp)" : ready ? "Útvonal és költség számítása" : "Add meg az indulást és az érkezést"}
          </button>

          {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">{error}</div>}

          {routes.length > 0 && (
            <>
              <button className="btn w-full" onClick={share}>{copied ? "✓ Link a vágólapon" : "🔗 Megosztható link másolása"}</button>
              <Results routes={routes} selected={selected} onSelect={setSelected} costs={costs} />
            </>
          )}

          <p className="border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-700">
            Térkép és úthálózat: © OpenStreetMap közreműködők. Útvonaltervezés: Valhalla. Geokódolás: Photon.
            Az útdíjak és tilalmak becsült, tájékoztató jellegű adatok – fuvar előtt ellenőrizd a hivatalos díjtáblákat és rendeleteket.
          </p>
        </div>
      </aside>

      <main className={`relative min-h-0 flex-1 ${panelOpen ? "h-[38dvh] md:h-full" : "h-full"}`}>
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
        />
      </main>
    </div>
  );
}

function Num({ label, value, onChange, step }: { label: string; value: number; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; step: number }) {
  return (
    <label className="lbl">{label}
      <input type="number" inputMode="decimal" className="field w-full" value={Number.isFinite(value) ? value : ""} step={step} min={0} onChange={onChange} />
    </label>
  );
}
