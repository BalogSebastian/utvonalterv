import { planRoutes } from "@/lib/planner";
import { ValhallaError } from "@/lib/valhalla";
import type { RouteRequest } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: Request) {
  let body: RouteRequest;
  try {
    body = (await req.json()) as RouteRequest;
  } catch {
    return Response.json({ error: "Hibás kérés." }, { status: 400 });
  }
  if (!Array.isArray(body.waypoints) || body.waypoints.length < 2 || body.waypoints.length > 14) {
    return Response.json({ error: "2–14 útpont szükséges." }, { status: 400 });
  }
  if (body.waypoints.some((w) => !w || !Number.isFinite(w.lat) || !Number.isFinite(w.lon))) {
    return Response.json({ error: "Hibás útpont." }, { status: 400 });
  }
  const xs = body.options?.crossings;
  if (xs !== undefined && (!Array.isArray(xs) || xs.length > 500 || xs.some((c) => !c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon) || !Array.isArray(c.countries) || !Array.isArray(c.requireIn)))) {
    return Response.json({ error: "Hibás határátkelő-lista." }, { status: 400 });
  }
  try {
    const { routes, exclude } = await planRoutes(body);
    return Response.json({ routes, exclude, source: "Valhalla (OpenStreetMap)" });
  } catch (e) {
    if (e instanceof ValhallaError) {
      const hint =
        e.code === 442 || e.code === 171
          ? " Lehetséges ok: a jármű méretei/tömege miatt nincs engedélyezett útvonal, vagy az indulási/érkezési pont nem közelíthető meg kamionnal."
          : "";
      const busy = e.status === 429 ? " A routing-szerver most túlterhelt (sok egyidejű kérés) – próbáld újra pár másodperc múlva." : "";
      return Response.json({ error: e.message + hint + busy }, { status: e.status });
    }
    console.error(e);
    return Response.json({ error: "Váratlan hiba az útvonaltervezésben." }, { status: 500 });
  }
}
