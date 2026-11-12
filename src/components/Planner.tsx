"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Results from "./Results";
import WaypointInput from "./WaypointInput";
import { Card, Ico, Num, Toggle } from "./ui";
import { addStop, applyPlan, autoPlan, cumulative, fractionAtHours, hoursAt, snapToRoute, type PlanStop } from "@/lib/schedule";
import { DEFAULT_COSTS, VEHICLE_PRESETS } from "@/lib/presets";
import { FERRIES, ferryById, ferryWaypoint } from "@/lib/ferries";
import { COUNTRY_NAMES } from "@/lib/country-names";
import { flag } from "@/lib/format";
import { BUILTIN_CROSSINGS, MODE_LABEL } from "@/lib/crossings";
import type { BorderCrossing, CargoKind, CostInputs, EuroClass, FerryOverride, LngLat, NoGo, RouteOptions, RouteResult, Vehicle, Waypoint } from "@/lib/types";

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

interface FleetItem { id: string; name: string; v: Vehicle }
interface Saved {
  vehicle?: Vehicle;
  costs?: Partial<CostInputs>;
  noGo?: NoGo;
  ferryOverrides?: Record<string, FerryOverride>;
  flexRules?: boolean;
  waitBans?: boolean;
  fleet?: FleetItem[];
  defaultFleet?: string;
  crossings?: BorderCrossing[];
  crossingsOff?: string[];
  /** Svájc alapértelmezett No-Go zóna – egyszer hozzáadva a régi beállításokhoz is */
  chDefault?: boolean;
}

function loadSaved(): Saved {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? "{}");
  } catch {
    return {};
  }
}

/** a régi (v1) költség-beállítások átvétele: a napi költségek új mezők */
function loadCosts(saved: Saved): CostInputs {
  const c = saved.costs;
  if (!c) return DEFAULT_COSTS;
  if (c.vehicleDaily === undefined) return { ...DEFAULT_COSTS, fuelPrice: c.fuelPrice ?? DEFAULT_COSTS.fuelPrice, driverHourly: c.driverHourly ?? DEFAULT_COSTS.driverHourly, eurHuf: c.eurHuf ?? DEFAULT_COSTS.eurHuf };
  return { ...DEFAULT_COSTS, ...c };
}

/** a régi mentésekbe egyszer bekerül Svájc No-Go zónaként (utána kivehető) */
function initialNoGo(saved: Saved): NoGo {
  const n = saved.noGo ?? { countries: [], areas: [] };
  if (saved.chDefault || n.countries.includes("CH")) return n;
  return { ...n, countries: ["CH", ...n.countries] };
}

const QUICK_NOGO = ["CH", "AT", "DE", "FR", "IT", "GB", "RS"];
const uid = () => Math.random().toString(36).slice(2, 9);

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
  const [saved] = useState<Saved>(loadSaved);
  const [waypoints, setWaypoints] = useState<(Waypoint | null)[]>(() => (shared.w && shared.w.length >= 2 ? shared.w : [null, null]));
  const [fleet, setFleet] = useState<FleetItem[]>(() => saved.fleet ?? []);
  const [defaultFleet, setDefaultFleet] = useState<string | undefined>(saved.defaultFleet);
  const [vehicle, setVehicle] = useState<Vehicle>(() => shared.v ?? (saved.fleet ?? []).find((f) => f.id === saved.defaultFleet)?.v ?? saved.vehicle ?? VEHICLE_PRESETS[0].v);
  const [costs, setCosts] = useState<CostInputs>(() => loadCosts(saved));
  const [options, setOptions] = useState<RouteOptions>(() => ({
    avoidTolls: false, avoidHighways: false, departure: nextDeparture(),
    noGo: initialNoGo(saved),
    crossings: saved.crossings ?? [],
    crossingsOff: saved.crossingsOff ?? [],
    ferryOverrides: saved.ferryOverrides ?? {},
    flexRules: saved.flexRules ?? true,
    waitBans: saved.waitBans ?? true,
    ...shared.o,
  }));
  const [exclude, setExclude] = useState<{ lat: number; lon: number }[]>([]);
  const [drawMode, setDrawMode] = useState<"poly" | "circle" | null>(null);
  const [circleKm, setCircleKm] = useState(15);
  const [ferrySel, setFerrySel] = useState(FERRIES[0].id);
  const [parkStatus, setParkStatus] = useState<string>("");
  const previewCtrl = useRef<AbortController | null>(null);
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
  const [keepView, setKeepView] = useState(false);
  /** határátkelő kijelölése a térképen */
  const [crossPick, setCrossPick] = useState(false);
  const [focus, setFocus] = useState<{ lat: number; lon: number; t: number } | null>(null);
  /** a kiszámolt útvonal pontjai (a sofőrnek küldéshez) */
  const [routeWps, setRouteWps] = useState<Waypoint[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(LS, JSON.stringify({
        vehicle, costs, fleet, defaultFleet,
        noGo: options.noGo, ferryOverrides: options.ferryOverrides, flexRules: options.flexRules, waitBans: options.waitBans,
        crossings: options.crossings, crossingsOff: options.crossingsOff, chDefault: true,
      } satisfies Saved));
    } catch { /* privát mód */ }
  }, [vehicle, costs, fleet, defaultFleet, options.noGo, options.ferryOverrides, options.flexRules, options.waitBans, options.crossings, options.crossingsOff]);

  const setWp = (i: number, w: Waypoint | null) => setWaypoints((ws) => ws.map((x, j) => (j === i ? w : x)));

  const addCrossingAt = useCallback(async (lat: number, lon: number) => {
    setCrossPick(false);
    const id = `x${uid()}`;
    const item: BorderCrossing = { id, name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon, countries: [], requireIn: [], mode: "any" };
    setOptions((o) => ({ ...o, crossings: [...(o.crossings ?? []), item] }));
    const patch = (p: Partial<BorderCrossing>) => setOptions((o) => ({ ...o, crossings: (o.crossings ?? []).map((c) => (c.id === id ? { ...c, ...p } : c)) }));
    try {
      const [b, g] = await Promise.all([
        fetch(`/api/border?lat=${lat}&lon=${lon}`).then((r) => r.json()),
        fetch(`/api/geocode?lat=${lat}&lon=${lon}&place=1`).then((r) => r.json()).catch(() => ({})),
      ]);
      const countries = [b.cc, b.neighbors?.[0]].filter(Boolean) as string[];
      const place = (g.results?.[0]?.label as string | undefined)?.split(/[—,]/)[0].trim();
      patch({ countries, requireIn: countries, ...(place ? { name: `${place} átkelő` } : {}) });
    } catch { /* kézzel állítható */ }
  }, []);

  const onPick = useCallback(async (lat: number, lon: number) => {
    const i = pickIdx;
    if (i === null) { if (crossPick) void addCrossingAt(lat, lon); return; }
    setPickIdx(null);
    const fallback = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    setWaypoints((ws) => ws.map((x, j) => (j === i ? { lat, lon, label: fallback } : x)));
    try {
      const r = await fetch(`/api/geocode?lat=${lat}&lon=${lon}`);
      const j = await r.json();
      const label = j.results?.[0]?.label;
      if (label) setWaypoints((ws) => ws.map((x, k) => (k === i && x?.lat === lat ? { ...x, label } : x)));
    } catch { /* marad a koordináta */ }
  }, [pickIdx, crossPick, addCrossingAt]);

  const ready = waypoints.every(Boolean);

  const calc = async (wpsIn: (Waypoint | null)[] = waypoints, carry?: PlanStop[], keep = false) => {
    if (!wpsIn.every(Boolean)) return;
    setKeepView(keep);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waypoints: wpsIn, vehicle, costs, options: { ...options, exclude: undefined } }),
      });
      const j = await res.json().catch(() => ({ error: `A szerver hibás választ adott (HTTP ${res.status}).` }));
      if (!res.ok) throw new Error(j.error ?? "Ismeretlen hiba");
      setRoutes(j.routes);
      setRouteWps(wpsIn as Waypoint[]);
      setExclude(j.exclude ?? []);
      setParkStatus("");
      setPlans(carry ? Object.fromEntries((j.routes as RouteResult[]).map((_, i) => [i, carry])) : {});
      setSelected(0);
      const wps = wpsIn as Waypoint[];
      const entry: Recent = { label: `${shortLabel(wps[0].label)} → ${shortLabel(wps[wps.length - 1].label)}`, waypoints: wps.filter((w) => !w.via || w.ferry) };
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
    const payload = btoa(encodeURIComponent(JSON.stringify({ w: waypoints, v: vehicle, o: { avoidTolls: options.avoidTolls, avoidHighways: options.avoidHighways, noGo: options.noGo, crossings: options.crossings, crossingsOff: options.crossingsOff } })));
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

  const sched = useMemo(() => ({ departure: options.departure, flexRules: options.flexRules, waitBans: options.waitBans }), [options.departure, options.flexRules, options.waitBans]);
  const routes = useMemo(
    () => rawRoutes.map((r, i) => applyPlan(r, plans[i] ?? autoPlan(r, sched, vehicle.weight), sched, vehicle.weight, costs)),
    [rawRoutes, plans, sched, vehicle.weight, costs],
  );
  const currentPlan = (): PlanStop[] => plans[selected] ?? (rawRoutes[selected] ? autoPlan(rawRoutes[selected], sched, vehicle.weight) : []);
  const setPlan = (p: PlanStop[]) => setPlans((all) => ({ ...all, [selected]: p }));
  const sameSpot = (w: Waypoint | null, a?: [number, number]) => !!w && !!a && Math.abs(w.lon - a[0]) < 1e-9 && Math.abs(w.lat - a[1]) < 1e-9;
  /** a megálló köztes pontjának eltávolítása a pontlistából (ha volt) */
  const withoutAnchor = (st?: PlanStop) => waypoints.filter((w) => !sameSpot(w, st?.anchor));
  const relabel = async (lat: number, lon: number) => {
    try {
      let label: string | undefined;
      for (const q of ["&place=1", ""]) {
        const r = await fetch(`/api/geocode?lat=${lat}&lon=${lon}${q}`);
        const j = await r.json();
        label = j.results?.[0]?.label;
        if (label) break;
      }
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
    if (wps.length >= 14) { setError("Legfeljebb 14 útpont engedélyezett."); return; }
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
    const moved = waypoints.map((x, j) => (j === i ? { ...x, lat, lon, label: `${lat.toFixed(5)}, ${lon.toFixed(5)}` } : x));
    setWaypoints(moved);
    void calc(moved, undefined, true);
    try {
      const r = await fetch(`/api/geocode?lat=${lat}&lon=${lon}`);
      const j = await r.json();
      const label = j.results?.[0]?.label;
      if (label) setWaypoints((ws) => ws.map((x, k) => (k === i && x?.lat === lat ? { ...x, label } : x)));
    } catch { /* marad a koordináta */ }
  };

  /** áthaladási pont beszúrása az útvonal mentén a megfelelő helyre (f = arány) */
  const insertVia = (f: number, lat: number, lon: number): Waypoint[] | null => {
    const route = rawRoutes[selected];
    const wps = waypoints.filter((w): w is Waypoint => !!w);
    if (!route || wps.length !== waypoints.length) return null;
    const cum = cumulative(route.geometry);
    const fs = wps.map((w, i) => (i === 0 ? 0 : i === wps.length - 1 ? 1 : snapToRoute(route.geometry, cum, [w.lon, w.lat]).f));
    let at = wps.length - 1;
    for (let i = 1; i < wps.length; i++) if (fs[i] >= f) { at = i; break; }
    const wp: Waypoint = { lat, lon, label: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, via: true };
    return [...wps.slice(0, at), wp, ...wps.slice(at)];
  };

  /** élő előnézet húzás közben (csak geometria) */
  const onRoutePreview = useCallback(async (f: number, lat: number, lon: number): Promise<LngLat[] | null> => {
    const next = insertVia(f, lat, lon);
    if (!next) return null;
    previewCtrl.current?.abort();
    const ctrl = new AbortController();
    previewCtrl.current = ctrl;
    const r = await fetch("/api/preview", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
      body: JSON.stringify({ waypoints: next, vehicle, options: { ...options, exclude } }),
    });
    if (!r.ok) return null;
    return (await r.json()).coords ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawRoutes, selected, waypoints, vehicle, options, exclude]);

  /** az útvonal megfogása és elengedése: új áthaladási pont a megfelelő helyre */
  const onRouteDrag = async (f: number, lat: number, lon: number) => {
    previewCtrl.current?.abort();
    if (waypoints.length >= 14) { setError("Legfeljebb 14 útpont engedélyezett – törölj egy áthaladási pontot (dupla kattintás)."); return; }
    const next = insertVia(f, lat, lon);
    if (!next) return;
    setWaypoints(next);
    void calc(next, undefined, true);
    void relabel(lat, lon);
  };
  const onWaypointRemove = (i: number) => {
    if (i === 0 || i === waypoints.length - 1) return;
    const next = waypoints.filter((_, j) => j !== i);
    setWaypoints(next);
    void calc(next, undefined, true);
  };

  const presetId = useMemo(
    () => fleet.find((p) => JSON.stringify(p.v) === JSON.stringify(vehicle))?.id
      ?? VEHICLE_PRESETS.find((p) => JSON.stringify(p.v) === JSON.stringify(vehicle))?.id ?? "custom",
    [vehicle, fleet],
  );
  const fleetItem = fleet.find((f) => f.id === presetId);
  const saveToFleet = () => {
    const name = window.prompt("A jármű neve a flottában (pl. rendszám vagy típus):", fleetItem?.name ?? "");
    if (!name?.trim()) return;
    const existing = fleet.find((f) => f.name === name.trim());
    const item: FleetItem = { id: existing?.id ?? `f${uid()}`, name: name.trim(), v: vehicle };
    setFleet((fl) => [...fl.filter((f) => f.id !== item.id), item]);
    if (!defaultFleet) setDefaultFleet(item.id);
  };

  // --- No-Go zónák ---
  const noGo = options.noGo ?? { countries: [], areas: [] };
  const setNoGo = (n: NoGo) => setOptions((o) => ({ ...o, noGo: n }));
  const toggleCountry = (cc: string) => setNoGo({ ...noGo, countries: noGo.countries.includes(cc) ? noGo.countries.filter((x) => x !== cc) : [...noGo.countries, cc] });
  const onDrawDone = (ring: LngLat[]) => {
    setDrawMode(null);
    const n = noGo.areas.length + 1;
    setNoGo({ ...noGo, areas: [...noGo.areas, { id: uid(), name: `Saját zóna ${n}`, ring }] });
  };
  // a No-Go zónák változásakor az útvonal automatikusan újraszámolódik
  const noGoKey = JSON.stringify(noGo);
  const lastNoGo = useRef(noGoKey);
  useEffect(() => {
    if (lastNoGo.current === noGoKey) return;
    lastNoGo.current = noGoKey;
    if (!rawRoutes.length || !waypoints.every(Boolean)) return;
    const t = setTimeout(() => { void calc(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noGoKey]);

  // --- feltételes határátkelők ---
  const crossings = options.crossings ?? [];
  const crossingsOff = options.crossingsOff ?? [];
  const setCrossing = (id: string, p: Partial<BorderCrossing>) => setOptions((o) => ({ ...o, crossings: (o.crossings ?? []).map((c) => (c.id === id ? { ...c, ...p } : c)) }));
  const removeCrossing = (id: string) => setOptions((o) => ({ ...o, crossings: (o.crossings ?? []).filter((c) => c.id !== id) }));
  const toggleBuiltin = (id: string) => setOptions((o) => ({ ...o, crossingsOff: (o.crossingsOff ?? []).includes(id) ? (o.crossingsOff ?? []).filter((x) => x !== id) : [...(o.crossingsOff ?? []), id] }));
  const exportCrossings = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ crossings }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "hatarakelok.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const importCrossings = async (file: File) => {
    try {
      const j = JSON.parse(await file.text());
      const list = (Array.isArray(j) ? j : j.crossings) as BorderCrossing[];
      if (!Array.isArray(list)) throw new Error();
      const ok = list.filter((c) => c && typeof c.id === "string" && Number.isFinite(c.lat) && Number.isFinite(c.lon) && Array.isArray(c.countries) && Array.isArray(c.requireIn));
      setOptions((o) => {
        const byId = new Map((o.crossings ?? []).map((c) => [c.id, c]));
        for (const c of ok) byId.set(c.id, { ...c, mode: c.mode ?? "any" });
        return { ...o, crossings: [...byId.values()] };
      });
      setError(null);
    } catch {
      setError("A fájl nem érvényes határátkelő-lista (JSON).");
    }
  };
  const crossStatus = useMemo(() => new Map((routes[selected]?.crossings ?? []).map((c) => [c.id, c])), [routes, selected]);
  // az átkelők / a rakodási pontok változásakor újraszámolás
  const crossKey = JSON.stringify([crossings, crossingsOff, waypoints.map((w) => w?.cargo ?? "")]);
  const lastCross = useRef(crossKey);
  useEffect(() => {
    if (lastCross.current === crossKey) return;
    lastCross.current = crossKey;
    if (!rawRoutes.length || !waypoints.every(Boolean)) return;
    const t = setTimeout(() => { void calc(undefined, undefined, true); }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossKey]);

  // --- komp / vasút ---
  const addFerry = () => {
    const line = ferryById(ferrySel);
    if (!line) return;
    if (waypoints.length >= 14) { setError("Legfeljebb 14 útpont engedélyezett."); return; }
    const fw = ferryWaypoint(line);
    // a legkisebb kerülőt adó helyre szúrjuk be
    const pts = waypoints.map((w) => (w ? ([w.lon, w.lat] as LngLat) : null));
    const d = (a: LngLat | null, b: LngLat | null) => (a && b ? Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) : 0);
    const me: LngLat = [fw.lon, fw.lat];
    let best = waypoints.length - 1;
    let bestCost = Infinity;
    for (let i = 1; i < waypoints.length; i++) {
      const c = d(pts[i - 1], me) + d(me, pts[i]) - d(pts[i - 1], pts[i]);
      if (c < bestCost) { bestCost = c; best = i; }
    }
    const next = [...waypoints.slice(0, best), fw, ...waypoints.slice(best)];
    setWaypoints(next);
    if (rawRoutes.length && next.every(Boolean)) void calc(next);
  };
  const setFerryOv = (id: string, patch: FerryOverride) =>
    setOptions((o) => {
      const cur = { ...(o.ferryOverrides?.[id] ?? {}), ...patch };
      for (const k of Object.keys(cur) as (keyof FerryOverride)[]) if (cur[k] === undefined || Number.isNaN(cur[k])) delete cur[k];
      return { ...o, ferryOverrides: { ...o.ferryOverrides, [id]: cur } };
    });
  const routeFerries = waypoints.filter((w): w is Waypoint => !!w?.ferry);

  // --- ideális pihenők: valós kamionparkolókhoz illesztés ---
  const onSnapParking = async () => {
    const raw = rawRoutes[selected];
    if (!raw) return;
    const plan = [...currentPlan()].sort((a, b) => a.f - b.f);
    const movable = plan.filter((p) => !p.anchor);
    if (!movable.length) { setParkStatus("Nincs áthelyezhető szünet / pihenő."); return; }
    setParkStatus("Kamionparkolók keresése az útvonal mentén…");
    const cum = cumulative(raw.geometry);
    const win = (p: PlanStop): LngLat[] => {
      const h = hoursAt(raw, p.f);
      const f0 = fractionAtHours(raw, Math.max(0, h - 2));
      const i0 = cum.findIndex((c) => c / (cum[cum.length - 1] || 1) >= f0);
      const i1 = cum.findIndex((c) => c / (cum[cum.length - 1] || 1) >= p.f);
      return raw.geometry.slice(Math.max(0, i0), Math.max(i0 + 2, i1 + 1));
    };
    try {
      const r = await fetch("/api/parkings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ windows: movable.map(win) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const cands = (j.parkings as { lon: number; lat: number; name: string; truck: boolean; services: boolean }[])
        .map((pk) => ({ ...pk, ...snapToRoute(raw.geometry, cum, [pk.lon, pk.lat]) }))
        .filter((pk) => pk.distKm < 1.6);
      let shiftH = 0;
      let moved = 0;
      const next = plan.map((p) => {
        if (p.anchor) return p;
        const hTarget = hoursAt(raw, p.f) - shiftH;
        const fTarget = fractionAtHours(raw, hTarget);
        const fMin = fractionAtHours(raw, Math.max(0, hTarget - (p.kind === "rest" ? 1.25 : 0.9)));
        const ok = cands.filter((c) => c.f >= fMin && c.f <= fTarget + 1e-6);
        // kamionparkoló előnyben, azon belül a legkésőbbi (a legkevesebb időveszteség)
        const best = ok.sort((a, b) => Number(b.truck) - Number(a.truck) || b.f - a.f)[0];
        if (!best) return { ...p, f: fTarget };
        shiftH += hTarget - hoursAt(raw, best.f);
        moved++;
        return { ...p, f: best.f, place: `🅿 ${best.name}` };
      });
      setPlan(next);
      setParkStatus(`${moved} / ${movable.length} megálló valós kamionparkolóhoz / pihenőhöz illesztve (${cands.length} találat az útvonal mentén).`);
    } catch (e) {
      setParkStatus((e as Error).message || "A parkolók nem tölthetők be.");
    }
  };
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
          <Card icon="route" title="Útvonal" hint="Jobb klikk: indulás / köztes pont / cél · az útvonal a térképen megfogható és húzható">
            <div className="relative space-y-2">
              <div className="absolute bottom-4 left-[13px] top-4 w-px border-l-2 border-dashed border-slate-300 dark:border-slate-600" />
              {waypoints.map((w, i) => {
                const first = i === 0;
                const last = i === waypoints.length - 1;
                return (
                  <WaypointInput
                    key={`${i}-${waypoints.length}-${w?.label ?? ""}`}
                    badge={w?.ferry ? (w.label.startsWith("🚆") ? "🚆" : "⛴") : first ? "A" : last ? "B" : w?.via ? "↝" : String(i)}
                    badgeClass={w?.ferry ? "bg-teal-600" : first ? "bg-emerald-500" : last ? "bg-rose-500" : "bg-slate-500"}
                    placeholder={first ? "Indulás (város, cím…)" : last ? "Érkezés" : w?.via ? "Áthaladási pont" : "Köztes pont"}
                    value={w}
                    picking={pickIdx === i}
                    onChange={(nw) => setWp(i, nw)}
                    onPickToggle={() => { setCrossPick(false); setPickIdx(pickIdx === i ? null : i); }}
                    cargo={w && !w.via && !w.ferry ? (w.cargo ?? (first ? "load" : last ? "unload" : "both")) : undefined}
                    onCargo={(k: CargoKind) => w && setWp(i, { ...w, cargo: k })}
                    onRemove={!first && !last ? () => (rawRoutes.length && w ? onWaypointRemove(i) : setWaypoints((ws) => ws.filter((_, j) => j !== i))) : undefined}
                  />
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <button className="btn flex-1" onClick={() => setWaypoints((ws) => [...ws.slice(0, -1), null, ws[ws.length - 1]])} disabled={waypoints.length >= 14}>
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
                const p = fleet.find((x) => x.id === e.target.value) ?? VEHICLE_PRESETS.find((x) => x.id === e.target.value);
                if (p) setVehicle(p.v);
              }}
            >
              {presetId === "custom" && <option value="custom">Egyéni beállítás (nincs mentve)</option>}
              {fleet.length > 0 && (
                <optgroup label="Saját flotta">
                  {fleet.map((p) => <option key={p.id} value={p.id}>{p.id === defaultFleet ? "★ " : ""}{p.name}</option>)}
                </optgroup>
              )}
              <optgroup label="Sablonok">
                {VEHICLE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            </select>
            <div className="-mt-1.5 mb-3 flex flex-wrap gap-1.5 text-xs">
              <button className="chip" onClick={saveToFleet}>💾 {fleetItem ? "Frissítés a flottában" : "Mentés a flottába"}</button>
              {fleetItem && fleetItem.id !== defaultFleet && <button className="chip" onClick={() => setDefaultFleet(fleetItem.id)}>★ Legyen alapértelmezett</button>}
              {fleetItem && fleetItem.id === defaultFleet && <span className="px-1 py-1 text-amber-600">★ Indításkor ez töltődik be</span>}
              {fleetItem && <button className="chip" onClick={() => { setFleet((fl) => fl.filter((f) => f.id !== fleetItem.id)); if (defaultFleet === fleetItem.id) setDefaultFleet(undefined); }}>🗑 Törlés</button>}
            </div>
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

          <Card icon="ban" title="No-Go zónák" hint="Az útvonal elkerüli ezeket az országokat / területeket"
            right={(noGo.countries.length + noGo.areas.length) > 0 ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">{noGo.countries.length + noGo.areas.length}</span> : undefined}>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {QUICK_NOGO.map((cc) => (
                <button key={cc} onClick={() => toggleCountry(cc)}
                  className={`rounded-full border px-2.5 py-1 transition ${noGo.countries.includes(cc) ? "border-red-500 bg-red-50 font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-200" : "border-slate-200 bg-white text-slate-600 hover:border-red-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
                  {flag(cc)} {COUNTRY_NAMES[cc]}{noGo.countries.includes(cc) ? " ✕" : ""}
                </button>
              ))}
              {noGo.countries.filter((cc) => !QUICK_NOGO.includes(cc)).map((cc) => (
                <button key={cc} onClick={() => toggleCountry(cc)} className="rounded-full border border-red-500 bg-red-50 px-2.5 py-1 font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-200">{flag(cc)} {COUNTRY_NAMES[cc] ?? cc} ✕</button>
              ))}
              <select className="field !py-1 text-xs" value="" onChange={(e) => e.target.value && toggleCountry(e.target.value)}>
                <option value="">+ ország…</option>
                {Object.entries(COUNTRY_NAMES).filter(([cc]) => !noGo.countries.includes(cc)).sort((a, b) => a[1].localeCompare(b[1], "hu")).map(([cc, n]) => <option key={cc} value={cc}>{n}</option>)}
              </select>
            </div>
            {noGo.areas.length > 0 && (
              <ul className="mt-2.5 space-y-1 text-xs">
                {noGo.areas.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 rounded-lg bg-red-50 px-2.5 py-1.5 dark:bg-red-950/30">
                    <span>⛔</span>
                    <input className="min-w-0 flex-1 bg-transparent outline-none" value={a.name} onChange={(e) => setNoGo({ ...noGo, areas: noGo.areas.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)) })} />
                    <button className="text-slate-400 hover:text-red-600" title="Törlés" onClick={() => setNoGo({ ...noGo, areas: noGo.areas.filter((x) => x.id !== a.id) })}>✕</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button className={`btn ${drawMode === "poly" ? "!border-red-500 !bg-red-50 !text-red-800" : ""}`} onClick={() => setDrawMode(drawMode === "poly" ? null : "poly")}>✏️ Terület rajzolása</button>
              <button className={`btn ${drawMode === "circle" ? "!border-red-500 !bg-red-50 !text-red-800" : ""}`} onClick={() => setDrawMode(drawMode === "circle" ? null : "circle")}>◯ Kör</button>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <input type="number" min={1} max={200} className="field w-14 !py-1" value={circleKm} onChange={(e) => setCircleKm(Math.max(1, parseFloat(e.target.value) || 1))} /> km
              </label>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-slate-500">Ha egy pont a zónán belül van (pl. a cél Svájcban), azt a zónát nem lehet elkerülni – erről figyelmeztetést kapsz.</p>
          </Card>

          <Card icon="ban" title="Feltételes határátkelők" hint="Csak akkor használható, ha a fuvarnak van felrakása / lerakása az adott országban – különben az útvonal elkerüli"
            right={crossings.length + BUILTIN_CROSSINGS.length > 0 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">{crossings.filter((c) => !c.disabled).length + BUILTIN_CROSSINGS.filter((c) => !crossingsOff.includes(c.id)).length}</span> : undefined}>
            {BUILTIN_CROSSINGS.length > 0 && (
              <ul className="mb-2 space-y-1 text-xs">
                {BUILTIN_CROSSINGS.map((c) => {
                  const st = crossStatus.get(c.id);
                  return (
                    <li key={c.id} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${crossingsOff.includes(c.id) ? "bg-slate-100 opacity-60 dark:bg-slate-800" : "bg-amber-50 dark:bg-amber-950/30"}`}>
                      <span>🛂</span>
                      <button className="min-w-0 flex-1 truncate text-left" onClick={() => setFocus({ lat: c.lat, lon: c.lon, t: Date.now() })} title={c.note}>
                        <b>{c.name}</b> {c.countries.map(flag).join("–")} · {c.requireIn.map((x) => COUNTRY_NAMES[x] ?? x).join("/")} {MODE_LABEL[c.mode]}
                        {st && <span className={st.used && !st.allowed ? "text-red-600" : st.allowed ? "text-emerald-600" : "text-slate-500"}> · {st.used ? (st.allowed ? "használja" : "érinti!") : st.allowed ? "használható" : "elkerülve"}</span>}
                      </button>
                      <input type="checkbox" checked={!crossingsOff.includes(c.id)} onChange={() => toggleBuiltin(c.id)} title="Érvényes" />
                    </li>
                  );
                })}
              </ul>
            )}
            {crossings.length > 0 && (
              <ul className="space-y-1.5 text-xs">
                {crossings.map((c) => {
                  const st = crossStatus.get(c.id);
                  const sides = c.countries.length ? c.countries : [];
                  return (
                    <li key={c.id} className={`rounded-lg px-2.5 py-2 ${c.disabled ? "bg-slate-100 opacity-60 dark:bg-slate-800" : "bg-amber-50 dark:bg-amber-950/30"}`}>
                      <div className="flex items-center gap-2">
                        <button title="Megmutatás a térképen" onClick={() => setFocus({ lat: c.lat, lon: c.lon, t: Date.now() })}>🛂</button>
                        <input className="min-w-0 flex-1 bg-transparent font-medium outline-none" value={c.name} onChange={(e) => setCrossing(c.id, { name: e.target.value })} />
                        <span className="shrink-0">{sides.map(flag).join("–")}</span>
                        <input type="checkbox" checked={!c.disabled} onChange={(e) => setCrossing(c.id, { disabled: !e.target.checked })} title="Érvényes" />
                        <button className="text-slate-400 hover:text-red-600" title="Törlés" onClick={() => removeCrossing(c.id)}>✕</button>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-slate-500">Csak ha</span>
                        <select className="field !py-0.5 !text-xs" value={c.mode} onChange={(e) => setCrossing(c.id, { mode: e.target.value as BorderCrossing["mode"] })}>
                          <option value="any">felrakás vagy lerakás</option>
                          <option value="load">felrakás</option>
                          <option value="unload">lerakás</option>
                        </select>
                        <span className="text-slate-500">van itt:</span>
                        {sides.map((cc) => (
                          <button key={cc} onClick={() => setCrossing(c.id, { requireIn: c.requireIn.includes(cc) ? c.requireIn.filter((x) => x !== cc) : [...c.requireIn, cc] })}
                            className={`rounded-full border px-2 py-0.5 ${c.requireIn.includes(cc) ? "border-amber-500 bg-white font-semibold text-amber-800 dark:bg-slate-900 dark:text-amber-300" : "border-slate-200 text-slate-400 line-through dark:border-slate-700"}`}>
                            {flag(cc)} {COUNTRY_NAMES[cc] ?? cc}
                          </button>
                        ))}
                        <select className="field !py-0.5 !text-xs" value="" title="Ország hozzáadása" onChange={(e) => e.target.value && setCrossing(c.id, { countries: [...sides, e.target.value], requireIn: [...c.requireIn, e.target.value] })}>
                          <option value="">+</option>
                          {Object.entries(COUNTRY_NAMES).filter(([cc]) => !sides.includes(cc)).sort((a, b) => a[1].localeCompare(b[1], "hu")).map(([cc, n]) => <option key={cc} value={cc}>{n}</option>)}
                        </select>
                      </div>
                      {!c.requireIn.length && <div className="mt-1 text-amber-700">Nincs ország kijelölve: a két oldal bármelyikében elég a rakodás.</div>}
                      {st && (
                        <div className={`mt-1 ${st.used && !st.allowed ? "text-red-600" : st.allowed ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500"}`}>
                          {st.used ? (st.allowed ? "✅ " : "⛔ ") : st.allowed ? "➖ " : "↪ "}{st.reason}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button className={`btn ${crossPick ? "!border-amber-500 !bg-amber-50 !text-amber-800" : ""}`} onClick={() => { setPickIdx(null); setDrawMode(null); setCrossPick((x) => !x); }}>🛂 Átkelő kijelölése a térképen</button>
              {crossings.length > 0 && <button className="chip text-xs" onClick={exportCrossings}>⬇ Export</button>}
              <label className="chip cursor-pointer text-xs">⬆ Import<input type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCrossings(f); e.target.value = ""; }} /></label>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              Kattints pontosan az átkelőre (a határon átmenő útra). A rakodás típusát az útpontok mellett állíthatod (alapból: indulás = felrakás, érkezés = lerakás, köztes pont = mindkettő). A lista a böngészőben marad, és a megosztott linkkel együtt utazik; JSON-ként a kollégáknak is átadható.
            </p>
          </Card>

          <Card icon="ferry" title="Komp / vasút" hint="Pontos járat kiválasztása (pl. Dover–Calais, Hoek van Holland–Harwich, RoLa)">
            <div className="flex gap-2">
              <select className="field min-w-0 flex-1" value={ferrySel} onChange={(e) => setFerrySel(e.target.value)}>
                {[...new Set(FERRIES.map((f) => f.region))].map((rg) => (
                  <optgroup key={rg} label={rg}>
                    {FERRIES.filter((f) => f.region === rg).map((f) => <option key={f.id} value={f.id}>{f.kind === "rail" ? "🚆" : "⛴"} {f.name}</option>)}
                  </optgroup>
                ))}
              </select>
              <button className="btn shrink-0" onClick={addFerry} disabled={waypoints.length >= 14}><Ico name="plus" /> Útvonalba</button>
            </div>
            {(() => {
              const f = ferryById(ferrySel);
              if (!f) return null;
              return (
                <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
                  {f.operator} · {f.durationH} ó menetidő + {f.checkInH} ó beszállás · {f.departures} · {f.berth ? "fekhellyel" : "fekhely nélkül"} ·{" "}
                  <b className={f.confidence === "estimate" ? "text-amber-600" : "text-emerald-600"}>{Math.round(f.priceEur)} €{f.confidence === "estimate" ? " (becslés)" : f.confidence === "ratecard" ? " (díjtábla)" : " (hivatalos)"}</b>
                </p>
              );
            })()}
            {routeFerries.length > 0 && (
              <ul className="mt-2.5 space-y-1.5">
                {routeFerries.map((w) => {
                  const f = ferryById(w.ferry!)!;
                  const ov = options.ferryOverrides?.[f.id] ?? {};
                  return (
                    <li key={f.id} className="rounded-lg bg-teal-50 px-2.5 py-2 text-xs dark:bg-teal-950/30">
                      <div className="flex items-center justify-between gap-2 font-medium"><span>{w.label}</span>
                        <button className="text-slate-400 hover:text-red-600" title="Eltávolítás" onClick={() => { const i = waypoints.indexOf(w); if (i >= 0) onWaypointRemove(i); }}>✕</button>
                      </div>
                      <div className="mt-1.5 grid grid-cols-2 gap-2">
                        <label className="block"><span className="text-[10px] text-slate-500">Saját ár (€, üres = katalógus)</span>
                          <input type="number" className="field w-full !py-1" placeholder={String(Math.round(f.priceEur))} value={ov.priceEur ?? ""} onChange={(e) => setFerryOv(f.id, { priceEur: e.target.value === "" ? undefined : parseFloat(e.target.value) })} /></label>
                        <label className="block"><span className="text-[10px] text-slate-500">Menetidő (óra)</span>
                          <input type="number" step={0.25} className="field w-full !py-1" placeholder={String(f.durationH)} value={ov.durationH ?? ""} onChange={(e) => setFerryOv(f.id, { durationH: e.target.value === "" ? undefined : parseFloat(e.target.value) })} /></label>
                      </div>
                    </li>
                  );
                })}
                <li className="text-[11px] text-slate-500">A saját (szerződéses) árak a böngészőben megmaradnak. Az ár/idő módosítása után számold újra.</li>
              </ul>
            )}
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
              <Toggle checked={options.waitBans !== false} onChange={(v) => setOptions({ ...options, waitBans: v })} label="Tilalmak kivárása az ETA-ban" icon="clock" />
              <Toggle checked={options.flexRules !== false} onChange={(v) => setOptions({ ...options, flexRules: v })} label="10 órás nap / 9 órás pihenő" icon="clock" />
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
              <Num label="EUR/HUF" unit="Ft" value={costs.eurHuf} step={1} onChange={(e) => setCosts({ ...costs, eurHuf: parseFloat(e.target.value) || 0 })} />
              <Num label="Sofőr (munkaidő)" unit="€/óra" value={costs.driverHourly} step={0.5} onChange={(e) => setCosts({ ...costs, driverHourly: parseFloat(e.target.value) || 0 })} />
              <Num label="Napidíj, szállás" unit="€/nap" value={costs.driverDaily} step={1} onChange={(e) => setCosts({ ...costs, driverDaily: parseFloat(e.target.value) || 0 })} />
              <Num label="Gumi, szerviz, kopás" unit="€/km" value={costs.vehicleKm} step={0.01} onChange={(e) => setCosts({ ...costs, vehicleKm: parseFloat(e.target.value) || 0 })} />
              <Num label="Amortizáció, biztosítás" unit="€/nap" value={costs.vehicleDaily} step={5} onChange={(e) => setCosts({ ...costs, vehicleDaily: parseFloat(e.target.value) || 0 })} />
            </div>
            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              Amortizáció / nap ≈ (vételár − maradványérték) ÷ (évek × ~240 munkanap), plusz lízing, biztosítás, gépjárműadó. Pl. 110 000 € − 35 000 € 5 év alatt ≈ 63 €/nap + biztosítás.
              A napi tételek az út naptári napjaival szorzódnak; a sofőr óradíja a vezetési + szünet + beszállási időre vonatkozik.
            </p>
          </details>

          {routes.length > 0 && (
            <>
              <button className="btn w-full" onClick={share}>
                <Ico name="link" /> {copied ? "Link a vágólapon ✓" : "Megosztható link másolása"}
              </button>
              <Results routes={routes} selected={selected} onSelect={setSelected} costs={costs} onAddStop={onAddStop} onRemoveStop={onRemoveStop} onResetStops={onResetStops} edited={!!plans[selected]} onSnapParking={onSnapParking} parkStatus={parkStatus} waypoints={routeWps} departure={options.departure} />
            </>
          )}

          <p className="px-1 pt-1 text-[11px] leading-relaxed text-slate-400">
            Térkép és úthálózat: © OpenStreetMap közreműködők. Útvonaltervezés: Valhalla. Geokódolás: Photon. Parkolók, korlátozások: Overpass.
            Az útdíjak nettó (ÁFA nélküli) összegek, 2026-os hivatalos tarifákból; a tilalmak és kompárak tájékoztató jellegűek – fuvar előtt ellenőrizd a hivatalos forrásokat.
          </p>
        </div>

        <footer className={`shrink-0 border-t border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 ${panelOpen ? "" : "hidden md:block"}`}>
          {error && <div className="mb-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">{error}</div>}
          {best && !loading && (
            <div className="mb-2 flex items-center justify-between rounded-lg bg-slate-100 px-3 py-1.5 text-xs dark:bg-slate-800">
              <span className="text-slate-500"><b className="text-slate-800 dark:text-slate-100">{Math.round(best.roadKm).toLocaleString("hu-HU")} km</b> · útdíj <b className="text-amber-700 dark:text-amber-400">{Math.round(best.tollTotalEur).toLocaleString("hu-HU")} €</b> · {Math.floor(best.drivingMin / 60)} ó {Math.round(best.drivingMin % 60)} p</span>
              <span className="font-bold tabular-nums">{Math.round(best.totalEur).toLocaleString("hu-HU")} €</span>
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
          pickMode={pickIdx ?? (crossPick ? -1 : null)}
          onPick={onPick}
          onSelectRoute={setSelected}
          onStopMove={onStopMove}
          onStopDrop={onStopDrop}
          onWaypointDrag={onWaypointDrag}
          onRouteDrag={onRouteDrag}
          onWaypointRemove={onWaypointRemove}
          keepView={keepView}
          zoneCountries={noGo.countries}
          zoneAreas={noGo.areas}
          drawMode={drawMode}
          circleKm={circleKm}
          onDrawDone={onDrawDone}
          onDrawCancel={() => setDrawMode(null)}
          onRoutePreview={onRoutePreview}
          crossings={[...BUILTIN_CROSSINGS.filter((c) => !crossingsOff.includes(c.id)), ...crossings.filter((c) => !c.disabled)]}
          crossStatus={crossStatus}
          focus={focus}
          onPickCancel={() => { setPickIdx(null); setCrossPick(false); }}
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
