import { decodePolyline, encodePolyline } from "./polyline";
import { buildZones, deepRun, exclusionPoints, hav, intrusions, perimeterKm, unavoidableZones, type Intrusion, type Zone } from "./zones";
import { crossingSquare, nearestOnLine, passesKm } from "./crossings";
import { waypointCountries } from "./wpcountry";
import type { BorderCrossing, LngLat, RouteOptions, Vehicle, Waypoint } from "./types";

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

/**
 * Natív kizáró poligonok a szerver kerület-limitjéig: először a lezárt határátkelők
 * (kis négyzetek, a útpontok közötti folyosóhoz legközelebbiek elöl), utána a kis saját zónák.
 */
function nativePolygons(zones: Zone[], skip: Set<string>, blocked: BorderCrossing[], waypoints: Waypoint[]): LngLat[][] {
  const out: LngLat[][] = [];
  let budget = MAX_EXCLUDE_KM * 0.95;
  const line: LngLat[] = waypoints.map((w) => [w.lon, w.lat]);
  const ranked = blocked
    .map((c) => ({ c, d: line.length > 1 ? nearestOnLine(line, [c.lon, c.lat]).km : 0 }))
    .filter((x) => x.d < 250)
    .sort((a, b) => a.d - b.d);
  for (const { c } of ranked) {
    const sq = crossingSquare(c);
    const per = perimeterKm(sq);
    if (per > budget) break;
    budget -= per;
    out.push(sq);
  }
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

/**
 * A durva (1:50m) határral talált rövid ország-behatolásokat a routing-szerver pontos
 * közigazgatási adataival ellenőrizzük: a határ menti „álbehatolás” kiesik, a valódi
 * szakasz pontos kezdete / vége marad.
 */
async function preciseRuns(coords: LngLat[], runs: Intrusion[], v: Vehicle, o: RouteOptions): Promise<Intrusion[]> {
  const out: Intrusion[] = [];
  for (const r of runs) {
    if (!r.zone.country || r.km >= 40) { out.push(r); continue; }
    const a = Math.max(0, r.a - 3);
    const b = Math.min(coords.length - 1, r.b + 3);
    try {
      const t = await post<{ shape: string; edges?: { length: number; begin_shape_index: number; end_shape_index: number; end_node?: { admin_index?: number } }[]; admins?: { country_code?: string }[] }>(
        "/trace_attributes",
        {
          encoded_polyline: encodePolyline(coords.slice(a, b + 1)),
          costing: "truck",
          costing_options: truckCosting(v, o),
          shape_match: "edge_walk",
          filters: { attributes: ["shape", "edge.length", "edge.begin_shape_index", "edge.end_shape_index", "node.admin_index", "admin.country_code"], action: "include" },
        },
        30000,
      );
      const sh = decodePolyline(t.shape);
      let km = 0;
      let first: LngLat | null = null;
      let last: LngLat | null = null;
      for (const e of t.edges ?? []) {
        const cc = e.end_node?.admin_index !== undefined ? t.admins?.[e.end_node.admin_index]?.country_code : undefined;
        if (cc !== r.zone.country) continue;
        km += e.length;
        first ??= sh[e.begin_shape_index];
        last = sh[e.end_shape_index];
      }
      if (km < 0.3 || !first || !last) continue;
      const near = (p: LngLat) => {
        let bi = a, bd = Infinity;
        for (let i = a; i <= b; i++) { const d = hav(coords[i], p); if (d < bd) { bd = d; bi = i; } }
        return bi;
      };
      const ia = near(first);
      const ib = Math.max(ia, near(last));
      out.push({ zone: r.zone, a: ia, b: ib, km });
    } catch {
      // ellenőrzés nélkül: a durva határ szerinti szakasz
      if (deepRun(coords, r.zone, r.a, r.b)) out.push(r);
    }
  }
  return out;
}

/** a lezárt átkelőkön áthaladó pontok: a kizáráshoz az útvonal saját pontjai (a használt pályatest) */
function crossingHits(coords: LngLat[], blocked: BorderCrossing[]): { c: BorderCrossing; i: number }[] {
  const out: { c: BorderCrossing; i: number }[] = [];
  for (const c of blocked) {
    const n = nearestOnLine(coords, [c.lon, c.lat]);
    if (n.km <= passesKm(c)) out.push({ c, i: n.i });
  }
  return out;
}

export interface RouteSet {
  trips: VTrip[];
  /** a No-Go zónák / lezárt átkelők elkerüléséhez kizárt pontok */
  exclude: Excl[];
  /** zónák, amelyeket nem sikerült / nem lehet elkerülni */
  unavoidable: string[];
  /** lezárt átkelők, amelyeket nem sikerült elkerülni */
  crossingsFailed: string[];
}

/**
 * Kamion-útvonal(ak) a No-Go zónák és a lezárt (feltételes) határátkelők elkerülésével: ha az
 * útvonal belép egy zónába / áthalad egy lezárt átkelőn, a behatoló szakasz útjait kizárjuk, és
 * újratervezünk (legfeljebb 10 kör / 50 kizárt pont).
 */
export async function routeRequest(
  waypoints: Waypoint[],
  v: Vehicle,
  o: RouteOptions,
  opts: { alternates?: boolean; light?: boolean; blocked?: BorderCrossing[] } = {},
): Promise<RouteSet> {
  const zones = buildZones(o.noGo);
  const blocked = opts.blocked ?? [];
  const wpCc = zones.some((z) => z.country) ? await waypointCountries(waypoints) : undefined;
  const skip = unavoidableZones(zones, waypoints, wpCc);
  const avoid: Avoid = { points: [...(o.exclude ?? [])].slice(0, 50), polygons: nativePolygons(zones, skip, blocked, waypoints) };
  const breaks = waypoints.filter((w) => !w.via).length;
  const alternates = opts.alternates !== false && breaks === 2 && waypoints.length === 2 ? 2 : 0;
  const locs = waypoints.map(toLocation);

  let trips = await truckRoute(locs, v, o, alternates, avoid, opts.light);
  const failed = new Set<string>();
  const failedX = new Set<string>();
  const violations = async (t: VTrip) => {
    const coords = tripCoords(t);
    const runs = zones.length ? await preciseRuns(coords, intrusions(coords, zones, skip), v, o) : [];
    return { coords, runs, hits: crossingHits(coords, blocked) };
  };
  const clean = async (t: VTrip) => { const x = await violations(t); return !x.runs.length && !x.hits.length; };

  if (zones.length || blocked.length) {
    for (let it = 0; it < 10; it++) {
      const { coords, runs, hits } = await violations(trips[0]);
      if (!runs.length && !hits.length) break;
      const before = avoid.points.length;
      const add = (p: LngLat) => {
        if (avoid.points.length >= 50) return;
        if (!avoid.points.some((q) => Math.abs(q.lat - p[1]) < 1e-4 && Math.abs(q.lon - p[0]) < 1e-4)) avoid.points.push({ lat: p[1], lon: p[0] });
      };
      // a lezárt átkelő: az útvonal saját pontja az átkelőnél (és egy szomszédos pont), így a használt pályatest zárul le
      for (const h of hits) { add(coords[h.i]); if (coords[h.i + 1]) add(coords[h.i + 1]); }
      for (const r of runs) for (const p of exclusionPoints(coords, r)) add(p);
      if (avoid.points.length === before) {
        runs.forEach((r) => failed.add(r.zone.id));
        hits.forEach((h) => failedX.add(h.c.id));
        break;
      }
      try {
        trips = await truckRoute(locs, v, o, alternates, avoid, opts.light);
      } catch (e) {
        // a kizárások után nincs út: marad az utolsó (zónát / átkelőt érintő) útvonal
        if (e instanceof ValhallaError && e.status === 422) {
          avoid.points.splice(before);
          runs.forEach((r) => failed.add(r.zone.id));
          hits.forEach((h) => failedX.add(h.c.id));
          break;
        }
        throw e;
      }
      if (it === 9) {
        const x = await violations(trips[0]);
        x.runs.forEach((r) => failed.add(r.zone.id));
        x.hits.forEach((h) => failedX.add(h.c.id));
      }
    }
    // a zónát / lezárt átkelőt érintő alternatívák kiesnek (a fő útvonal marad)
    const keep = await Promise.all(trips.map((t, i) => (i === 0 ? true : clean(t))));
    trips = trips.filter((_, i) => keep[i]);
  }
  if (!opts.light) {
    const extra = await corridorCandidate(waypoints, v, o, trips[0], avoid);
    if (extra && !trips.some((t) => similar(t, extra)) && (!(zones.length || blocked.length) || (await clean(extra)))) trips.push(extra);
  }
  const names = new Map(zones.map((z) => [z.id, z.name]));
  return {
    trips,
    exclude: avoid.points,
    unavoidable: [...new Set([...skip, ...failed])].map((id) => names.get(id) ?? id),
    crossingsFailed: [...failedX],
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
