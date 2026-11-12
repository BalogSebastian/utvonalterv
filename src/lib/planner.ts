import { COUNTRY_NAMES, countryAt } from "./countries";
import { decodePolyline, encodePolyline } from "./polyline";
import { TOLL_RULES, fixedFee, isTolledEdge, ratePerKm } from "./tolls";
import { SPECIALS, specialFee } from "./specials";
import { ferryPath, ferryPrice, matchFerry, pathKm, splitByFerries, type FerryLine } from "./ferries";
import { buildZones, inZone } from "./zones";
import { activeCrossings, crossingAllowed, nearestOnLine, passesKm } from "./crossings";
import { waypointCountries } from "./wpcountry";
import { applyPlan, autoPlan } from "./schedule";
import { DEFAULT_COSTS } from "./presets";
import {
  routeRequest, traceEdges, type Excl, type VLeg, type VTrip,
} from "./valhalla";
import type {
  BorderCrossing, CountryLeg, CrossingUse, FerryLeg, LngLat, RouteRequest, RouteResult, TimeProfile, TollBreakdownItem, SpecialItem,
} from "./types";

interface EdgeLike {
  km: number;
  toll: boolean;
  roadClass?: string;
  name?: string;
  names?: string[];
  /** ország a routing-szerver közigazgatási adataiból (pontos határ) */
  cc?: string;
  a: LngLat;
  b: LngLat;
  /** index range a geometria pontjaiban (tollGeometry-hez) */
  i0: number;
  i1: number;
  /** komp / autós vonat él */
  ferry?: boolean;
}

/** Közel egymás melletti pontok ritkítása a térképes megjelenítéshez (~12 m). */
function thin(coords: LngLat[]): LngLat[] {
  if (coords.length < 3) return coords;
  const out: LngLat[] = [coords[0]];
  let last = coords[0];
  const tol = 0.00011;
  for (let i = 1; i < coords.length - 1; i++) {
    const c = coords[i];
    if (Math.abs(c[0] - last[0]) > tol * 1.5 || Math.abs(c[1] - last[1]) > tol) {
      out.push(c);
      last = c;
    }
  }
  out.push(coords[coords.length - 1]);
  return out;
}

/** az út legjobb megnevezése: útszám (M1, A4, D2, S16…), nem az E-szám vagy utcanév */
function refName(names?: string[]): string | undefined {
  if (!names?.length) return undefined;
  return (
    names.find((n) => /^[A-DF-Z][A-Z]{0,2} ?\d{1,4}[a-z]?$/.test(n)) ??
    names.find((n) => /^\d{1,4}$/.test(n)) ??
    names.find((n) => /^E ?\d+$/.test(n)) ??
    names[0]
  );
}

/** reális kamionos átlagsebesség (km/h) útosztályonként */
const TRUCK_SPEED: Record<string, number> = {
  motorway: 82, trunk: 72, primary: 62, secondary: 52, tertiary: 45,
  unclassified: 38, residential: 30, service_other: 25,
};

const CHUNK_KM = Number(process.env.TRACE_CHUNK_KM) || 300;

/** Egy leg élei, manőverhatáron ~300 km-es darabokban lekérve (a publikus szerver 1000 km-es limitje miatt). */
async function legEdges(
  leg: VLeg,
  v: RouteRequest["vehicle"],
  o: RouteRequest["options"],
): Promise<{ coords: LngLat[]; edges: EdgeLike[]; exact: boolean }> {
  const coords = decodePolyline(leg.shape);
  const chunks: { from: number; to: number; ms: typeof leg.maneuvers }[] = [];
  let cur: typeof leg.maneuvers = [];
  let curKm = 0;
  for (const m of leg.maneuvers) {
    if (m.end_shape_index <= m.begin_shape_index) continue;
    cur.push(m);
    curKm += m.length;
    if (curKm >= CHUNK_KM) {
      chunks.push({ from: cur[0].begin_shape_index, to: m.end_shape_index, ms: cur });
      cur = [];
      curKm = 0;
    }
  }
  if (cur.length) chunks.push({ from: cur[0].begin_shape_index, to: cur[cur.length - 1].end_shape_index, ms: cur });

  let exact = true;
  const edges: EdgeLike[] = [];
  const results: PromiseSettledResult<Awaited<ReturnType<typeof traceEdges>>>[] = [];
  const CONC = 3;
  for (let i = 0; i < chunks.length; i += CONC) {
    const batch = chunks.slice(i, i + CONC).map((c) =>
      traceEdges({ ...leg, shape: encodePolyline(coords.slice(c.from, c.to + 1)) }, v, o),
    );
    results.push(...(await Promise.allSettled(batch)));
  }
  // a ferry élek a 'use' mezőből jönnek; manőver-szinten a típus (28/29 = komp be/ki)
  chunks.forEach((c, ci) => {
    const t = results[ci];
    if (t.status === "fulfilled" && t.value.edges?.length) {
      const sh = decodePolyline(t.value.shape);
      const admins = t.value.admins ?? [];
      for (const e of t.value.edges) {
        const ai = e.end_node?.admin_index;
        const cc = ai !== undefined ? admins[ai]?.country_code : undefined;
        const ferry = e.use === "ferry" || e.use === "rail-ferry";
        edges.push({
          ferry, km: e.length, toll: !!e.toll, roadClass: e.road_class, name: refName(e.names), names: e.names, cc: cc || undefined,
          a: sh[e.begin_shape_index], b: sh[e.end_shape_index],
          i0: c.from + e.begin_shape_index, i1: c.from + e.end_shape_index,
        });
      }
    } else {
      exact = false;
      for (const m of c.ms) {
        edges.push({
          ferry: !!m.ferry, km: m.length, toll: !!m.toll, roadClass: m.highway ? "motorway" : undefined, name: m.street_names?.[0],
          a: coords[m.begin_shape_index], b: coords[m.end_shape_index],
          i0: m.begin_shape_index, i1: m.end_shape_index,
        });
      }
    }
  });
  return { coords, edges, exact };
}

/** egy útvonal-rész: közúti (Valhalla) vagy kiválasztott komp / vasúti járat */
type Part = { kind: "road"; trip: VTrip } | { kind: "ferry"; line: FerryLine; reverse: boolean };

const CONF_WEIGHT = { official: 0.99, source: 0.95, estimate: 0.8, none: 0.7 } as const;

interface CrossCtx { all: BorderCrossing[]; status: Map<string, { allowed: boolean; reason: string }> }

async function analyse(parts: Part[], req: RouteRequest, id: number, unavoidable: string[], cx: CrossCtx): Promise<RouteResult> {
  const { vehicle: v, costs: c0, options: o } = req;
  const c = { ...DEFAULT_COSTS, ...c0 };
  const depMs = Date.parse(`${o.departure}:00Z`);

  // --- geometria + élek ---
  const fullCoords: LngLat[] = [];
  const edges: EdgeLike[] = [];
  let accuracy: "edge" | "maneuver" = "edge";
  let valhallaRoadMin = 0;
  const chosen: { line: FerryLine; reverse: boolean; i0: number; i1: number }[] = [];
  const maneuvers: RouteResult["maneuvers"] = [];

  for (const part of parts) {
    const base = fullCoords.length ? fullCoords.length - 1 : 0;
    if (part.kind === "ferry") {
      const path = ferryPath(part.line, part.reverse);
      const km = pathKm(path);
      edges.push({ ferry: true, km, toll: false, roadClass: "ferry", a: path[0], b: path[path.length - 1], i0: base, i1: base + path.length - 1 });
      chosen.push({ ...part, i0: base, i1: base + path.length - 1 });
      fullCoords.push(...(fullCoords.length ? path.slice(1) : path));
      const dep = part.reverse ? part.line.b : part.line.a;
      const arr = part.reverse ? part.line.a : part.line.b;
      maneuvers.push({ text: `${part.line.kind === "rail" ? "🚆" : "⛴"} ${part.line.name}: ${dep.name} → ${arr.name} (${part.line.operator})`, km, min: part.line.durationH * 60 });
      continue;
    }
    valhallaRoadMin += part.trip.summary.time / 60;
    for (const leg of part.trip.legs) {
      const b0 = fullCoords.length ? fullCoords.length - 1 : 0;
      const r = await legEdges(leg, v, o);
      if (!r.exact) accuracy = "maneuver";
      for (const e of r.edges) edges.push({ ...e, i0: e.i0 + b0, i1: e.i1 + b0 });
      fullCoords.push(...(fullCoords.length ? r.coords.slice(1) : r.coords));
      maneuvers.push(...leg.maneuvers.map((m) => ({ text: m.instruction, km: m.length, min: m.time / 60, street: m.street_names?.[0] })));
    }
  }

  // --- geometriai arány (0..1) a pontokhoz ---
  const cumG: number[] = [0];
  for (let i = 1; i < fullCoords.length; i++) {
    const [x1, y1] = fullCoords[i - 1];
    const [x2, y2] = fullCoords[i];
    const dx = (x2 - x1) * Math.cos(((y1 + y2) / 2) * (Math.PI / 180)) * 111.32;
    cumG.push(cumG[i - 1] + Math.hypot(dx, (y2 - y1) * 110.57));
  }
  const geoKm = cumG[cumG.length - 1] || 1;
  const fAt = (i: number) => Math.min(1, cumG[Math.min(i, cumG.length - 1)] / geoKm);

  // --- országok, díjköteles km-ek ---
  let curCountry = countryAt(fullCoords[0]) ?? "??";
  interface Visit { country: string; km: number; tollKm: number; startKm: number; cost: number }
  const visits: Visit[] = [];
  const tollRuns: [number, number][] = [];
  let cumKm = 0;
  let totalKm = 0;
  let roadKm = 0;
  for (const e of edges) { totalKm += e.km; if (!e.ferry) roadKm += e.km; }

  const perCountry = new Map<string, { km: number; tollKm: number; cost: number }>();
  const roadKmBy = new Map<string, Map<string, number>>();
  const specialKm = new Map<string, number>();
  const zones = buildZones(o.noGo);
  const zoneKm = new Map<string, number>();
  const autoFerries: { i0: number; i1: number; km: number }[] = [];
  for (const e of edges) {
    if (e.ferry) {
      // a routing által választott (nem a felhasználó által kijelölt) komp
      if (!chosen.some((x) => e.i0 >= x.i0 && e.i1 <= x.i1)) {
        const last = autoFerries[autoFerries.length - 1];
        if (last && last.i1 === e.i0) { last.i1 = e.i1; last.km += e.km; }
        else autoFerries.push({ i0: e.i0, i1: e.i1, km: e.km });
      }
      cumKm += e.km;
      continue;
    }
    const mid: LngLat = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
    const cc = e.cc ?? countryAt(mid) ?? countryAt(e.a) ?? curCountry;
    curCountry = cc;
    for (const z of zones) {
      if (z.country ? z.country === cc : inZone(z, mid)) zoneKm.set(z.id, (zoneKm.get(z.id) ?? 0) + e.km);
    }
    let replaced = false;
    if (e.names?.length) {
      for (const sp of SPECIALS) {
        if (!sp.test(e.names, cc, mid)) continue;
        specialKm.set(sp.id, (specialKm.get(sp.id) ?? 0) + e.km);
        if (sp.replacesKm) replaced = true;
      }
    }
    const rule = TOLL_RULES[cc];
    const tolled = rule ? isTolledEdge(rule, e.roadClass, e.toll) : false;
    const cost = tolled && rule && !replaced ? e.km * ratePerKm(rule, v, e.roadClass, c.eurHuf, mid, depMs) : 0;
    let last = visits[visits.length - 1];
    if (!last || last.country !== cc) {
      last = { country: cc, km: 0, tollKm: 0, startKm: cumKm, cost: 0 };
      visits.push(last);
    }
    last.km += e.km;
    const agg = perCountry.get(cc) ?? { km: 0, tollKm: 0, cost: 0 };
    agg.km += e.km;
    if (tolled) {
      last.tollKm += e.km;
      last.cost += cost;
      agg.tollKm += e.km;
      agg.cost += cost;
      if (e.name) {
        const m = roadKmBy.get(cc) ?? new Map<string, number>();
        m.set(e.name, (m.get(e.name) ?? 0) + e.km);
        roadKmBy.set(cc, m);
      }
      const lastRun = tollRuns[tollRuns.length - 1];
      if (lastRun && lastRun[1] === e.i0) lastRun[1] = e.i1;
      else tollRuns.push([e.i0, e.i1]);
    }
    perCountry.set(cc, agg);
    cumKm += e.km;
  }

  // határ menti "villogás" kisimítása: a rövid (<8 km) szakaszt beolvasztjuk, ha előtte és utána ugyanaz az ország
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < visits.length; i++) {
      const cur = visits[i];
      const prev = visits[i - 1];
      const next = visits[i + 1];
      if (cur.km >= 8 || (!prev && !next)) continue;
      if (prev && next && prev.country === next.country) {
        prev.km += cur.km + next.km;
        prev.tollKm += cur.tollKm + next.tollKm;
        prev.cost += cur.cost + next.cost;
        visits.splice(i, 2);
        changed = true;
        break;
      }
    }
  }

  // --- útdíj ---
  const tollBreakdown: TollBreakdownItem[] = [];
  for (const [cc, a] of perCountry) {
    const rule = TOLL_RULES[cc];
    const name = COUNTRY_NAMES[cc] ?? cc;
    if (!rule) {
      tollBreakdown.push({ country: cc, tollKm: 0, perKm: 0, fixed: 0, total: 0, note: `${name}: nincs kamion-útdíj (vagy nincs modellezve).`, roads: [], confidence: "none", asOf: "" });
      continue;
    }
    const perKm = a.tollKm > 0 ? a.cost / a.tollKm : rule.fixedFn ? 0 : ratePerKm(rule, v, "motorway", c.eurHuf, undefined, depMs);
    const fixed = a.km > 0 && (rule.fixed || rule.fixedFn) ? fixedFee(rule, v) : 0;
    tollBreakdown.push({
      country: cc, tollKm: a.tollKm, perKm, fixed,
      total: a.cost + fixed,
      note: `${rule.system}. ${rule.note}`,
      roads: [...(roadKmBy.get(cc)?.entries() ?? [])].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([n]) => n),
      confidence: rule.confidence,
      asOf: rule.asOf,
    });
  }
  const specials: SpecialItem[] = [];
  for (const sp of SPECIALS) {
    const km = specialKm.get(sp.id) ?? 0;
    if (km < sp.minKm) continue;
    const fee = specialFee(sp, v, km);
    specials.push({ id: sp.id, name: sp.name, country: sp.country, km, fee, modelled: !!sp.fees, note: sp.note, confidence: sp.confidence, asOf: sp.asOf });
  }
  const specialsTotalEur = specials.reduce((s, x) => s + x.fee, 0);
  const tollTotalEur = tollBreakdown.reduce((s, t) => s + t.total, 0) + specialsTotalEur;
  const tollKm = tollBreakdown.reduce((s, t) => s + t.tollKm, 0);
  // becsült pontosság: a tarifák megbízhatóságával súlyozva
  let wSum = 0;
  let wConf = 0;
  for (const t of tollBreakdown) { wSum += t.total; wConf += t.total * CONF_WEIGHT[t.confidence]; }
  for (const sp of specials) {
    const w = sp.modelled ? sp.fee : 150;
    wSum += w;
    wConf += w * (sp.modelled ? CONF_WEIGHT[sp.confidence] : 0.5);
  }
  let tollConfidence = wSum > 0 ? wConf / wSum : 1;
  if (accuracy === "maneuver") tollConfidence *= 0.95;

  // --- kompok / vasúti járatok ---
  const ferries: FerryLeg[] = [];
  const legOf = (line: FerryLine | null, reverse: boolean, i0: number, i1: number, km: number): FerryLeg => {
    const ov = line ? o.ferryOverrides?.[line.id] : undefined;
    const dep = line ? (reverse ? line.b : line.a) : null;
    const arr = line ? (reverse ? line.a : line.b) : null;
    return {
      id: line?.id ?? `auto${i0}`,
      name: line?.name ?? "Komp (a katalógusban nem szereplő járat)",
      kind: line?.kind ?? "ferry",
      from: dep?.name ?? "?", to: arr?.name ?? "?",
      f0: fAt(i0), f1: fAt(i1), km,
      durationH: ov?.durationH ?? line?.durationH ?? Math.max(0.5, km / 28),
      checkInH: line?.checkInH ?? 1,
      priceEur: line ? ferryPrice(line, v, ov, reverse) : 0,
      berth: line?.berth ?? false,
      priced: !line ? "estimate" : ov?.priceEur !== undefined ? "user" : "catalog",
      note: line ? `${line.operator}. ${line.note}` : "A routing kompot választott, de a járat nincs a katalógusban – a díj nincs bekalkulálva. Válaszd ki a járatot a Komp / vasút kártyán.",
      geometry: fullCoords.slice(i0, i1 + 1),
    };
  };
  for (const x of chosen) ferries.push(legOf(x.line, x.reverse, x.i0, x.i1, edges.find((e) => e.ferry && e.i0 === x.i0)?.km ?? 0));
  for (const x of autoFerries) {
    const m = matchFerry(fullCoords[x.i0], fullCoords[x.i1]);
    ferries.push(legOf(m?.line ?? null, m?.reverse ?? false, x.i0, x.i1, x.km));
  }
  ferries.sort((a, b) => a.f0 - b.f0);
  const ferryTotalEur = ferries.reduce((s, f) => s + f.priceEur, 0);

  // --- idő-profil: útvonal-arány → vezetési óra (kamionos sebességmodell útosztályonként) ---
  // Ha nincs élszintű adat: a Valhalla ideje +20%.
  const roadModelMin = edges.reduce((sum, e) => sum + (e.ferry ? 0 : (e.km / (TRUCK_SPEED[e.roadClass ?? ""] ?? 40)) * 60), 0);
  const scale = accuracy === "edge" || !roadModelMin ? 1 : (valhallaRoadMin * 1.2) / roadModelMin;
  const profile: TimeProfile = [[0, 0]];
  let hAcc = 0;
  let lastF = 0;
  for (const e of edges) {
    if (!e.ferry) hAcc += ((e.km / (TRUCK_SPEED[e.roadClass ?? ""] ?? 40)) * scale);
    const f = fAt(e.i1);
    if (f - lastF > 0.0015 || e.ferry) { profile.push([f, hAcc]); lastF = f; }
  }
  if (profile[profile.length - 1][0] < 1) profile.push([1, hAcc]);
  const drivingMin = hAcc * 60;

  const countries: CountryLeg[] = visits.map((vis) => ({
    country: vis.country, startKm: vis.startKm, km: vis.km, tollKm: vis.tollKm, toll: vis.cost, enter: "", leave: "",
  }));

  // --- No-Go zónák ellenőrzése (pontos, élszintű országadattal) ---
  const noGo = zones
    .map((z) => ({ name: z.name, km: zoneKm.get(z.id) ?? 0, unavoidable: unavoidable.includes(z.name) }))
    .filter((z) => z.km > 0.5);

  // --- feltételes határátkelők az útvonal mentén ---
  const crossings: CrossingUse[] = [];
  for (const cr of cx.all) {
    const st = cx.status.get(cr.id);
    if (!st) continue;
    const n = nearestOnLine(fullCoords, [cr.lon, cr.lat]);
    if (n.km > 40) continue;
    const used = n.km <= passesKm(cr);
    crossings.push({
      id: cr.id, name: cr.name, countries: cr.countries, allowed: st.allowed, used, distKm: n.km,
      reason: used && !st.allowed
        ? `${st.reason.replace(/, ezért elkerüljük\.$/, ".")} Nem sikerült elkerülni – nincs más engedélyezett út, vagy egy útpont az átkelőnél van.`
        : st.reason,
    });
  }
  crossings.sort((a, b) => Number(b.used && !b.allowed) - Number(a.used && !a.allowed) || Number(b.used) - Number(a.used) || a.distKm - b.distKm);

  // --- közvetlen költségek (a sofőr és a napi költség a menetrendből jön: applyPlan) ---
  const fuelLiters = (roadKm * v.consumption) / 100;
  const fuelCostEur = fuelLiters * c.fuelPrice;
  const tollGeometry = tollRuns.map(([i0, i1]) => fullCoords.slice(i0, i1 + 1));

  const base: RouteResult = {
    id,
    distanceKm: totalKm,
    roadKm,
    tollKm,
    drivingMin,
    geometry: thin(fullCoords),
    tollGeometry: tollGeometry.map(thin).filter((g) => g.length > 1),
    countries,
    tollBreakdown,
    tollTotalEur,
    tollConfidence,
    specials,
    specialsTotalEur,
    ferries: ferries.map((f) => ({ ...f, geometry: thin(f.geometry) })),
    ferryTotalEur,
    profile,
    noGo,
    crossings,
    fuelLiters,
    fuelCostEur,
    driverCostEur: 0,
    vehicleCostEur: roadKm * c.vehicleKm,
    totalEur: 0,
    schedule: { drivingH: hAcc, breaks45: 0, dailyRests: 0, totalH: hAcc, days: 1, arrival: o.departure, waitH: 0, ferryH: 0 },
    stops: [],
    warnings: [],
    highways: parts.some((p) => p.kind === "road" && !!p.trip.summary.has_highway),
    ferry: ferries.length > 0,
    tollAccuracy: accuracy,
    maneuvers,
  };
  // alap menetrend (szünetek, pihenők, tilalmak, érkezés) – a kliens ugyanezzel számol újra
  return applyPlan(base, autoPlan(base, o, v.weight), o, v.weight, c);
}

export interface PlanResult { routes: RouteResult[]; exclude: Excl[] }

/** a fuvar pontjai alapján: mely feltételes átkelők használhatók, melyek zárulnak le */
async function crossingContext(req: RouteRequest): Promise<CrossCtx> {
  const all = activeCrossings(req.options.crossings, req.options.crossingsOff);
  const status = new Map<string, { allowed: boolean; reason: string }>();
  if (all.length) {
    const wpCc = await waypointCountries(req.waypoints);
    for (const c of all) status.set(c.id, crossingAllowed(c, req.waypoints, wpCc));
  }
  return { all, status };
}

export async function blockedCrossings(req: Pick<RouteRequest, "waypoints" | "options">): Promise<BorderCrossing[]> {
  const cx = await crossingContext(req as RouteRequest);
  return cx.all.filter((c) => cx.status.get(c.id)?.allowed === false);
}

export async function planRoutes(req: RouteRequest): Promise<PlanResult> {
  const cx = await crossingContext(req);
  const blocked = cx.all.filter((c) => cx.status.get(c.id)?.allowed === false);
  const seg = splitByFerries(req.waypoints);
  if (!seg.ferries.length) {
    const set = await routeRequest(req.waypoints, req.vehicle, req.options, { blocked });
    const results = await Promise.all(set.trips.map((t, i) => analyse([{ kind: "road", trip: t }], req, i, set.unavoidable, cx)));
    // a leggyorsabb (kamionos menetidő-modell szerint) legyen az első
    results.sort((a, b) => a.drivingMin - b.drivingMin);
    return { routes: results.map((r, i) => ({ ...r, id: i })), exclude: set.exclude };
  }
  // komppal / vasúttal: a közúti szakaszok külön tervezve, a járat közéjük illesztve
  const sets = await Promise.all(seg.roads.map((r) => routeRequest(r, req.vehicle, req.options, { alternates: false, blocked })));
  const parts: Part[] = [];
  let ri = 0;
  let fi = 0;
  for (const k of seg.order) {
    if (k === "r") parts.push({ kind: "road", trip: sets[ri++].trips[0] });
    else parts.push({ kind: "ferry", ...seg.ferries[fi++] });
  }
  const route = await analyse(parts, req, 0, [...new Set(sets.flatMap((s) => s.unavoidable))], cx);
  return { routes: [route], exclude: sets.flatMap((s) => s.exclude).slice(0, 50) };
}
