import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import atlas from "world-atlas/countries-50m.json";
import type { LngLat } from "./types";

/** ISO 3166-1 numerikus -> alpha2 (Európa + szomszédok) */
const NUM_TO_A2: Record<string, string> = {
  "276": "DE", "040": "AT", "348": "HU", "703": "SK", "203": "CZ", "616": "PL",
  "642": "RO", "100": "BG", "705": "SI", "191": "HR", "380": "IT", "250": "FR",
  "724": "ES", "620": "PT", "756": "CH", "056": "BE", "528": "NL", "442": "LU",
  "208": "DK", "688": "RS", "300": "GR", "440": "LT", "428": "LV", "233": "EE",
  "752": "SE", "578": "NO", "246": "FI", "804": "UA", "792": "TR", "070": "BA",
  "499": "ME", "807": "MK", "008": "AL", "826": "GB", "372": "IE", "498": "MD",
  "112": "BY", "438": "LI", "492": "MC", "020": "AD", "674": "SM", "336": "VA",
  "470": "MT", "196": "CY", "352": "IS",
};

interface Poly {
  a2: string;
  bbox: [number, number, number, number];
  rings: number[][][]; // [outer, ...holes] for each polygon flattened as polygons list
  polys: number[][][][];
}

let cache: Poly[] | null = null;

function build(): Poly[] {
  const topo = atlas as unknown as Topology;
  const fc = feature(topo, topo.objects.countries as GeometryCollection) as GeoJSON.FeatureCollection;
  const list: Poly[] = [];
  for (const f of fc.features) {
    const a2 = NUM_TO_A2[String(f.id).padStart(3, "0")];
    if (!a2) continue;
    const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    for (const p of polys) for (const [x, y] of p[0]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    list.push({ a2, bbox: [minX, minY, maxX, maxY], rings: [], polys });
  }
  return list;
}

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Országkód (alpha2) egy pontra; null ha tenger / ismeretlen. */
export function countryAt([x, y]: LngLat): string | null {
  if (!cache) cache = build();
  for (const c of cache) {
    const b = c.bbox;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    for (const poly of c.polys) {
      if (!inRing(x, y, poly[0])) continue;
      let hole = false;
      for (let h = 1; h < poly.length; h++) if (inRing(x, y, poly[h])) { hole = true; break; }
      if (!hole) return c.a2;
    }
  }
  return null;
}

export const COUNTRY_NAMES: Record<string, string> = {
  DE: "Németország", AT: "Ausztria", HU: "Magyarország", SK: "Szlovákia", CZ: "Csehország",
  PL: "Lengyelország", RO: "Románia", BG: "Bulgária", SI: "Szlovénia", HR: "Horvátország",
  IT: "Olaszország", FR: "Franciaország", ES: "Spanyolország", PT: "Portugália", CH: "Svájc",
  BE: "Belgium", NL: "Hollandia", LU: "Luxemburg", DK: "Dánia", RS: "Szerbia", GR: "Görögország",
  LT: "Litvánia", LV: "Lettország", EE: "Észtország", SE: "Svédország", NO: "Norvégia",
  FI: "Finnország", UA: "Ukrajna", TR: "Törökország", BA: "Bosznia-Hercegovina", ME: "Montenegró",
  MK: "Észak-Macedónia", AL: "Albánia", GB: "Egyesült Királyság", IE: "Írország", MD: "Moldova",
  BY: "Belarusz", LI: "Liechtenstein", MC: "Monaco", AD: "Andorra", SM: "San Marino", MT: "Málta",
  CY: "Ciprus", IS: "Izland",
};
