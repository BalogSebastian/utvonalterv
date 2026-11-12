/**
 * Kamionparkolók / pihenőhelyek az útvonal megadott ablakai mentén (OSM, Overpass).
 * Bemenet: { windows: [lng,lat][][] } – minden ablak egy rövid útvonal-szakasz (a megálló előtti ~1 óra).
 */
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

export const maxDuration = 60;

interface El { id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

export async function POST(req: Request) {
  let body: { windows?: [number, number][][] };
  try { body = await req.json(); } catch { return Response.json({ error: "Hibás kérés." }, { status: 400 }); }
  const wins = (body.windows ?? []).filter((w) => Array.isArray(w) && w.length >= 2).slice(0, 12);
  if (!wins.length) return Response.json({ parkings: [] });
  const parts = wins.map((w) => {
    const step = Math.max(1, Math.floor(w.length / 25));
    const pts = w.filter((_, i) => i % step === 0 || i === w.length - 1).map(([x, y]) => `${y.toFixed(5)},${x.toFixed(5)}`).join(",");
    return `nwr["amenity"="parking"]["hgv"~"^(yes|designated)$"](around:1500,${pts});
      nwr["amenity"="parking"]["parking"~"truck|hgv"](around:1500,${pts});
      nwr["highway"~"^(rest_area|services)$"]["hgv"!="no"](around:1200,${pts});`;
  });
  const q = `[out:json][timeout:40];(${parts.join("\n")});out tags center 1500;`;
  const ask = async (ep: string) => {
    const res = await fetch(ep, {
      method: "POST",
      body: "data=" + encodeURIComponent(q),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "tesotter-truck-planner/1.1" },
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as { elements: El[] };
  };
  try {
    const data = await Promise.any(ENDPOINTS.map(ask));
    const parkings = data.elements
      .map((el) => {
        const c = el.center ?? (el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : null);
        if (!c) return null;
        const t = el.tags ?? {};
        const truck = t.hgv === "yes" || t.hgv === "designated" || /truck|hgv/.test(t.parking ?? "") || !!t["capacity:hgv"];
        return {
          lon: c.lon, lat: c.lat,
          name: t.name ?? (t.highway === "services" ? "Autópálya-pihenő (szerviz)" : t.highway === "rest_area" ? "Pihenőhely" : "Kamionparkoló"),
          truck,
          capacity: t["capacity:hgv"] ?? null,
          services: t.highway === "services",
          fee: t.fee ?? null,
        };
      })
      .filter(Boolean);
    return Response.json({ parkings }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch {
    return Response.json({ error: "A parkoló-adatbázis (Overpass) most nem érhető el – próbáld újra később." }, { status: 504 });
  }
}
