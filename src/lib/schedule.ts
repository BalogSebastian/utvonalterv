import { banEndAt, banWarnings, nextBanStart, TZ_OFFSET } from "./bans";
import { COUNTRY_NAMES } from "./country-names";
import type { BanWarning, CostInputs, LngLat, RouteOptions, RouteResult, TripStop } from "./types";

/** A felhasználó által szerkeszthető megálló: szünet vagy napi pihenő. */
export interface PlanStop {
  id: string;
  kind: "break" | "rest";
  /** az útvonal mentén megtett arány 0..1 */
  f: number;
  /** ha meg van adva: a megálló egy valós helyhez [lng,lat] kötött (köztes pont az útvonalon) */
  anchor?: LngLat;
  /** csökkentett (9 órás) napi pihenő */
  reduced?: boolean;
  /** valós kamionparkoló, ahová a megállót illesztettük */
  place?: string;
}

const BREAK_H = 0.75;
const REST_H = 11;
const REDUCED_REST_H = 9;
const MAX_CONT_H = 4.5;
const MAX_DAY_H = 9;
const EXT_DAY_H = 10;
const H_MS = 3600_000;

type SchedOpts = Pick<RouteOptions, "departure" | "flexRules" | "waitBans">;

/* ---------- geometria ---------- */

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
export function snapToRoute(geometry: LngLat[], cum: number[], p: LngLat): { f: number; point: LngLat; distKm: number } {
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
  return { f: Math.max(0, Math.min(1, bestF)), point: bestPt, distKm: Math.sqrt(best) * 110.57 };
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

/* ---------- idő-profil ---------- */

/** vezetési óra az f arányig */
export function hoursAt(route: RouteResult, f: number): number {
  const p = route.profile;
  if (!p?.length) return f * (route.drivingMin / 60);
  if (f <= p[0][0]) return p[0][1];
  let lo = 0;
  let hi = p.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (p[mid][0] < f) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return p[0][1];
  const [f0, h0] = p[lo - 1];
  const [f1, h1] = p[lo];
  return f1 > f0 ? h0 + ((f - f0) / (f1 - f0)) * (h1 - h0) : h1;
}

/** az első f arány, ahol a vezetési idő eléri h-t */
export function fractionAtHours(route: RouteResult, h: number): number {
  const p = route.profile;
  if (!p?.length) return Math.min(1, h / ((route.drivingMin / 60) || 1));
  if (h <= p[0][1]) return p[0][0];
  for (let i = 1; i < p.length; i++) {
    if (p[i][1] >= h) {
      const [f0, h0] = p[i - 1];
      const [f1, h1] = p[i];
      return h1 > h0 ? f0 + ((h - h0) / (h1 - h0)) * (f1 - f0) : f0;
    }
  }
  return 1;
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);

/* ---------- szimuláció ---------- */

interface Seg { f0: number; f1: number; t0: number; t1: number; h0: number; ferry: boolean }

interface SimOut {
  stops: TripStop[];
  plan: PlanStop[];
  segs: Seg[];
  arrival: number;
  breaks: number;
  rests: number;
  waitH: number;
  ferryH: number;
  waitedIn: Set<string>;
  hardWarnings: string[];
  extUsed: number;
  reducedUsed: number;
}

/**
 * Menetrend-szimuláció az útvonal mentén. `plan` = null: automatikus tervezés
 * (szünetek / pihenők a legkorábbi jogszerű érkezéshez), különben a megadott megállókkal.
 */
function simulate(route: RouteResult, plan: PlanStop[] | null, o: SchedOpts, weight: number): SimOut | null {
  const depMs = Date.parse(`${o.departure}:00Z`);
  if (!Number.isFinite(depMs)) return null;
  const flex = o.flexRules !== false;
  const waitBans = o.waitBans !== false;
  const hTotal = hoursAt(route, 1);
  const total = route.distanceKm || 1;
  const cum = cumulative(route.geometry);

  // országhatárok arányban
  const bounds = route.countries.map((c) => ({ cc: c.country, f0: c.startKm / total, f1: Math.min(1, (c.startKm + c.km) / total) }));
  const countryAtF = (f: number) => {
    const hit = bounds.find((b) => f >= b.f0 - 1e-9 && f < b.f1 - 1e-9);
    if (hit) return hit.cc;
    // komp alatt / határréseken: az előző ország
    let prev = bounds[0];
    for (const b of bounds) if (b.f0 <= f) prev = b;
    return prev?.cc ?? "??";
  };
  const nextBoundary = (f: number) => {
    for (const b of bounds) if (b.f1 > f + 1e-9) return b.f1;
    return 1;
  };

  let t = depMs;
  let f = 0;
  let sinceBreak = 0;
  let dayDrive = 0;
  let dayLimit = MAX_DAY_H;
  let breaks = 0;
  let rests = 0;
  let waitH = 0;
  let ferryH = 0;
  let extUsed = 0;
  let reducedUsed = 0;
  const waitedIn = new Set<string>();
  const hardWarnings: string[] = [];
  const segs: Seg[] = [];
  const stops: TripStop[] = [];
  const outPlan: PlanStop[] = [];

  const mkStop = (id: string, kind: TripStop["kind"], durH: number, extra: Partial<TripStop> = {}): TripStop => {
    const pt = pointAtFraction(route.geometry, cum, f);
    return {
      id, kind, f, atH: hoursAt(route, f), km: f * total, lon: pt[0], lat: pt[1],
      country: countryAtF(Math.min(f, 0.999999)), time: iso(t), day: rests + 1, durH, ...extra,
    };
  };

  const checkSeg = (): string | undefined => {
    // 10 órás nap (hetente legfeljebb 2×) a kézi tervben is
    if (flex && dayLimit === MAX_DAY_H && dayDrive > MAX_DAY_H + 0.02 && dayDrive <= EXT_DAY_H + 0.02 && extUsed < 2) { dayLimit = EXT_DAY_H; extUsed++; }
    const msgs: string[] = [];
    if (sinceBreak > MAX_CONT_H + 0.02) msgs.push(`${sinceBreak.toFixed(1)} óra megszakítás nélküli vezetés (max. 4,5 óra)`);
    if (dayDrive > dayLimit + 0.02) msgs.push(`${dayDrive.toFixed(1)} óra napi vezetés (max. ${dayLimit} óra${dayLimit < EXT_DAY_H ? ", hetente 2× 10 óra" : ""})`);
    return msgs.length ? msgs.join("; ") : undefined;
  };

  /** várakozás (tilalom): a pihenőidő-számlálókat is nullázhatja */
  const doWait = (until: number, cc: string) => {
    const dh = (until - t) / H_MS;
    if (dh <= 0) return;
    stops.push(mkStop(`w${stops.length}`, "wait", dh, { warn: undefined, place: `Tilalom kivárása – ${COUNTRY_NAMES[cc] ?? cc}` }));
    waitedIn.add(cc);
    waitH += dh;
    t = until;
    if (dh >= REDUCED_REST_H) { sinceBreak = 0; dayDrive = 0; dayLimit = MAX_DAY_H; rests++; }
    else if (dh >= BREAK_H) sinceBreak = 0;
  };

  /** vezetés fTarget-ig (országhatárokon és tilalmakon megállva) */
  const driveTo = (fTarget: number) => {
    let guard = 0;
    while (f < fTarget - 1e-9 && guard++ < 500) {
      const cc = countryAtF(f);
      if (waitBans) {
        const end = banEndAt(cc, t, weight);
        // a célpont előtt közvetlenül (utolsó ~15 perc) nem várunk – a rakodóhelyre be lehet érni
        if (end && hTotal - hoursAt(route, f) > 0.25) { doWait(end, cc); continue; }
      }
      const fc = Math.min(fTarget, nextBoundary(f));
      const h0 = hoursAt(route, f);
      let dh = hoursAt(route, fc) - h0;
      let fEnd = fc;
      if (waitBans && dh > 0) {
        const tb = nextBanStart(cc, t, t + dh * H_MS, weight);
        if (tb && hTotal - h0 - (tb - t) / H_MS > 0.25) {
          dh = (tb - t) / H_MS;
          fEnd = Math.min(fc, fractionAtHours(route, h0 + dh));
        }
      }
      segs.push({ f0: f, f1: fEnd, t0: t, t1: t + dh * H_MS, h0, ferry: false });
      t += dh * H_MS;
      sinceBreak += dh;
      dayDrive += dh;
      if (fEnd <= f + 1e-12 && dh <= 0) {
        // nincs előrehaladás (pl. tilalom kezdetén): várakozás következik
        if (waitBans) { const end = banEndAt(cc, t + 1000, weight); if (end) { doWait(end, cc); continue; } }
        f = fc;
      } else f = fEnd;
    }
  };

  const doBreak = (id: string, place?: string) => {
    const warn = checkSeg();
    if (warn) hardWarnings.push(warn);
    stops.push(mkStop(id, "break", BREAK_H, { warn, place }));
    breaks++;
    t += BREAK_H * H_MS;
    sinceBreak = 0;
  };
  const doRest = (id: string, reducedWanted: boolean, place?: string) => {
    const warn = checkSeg();
    if (warn) hardWarnings.push(warn);
    const reduced = reducedWanted && reducedUsed < 3;
    if (reduced) reducedUsed++;
    const dur = reduced ? REDUCED_REST_H : REST_H;
    stops.push(mkStop(id, "rest", dur, { warn, place: place ?? (reduced ? "Csökkentett (9 órás) napi pihenő" : undefined) }));
    rests++;
    t += dur * H_MS;
    sinceBreak = 0;
    dayDrive = 0;
    dayLimit = MAX_DAY_H;
    return reduced;
  };
  const doFerry = (fr: RouteResult["ferries"][number]) => {
    const dur = fr.checkInH + fr.durationH;
    const t0 = t;
    t += dur * H_MS;
    ferryH += dur;
    segs.push({ f0: fr.f0, f1: fr.f1, t0, t1: t, h0: hoursAt(route, fr.f0), ferry: true });
    const restOnBoard = fr.berth && dur >= REST_H;
    stops.push({ ...mkStop(`f${fr.id}`, "ferry", dur), place: `${fr.kind === "rail" ? "🚆" : "⛴"} ${fr.from} → ${fr.to}${restOnBoard ? " · napi pihenő a fedélzeten (fekhely)" : dur >= BREAK_H ? " · szünetnek számít" : ""}` });
    if (restOnBoard) { sinceBreak = 0; dayDrive = 0; dayLimit = MAX_DAY_H; rests++; }
    else if (dur >= BREAK_H) sinceBreak = 0;
    f = fr.f1;
  };

  const ferries = [...(route.ferries ?? [])].sort((a, b) => a.f0 - b.f0);

  if (plan) {
    // --- a megadott megállókkal ---
    type Ev = { f: number; stop?: PlanStop; ferry?: RouteResult["ferries"][number] };
    const evs: Ev[] = [
      ...plan.map((st): Ev => ({ f: st.anchor ? snapToRoute(route.geometry, cum, st.anchor).f : st.f, stop: st })),
      ...ferries.map((fr): Ev => ({ f: fr.f0, ferry: fr })),
    ].sort((a, b) => a.f - b.f || (a.ferry ? 1 : -1));
    for (const ev of evs) {
      if (ev.f < f - 1e-9) continue; // kompon belüli megálló: kihagyva
      driveTo(ev.f);
      if (ev.ferry) { doFerry(ev.ferry); continue; }
      const st = ev.stop!;
      const before = stops.length;
      if (st.kind === "break") doBreak(st.id, st.place);
      else doRest(st.id, !!st.reduced && flex, st.place);
      const s = stops[before];
      if (s) s.anchored = !!st.anchor;
      outPlan.push({ ...st, f: ev.f });
    }
    driveTo(1);
    const warn = checkSeg();
    if (warn) hardWarnings.push(`Az utolsó szakaszon: ${warn}`);
  } else {
    // --- automatikus tervezés ---
    let fi = 0;
    let n = 0;
    while (f < 1 - 1e-9 && n++ < 400) {
      const hNow = hoursAt(route, f);
      const remaining = hTotal - hNow;
      const nextFerry = ferries[fi];
      const hFerry = nextFerry ? hoursAt(route, nextFerry.f0) : Infinity;
      // 10 órás nap (hetente 2×): ha így elérjük a célt vagy a kompot
      if (flex && extUsed < 2 && dayLimit === MAX_DAY_H) {
        const reach = Math.min(remaining, hFerry - hNow);
        if (dayDrive + reach > MAX_DAY_H + 0.01 && dayDrive + reach <= EXT_DAY_H) { dayLimit = EXT_DAY_H; extUsed++; }
      }
      const hBreak = hNow + (MAX_CONT_H - sinceBreak);
      const hDay = hNow + (dayLimit - dayDrive);
      const hStop = Math.min(hBreak, hDay);
      if (hFerry <= hStop + 1e-9 && hFerry <= hTotal) {
        driveTo(nextFerry.f0);
        doFerry(nextFerry);
        fi++;
        continue;
      }
      if (hStop >= hTotal - 1e-6) { driveTo(1); break; }
      const fStop = fractionAtHours(route, hStop);
      const restsBefore = rests;
      driveTo(fStop);
      // a vezetés közben tilalom miatti várakozás volt: újratervezés innen
      if (rests !== restsBefore || hoursAt(route, f) < hStop - 1e-3) continue;
      const id = `a${outPlan.length}`;
      if (hDay <= hBreak + 1e-6) {
        const reduced = doRest(id, flex);
        outPlan.push({ id, kind: "rest", f, reduced });
      } else {
        doBreak(id);
        outPlan.push({ id, kind: "break", f });
      }
    }
  }

  // nap sorszám
  let day = 1;
  for (const st of stops) {
    st.day = day;
    if (st.kind === "rest" || (st.kind === "wait" && (st.durH ?? 0) >= REDUCED_REST_H) || (st.kind === "ferry" && st.place?.includes("napi pihenő"))) day++;
  }
  return { stops, plan: outPlan, segs, arrival: t, breaks, rests, waitH, ferryH, waitedIn, hardWarnings, extUsed, reducedUsed };
}

/** automatikus szünet- és pihenőterv (EU 561/2006, a legkorábbi jogszerű érkezéshez) */
export function autoPlan(route: RouteResult, o: SchedOpts, weight: number): PlanStop[] {
  return simulate(route, null, o, weight)?.plan ?? [];
}

/**
 * A megállók alapján újraszámolja a menetrendet, az országonkénti áthaladási időket,
 * a tilalmakat, a sofőr- és a napi költségeket, valamint a teljes költséget.
 */
export function applyPlan(route: RouteResult, plan: PlanStop[], o: SchedOpts, weight: number, costs: CostInputs): RouteResult {
  const sim = simulate(route, plan, o, weight);
  if (!sim) return route;
  const depMs = Date.parse(`${o.departure}:00Z`);
  const total = route.distanceKm || 1;

  const wall = (f: number): number => {
    const seg = sim.segs.find((s) => f >= s.f0 - 1e-9 && f <= s.f1 + 1e-9 && s.f1 > s.f0) ?? sim.segs[sim.segs.length - 1];
    if (!seg) return depMs;
    if (seg.ferry) return seg.t0 + ((f - seg.f0) / (seg.f1 - seg.f0 || 1)) * (seg.t1 - seg.t0);
    return seg.t0 + (hoursAt(route, f) - seg.h0) * H_MS;
  };

  const countries = route.countries.map((c) => {
    const f0 = c.startKm / total;
    const f1 = Math.min(1, (c.startKm + c.km) / total);
    return { ...c, enter: iso(wall(f0)), leave: iso(wall(f1)) };
  });
  const bans = banWarnings(
    countries.map((c) => ({ country: c.country, enter: Date.parse(`${c.enter}:00Z`), leave: Date.parse(`${c.leave}:00Z`) })),
    weight,
    sim.waitedIn,
  );
  const drivingH = hoursAt(route, 1);
  const ruleWarnings: BanWarning[] = sim.hardWarnings.map((text) => ({ country: "EU", severity: "danger", text: `Pihenőidő-szabály (EU 561/2006): ${text}.` }));
  if (drivingH > 56) ruleWarnings.push({ country: "EU", severity: "warn", text: `A vezetési idő (${drivingH.toFixed(1)} óra) meghaladja a heti 56 órát – két sofőr vagy heti pihenő szükséges.` });
  const totalH = (sim.arrival - depMs) / H_MS;
  if (totalH > 6 * 24) ruleWarnings.push({ country: "EU", severity: "warn", text: "Az út 6 napnál hosszabb: heti pihenőidő (45 / 24 óra) is szükséges – ez nincs betervezve." });

  const calendarDays = Math.max(1, Math.ceil(totalH / 24 - 1e-6));
  const workH = drivingH + sim.breaks * BREAK_H + sim.waitH * 0 + (route.ferries ?? []).reduce((s, f) => s + f.checkInH, 0);
  const driverCostEur = workH * costs.driverHourly + calendarDays * (costs.driverDaily ?? 0);
  const vehicleCostEur = (route.roadKm ?? route.distanceKm) * costs.vehicleKm + calendarDays * (costs.vehicleDaily ?? 0);
  const last = countries[countries.length - 1]?.country;
  const off = last ? TZ_OFFSET[last] ?? 0 : 0;

  return {
    ...route,
    countries,
    stops: sim.stops,
    warnings: [...ruleWarnings, ...bans],
    schedule: {
      drivingH, breaks45: sim.breaks, dailyRests: sim.rests, totalH, days: calendarDays,
      arrival: iso(sim.arrival),
      arrivalLocal: off ? iso(sim.arrival + off * H_MS) : undefined,
      waitH: sim.waitH, ferryH: sim.ferryH,
    },
    driverCostEur,
    vehicleCostEur,
    totalEur: route.tollTotalEur + (route.ferryTotalEur ?? 0) + route.fuelCostEur + driverCostEur + vehicleCostEur,
  };
}

/** Új megálló a legnagyobb "lyuk" közepére. */
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
