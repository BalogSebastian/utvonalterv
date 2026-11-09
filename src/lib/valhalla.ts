import type { RouteOptions, Vehicle, Waypoint } from "./types";

export const VALHALLA_URL = process.env.VALHALLA_URL ?? "https://valhalla1.openstreetmap.de";

export interface VManeuver {
  instruction: string;
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
      top_speed: 90,
      use_tolls: o.avoidTolls ? 0 : 1,
      use_highways: o.avoidHighways ? 0 : 1,
      use_truck_route: 0.8,
      use_ferry: 0.3,
    },
  };
}

export async function routeRequest(
  waypoints: Waypoint[],
  v: Vehicle,
  o: RouteOptions,
): Promise<{ trips: VTrip[] }> {
  const body = {
    locations: waypoints.map((w) => ({ lat: w.lat, lon: w.lon, radius: 600, type: "break" })),
    costing: "truck",
    costing_options: truckCosting(v, o),
    directions_options: { language: "hu-HU", units: "kilometers" },
    ...(waypoints.length === 2 ? { alternates: 2 } : {}),
  };
  const r = await post<{ trip: VTrip; alternates?: { trip: VTrip }[] }>("/route", body);
  return { trips: [r.trip, ...(r.alternates ?? []).map((a) => a.trip)] };
}

export async function traceEdges(
  leg: VLeg,
  v: Vehicle,
  o: RouteOptions,
): Promise<{ shape: string; edges: VEdge[] }> {
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
        "edge.begin_shape_index",
        "edge.end_shape_index",
      ],
      action: "include",
    },
  };
  return post("/trace_attributes", body, 90000);
}
