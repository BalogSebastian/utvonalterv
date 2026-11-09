import type { NextRequest } from "next/server";

/**
 * Kamion-korlátozások az OSM-ből (Overpass API, ingyenes).
 * Tiltott (hgv=no), súly-, magasság-, szélesség-, hosszkorlát.
 */
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

interface OverpassWay {
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

function num(v?: string): number | null {
  if (!v) return null;
  const m = v.replace(",", ".").match(/[\d.]+/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (/ft|'/.test(v)) n *= 0.3048;
  if (/lbs/.test(v)) n *= 0.000453592;
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const [s, w, n, e] = ["s", "w", "n", "e"].map((k) => parseFloat(sp.get(k) ?? ""));
  if ([s, w, n, e].some((x) => !Number.isFinite(x))) return Response.json({ error: "bbox" }, { status: 400 });
  const parking = sp.get("mode") === "parking";
  if ((n - s) * (e - w) > (parking ? 1.2 : 0.25)) return Response.json({ error: "Túl nagy terület – közelíts rá." }, { status: 413 });

  const bb = `${s},${w},${n},${e}`;
  const qParking = `[out:json][timeout:25];(
    nwr["amenity"="parking"]["hgv"~"^(yes|designated)$"](${bb});
    nwr["amenity"="parking"]["capacity:hgv"](${bb});
    nwr["highway"="rest_area"]["hgv"!="no"](${bb});
    nwr["amenity"="parking"]["parking"="truck"](${bb});
  );out tags center 800;`;
  const q = parking ? qParking : `[out:json][timeout:25];(
    way["highway"]["hgv"~"^(no|destination|delivery)$"](${bb});
    way["highway"]["maxweight"](${bb});
    way["highway"]["maxheight"](${bb});
    way["highway"]["maxwidth"](${bb});
    way["highway"]["maxlength"](${bb});
    way["highway"]["maxaxleload"](${bb});
    way["highway"]["hazmat"="no"](${bb});
  );out tags geom 2500;`;

  const ask = async (ep: string): Promise<{ elements: OverpassWay[] }> => {
    const res = await fetch(ep, {
      method: "POST",
      body: "data=" + encodeURIComponent(q),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "tesotter-truck-planner/1.0",
      },
      signal: AbortSignal.timeout(22000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  try {
    // a leggyorsabb működő tükör nyer
    const data = await Promise.any(ENDPOINTS.map(ask));
    if (parking) {
      const pts = data.elements
        .map((el) => {
          const c = el.center ?? (el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : null);
          if (!c) return null;
          const t = el.tags ?? {};
          return {
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] },
            properties: {
              name: t.name ?? "Kamionparkoló / pihenő",
              capacity: t["capacity:hgv"] ?? null,
              fee: t.fee ?? null,
              supervised: t.supervised ?? t.surveillance ?? null,
              operator: t.operator ?? null,
            },
          };
        })
        .filter(Boolean);
      return Response.json(
        { type: "FeatureCollection", features: pts },
        { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
      );
    }
    const features = data.elements
      .filter((el) => el.geometry && el.geometry.length > 1)
      .map((el) => {
        const t = el.tags ?? {};
        const hgvNo = t.hgv === "no" || t.hgv === "destination" || t.hgv === "delivery";
        return {
          type: "Feature" as const,
          geometry: { type: "LineString" as const, coordinates: el.geometry!.map((p) => [p.lon, p.lat]) },
          properties: {
            id: el.id,
            name: t.name ?? t.ref ?? "",
            hgv: hgvNo ? t.hgv : null,
            maxweight: num(t.maxweight),
            maxheight: num(t.maxheight),
            maxwidth: num(t.maxwidth),
            maxlength: num(t.maxlength),
            maxaxleload: num(t.maxaxleload),
            hazmat: t.hazmat === "no",
          },
        };
      });
    return Response.json(
      { type: "FeatureCollection", features },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch {
    // alább: hibaág
  }
  return Response.json({ error: "A korlátozás-adatbázis (Overpass) most túlterhelt – próbáld újra pár másodperc múlva." }, { status: 504 });
}
