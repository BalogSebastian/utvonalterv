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
  if (!Array.isArray(body.waypoints) || body.waypoints.length < 2 || body.waypoints.length > 12) {
    return Response.json({ error: "2–12 útpont szükséges." }, { status: 400 });
  }
  try {
    const routes = await planRoutes(body);
    return Response.json({ routes, source: "Valhalla (OpenStreetMap)" });
  } catch (e) {
    if (e instanceof ValhallaError) {
      const hint =
        e.code === 442 || e.code === 171
          ? " Lehetséges ok: a jármű méretei/tömege miatt nincs engedélyezett útvonal, vagy az indulási/érkezési pont nem közelíthető meg kamionnal."
          : "";
      return Response.json({ error: e.message + hint }, { status: e.status });
    }
    return Response.json({ error: "Váratlan hiba az útvonaltervezésben." }, { status: 500 });
  }
}
