import { decodePolyline } from "./polyline";
import { buildZones, exclusionPoints, intrusions, perimeterKm, unavoidableZones, type Zone } from "./zones";
import type { LngLat, RouteOptions, Vehicle, Waypoint } from "./types";

/** Valhalla szerver(ek): VALHALLA_URLS=vesszővel elválasztott lista (failover), vagy VALHALLA_URL */
const HOSTS = (process.env.VALHALLA_URLS ?? process.env.VALHALLA_URL ?? "https://valhalla1.openstreetmap.de")
  .split(",").map((h) => h.trim().replace(/\/$/, "")).filter(Boolean);
export const VALHALLA_URL = HOSTS[0];
/** a kizáró poligonok max. összkerülete (km) a szerveren – a publikus példányon 10 km */
const MAX_EXCLUDE_KM = Number(process.env.VALHALLA_MAX_EXCLUDE_KM) || 10;

export interface VManeuver {
  instruction: string;
  type?: number;
  length: number; // km
  time: number; // s
  street_names?: string[];
  toll?: boolean;
  highway?: boolean;
  ferry?: boolean;
  begin_shape_index: number;
  end_shape_index: number;
}
export interface VLeg {
  shape: string;
  maneuvers: VManeuver[];
  summary: { length: number; time: number; has_toll?: boolean; has_highway?: boolean; has_ferry?: boolean };
}
export interface VTrip {
  legs: VLeg[];
  summary: { length: number; time: number; has_toll?: boolean; has_highway?: boolean; has_ferry?: boolean };
}
export interface VEdge {
  toll?: boolean;
  road_class?: string;
  length: number; // km
  begin_shape_index: number;
  end_shape_index: number;
  speed_limit?: number;
  use?: string;
  names?: string[];
  tunnel?: boolean;
  end_node?: { admin_index?: number };
}

export class ValhallaError extends Error {
  constructor(message: string, public status = 502, public code?: number) {
    super(message);
  }
}

/* ---------- többfelhasználós működés: sorba állítás, cache, újrapróbálás ---------- */

/** egyszerre ennyi kérés megy a routing-szerver felé (a többi sorban áll) – a publikus szerver fair-use korlátja miatt */
const MAX_CONC = Number(process.env.VALHALLA_CONCURRENCY) || 4;
let active = 0;
const waiting: (() => void)[] = [];
async function acquire() {
  if (active < MAX_CONC) { active++; return; }
  await new Promise<void>((r) => waiting.push(r));
  active++;
}
function release() {
  active--;
  waiting.shift()?.();
}

/** memóriacache (LRU, 6 óra): több felhasználó ugyanazon útvonalánál nem terheli újra a szervert */
const CACHE_MAX = 400;
const CACHE_TTL = 6 * 3600_000;
const cache = new Map<string, { t: number; v: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

function cacheGet(k: string): unknown | undefined {
  const e = cache.get(k);
  if (!e) return undefined;
  if (Date.now() - e.t > CACHE_TTL) { cache.delete(k); return undefined; }
  cache.delete(k);
  cache.set(k, e);
  return e.v;
}
function cacheSet(k: string, v: unknown) {
  cache.set(k, { t: Date.now(), v });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function once<T>(host: string, path: string, body: string, timeoutMs: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${host}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "tesotter-truck-planner/1.1" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    throw new ValhallaError("Az útvonaltervező szerver nem érhető el (időtúllépés vagy hálózati hiba).", 504);
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ValhallaError(`Az útvonaltervező szerver hibás választ adott (HTTP ${res.status}).`, res.status === 429 ? 429 : 502);
  }
  if (!res.ok) {
    const e = json as { error?: string; error_code?: number };
    throw new ValhallaError(e.error ?? "Ismeretlen routing hiba", res.status === 400 ? 422 : res.status === 429 ? 429 : 502, e.error_code);
  }
  return json as T;
}

/** POST a routing-szerverre: cache → egyesített párhuzamos kérések → sor → újrapróbálás / failover */
async function post<T>(path: string, payload: unknown, timeoutMs = 60000): Promise<T> {
  const body = JSON.stringify(payload);
  const key = path + body;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit as T;
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = (async () => {
    await acquire();
    try {
      let last: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        const host = HOSTS[attempt % HOSTS.length];
        try {
          const v = await once<T>(host, path, body, timeoutMs);
          cacheSet(key, v);
          return v;
        } catch (e) {
          last = e;
          // a „nincs útvonal” jellegű (400) hibát nincs értelme ismételni
          if (e instanceof ValhallaError && e.status === 422) throw e;
          await sleep(attempt === 0 ? 400 : 1500);
        }
      }
      throw last;
    } finally {
      release();
    }
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

export function truckCosting(v: Vehicle, o: RouteOptions) {
  return {
    truck: {
      weight: v.weight,
      axle_load: v.axleLoad,
      height: v.height,
      width: v.width,
      length: v.length,
      hazmat: v.hazmat,
      use_tolls: o.avoidTolls ? 0 : 1,
      use_highways: o.avoidHighways ? 0 : 1,
      use_truck_route: 0.8,
      use_ferry: 0.3,
    },
  };
}

type VLocation = { lat: number; lon: number; radius?: number; type: "break" | "through"; heading?: number; heading_tolerance?: number };
export type Excl = { lat: number; lon: number };

/** a kis (pl. városi) saját zónák natívan is kizárhatók, ha a szerver kerület-limitjébe beleférnek */
export interface Avoid { points: Excl[]; polygons: LngLat[][] }

const toLocation = (w: Waypoint): VLocation =>
  w.via ? { lat: w.lat, lon: w.lon, radius: 80, type: "through" } : { lat: w.lat, lon: w.lon, radius: 600, type: "break" };

async function truckRoute(locations: VLocation[], v: Vehicle, o: RouteOptions, alternates: number, avoid?: Avoid, light = false) {
  const body = {
    locations,
    costing: "truck",
    costing_options: truckCosting(v, o),
    directions_options: light ? { directions_type: "none", units: "kilometers" } : { language: "hu-HU", units: "kilometers" },
    ...(alternates ? { alternates } : {}),
    ...(avoid?.points.length ? { exclude_locations: avoid.points.slice(0, 50) } : {}),
    ...(avoid?.polygons.length ? { exclude_polygons: avoid.polygons } : {}),
  };
  const r = await post<{ trip: VTrip; alternates?: { trip: VTrip }[] }>("/route", body);
  return [r.trip, ...(r.alternates ?? []).map((a) => a.trip)];
}

function bearing(a: [number, number], b: [number, number]): number {
  const toR = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * toR) * Math.cos(b[1] * toR);
  const x = Math.cos(a[1] * toR) * Math.sin(b[1] * toR) - Math.sin(a[1] * toR) * Math.cos(b[1] * toR) * Math.cos((b[0] - a[0]) * toR);
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

/**
 * Autópálya-javaslat: a Valhalla hosszú útnál hierarchia-szűrést használ, ezért kihagyhat olyan
 * autópálya-folyosót, ahol a kamionoknak rövid, alacsonyabb rendű kerülőt kell tenniük
 * (pl. a hegyeshalmi kamionsáv M1 → A4). Az autós útvonal autópálya-szakaszainak közepére
 * „through” pontokat teszünk, és a kamion-útvonalat ezeken át is kiszámoljuk.
 */
async function corridorCandidate(waypoints: Waypoint[], v: Vehicle, o: RouteOptions, primary: VTrip, avoid?: Avoid): Promise<VTrip | null> {
  if (o.avoidHighways) return null;
  const body = {
    locations: waypoints.map((w) => ({ lat: w.lat, lon: w.lon, radius: w.via ? 80 : 600, type: w.via ? "through" : "break" })),
    costing: "auto",
    costing_options: { auto: { use_tolls: o.avoidTolls ? 0 : 1 } },
    directions_options: { units: "kilometers" },
    ...(avoid?.points.length ? { exclude_locations: avoid.points.slice(0, 50) } : {}),
    ...(avoid?.polygons.length ? { exclude_polygons: avoid.polygons } : {}),
  };
  let auto: VTrip;
  try {
    auto = (await post<{ trip: VTrip }>("/route", body, 30000)).trip;
  } catch {
    return null;
  }
  // csak ha az autós útvonal érdemben rövidebb (különben a kamionos útvonal már jó)
  if (auto.summary.length > primary.summary.length * 0.985) return null;
  // a pontok szakaszokra bontva: minden „break” pont új szakaszt kezd, a „via” pontok a szakaszon belül vannak
  const segs: { from: Waypoint; vias: Waypoint[]; to: Waypoint }[] = [];
  let from = waypoints[0];
  let vias: Waypoint[] = [];
  for (const w of waypoints.slice(1)) {
    if (w.via) { vias.push(w); continue; }
    segs.push({ from, vias, to: w });
    from = w;
    vias = [];
  }
  if (segs.length !== auto.legs.length) return null;
  const locations: VLocation[] = [toLocation(waypoints[0])];
  let hints = 0;
  auto.legs.forEach((leg, li) => {
    const coords = decodePolyline(leg.shape);
    const items: { i: number; loc: VLocation }[] = [];
    // a felhasználó áthaladási pontjai a helyükön maradnak
    let searchFrom = 0;
    for (const w of segs[li].vias) {
      let best = searchFrom;
      let bd = Infinity;
      for (let i = searchFrom; i < coords.length; i++) {
        const d = (coords[i][0] - w.lon) ** 2 + (coords[i][1] - w.lat) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      searchFrom = best;
      items.push({ i: best, loc: toLocation(w) });
    }
    const step = Math.max(60, leg.summary.length / 8);
    let acc = step / 2;
    let km = 0;
    for (const m of leg.maneuvers) {
      const start = km;
      km += m.length;
      if (!m.highway || m.length < 8) continue;
      while (acc < km) {
        if (acc > start + 2 && acc < km - 2) {
          const t = (acc - start) / m.length;
          const i = Math.min(m.end_shape_index - 1, Math.max(m.begin_shape_index, Math.round(m.begin_shape_index + t * (m.end_shape_index - m.begin_shape_index))));
          const a = coords[i];
          const b = coords[Math.min(i + 1, coords.length - 1)];
          // ne kerüljön túl közel egy felhasználói ponthoz
          const nearVia = segs[li].vias.some((w) => Math.abs(w.lat - a[1]) < 0.05 && Math.abs(w.lon - a[0]) < 0.07);
          if (a && b && (a[0] !== b[0] || a[1] !== b[1]) && !nearVia) {
            items.push({ i, loc: { lat: a[1], lon: a[0], radius: 25, type: "through", heading: bearing(a, b), heading_tolerance: 40 } });
            hints++;
          }
        }
        acc += step;
      }
      if (acc < km) acc = km;
    }
    items.sort((x, y) => x.i - y.i);
    locations.push(...items.map((x) => x.loc), toLocation(segs[li].to));
  });
  if (!hints || locations.length > 20) return null;
  try {
    const [trip] = await truckRoute(locations, v, o, 0, avoid);
    return trip;
  } catch {
    return null;
  }
}

const similar = (a: VTrip, b: VTrip) =>
  Math.abs(a.summary.length - b.summary.length) < Math.max(0.5, a.summary.length * 0.004) &&
  Math.abs(a.summary.time - b.summary.time) < Math.max(30, a.summary.time * 0.004);

const tripCoords = (t: VTrip): LngLat[] => t.legs.flatMap((l, i) => (i ? decodePolyline(l.shape).slice(1) : decodePolyline(l.shape)));

/** natívan kizárható saját zónák (a kerület-limitig) */
function nativePolygons(zones: Zone[], skip: Set<string>): LngLat[][] {
  const out: LngLat[][] = [];
  let budget = MAX_EXCLUDE_KM * 0.95;
  for (const z of zones) {
    if (skip.has(z.id)) continue;
    for (const poly of z.polys) {
      const ring = poly[0] as LngLat[];
      const per = perimeterKm(ring);
      if (per > budget) continue;
      budget -= per;
      out.push(ring);
    }
  }
  return out;
}

export interface RouteSet {
  trips: VTrip[];
  /** a No-Go zónák elkerüléséhez kizárt pontok */
  exclude: Excl[];
  /** zónák, amelyeket nem sikerült / nem lehet elkerülni */
  unavoidable: string[];
}

/**
 * Kamion-útvonal(ak) a No-Go zónák elkerülésével: ha az útvonal belép egy zónába, a behatoló
 * szakasz útjait kizárjuk, és újratervezünk (legfeljebb 8 kör / 50 kizárt pont).
 */
export async function routeRequest(
  waypoints: Waypoint[],
  v: Vehicle,
  o: RouteOptions,
  opts: { alternates?: boolean; light?: boolean } = {},
): Promise<RouteSet> {
  const zones = buildZones(o.noGo);
  const skip = unavoidableZones(zones, waypoints);
  const avoid: Avoid = { points: [...(o.exclude ?? [])].slice(0, 50), polygons: nativePolygons(zones, skip) };
  const breaks = waypoints.filter((w) => !w.via).length;
  const alternates = opts.alternates !== false && breaks === 2 && waypoints.length === 2 ? 2 : 0;
  const locs = waypoints.map(toLocation);

  let trips = await truckRoute(locs, v, o, alternates, avoid, opts.light);
  const failed = new Set<string>();
  if (zones.length) {
    for (let it = 0; it < 8; it++) {
      const runs = intrusions(tripCoords(trips[0]), zones, skip);
      if (!runs.length) break;
      const coords = tripCoords(trips[0]);
      const before = avoid.points.length;
      for (const r of runs) for (const p of exclusionPoints(coords, r)) {
        if (avoid.points.length >= 50) break;
        if (!avoid.points.some((q) => Math.abs(q.lat - p[1]) < 1e-4 && Math.abs(q.lon - p[0]) < 1e-4)) avoid.points.push({ lat: p[1], lon: p[0] });
      }
      if (avoid.points.length === before) { runs.forEach((r) => failed.add(r.zone.id)); break; }
      try {
        trips = await truckRoute(locs, v, o, alternates, avoid, opts.light);
      } catch (e) {
        // a kizárások után nincs út: marad az utolsó (zónát érintő) útvonal
        if (e instanceof ValhallaError && e.status === 422) { runs.forEach((r) => failed.add(r.zone.id)); break; }
        throw e;
      }
      if (it === 7) intrusions(tripCoords(trips[0]), zones, skip).forEach((r) => failed.add(r.zone.id));
    }
    // a zónát érintő alternatívák kiesnek (a fő útvonal marad)
    trips = trips.filter((t, i) => i === 0 || !intrusions(tripCoords(t), zones, skip).length);
  }
  if (!opts.light) {
    const extra = await corridorCandidate(waypoints, v, o, trips[0], avoid);
    if (extra && !trips.some((t) => similar(t, extra)) && !(zones.length && intrusions(tripCoords(extra), zones, skip).length)) trips.push(extra);
  }
  const names = new Map(zones.map((z) => [z.id, z.name]));
  return {
    trips,
    exclude: avoid.points,
    unavoidable: [...new Set([...skip, ...failed])].map((id) => names.get(id) ?? id),
  };
}

export async function traceEdges(
  leg: VLeg,
  v: Vehicle,
  o: RouteOptions,
): Promise<{ shape: string; edges: VEdge[]; admins?: { country_code?: string }[] }> {
  const body = {
    encoded_polyline: leg.shape,
    costing: "truck",
    costing_options: truckCosting(v, o),
    shape_match: "edge_walk",
    filters: {
      attributes: [
        "shape",
        "edge.length",
        "edge.toll",
        "edge.road_class",
        "edge.use",
        "edge.names",
        "edge.tunnel",
        "edge.begin_shape_index",
        "edge.end_shape_index",
        "node.admin_index",
        "admin.country_code",
      ],
      action: "include",
    },
  };
  return post("/trace_attributes", body, 90000);
}
