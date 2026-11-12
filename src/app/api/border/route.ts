import type { NextRequest } from "next/server";
import { countryAt } from "@/lib/countries";
import { preciseCountry } from "@/lib/wpcountry";
import type { LngLat } from "@/lib/types";

/** Egy (határátkelő-) pont országa és a közeli szomszéd ország(ok) – az átkelő felvételéhez. */
export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Response.json({ error: "lat/lon" }, { status: 400 });
  const p: LngLat = [lon, lat];
  const here = await preciseCountry(p);
  const near = new Map<string, number>();
  const k = Math.cos((lat * Math.PI) / 180);
  for (const km of [1, 3, 8]) {
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      const cc = countryAt([lon + (Math.cos(t) * km) / (111.32 * k), lat + (Math.sin(t) * km) / 110.57]);
      if (cc && cc !== here && !near.has(cc)) near.set(cc, km);
    }
  }
  const neighbors = [...near.entries()].sort((a, b) => a[1] - b[1]).map(([cc]) => cc);
  return Response.json({ cc: here, neighbors });
}
