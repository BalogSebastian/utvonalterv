import type { BorderCrossing, CargoKind, LngLat, Waypoint } from "./types";
import { COUNTRY_NAMES } from "./country-names";

/**
 * Feltételes határátkelők: olyan átkelők, amelyeket a kamion csak akkor használhat, ha a fuvarnak
 * van felrakása / lerakása az adott ország(ok)ban (pl. „Ziel- und Quellverkehr” kivétellel
 * kitáblázott határátkelők). Ha a feltétel nem teljesül, az útvonaltervező lezárja az átkelőt.
 *
 * BUILTIN_CROSSINGS: a cég közös listája (minden felhasználónál érvényes, kikapcsolható).
 * A felhasználók a felületen saját átkelőket is felvehetnek (a böngészőben tárolódnak,
 * JSON-ként exportálhatók / importálhatók, és a megosztott linkben is utaznak).
 */
export const BUILTIN_CROSSINGS: BorderCrossing[] = [];

export const DEFAULT_RADIUS_M = 80;

/** a beépített + saját átkelők, a kikapcsoltak nélkül */
export function activeCrossings(user: BorderCrossing[] | undefined, off: string[] | undefined): BorderCrossing[] {
  const offSet = new Set(off ?? []);
  const seen = new Set<string>();
  const out: BorderCrossing[] = [];
  for (const c of [...(user ?? []), ...BUILTIN_CROSSINGS]) {
    if (!c || seen.has(c.id) || c.disabled || offSet.has(c.id)) continue;
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/** a pont rakodási szerepe (az alapértelmezésekkel) */
export function cargoOf(w: Waypoint, i: number, n: number): CargoKind {
  if (w.via || w.ferry) return "none";
  if (w.cargo) return w.cargo;
  return i === 0 ? "load" : i === n - 1 ? "unload" : "both";
}

export const CARGO_LABEL: Record<CargoKind, string> = {
  load: "Felrakás", unload: "Lerakás", both: "Fel- és lerakás", none: "Nincs rakodás",
};

export const MODE_LABEL: Record<BorderCrossing["mode"], string> = {
  any: "felrakás vagy lerakás", load: "felrakás", unload: "lerakás",
};

const cn = (cc: string) => COUNTRY_NAMES[cc] ?? cc;

/**
 * Használható-e az átkelő a fuvar pontjai alapján.
 * @param wpCountries a pontok (pontos) országa, a waypoints sorrendjében
 */
export function crossingAllowed(
  c: BorderCrossing,
  waypoints: Waypoint[],
  wpCountries: (string | null)[],
): { allowed: boolean; reason: string } {
  const need = c.requireIn.length ? c.requireIn : c.countries;
  const req = need.map(cn).join(" vagy ");
  for (let i = 0; i < waypoints.length; i++) {
    const cc = wpCountries[i];
    if (!cc || !need.includes(cc)) continue;
    const k = cargoOf(waypoints[i], i, waypoints.length);
    if (k === "none") continue;
    const ok = c.mode === "any" || k === "both" || k === c.mode;
    if (ok) {
      const what = k === "both" ? MODE_LABEL[c.mode] : CARGO_LABEL[k].toLowerCase();
      return { allowed: true, reason: `Használható: ${what} itt: ${cn(cc)} (${shortLabel(waypoints[i].label)}).` };
    }
  }
  return { allowed: false, reason: `Csak ${req} ${MODE_LABEL[c.mode]} esetén használható – ennél a fuvarnál nincs, ezért elkerüljük.` };
}

const shortLabel = (l: string) => l.split(/[—,]/)[0].trim();

/** kis négyzet (lezárt terület) az átkelő körül [lng,lat][] */
export function crossingSquare(c: BorderCrossing): LngLat[] {
  const m = c.radiusM ?? DEFAULT_RADIUS_M;
  const dy = m / 110570;
  const dx = m / (111320 * Math.cos((c.lat * Math.PI) / 180));
  return [[c.lon - dx, c.lat - dy], [c.lon + dx, c.lat - dy], [c.lon + dx, c.lat + dy], [c.lon - dx, c.lat + dy], [c.lon - dx, c.lat - dy]];
}

/** a pont távolsága (km) egy vonallánctól, és a legközelebbi pont indexe */
export function nearestOnLine(coords: LngLat[], p: LngLat): { km: number; i: number } {
  let best = Infinity;
  let bi = 0;
  const k = Math.cos((p[1] * Math.PI) / 180);
  for (let i = 1; i < coords.length; i++) {
    const [ax, ay] = coords[i - 1];
    const [bx, by] = coords[i];
    // gyors bbox-szűrés (~50 km)
    if (Math.min(ax, bx) - 0.7 > p[0] || Math.max(ax, bx) + 0.7 < p[0] || Math.min(ay, by) - 0.45 > p[1] || Math.max(ay, by) + 0.45 < p[1]) continue;
    const dx = (bx - ax) * k, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? (((p[0] - ax) * k) * dx + (p[1] - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = ((p[0] - ax - (bx - ax) * t) * k) ** 2 + (p[1] - ay - (by - ay) * t) ** 2;
    if (d < best) { best = d; bi = t < 0.5 ? i - 1 : i; }
  }
  return { km: Number.isFinite(best) ? Math.sqrt(best) * 110.57 : Infinity, i: bi };
}

/** áthalad-e az útvonal az átkelőn (a lezárt terület kb. másfélszeresén belül) */
export const passesKm = (c: BorderCrossing) => Math.max(0.12, ((c.radiusM ?? DEFAULT_RADIUS_M) * 1.6) / 1000);
