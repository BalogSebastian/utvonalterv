import { COUNTRY_NAMES, countryAt } from "./countries";
import { banWarnings } from "./bans";
import { decodePolyline, encodePolyline } from "./polyline";
import { TOLL_RULES, fixedFee, isTolledEdge, ratePerKm } from "./tolls";
import { SPECIALS, specialFee } from "./specials";
import {
  routeRequest, traceEdges, type VLeg, type VTrip,
} from "./valhalla";
import type {
  CountryLeg, DriveSchedule, LngLat, RouteRequest, RouteResult, TollBreakdownItem, TripStop, SpecialItem,
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

/** EU 561/2006: 9 óra vezetés / nap, 45 perc szünet 4,5 óra után, 11 óra napi pihenő. */
const DAY_DRIVE_H = 9;
const BREAK_H = 0.75;
const REST_H = 11;

export function schedule(drivingH: number, departureMs: number): DriveSchedule {
  let rem = drivingH;
  let breaks = 0;
  let days = 0;
  let totalH = 0;
  while (rem > 1e-6) {
    const day = Math.min(DAY_DRIVE_H, rem);
    days++;
    const b = Math.max(0, Math.ceil(day / 4.5 - 1e-9) - 1);
    breaks += b;
    totalH += day + b * BREAK_H;
    rem -= day;
    if (rem > 1e-6) totalH += REST_H;
  }
  return {
    drivingH, breaks45: breaks, dailyRests: Math.max(0, days - 1), totalH, days,
    arrival: new Date(departureMs + totalH * 3600_000).toISOString().slice(0, 16),
  };
}

/** vezetési idő (h) -> falióra-idő (ms), szünetekkel és pihenőkkel */
function wallClock(departureMs: number, drivingH: number): number {
  const full = Math.floor(drivingH / DAY_DRIVE_H + 1e-9);
  const rem = drivingH - full * DAY_DRIVE_H;
  let h = full * (DAY_DRIVE_H + BREAK_H + REST_H);
  h += rem + (rem > 4.5 ? BREAK_H : 0);
  return departureMs + h * 3600_000;
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
  chunks.forEach((c, ci) => {
    const t = results[ci];
    if (t.status === "fulfilled" && t.value.edges?.length) {
      const sh = decodePolyline(t.value.shape);
      const admins = t.value.admins ?? [];
      for (const e of t.value.edges) {
        const ai = e.end_node?.admin_index;
        const cc = ai !== undefined ? admins[ai]?.country_code : undefined;
        edges.push({
          km: e.length, toll: !!e.toll, roadClass: e.road_class, name: refName(e.names), names: e.names, cc: cc || undefined,
          a: sh[e.begin_shape_index], b: sh[e.end_shape_index],
          i0: c.from + e.begin_shape_index, i1: c.from + e.end_shape_index,
        });
      }
    } else {
      exact = false;
      for (const m of c.ms) {
        edges.push({
          km: m.length, toll: !!m.toll, roadClass: m.highway ? "motorway" : undefined, name: m.street_names?.[0],
          a: coords[m.begin_shape_index], b: coords[m.end_shape_index],
          i0: m.begin_shape_index, i1: m.end_shape_index,
        });
      }
    }
  });
  return { coords, edges, exact };
}

async function analyseTrip(trip: VTrip, req: RouteRequest, id: number): Promise<RouteResult> {
  const { vehicle: v, costs: c, options: o } = req;
  const legs: VLeg[] = trip.legs;

  // --- geometria + élek ---
  const fullCoords: LngLat[] = [];
  const edges: EdgeLike[] = [];
  let accuracy: "edge" | "maneuver" = "edge";

  for (const leg of legs) {
    const r = await legEdges(leg, v, o);
    if (!r.exact) accuracy = "maneuver";
    const base = fullCoords.length ? fullCoords.length - 1 : 0;
    for (const e of r.edges) edges.push({ ...e, i0: e.i0 + base, i1: e.i1 + base });
    fullCoords.push(...(fullCoords.length ? r.coords.slice(1) : r.coords));
  }

  // --- országok, díjköteles km-ek ---
  let curCountry = countryAt(fullCoords[0]) ?? "??";
  interface Visit { country: string; km: number; tollKm: number; startKm: number; cost: number }
  const visits: Visit[] = [];
  const tollRuns: [number, number][] = [];
  let cumKm = 0;
  let totalKm = 0;
  for (const e of edges) totalKm += e.km;

  const perCountry = new Map<string, { km: number; tollKm: number; cost: number }>();
  const roadKm = new Map<string, Map<string, number>>();
  const specialKm = new Map<string, number>();
  for (const e of edges) {
    const mid: LngLat = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
    const cc = e.cc ?? countryAt(mid) ?? countryAt(e.a) ?? curCountry;
    curCountry = cc;
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
    const cost = tolled && rule && !replaced ? e.km * ratePerKm(rule, v, e.roadClass, c.eurHuf) : 0;
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
        const m = roadKm.get(cc) ?? new Map<string, number>();
        m.set(e.name, (m.get(e.name) ?? 0) + e.km);
        roadKm.set(cc, m);
      }
      const lastRun = tollRuns[tollRuns.length - 1];
      if (lastRun && lastRun[1] === e.i0) lastRun[1] = e.i1;
      else tollRuns.push([e.i0, e.i1]);
    }
    perCountry.set(cc, agg);
    cumKm += e.km;
  }

  // határ menti "villogás" kisimítása: a rövid (<8 km) szakaszt beolvasztjuk a szomszédjába,
  // ha az előtte és utána lévő ország ugyanaz (pl. Komárom/Komárno), különben a nagyobb szomszédba.
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
      tollBreakdown.push({ country: cc, tollKm: 0, perKm: 0, fixed: 0, total: 0, note: `${name}: nincs modellezett kamion-útdíj.`, roads: [], confidence: "none", asOf: "" });
      continue;
    }
    const perKm = a.tollKm > 0 ? a.cost / a.tollKm : ratePerKm(rule, v, "motorway", c.eurHuf);
    const fixed = a.km > 0 && rule.fixed ? fixedFee(rule, v) : 0;
    tollBreakdown.push({
      country: cc, tollKm: a.tollKm, perKm, fixed,
      total: a.cost + fixed,
      note: `${rule.system}. ${rule.note}`,
      roads: [...(roadKm.get(cc)?.entries() ?? [])].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([n]) => n),
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

  // --- idő, szünetek ---
  // Menetidő: kamionos átlagsebességek útosztályonként (a routingot nem torzítjuk sebességkorláttal,
  // különben az autópálya nem lenne vonzóbb a főútnál). Ha nincs élszintű adat: a Valhalla ideje +20%.
  const modelMin = edges.reduce((sum, e) => sum + (e.km / (TRUCK_SPEED[e.roadClass ?? ""] ?? 40)) * 60, 0);
  const drivingMin = accuracy === "edge" ? modelMin : (trip.summary.time / 60) * 1.2;
  const drivingH = drivingMin / 60;
  const depMs = Date.parse(`${o.departure}:00Z`);
  const sched = schedule(drivingH, Number.isFinite(depMs) ? depMs : Date.now());

  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
  const countries: CountryLeg[] = visits.map((vis) => {
    const startH = (vis.startKm / (totalKm || 1)) * drivingH;
    const endH = ((vis.startKm + vis.km) / (totalKm || 1)) * drivingH;
    const enter = wallClock(depMs, startH);
    const leave = wallClock(depMs, endH);
    return {
      country: vis.country, startKm: vis.startKm, km: vis.km, tollKm: vis.tollKm,
      toll: vis.cost,
      enter: iso(enter), leave: iso(leave),
    };
  });

  // --- szünetek / napi pihenők helye a térképen ---
  const cum: number[] = [0];
  for (let i = 1; i < fullCoords.length; i++) {
    const [x1, y1] = fullCoords[i - 1];
    const [x2, y2] = fullCoords[i];
    const dx = (x2 - x1) * Math.cos(((y1 + y2) / 2) * (Math.PI / 180)) * 111.32;
    const dy = (y2 - y1) * 110.57;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const geoKm = cum[cum.length - 1] || 1;
  const pointAt = (atH: number): { km: number; c: LngLat } => {
    const target = Math.min(1, atH / (drivingH || 1)) * geoKm;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return { km: (target / geoKm) * trip.summary.length, c: fullCoords[lo] };
  };
  const stops: TripStop[] = [];
  for (let day = 0; day * DAY_DRIVE_H < drivingH - 0.05; day++) {
    const dayStart = day * DAY_DRIVE_H;
    const dayDrive = Math.min(DAY_DRIVE_H, drivingH - dayStart);
    if (dayDrive > 4.5 + 0.05) {
      const atH = dayStart + 4.5;
      const pt = pointAt(atH);
      stops.push({ id: `b${day}`, f: atH / (drivingH || 1), kind: "break", atH, km: pt.km, lon: pt.c[0], lat: pt.c[1], country: countryAt(pt.c) ?? "??", time: iso(wallClock(depMs, atH)), day: day + 1 });
    }
    if (dayStart + dayDrive < drivingH - 0.05) {
      const atH = dayStart + dayDrive;
      const pt = pointAt(atH);
      stops.push({ id: `r${day}`, f: atH / (drivingH || 1), kind: "rest", atH, km: pt.km, lon: pt.c[0], lat: pt.c[1], country: countryAt(pt.c) ?? "??", time: iso(wallClock(depMs, atH)), day: day + 1 });
    }
  }

  const warnings = Number.isFinite(depMs)
    ? banWarnings(
        countries.map((cl) => ({ country: cl.country, enter: Date.parse(`${cl.enter}:00Z`), leave: Date.parse(`${cl.leave}:00Z`) })),
        v.weight,
      )
    : [];

  // --- költség ---
  const fuelLiters = (totalKm * v.consumption) / 100;
  const fuelCostEur = fuelLiters * c.fuelPrice;
  const workH = sched.drivingH + sched.breaks45 * BREAK_H;
  const driverCostEur = workH * c.driverHourly;
  const vehicleCostEur = totalKm * c.vehicleKm;

  const tollGeometry = tollRuns.map(([i0, i1]) => fullCoords.slice(i0, i1 + 1));

  return {
    id,
    distanceKm: trip.summary.length,
    drivingMin,
    geometry: thin(fullCoords),
    tollGeometry: tollGeometry.map(thin).filter((g) => g.length > 1),
    countries,
    tollBreakdown,
    tollTotalEur,
    specials,
    specialsTotalEur,
    fuelLiters,
    fuelCostEur,
    driverCostEur,
    vehicleCostEur,
    totalEur: tollTotalEur + fuelCostEur + driverCostEur + vehicleCostEur,
    schedule: sched,
    stops: Number.isFinite(depMs) ? stops : [],
    warnings,
    highways: !!trip.summary.has_highway,
    ferry: !!trip.summary.has_ferry,
    tollAccuracy: accuracy,
    maneuvers: legs.flatMap((l) =>
      l.maneuvers.map((m) => ({ text: m.instruction, km: m.length, min: m.time / 60, street: m.street_names?.[0] })),
    ),
  };
}

export async function planRoutes(req: RouteRequest): Promise<RouteResult[]> {
  const { trips } = await routeRequest(req.waypoints, req.vehicle, req.options);
  const results = await Promise.all(trips.map((t, i) => analyseTrip(t, req, i)));
  // a leggyorsabb (kamionos menetidő-modell szerint) legyen az első
  results.sort((a, b) => a.drivingMin - b.drivingMin);
  return results.map((r, i) => ({ ...r, id: i }));
}
