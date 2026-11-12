import { COUNTRY_NAMES } from "./country-names";
import type { BanWarning } from "./types";

/**
 * Tehergépjármű-forgalmi tilalmak (hétvége, ünnepnap, nyári sávok, éjszaka).
 * Az időpontok „naiv helyi” ms-ben (UTC-mezőkkel kezelve). A menetrend a felhasználó
 * időzónájában (közép-európai idő) fut; az ország helyi idejére a TZ_OFFSET vált.
 * Regionális / helyi tilalmak és az évente kihirdetett extra napok (pl. FR „samedis rouges”) nincsenek benne.
 */
type Day = "sun" | "sat" | "fri" | "hol" | "preHol" | "daily";
interface Spec {
  day: Day;
  /** perc a nap 00:00-jától (lehet negatív: előző este kezdődik) */
  start: number;
  dur: number;
  /** csak ebben az időszakban (MM-DD, zárt intervallum) */
  from?: string;
  to?: string;
  /** csak ezekben a hónapokban (1–12) */
  months?: number[];
}
interface BanRule { minWeight: number; specs: Spec[]; text: string }

const h = (x: number) => x * 60;

export const BANS: Record<string, BanRule> = {
  DE: { minWeight: 7.5, specs: [{ day: "sun", start: 0, dur: h(22) }, { day: "hol", start: 0, dur: h(22) }],
    text: "Vasárnap és ünnepnap 00–22 h (>7,5 t); júl.–aug. szombatonként 07–20 h egyes autópályákon (nincs bekalkulálva)" },
  AT: { minWeight: 7.5, specs: [{ day: "sat", start: h(15), dur: h(9) }, { day: "sun", start: 0, dur: h(22) }, { day: "hol", start: 0, dur: h(22) }],
    text: "Szombat 15–24 h, vasárnap és ünnepnap 00–22 h (>7,5 t); éjjel 22–05 csak „lärmarm” járművel, 60 km/h" },
  HU: { minWeight: 7.5, specs: [
      { day: "sun", start: h(-2), dur: h(24) }, { day: "hol", start: h(-2), dur: h(24) },
      { day: "sat", start: h(15), dur: h(7), from: "06-15", to: "08-31" },
    ], text: "Szombat 22 h – vasárnap 22 h, ünnepnap előtti nap 22 h – ünnepnap 22 h (>7,5 t); jún. 15. – aug. 31. szombaton már 15 h-tól" },
  CZ: { minWeight: 7.5, specs: [
      { day: "sun", start: h(13), dur: h(9) }, { day: "hol", start: h(13), dur: h(9) },
      { day: "fri", start: h(17), dur: h(4), from: "07-01", to: "08-31" }, { day: "sat", start: h(7), dur: h(6), from: "07-01", to: "08-31" },
    ], text: "Vasárnap és ünnepnap 13–22 h (>7,5 t); júl.–aug. péntek 17–21 h, szombat 07–13 h" },
  SK: { minWeight: 7.5, specs: [
      { day: "sun", start: 0, dur: h(22) }, { day: "hol", start: 0, dur: h(22) },
      { day: "sat", start: h(7), dur: h(12), from: "07-01", to: "08-31" },
    ], text: "Vasárnap és ünnepnap 00–22 h (>7,5 t, autópálya/gyorsút/I. o.); júl.–aug. szombat 07–19 h" },
  PL: { minWeight: 12, specs: [
      { day: "hol", start: h(8), dur: h(14) }, { day: "preHol", start: h(18), dur: h(4) },
      { day: "fri", start: h(18), dur: h(4), from: "06-26", to: "08-31" }, { day: "sat", start: h(8), dur: h(6), from: "06-26", to: "08-31" },
      { day: "sun", start: h(8), dur: h(14), from: "06-26", to: "08-31" },
    ], text: "Ünnepnap 08–22 h, előtte 18–22 h (>12 t); nyári szezonban péntek 18–22, szombat 08–14, vasárnap 08–22 h" },
  FR: { minWeight: 7.5, specs: [{ day: "sun", start: h(-2), dur: h(24) }, { day: "hol", start: h(-2), dur: h(24) }],
    text: "Szombat / ünnep előtti nap 22 h – vasárnap / ünnepnap 22 h (>7,5 t); nyári „samedis” külön (nincs bekalkulálva)" },
  IT: { minWeight: 7.5, specs: [
      { day: "sun", start: h(9), dur: h(5), months: [1, 2, 3, 4, 5, 10, 11, 12] },
      { day: "sun", start: h(7), dur: h(15), months: [6, 7, 8, 9] },
      { day: "hol", start: h(9), dur: h(13) },
    ], text: "Vasárnap 09–14 h (jún.–szept. 07–22 h), ünnepnap 09–22 h (>7,5 t); a pontos naptár évente rendeletben" },
  SI: { minWeight: 7.5, specs: [
      { day: "sun", start: h(8), dur: h(13) }, { day: "hol", start: h(8), dur: h(13) },
      { day: "sat", start: h(8), dur: h(5), from: "06-28", to: "09-07" },
    ], text: "Vasárnap és ünnepnap 08–21 h (>7,5 t); nyáron szombat 08–13 h" },
  CH: { minWeight: 3.5, specs: [
      { day: "sun", start: 0, dur: h(24) }, { day: "hol", start: 0, dur: h(24) }, { day: "daily", start: h(22), dur: h(7) },
    ], text: "Vasárnap, ünnepnap egész nap és minden éjjel 22–05 h (>3,5 t)" },
};

/** időeltolás (óra) a közép-európai időhöz képest */
export const TZ_OFFSET: Record<string, number> = {
  GB: -1, IE: -1, PT: -1, IS: -1,
  RO: 1, BG: 1, GR: 1, FI: 1, EE: 1, LV: 1, LT: 1, UA: 1, MD: 1, CY: 1, TR: 1, BY: 1,
};

/* ---------- ünnepnapok ---------- */

function easter(y: number): number {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const hh = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const month = Math.floor((hh + l - 7 * m + 114) / 31), day = ((hh + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day);
}

/** fix dátumok (MM-DD) és húsvéthoz képesti eltolások (nap) */
const HOLIDAYS: Record<string, { fixed: string[]; easter: number[] }> = {
  DE: { fixed: ["01-01", "05-01", "10-03", "12-25", "12-26"], easter: [-2, 1, 39, 50] },
  AT: { fixed: ["01-01", "01-06", "05-01", "08-15", "10-26", "11-01", "12-08", "12-25", "12-26"], easter: [1, 39, 50, 60] },
  HU: { fixed: ["01-01", "03-15", "05-01", "08-20", "10-23", "11-01", "12-25", "12-26"], easter: [-2, 1, 50] },
  CZ: { fixed: ["01-01", "05-01", "05-08", "07-05", "07-06", "09-28", "10-28", "11-17", "12-24", "12-25", "12-26"], easter: [-2, 1] },
  SK: { fixed: ["01-01", "01-06", "05-01", "05-08", "07-05", "08-29", "09-15", "11-01", "12-24", "12-25", "12-26"], easter: [-2, 1] },
  PL: { fixed: ["01-01", "01-06", "05-01", "05-03", "08-15", "11-01", "11-11", "12-24", "12-25", "12-26"], easter: [0, 1, 49, 60] },
  FR: { fixed: ["01-01", "05-01", "05-08", "07-14", "08-15", "11-01", "11-11", "12-25"], easter: [1, 39, 50] },
  IT: { fixed: ["01-01", "01-06", "04-25", "05-01", "06-02", "08-15", "11-01", "12-08", "12-25", "12-26"], easter: [1] },
  SI: { fixed: ["01-01", "01-02", "02-08", "04-27", "05-01", "05-02", "06-25", "08-15", "10-31", "11-01", "12-25", "12-26"], easter: [1] },
  CH: { fixed: ["01-01", "08-01", "12-25", "12-26"], easter: [-2, 1, 39, 50] },
};

const DAY_MS = 86400_000;
const hcache = new Map<string, Set<number>>();
function holidays(cc: string, y: number): Set<number> {
  const k = `${cc}${y}`;
  let s = hcache.get(k);
  if (s) return s;
  s = new Set<number>();
  const def = HOLIDAYS[cc];
  if (def) {
    for (const md of def.fixed) s.add(Date.UTC(y, +md.slice(0, 2) - 1, +md.slice(3)));
    const e = easter(y);
    for (const off of def.easter) s.add(e + off * DAY_MS);
  }
  hcache.set(k, s);
  return s;
}
const isHoliday = (cc: string, day: number) => holidays(cc, new Date(day).getUTCFullYear()).has(day);
const mmdd = (day: number) => new Date(day).toISOString().slice(5, 10);

function specOn(cc: string, sp: Spec, day: number): boolean {
  const d = new Date(day);
  if (sp.months && !sp.months.includes(d.getUTCMonth() + 1)) return false;
  if (sp.from && sp.to) { const x = mmdd(day); if (x < sp.from || x > sp.to) return false; }
  const dow = d.getUTCDay();
  switch (sp.day) {
    case "daily": return true;
    case "sun": return dow === 0;
    case "sat": return dow === 6;
    case "fri": return dow === 5;
    case "hol": return isHoliday(cc, day);
    case "preHol": return isHoliday(cc, day + DAY_MS) && !isHoliday(cc, day);
  }
}

/** a tilalmi intervallumok [start, end) egy időszakban, az ország helyi idejében */
function windows(cc: string, from: number, to: number): [number, number][] {
  const rule = BANS[cc];
  if (!rule) return [];
  const out: [number, number][] = [];
  const d0 = Math.floor(from / DAY_MS) * DAY_MS - DAY_MS;
  for (let day = d0; day <= to + DAY_MS; day += DAY_MS) {
    for (const sp of rule.specs) if (specOn(cc, sp, day)) out.push([day + sp.start * 60000, day + (sp.start + sp.dur) * 60000]);
  }
  out.sort((a, b) => a[0] - b[0]);
  // összefésülés
  const merged: [number, number][] = [];
  for (const w of out) {
    const last = merged[merged.length - 1];
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else merged.push([...w]);
  }
  return merged;
}

const toLocal = (cc: string, t: number) => t + (TZ_OFFSET[cc] ?? 0) * 3600_000;
const fromLocal = (cc: string, t: number) => t - (TZ_OFFSET[cc] ?? 0) * 3600_000;

export function applies(cc: string, weight: number): boolean {
  const r = BANS[cc];
  return !!r && weight > r.minWeight;
}

/** ha t (a menetrend idejében) tilalomba esik: a tilalom vége, különben null */
export function banEndAt(cc: string, t: number, weight: number): number | null {
  if (!applies(cc, weight)) return null;
  const lt = toLocal(cc, t);
  for (const [s, e] of windows(cc, lt - DAY_MS, lt + DAY_MS)) if (s <= lt && lt < e) return fromLocal(cc, e);
  return null;
}

/** az első tilalom kezdete (t0, t1) között, vagy null */
export function nextBanStart(cc: string, t0: number, t1: number, weight: number): number | null {
  if (!applies(cc, weight)) return null;
  const a = toLocal(cc, t0);
  const b = toLocal(cc, t1);
  for (const [s] of windows(cc, a, b)) if (s > a && s < b) return fromLocal(cc, s);
  return null;
}

/** helyi idő egy országban (a menetrend idejéből) */
export const localTime = toLocal;

export function banWarnings(
  legs: { country: string; enter: number; leave: number }[],
  weight: number,
  waited: Set<string> = new Set(),
): BanWarning[] {
  const out: BanWarning[] = [];
  const seen = new Set<string>();
  for (const l of legs) {
    const rule = BANS[l.country];
    if (!rule || weight <= rule.minWeight || seen.has(l.country)) continue;
    seen.add(l.country);
    const name = COUNTRY_NAMES[l.country] ?? l.country;
    const a = toLocal(l.country, l.enter);
    const b = toLocal(l.country, l.leave);
    const hit = windows(l.country, a, b).some(([s, e]) => s < b && e > a);
    out.push({
      country: l.country,
      severity: waited.has(l.country) ? "warn" : hit ? "danger" : "info",
      text: waited.has(l.country)
        ? `${name}: a tilalom idejére várakozás van betervezve (az érkezési időben benne van). ${rule.text}.`
        : hit
          ? `${name}: a tervezett áthaladás tilalmi idősávba esik! ${rule.text}.`
          : `${name}: ${rule.text} – az áthaladási idő nem érinti.`,
    });
  }
  return out;
}
