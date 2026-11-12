import { decodePolyline } from "@/lib/polyline";
import { ferryPath, splitByFerries } from "@/lib/ferries";
import { routeRequest, ValhallaError } from "@/lib/valhalla";
import { blockedCrossings } from "@/lib/planner";
import type { LngLat, RouteRequest } from "@/lib/types";

/** Gyors útvonal-előnézet az útvonal húzása közben (csak geometria, útdíjszámítás nélkül). */
export const maxDuration = 30;

export async function POST(req: Request) {
  let body: Pick<RouteRequest, "waypoints" | "vehicle" | "options">;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Hibás kérés." }, { status: 400 });
  }
  if (!Array.isArray(body.waypoints) || body.waypoints.length < 2 || body.waypoints.length > 14) {
    return Response.json({ error: "2–14 útpont szükséges." }, { status: 400 });
  }
  try {
    const seg = splitByFerries(body.waypoints);
    // az előnézet a már ismert kizárásokat használja, új No-Go iteráció nélkül
    const o = { ...body.options, noGo: undefined };
    const blocked = await blockedCrossings(body);
    const sets = await Promise.all(seg.roads.map((r) => routeRequest(r, body.vehicle, o, { alternates: false, light: true, blocked })));
    const out: LngLat[] = [];
    let ri = 0;
    let fi = 0;
    for (const k of seg.order) {
      const part = k === "r"
        ? sets[ri++].trips[0].legs.flatMap((l) => decodePolyline(l.shape))
        : ferryPath(seg.ferries[fi].line, seg.ferries[fi++].reverse);
      out.push(...part);
    }
    // ritkítás (gyors megjelenítés)
    const step = Math.max(1, Math.floor(out.length / 3000));
    const coords = out.filter((_, i) => i % step === 0 || i === out.length - 1).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
    return Response.json({ coords });
  } catch (e) {
    const status = e instanceof ValhallaError ? e.status : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
