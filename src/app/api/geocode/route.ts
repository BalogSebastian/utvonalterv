import type { NextRequest } from "next/server";

/** Photon (komoot) – ingyenes, OSM-alapú geokódoló/autocomplete */
export async function GET(req: NextRequest) {
  const lat = req.nextUrl.searchParams.get("lat");
  const lon = req.nextUrl.searchParams.get("lon");
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const reverse = lat !== null && lon !== null && Number.isFinite(+lat) && Number.isFinite(+lon);
  if (!reverse && (!q || q.length < 2)) return Response.json({ results: [] });
  const url = reverse
    ? `https://photon.komoot.io/reverse?lat=${+lat!}&lon=${+lon!}&lang=en${req.nextUrl.searchParams.get("place") ? "&layer=city&layer=locality" : ""}`
    : `https://photon.komoot.io/api/?q=${encodeURIComponent(q!)}&limit=6&lang=en`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "tesotter-truck-planner/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return Response.json({ results: [], error: "Geokódolás hiba" }, { status: 502 });
    const data = (await res.json()) as {
      features: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[];
    };
    const results = data.features.map((f) => {
      const p = f.properties;
      const line1 = [p.name, p.street && `${p.street}${p.housenumber ? " " + p.housenumber : ""}`].filter(Boolean).join(", ");
      const line2 = [p.postcode, p.city && p.city !== p.name ? p.city : null, p.state, p.country].filter(Boolean).join(", ");
      return {
        label: [line1, line2].filter(Boolean).join(" — "),
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        cc: p.countrycode,
      };
    });
    return Response.json({ results });
  } catch {
    return Response.json({ results: [], error: "Geokódoló nem érhető el" }, { status: 504 });
  }
}
