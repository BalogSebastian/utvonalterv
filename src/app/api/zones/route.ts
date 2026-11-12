import type { NextRequest } from "next/server";
import { countryPolygons } from "@/lib/countries";

/** Egy ország határa GeoJSON-ként (a No-Go zóna megjelenítéséhez a térképen). */
export async function GET(req: NextRequest) {
  const cc = (req.nextUrl.searchParams.get("cc") ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return Response.json({ error: "cc" }, { status: 400 });
  const polys = countryPolygons(cc);
  if (!polys) return Response.json({ error: "Ismeretlen ország" }, { status: 404 });
  const round = (r: number[][]) => r.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]);
  return Response.json(
    { type: "Feature", properties: { cc }, geometry: { type: "MultiPolygon", coordinates: polys.map((p) => p.map(round)) } },
    { headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" } },
  );
}
