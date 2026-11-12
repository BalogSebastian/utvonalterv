import { countryPolygons } from "./countries";
import { COUNTRY_NAMES } from "./country-names";
import type { LngLat, NoGo, Waypoint } from "./types";

/**
 * No-Go zónák: országok (Natural Earth határ) és saját rajzolt területek.
 * A publikus Valhalla legfeljebb 10 km kerületű kizáró poligont fogad el, ezért egy ország
 * (pl. Svájc) elkerülését iteratívan oldjuk meg: ha az útvonal belép a zónába, a behatoló
 * szakasz útjait kizárjuk (exclude_locations), és újratervezünk.
 */
export interface Zone {
  id: string;
  name: string;
  country?: string;
  polys: number[][][][];
  bbox: [number, number, number, number];
}

function bboxOf(polys: number[][][][]): [number, number, number, number] {
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for (const p of polys) for (const [x, y] of p[0]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function buildZones(noGo?: NoGo): Zone[] {
  if (!noGo) return [];
  const out: Zone[] = [];
  for (const cc of noGo.countries ?? []) {
    const polys = countryPolygons(cc);
    if (polys) out.push({ id: `c:${cc}`, name: COUNTRY_NAMES[cc] ?? cc, country: cc, polys, bbox: bboxOf(polys) });
  }
  for (const a of noGo.areas ?? []) {
    if (!a.ring || a.ring.length < 3) continue;
    const ring = [...a.ring];
    const [f, l] = [ring[0], ring[ring.length - 1]];
    if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f);
    const polys = [[ring]];
    out.push({ id: `a:${a.id}`, name: a.name || "Saját zóna", polys, bbox: bboxOf(polys) });
  }
  return out;
}

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inZone(z: Zone, [x, y]: LngLat): boolean {
  const b = z.bbox;
  if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  for (const poly of z.polys) {
    if (!inRing(x, y, poly[0])) continue;
    let hole = false;
    for (let h = 1; h < poly.length; h++) if (inRing(x, y, poly[h])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

export const hav = (a: LngLat, b: LngLat) => {
  const dx = (b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180) * 111.32;
  const dy = (b[1] - a[1]) * 110.57;
  return Math.hypot(dx, dy);
};

/** egy pont távolsága (km) a zóna határától */
function distToEdge(z: Zone, p: LngLat): number {
  let best = Infinity;
  const k = Math.cos((p[1] * Math.PI) / 180);
  for (const poly of z.polys) for (const ring of poly) {
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1];
      const [bx, by] = ring[i];
      const dx = (bx - ax) * k, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 ? (((p[0] - ax) * k) * dx + (p[1] - ay) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = ((p[0] - ax - (bx - ax) * t) * k) ** 2 + (p[1] - ay - (by - ay) * t) ** 2;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best) * 110.57;
}

/** zóna, ami valamelyik felhasználói pontot tartalmazza: azt nem lehet elkerülni */
export function unavoidableZones(zones: Zone[], wps: Waypoint[]): Set<string> {
  const s = new Set<string>();
  for (const z of zones) if (wps.some((w) => !w.ferry && inZone(z, [w.lon, w.lat]))) s.add(z.id);
  return s;
}

export interface Intrusion { zone: Zone; a: number; b: number; km: number }

/**
 * Az útvonal zónán belüli szakaszai. Az ország-határ (1:50m) pontatlansága miatt csak a
 * legalább 2 km hosszú és a határtól legalább ~0,8 km mélyre hatoló szakaszok számítanak.
 */
export function intrusions(coords: LngLat[], zones: Zone[], skip: Set<string> = new Set()): Intrusion[] {
  const out: Intrusion[] = [];
  for (const z of zones) {
    if (skip.has(z.id)) continue;
    let cur: Intrusion | null = null;
    const close = () => {
      if (!cur) return;
      const c = cur;
      cur = null;
      const custom = !z.country;
      if (!custom && c.km < 2) return;
      if (!custom) {
        let deep = false;
        const step = Math.max(1, Math.floor((c.b - c.a) / 25));
        for (let i = c.a; i <= c.b && !deep; i += step) if (distToEdge(z, coords[i]) > 0.8) deep = true;
        if (!deep) return;
      }
      out.push(c);
    };
    for (let i = 0; i < coords.length; i++) {
      if (inZone(z, coords[i])) {
        if (!cur) cur = { zone: z, a: i, b: i, km: 0 };
        else { cur.km += hav(coords[i - 1], coords[i]); cur.b = i; }
      } else close();
    }
    close();
  }
  return out;
}

/** a kizárandó pontok egy behatoló szakaszhoz: belépés és kilépés után ~1,5 km-rel, valamint a közepén */
export function exclusionPoints(coords: LngLat[], r: Intrusion): LngLat[] {
  const walk = (from: number, dir: 1 | -1) => {
    let d = 0;
    let i = from;
    while (i + dir >= r.a && i + dir <= r.b && d < 1.5) { d += hav(coords[i], coords[i + dir]); i += dir; }
    return coords[i];
  };
  const pts = [walk(r.a, 1), walk(r.b, -1)];
  if (r.km > 6) pts.push(coords[Math.floor((r.a + r.b) / 2)]);
  return pts;
}

/** egy gyűrű kerülete (km) */
export function perimeterKm(ring: LngLat[]): number {
  let s = 0;
  for (let i = 1; i < ring.length; i++) s += hav(ring[i - 1], ring[i]);
  if (ring.length > 2) s += hav(ring[ring.length - 1], ring[0]);
  return s;
}

/** kör alakú zóna gyűrűje */
export function circleRing(c: LngLat, radiusKm: number, n = 40): LngLat[] {
  const out: LngLat[] = [];
  const k = Math.cos((c[1] * Math.PI) / 180);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([c[0] + (Math.cos(a) * radiusKm) / (111.32 * k), c[1] + (Math.sin(a) * radiusKm) / 110.57]);
  }
  return out;
}
