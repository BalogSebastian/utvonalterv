import { banWarnings } from "./bans";
import { COUNTRY_NAMES } from "./country-names";
import type { BanWarning, LngLat, RouteResult, TripStop } from "./types";

/** A felhasználó által szerkeszthető megálló: kávészünet vagy napi pihenő. */
export interface PlanStop {
  id: string;
  kind: "break" | "rest";
  /** az útvonal mentén megtett arány 0..1 */
  f: number;
}

const BREAK_H = 0.75;
const REST_H = 11;
const MAX_CONT_H = 4.5;
const MAX_DAY_H = 9;

export function defaultStops(route: RouteResult): PlanStop[] {
  return route.stops.map((s) => ({ id: s.id, kind: s.kind, f: s.f }));
}

/** Az útvonal geometriájának kumulatív hossza (km, közelítő). */
export function cumulative(geometry: LngLat[]): number[] {
  const cum = [0];
  for (let i = 1; i < geometry.length; i++) {
    const [x1, y1] = geometry[i - 1];
    const [x2, y2] = geometry[i];
    const dx = (x2 - x1) * Math.cos(((y1 + y2) / 2) * (Math.PI / 180)) * 111.32;
    const dy = (y2 - y1) * 110.57;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  return cum;
}

/** Egy pont rávetítése az útvonalra: arány (0..1) és a vetített koordináta. */
export function snapToRoute(geometry: LngLat[], cum: number[], p: LngLat): { f: number; point: LngLat } {
  const total = cum[cum.length - 1] || 1;
  const k = Math.cos((p[1] * Math.PI) / 180);
  let best = Infinity;
  let bestF = 0;
  let bestPt: LngLat = geometry[0];
  for (let i = 1; i < geometry.length; i++) {
    const [ax, ay] = geometry[i - 1];
    const [bx, by] = geometry[i];
    const dx = (bx - ax) * k;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : (((p[0] - ax) * k) * dx + (p[1] - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + (bx - ax) * t;
    const py = ay + (by - ay) * t;
    const d = ((p[0] - px) * k) ** 2 + (p[1] - py) ** 2;
    if (d < best) {
      best = d;
      bestPt = [px, py];
      bestF = (cum[i - 1] + (cum[i] - cum[i - 1]) * t) / total;
    }
  }
  return { f: Math.max(0, Math.min(1, bestF)), point: bestPt };
}

export function pointAtFraction(geometry: LngLat[], cum: number[], f: number): LngLat {
  const target = Math.max(0, Math.min(1, f)) * (cum[cum.length - 1] || 1);
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return geometry[0];
  const seg = cum[lo] - cum[lo - 1] || 1;
  const t = (target - cum[lo - 1]) / seg;
  const [ax, ay] = geometry[lo - 1];
  const [bx, by] = geometry[lo];
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);

/**
 * A szerkesztett megállók alapján újraszámolja a menetrendet, az országonkénti
 * áthaladási időket, a tilalmi figyelmeztetéseket és a sofőrköltséget.
 */
export function applyPlan(
  route: RouteResult,
  plan: PlanStop[],
  departure: string,
  vehicleWeight: number,
  driverHourly: number,
): RouteResult {
  const depMs = Date.parse(`${departure}:00Z`);
  if (!Number.isFinite(depMs)) return route;

  const drivingH = route.drivingMin / 60;
  const sorted = [...plan].sort((a, b) => a.f - b.f);
  const cum = cumulative(route.geometry);

  // --- szimuláció ---
  let t = depMs;
  let prevF = 0;
  let sinceBreak = 0;
  let sinceRest = 0;
  let breaks = 0;
  let rests = 0;
  const hardWarnings: string[] = [];
  const segs: { f0: number; f1: number; t0: number }[] = [];
  const stops: TripStop[] = [];

  const checkSeg = (): string | undefined => {
    const msgs: string[] = [];
    if (sinceBreak > MAX_CONT_H + 0.01) msgs.push(`${sinceBreak.toFixed(1)} óra megszakítás nélküli vezetés (max. 4,5 óra)`);
    if (sinceRest > MAX_DAY_H + 0.01) msgs.push(`${sinceRest.toFixed(1)} óra napi vezetés (max. 9 óra, hetente 2× 10 óra)`);
    return msgs.length ? msgs.join("; ") : undefined;
  };

  sorted.forEach((st) => {
    const drive = (st.f - prevF) * drivingH;
    segs.push({ f0: prevF, f1: st.f, t0: t });
    t += drive * 3600_000;
    sinceBreak += drive;
    sinceRest += drive;
    const warn = checkSeg();
    if (warn) hardWarnings.push(warn);
    const arrive = t;
    if (st.kind === "break") {
      breaks++;
      t += BREAK_H * 3600_000;
      sinceBreak = 0;
    } else {
      rests++;
      t += REST_H * 3600_000;
      sinceBreak = 0;
      sinceRest = 0;
    }
    const pt = pointAtFraction(route.geometry, cum, st.f);
    const km = st.f * route.distanceKm;
    const leg = route.countries.find((c) => km >= c.startKm && km <= c.startKm + c.km) ?? route.countries[route.countries.length - 1];
    stops.push({
      id: st.id, kind: st.kind, f: st.f, atH: st.f * drivingH, km, lon: pt[0], lat: pt[1],
      country: leg?.country ?? "??", time: iso(arrive), day: rests + (st.kind === "rest" ? 0 : 1),
      warn,
    });
    prevF = st.f;
  });
  // utolsó szakasz a célig
  {
    const drive = (1 - prevF) * drivingH;
    segs.push({ f0: prevF, f1: 1, t0: t });
    t += drive * 3600_000;
    sinceBreak += drive;
    sinceRest += drive;
    const warn = checkSeg();
    if (warn) hardWarnings.push(`Az utolsó szakaszon: ${warn}`);
  }
  const arrival = t;

  // nap sorszám a megállókhoz (pihenők után új nap)
  let day = 1;
  for (const st of stops) {
    st.day = day;
    if (st.kind === "rest") day++;
  }

  const wall = (f: number): number => {
    const seg = segs.find((s) => f <= s.f1 + 1e-9) ?? segs[segs.length - 1];
    return seg.t0 + (f - seg.f0) * drivingH * 3600_000;
  };

  // --- országok ideje + tilalmak ---
  const total = route.distanceKm || 1;
  const countries = route.countries.map((c) => {
    const f0 = c.startKm / total;
    const f1 = Math.min(1, (c.startKm + c.km) / total);
    return { ...c, enter: iso(wall(f0)), leave: iso(wall(f1)) };
  });
  const bans = banWarnings(
    countries.map((c) => ({ country: c.country, enter: Date.parse(`${c.enter}:00Z`), leave: Date.parse(`${c.leave}:00Z`) })),
    vehicleWeight,
  );
  const ruleWarnings: BanWarning[] = hardWarnings.map((text) => ({ country: "EU", severity: "danger", text: `Pihenőidő-szabály (EU 561/2006): ${text}.` }));
  // az időtartam alapú napi bontás összegzése
  const totalH = (arrival - depMs) / 3600_000;
  const workH = drivingH + breaks * BREAK_H;
  const driverCostEur = workH * driverHourly;

  return {
    ...route,
    countries,
    stops,
    warnings: [...ruleWarnings, ...bans],
    schedule: {
      drivingH, breaks45: breaks, dailyRests: rests, totalH, days: rests + 1, arrival: iso(arrival),
    },
    driverCostEur,
    totalEur: route.tollTotalEur + route.fuelCostEur + driverCostEur + route.vehicleCostEur,
  };
}

/** Új megálló a legnagyobb "lyuk" közepére (az utolsó megálltól/céltól mért leghosszabb szakaszra). */
export function addStop(plan: PlanStop[], kind: "break" | "rest"): PlanStop[] {
  const fs = [0, ...plan.map((p) => p.f).sort((a, b) => a - b), 1];
  let best = 0;
  let at = 0.5;
  for (let i = 1; i < fs.length; i++) {
    if (fs[i] - fs[i - 1] > best) {
      best = fs[i] - fs[i - 1];
      at = (fs[i] + fs[i - 1]) / 2;
    }
  }
  return [...plan, { id: `${kind[0]}${Date.now().toString(36)}`, kind, f: at }];
}

export const countryLabel = (cc: string) => COUNTRY_NAMES[cc] ?? cc;
