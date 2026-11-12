import { cargoOf, CARGO_LABEL } from "./crossings";
import { COUNTRY_NAMES } from "./country-names";
import { decodePolyline, encodePolyline } from "./polyline";
import type { CargoKind, LngLat, RouteResult, Waypoint } from "./types";

/**
 * Navigáció a sofőrnek: a kamionos útvonalat ingyenes navigációs appokba visszük át.
 * - Google Maps: a megállók + „irányító” pontok (határátkelők, kompkikötők, saját áthaladási
 *   pontok, hosszú szakaszokon köztes pontok), hogy a Google ne térjen el a kamionos útvonaltól
 *   (pl. ne menjen Svájcon vagy egy lezárt átkelőn át). Linkenként legfeljebb 9 köztes pont,
 *   ezért hosszú útnál több szakasz-link készül.
 * - Waze: csak egy célpont (megállónként).
 * - OsmAnd (ingyenes, kamion-profillal): GPX, ami pontosan a megtervezett nyomvonalat követi.
 */

export interface NavPoint {
  lat: number;
  lon: number;
  /** valódi megálló (felrakás / lerakás / köztes cél) vagy csak irányító pont */
  stop: boolean;
  label?: string;
  cargo?: CargoKind;
}

export interface NavLink { label: string; url: string; from: string; to: string; points: number }

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const short = (l: string) => l.split(/[—,]/)[0].trim();

function haversine(a: LngLat, b: LngLat) {
  const dx = (b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180) * 111.32;
  return Math.hypot(dx, (b[1] - a[1]) * 110.57);
}

function cumKm(g: LngLat[]): number[] {
  const c = [0];
  for (let i = 1; i < g.length; i++) c.push(c[i - 1] + haversine(g[i - 1], g[i]));
  return c;
}

function indexAtKm(cum: number[], km: number): number {
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < km) lo = m + 1; else hi = m; }
  return lo;
}

function nearestIndex(g: LngLat[], p: LngLat, from = 0): number {
  let bi = from, bd = Infinity;
  for (let i = from; i < g.length; i++) {
    const d = (g[i][0] - p[0]) ** 2 + (g[i][1] - p[1]) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

/** a navigációs pontok sorrendben: megállók + irányító pontok az útvonal mentén */
export function navPoints(r: RouteResult, wps: Waypoint[], maxGapKm = 220): NavPoint[] {
  const g = r.geometry;
  if (g.length < 2) return [];
  const cum = cumKm(g);
  const total = cum[cum.length - 1] || 1;
  const scale = total / Math.max(1, r.distanceKm);
  type Cand = { i: number; p: NavPoint; prio: number };
  const cands: Cand[] = [];

  // megállók és saját áthaladási pontok (a felhasználó sorrendjében)
  let from = 0;
  wps.forEach((w, k) => {
    if (w.ferry) return;
    const i = k === 0 ? 0 : k === wps.length - 1 ? g.length - 1 : nearestIndex(g, [w.lon, w.lat], from);
    from = i;
    cands.push({ i, prio: w.via ? 2 : 0, p: { lat: w.lat, lon: w.lon, stop: !w.via, label: short(w.label), cargo: cargoOf(w, k, wps.length) } });
  });
  // kompkikötők: beszállás előtt és kiszállás után
  for (const f of r.ferries) {
    const a = f.geometry[0];
    const b = f.geometry[f.geometry.length - 1];
    if (a) cands.push({ i: nearestIndex(g, a), prio: 1, p: { lat: a[1], lon: a[0], stop: false, label: `⛴ ${f.from}` } });
    if (b) cands.push({ i: nearestIndex(g, b), prio: 1, p: { lat: b[1], lon: b[0], stop: false, label: `${f.to}` } });
  }
  // határátkelők: ~2 km-rel a határ után (a Google ugyanott lépje át a határt)
  r.countries.forEach((c, k) => {
    if (k === 0) return;
    const i = Math.min(g.length - 1, indexAtKm(cum, (c.startKm + 2) * scale));
    cands.push({ i, prio: 1, p: { lat: g[i][1], lon: g[i][0], stop: false, label: `→ ${COUNTRY_NAMES[c.country] ?? c.country}` } });
  });
  cands.sort((a, b) => a.i - b.i || a.prio - b.prio);

  // hosszú, pont nélküli szakaszokon köztes irányító pontok
  const withGaps: Cand[] = [];
  for (let k = 0; k < cands.length; k++) {
    const c = cands[k];
    const prev = withGaps[withGaps.length - 1];
    if (prev) {
      const gap = cum[c.i] - cum[prev.i];
      const n = Math.floor(gap / maxGapKm);
      for (let j = 1; j <= n; j++) {
        const i = indexAtKm(cum, cum[prev.i] + (gap * j) / (n + 1));
        withGaps.push({ i, prio: 3, p: { lat: g[i][1], lon: g[i][0], stop: false } });
      }
    }
    withGaps.push(c);
  }
  // túl közeli irányító pontok összevonása (a megállók mindig maradnak)
  const out: Cand[] = [];
  for (const c of withGaps) {
    const prev = out[out.length - 1];
    if (prev && cum[c.i] - cum[prev.i] < 12) {
      // megálló mindig marad; a túl közeli irányító pont kiesik
      if (c.p.stop) { if (prev.p.stop) out.push(c); else out[out.length - 1] = c; }
      continue;
    }
    out.push(c);
  }
  return out.map((c) => ({ ...c.p, lat: r5(c.p.lat), lon: r5(c.p.lon) }));
}

const ll = (p: NavPoint) => `${p.lat},${p.lon}`;

/**
 * Google Maps navigációs linkek (indulás: a sofőr aktuális helyzete). Egy link legfeljebb
 * 9 köztes pontot visz, ezért a pontokat szakaszokra bontjuk; a következő szakasz linkjét
 * az előző cél elérésekor kell megnyitni.
 */
export function googleLinks(points: NavPoint[], perLink = 9): NavLink[] {
  if (points.length < 2) return [];
  const links: NavLink[] = [];
  let k = 0;
  // az első pont az indulás (felrakás): a sofőr onnan indul, ezért az első link ide is visz
  while (k < points.length - 1) {
    // az 1. szakasz az indulási pontot is érinti; a többinél az indulás a sofőr helyzete (= az előző cél)
    const first = k === 0;
    let end = Math.min(points.length - 1, k + perLink + (first ? 0 : 1));
    // a szakasz lehetőleg valódi megállónál (felrakás / lerakás) érjen véget
    if (end < points.length - 1) {
      for (let j = end; j > k + 3; j--) if (points[j].stop) { end = j; break; }
    }
    const chunk = points.slice(k, end + 1);
    const dest = chunk[chunk.length - 1];
    const ways = first ? chunk.slice(0, -1) : chunk.slice(1, -1);
    const q = new URLSearchParams({ api: "1", destination: ll(dest), travelmode: "driving", dir_action: "navigate" });
    if (ways.length) q.set("waypoints", ways.map(ll).join("|"));
    const fromP = chunk.find((p) => p.label) ?? chunk[0];
    const toP = [...chunk].reverse().find((p) => p.label) ?? dest;
    links.push({
      label: `${links.length + 1}. szakasz`,
      url: `https://www.google.com/maps/dir/?${q.toString().replace(/%2C/g, ",").replace(/%7C/g, "|")}`,
      from: fromP.label ?? "", to: toP.label ?? "", points: ways.length + 1,
    });
    k = end;
  }
  return links;
}

export const wazeUrl = (p: { lat: number; lon: number }) => `https://waze.com/ul?ll=${p.lat},${p.lon}&navigate=yes`;

/** Apple Térkép (iPhone) – egy célpont */
export const appleUrl = (p: { lat: number; lon: number }) => `https://maps.apple.com/?daddr=${p.lat},${p.lon}&dirflg=d`;

/** Douglas–Peucker egyszerűsítés (tűrés fokban), majd legfeljebb max pont */
export function simplify(g: LngLat[], tol = 0.0004, max = 700): LngLat[] {
  if (g.length < 3) return g;
  const keep = new Uint8Array(g.length);
  keep[0] = keep[g.length - 1] = 1;
  const stack: [number, number][] = [[0, g.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let bi = -1, bd = tol * tol;
    const [ax, ay] = g[a], [bx, by] = g[b];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let t = l2 ? ((g[i][0] - ax) * dx + (g[i][1] - ay) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = (g[i][0] - ax - dx * t) ** 2 + (g[i][1] - ay - dy * t) ** 2;
      if (d > bd) { bd = d; bi = i; }
    }
    if (bi > 0) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  let out = g.filter((_, i) => keep[i]);
  if (out.length > max) {
    const step = out.length / max;
    out = Array.from({ length: max }, (_, i) => out[Math.floor(i * step)]).concat([g[g.length - 1]]);
  }
  return out;
}

/* ---------- sofőr-oldal (link a telefonra) ---------- */

export interface DriverTrip {
  /** cím */
  t: string;
  dep: string;
  arr: string;
  km: number;
  driveMin: number;
  /** navigációs pontok */
  p: NavPoint[];
  /** megállók, pihenők */
  s: { k: string; time: string; km: number; place?: string; country: string }[];
  /** figyelmeztetések (tilalmak, átkelők, No-Go) */
  w: string[];
  /** komp / vasút */
  f: { name: string; from: string; to: string }[];
  /** egyszerűsített nyomvonal (polyline, 5 tizedes) – a GPX-hez */
  g: string;
}

export function driverTrip(r: RouteResult, wps: Waypoint[], points: NavPoint[], departure: string): DriverTrip {
  const stops = wps.filter((w) => !w.via && !w.ferry);
  const warn: string[] = [];
  for (const c of r.crossings) if (c.used && !c.allowed) warn.push(`⛔ ${c.name}: ${c.reason}`);
  for (const c of r.crossings) if (!c.used && !c.allowed && c.distKm < 15) warn.push(`🛂 ${c.name}: NE ezen az átkelőn menj – ${c.reason}`);
  for (const z of r.noGo) warn.push(`⛔ Az útvonal ${Math.round(z.km)} km-t halad itt: ${z.name}.`);
  for (const x of r.warnings) if (x.severity !== "info") warn.push(`${x.severity === "danger" ? "🚫" : "⚠️"} ${x.text}`);
  return {
    t: `${short(stops[0]?.label ?? "Indulás")} → ${short(stops[stops.length - 1]?.label ?? "Érkezés")}`,
    dep: departure,
    arr: r.schedule.arrival,
    km: Math.round(r.distanceKm),
    driveMin: Math.round(r.drivingMin),
    p: points,
    s: r.stops.map((s) => ({ k: s.kind, time: s.time, km: Math.round(s.km), place: s.place, country: s.country })),
    w: warn.slice(0, 12),
    f: r.ferries.map((f) => ({ name: f.name, from: f.from, to: f.to })),
    g: encodePolyline(simplify(r.geometry), 5),
  };
}

export function driverGeometry(d: DriverTrip): LngLat[] {
  return d.g ? decodePolyline(d.g, 5) : d.p.map((p) => [p.lon, p.lat] as LngLat);
}

/** GPX: útvonalpontok (rte) + pontos nyomvonal (trk) – OsmAnd: „Navigáció GPX szerint” */
export function gpxFor(title: string, points: NavPoint[], track: LngLat[]): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  const wpt = points.filter((p) => p.stop).map((p) => `<wpt lat="${p.lat}" lon="${p.lon}"><name>${esc(p.label ?? "")}</name>${p.cargo && p.cargo !== "none" ? `<desc>${CARGO_LABEL[p.cargo]}</desc>` : ""}</wpt>`).join("");
  const trk = track.map(([lo, la]) => `<trkpt lat="${la.toFixed(5)}" lon="${lo.toFixed(5)}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="tesotter routeR" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${esc(title)}</name></metadata>${wpt}<trk><name>${esc(title)}</name><trkseg>${trk}</trkseg></trk></gpx>`;
}

/* ---------- tömörített link (#d=...) ---------- */

const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeTrip(d: DriverTrip): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(d));
  if (typeof CompressionStream !== "undefined") return "z" + b64url(await pipe(raw, new CompressionStream("deflate-raw")));
  return "j" + b64url(raw);
}

export async function decodeTrip(s: string): Promise<DriverTrip> {
  const bytes = unb64url(s.slice(1));
  const raw = s[0] === "z" ? await pipe(bytes, new DecompressionStream("deflate-raw")) : bytes;
  return JSON.parse(new TextDecoder().decode(raw)) as DriverTrip;
}
