import { decodePolyline } from "./polyline";
import type { RouteOptions, Vehicle, Waypoint } from "./types";

export const VALHALLA_URL = process.env.VALHALLA_URL ?? "https://valhalla1.openstreetmap.de";

export interface VManeuver {
  instruction: string;
  type?: number;
  length: number; // km
  time: number; // s
  street_names?: string[];
  toll?: boolean;
  highway?: boolean;
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

async function post<T>(path: string, body: unknown, timeoutMs = 60000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${VALHALLA_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "tesotter-truck-planner/1.0" },
      body: JSON.stringify(body),
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
    throw new ValhallaError(`Az útvonaltervező szerver hibás választ adott (HTTP ${res.status}).`, 502);
  }
  if (!res.ok) {
    const e = json as { error?: string; error_code?: number };
    throw new ValhallaError(e.error ?? "Ismeretlen routing hiba", res.status === 400 ? 422 : 502, e.error_code);
  }
  return json as T;
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

const toLocation = (w: Waypoint): VLocation =>
  w.via ? { lat: w.lat, lon: w.lon, radius: 80, type: "through" } : { lat: w.lat, lon: w.lon, radius: 600, type: "break" };

async function truckRoute(locations: VLocation[], v: Vehicle, o: RouteOptions, alternates: number) {
  const body = {
    locations,
    costing: "truck",
    costing_options: truckCosting(v, o),
    directions_options: { language: "hu-HU", units: "kilometers" },
    ...(alternates ? { alternates } : {}),
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
async function corridorCandidate(waypoints: Waypoint[], v: Vehicle, o: RouteOptions, primary: VTrip): Promise<VTrip | null> {
  if (o.avoidHighways) return null;
  const body = {
    locations: waypoints.map((w) => ({ lat: w.lat, lon: w.lon, radius: w.via ? 80 : 600, type: w.via ? "through" : "break" })),
    costing: "auto",
    costing_options: { auto: { use_tolls: o.avoidTolls ? 0 : 1 } },
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
    const [trip] = await truckRoute(locations, v, o, 0);
    return trip;
  } catch {
    return null;
  }
}

const similar = (a: VTrip, b: VTrip) =>
  Math.abs(a.summary.length - b.summary.length) < Math.max(0.5, a.summary.length * 0.004) &&
  Math.abs(a.summary.time - b.summary.time) < Math.max(30, a.summary.time * 0.004);

export async function routeRequest(
  waypoints: Waypoint[],
  v: Vehicle,
  o: RouteOptions,
): Promise<{ trips: VTrip[] }> {
  const breaks = waypoints.filter((w) => !w.via).length;
  const trips = await truckRoute(waypoints.map(toLocation), v, o, breaks === 2 && waypoints.length === 2 ? 2 : 0);
  const extra = await corridorCandidate(waypoints, v, o, trips[0]);
  if (extra && !trips.some((t) => similar(t, extra))) trips.push(extra);
  return { trips };
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
