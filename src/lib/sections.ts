import type { LngLat, RoadClassKey, RoadSection } from "./types";

/* ---------- kamionos sebességmodell ---------- */

/**
 * Kamion (40 t, >7,5 t) megengedett legnagyobb sebessége: [autópálya, országút] km/h.
 * Forrás: nemzeti KRESZ-ek (tájékoztató). Ismeretlen országnál 80 / 70.
 */
const TRUCK_LIMIT: Record<string, [number, number]> = {
  HU: [80, 70], DE: [80, 60], AT: [80, 70], SK: [90, 80], CZ: [80, 80], PL: [80, 70], SI: [80, 80], HR: [80, 80],
  RO: [90, 80], BG: [80, 80], RS: [80, 70], IT: [80, 70], FR: [90, 80], ES: [90, 80], PT: [90, 80], CH: [80, 80],
  NL: [80, 80], BE: [90, 60], LU: [90, 75], DK: [80, 80], SE: [80, 80], NO: [80, 80], FI: [80, 80], GR: [80, 80],
  LT: [90, 70], LV: [90, 80], EE: [90, 80], BA: [80, 70], ME: [80, 70], MK: [80, 70], AL: [80, 70], UA: [80, 70], TR: [90, 80],
};

/** valós menetsebesség / megengedett sebesség (torlódások, lassítások, előzések nélküli átlag) */
const MW_FACTOR = 0.97;
const RURAL_FACTOR = 0.9;
const URBAN_FACTOR = 0.8;

/** tartalék sebességek (km/h) élszintű adat nélkül */
const FALLBACK: Record<string, number> = {
  motorway: 76, trunk: 66, primary: 58, secondary: 50, tertiary: 44, unclassified: 38, residential: 28, service_other: 22,
};

export interface SpeedEdge {
  roadClass?: string;
  use?: string;
  /** a routing-szerver éle sebessége (km/h) */
  speed?: number;
  /** kihelyezett sebességkorlát (km/h) */
  limit?: number;
}

/** Egy él reális kamionos átlagsebessége (km/h): a kihelyezett / ország szerinti kamion-korlát és az úthálózati sebesség minimuma. */
export function truckSpeed(e: SpeedEdge, cc: string | undefined): number {
  const cls = e.roadClass ?? "";
  const [capMw, capRural] = (cc && TRUCK_LIMIT[cc]) || [80, 70];
  const known = e.speed !== undefined || e.limit !== undefined;
  if (!known) return FALLBACK[cls] ?? FALLBACK.unclassified;
  const net = e.speed ?? Infinity;
  const lim = e.limit ?? Infinity;
  let v: number;
  if (e.use === "ramp" || e.use === "turn_channel") {
    v = Math.min(net, lim, 50) * 0.85;
  } else if (cls === "motorway") {
    v = Math.min(lim, capMw, net === Infinity ? capMw : Math.max(net, 40)) * MW_FACTOR;
  } else if (cls === "trunk") {
    // gyorsforgalmi / négysávos főút: az autópálya-korlát, de a kihelyezett sebesség alatt
    v = Math.min(lim, net === Infinity ? capRural : Math.max(net, 40), Math.max(capRural, Math.min(capMw, lim))) * (lim <= 60 ? URBAN_FACTOR : RURAL_FACTOR);
  } else if (lim <= 60 || cls === "residential" || cls === "service_other" || cls === "unclassified") {
    // lakott terület / helyi út
    v = Math.min(lim, net, 50) * URBAN_FACTOR;
  } else {
    v = Math.min(lim, capRural, net) * RURAL_FACTOR;
  }
  return Math.max(8, v);
}

/* ---------- útszakaszok ---------- */

export interface SectionEdge extends SpeedEdge {
  km: number;
  ferry?: boolean;
  names?: string[];
  /** az él indexei a (teljes, ritkítatlan) geometriában */
  i0: number;
  i1: number;
}

export interface SignAt { i: number; exit?: string; toward?: string }

const REF = /^[A-DF-Z][A-Z]{0,2} ?\d{1,4}[a-zA-Z]?$/;
const EURO = /^E ?\d{1,3}$/;
const NUM = /^\d{1,4}$/;
/** autópálya-név (pl. „West Autobahn”), szemben a városi utcanévvel, amely a felhajtón előfordulhat */
const NAMED_MW = /bahn|autostr|autoroute|autopista|autoestrada|d[aá]lnice|diaľnica|autocesta|autópálya|motorway|snelweg|motorväg/i;
const MAJOR = new Set(["motorway", "trunk", "primary", "secondary"]);

const normRef = (r: string) => r.replace(/^([A-Z]+) (\d)/, "$1$2");

/** az él útszáma, E-számai és utcaneve */
export function parseNames(names: string[] | undefined, roadClass?: string): { ref?: string; euro: string[]; street?: string } {
  const n = names ?? [];
  const euro = n.filter((x) => EURO.test(x)).map((x) => x.replace(/^E ?/, "E "));
  let ref = n.find((x) => REF.test(x) && !EURO.test(x));
  if (!ref) {
    // magyar / szlovák főutak számozása: csak egyetlen számnév, főúton (a házszám-szerű „3,4,5” nevek zaj)
    const nums = n.filter((x) => NUM.test(x));
    if (nums.length === 1 && MAJOR.has(roadClass ?? "")) ref = nums[0];
  }
  const street = n.find((x) => !REF.test(x) && !EURO.test(x) && !NUM.test(x));
  return { ref: ref ? normRef(ref) : undefined, euro, street };
}

const CLS_RANK: Record<RoadClassKey, number> = { ferry: 7, motorway: 6, trunk: 5, primary: 4, secondary: 3, minor: 2, local: 1 };

function classOf(c: string | undefined): RoadClassKey {
  if (c === "motorway") return "motorway";
  if (c === "trunk") return "trunk";
  if (c === "primary") return "primary";
  if (c === "secondary") return "secondary";
  if (c === "tertiary") return "minor";
  return "local";
}

interface Acc {
  key: string;
  ref?: string;
  euro: Set<string>;
  streets: Map<string, number>;
  country: string;
  ferry: boolean;
  startKm: number;
  km: number;
  h: number;
  tollKm: number;
  tollEur: number;
  i0: number;
  i1: number;
  clsKm: Map<RoadClassKey, number>;
  limKm: Map<number, number>;
  signs: SignAt[];
  /** ismert (névvel / útszámmal rendelkező) szakasz */
  named: boolean;
}

/**
 * Az élekből összefüggő útszakaszok: azonos útszám / utcanév + ország. A névtelen élek (felhajtók,
 * csomópontok) a szomszédos szakaszhoz tartoznak; a rövid helyi utak „helyi utak” csoportba olvadnak.
 */
export function buildSections(
  edges: SectionEdge[],
  ccs: (string | undefined)[],
  tolled: boolean[],
  hours: number[],
  costs: number[],
  fAt: (i: number) => number,
  signs: SignAt[],
): RoadSection[] {
  const raw: Acc[] = [];
  let cum = 0;
  for (let k = 0; k < edges.length; k++) {
    const e = edges[k];
    const cc = ccs[k] ?? "??";
    let key: string;
    let ref: string | undefined;
    let euro: string[] = [];
    let street: string | undefined;
    if (e.ferry) key = `ferry|${raw.length}`;
    else {
      const p = parseNames(e.names, e.roadClass);
      ref = p.ref;
      euro = p.euro;
      street = p.street;
      key = ref ? `r|${ref}|${cc}` : street ? `s|${street}|${cc}` : euro.length ? `e|${euro[0]}|${cc}` : "";
    }
    const last = raw[raw.length - 1];
    // névtelen él (felhajtó, csomópont): marad az előző szakaszban; ha a sor elején áll, a következővel jön létre
    if (!key && last && !last.ferry) key = last.key;
    else if (!key) key = `u|${cc}`;
    // a ferry-élek összevonása: egymás utáni komp-élek egy szakasz
    const sameFerry = e.ferry && last?.ferry && last.i1 === e.i0;
    let cur = last;
    if (!cur || (!sameFerry && (cur.key !== key || cur.country !== cc || cur.ferry !== !!e.ferry))) {
      cur = {
        key, ref, euro: new Set(), streets: new Map(), country: cc, ferry: !!e.ferry, startKm: cum, km: 0, h: 0,
        tollKm: 0, tollEur: 0, i0: e.i0, i1: e.i1, clsKm: new Map(), limKm: new Map(), signs: [], named: key !== "" && !key.startsWith("u|"),
      };
      raw.push(cur);
    }
    // a szakasz útszáma az első ismert névből
    if (ref && !cur.ref && cur.key.startsWith("r|")) cur.ref = ref;
    for (const x of euro) cur.euro.add(x);
    if (street) cur.streets.set(street, (cur.streets.get(street) ?? 0) + e.km);
    cur.km += e.km;
    cur.h += hours[k];
    cur.i1 = e.i1;
    if (tolled[k]) { cur.tollKm += e.km; cur.tollEur += costs[k]; }
    const cls: RoadClassKey = e.ferry ? "ferry" : classOf(e.roadClass);
    cur.clsKm.set(cls, (cur.clsKm.get(cls) ?? 0) + e.km);
    if (e.limit) cur.limKm.set(e.limit, (cur.limKm.get(e.limit) ?? 0) + e.km);
    cum += e.km;
  }

  // táblák (kijárat / irány) a szakaszokhoz: az (i0, i1] tartomány
  for (const s of signs) {
    const sec = raw.find((x) => s.i > x.i0 && s.i <= x.i1) ?? raw.find((x) => s.i === x.i0);
    if (sec) sec.signs.push(s);
  }

  // kis jelentéktelen szakaszok beolvasztása
  const dominant = (a: Acc): RoadClassKey => [...a.clsKm.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "local";
  const absorb = (into: Acc, from: Acc) => {
    into.km += from.km; into.h += from.h; into.tollKm += from.tollKm; into.tollEur += from.tollEur;
    into.i1 = Math.max(into.i1, from.i1); into.i0 = Math.min(into.i0, from.i0);
    for (const [c, v] of from.clsKm) into.clsKm.set(c, (into.clsKm.get(c) ?? 0) + v);
    for (const [l, v] of from.limKm) into.limKm.set(l, (into.limKm.get(l) ?? 0) + v);
    for (const [s, v] of from.streets) into.streets.set(s, (into.streets.get(s) ?? 0) + v);
    for (const x of from.euro) into.euro.add(x);
    into.signs.push(...from.signs);
  };
  const merged: Acc[] = [];
  for (const a of raw) {
    const last = merged[merged.length - 1];
    const isLocal = !a.ref && !a.ferry && !a.euro.size && (dominant(a) === "local" || dominant(a) === "minor");
    // jelentéktelen (<0,6 km) számozott szakasz: csomópont-összekötő, az előzőhöz tartozik
    if (last && !a.ferry && !last.ferry && a.km < 0.6 && a.country === last.country && !(isLocal && last.key === "local|group")) {
      absorb(last, a);
      continue;
    }
    // rövid helyi utak (<3 km) egy csoportba
    if (isLocal && a.km < 3 && last && !last.ref && !last.ferry && last.country === a.country && (last.key === "local|group" || (last.km < 3 && !last.ref && last.streets.size))) {
      absorb(last, a);
      last.key = "local|group";
      continue;
    }
    merged.push({ ...a, signs: [...a.signs], clsKm: new Map(a.clsKm), limKm: new Map(a.limKm), streets: new Map(a.streets), euro: new Set(a.euro) });
  }

  return merged.map((a): RoadSection => {
    const cls = a.ferry ? "ferry" : dominant(a);
    // ha a szakasz jórészt számozott főút, a besorolás a domináns; kisebb osztály ne torzítson
    const lim = [...a.limKm.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    const streets = [...a.streets.entries()].sort((x, y) => y[1] - x[1]).map(([n]) => n);
    const grouped = a.key === "local|group" || (!a.ref && !a.ferry && streets.length > 2);
    const label = a.ferry ? "Komp / vasút" : a.ref ?? (grouped ? "Helyi utak" : streets[0] ?? ([...a.euro][0] ?? "Névtelen út"));
    const tw = a.signs.find((s) => s.toward);
    const ex = [...a.signs].reverse().find((s) => s.exit);
    return {
      ref: a.ref,
      euro: a.euro.size ? [...a.euro].slice(0, 3) : undefined,
      name: a.ref && streets[0] && (cls === "motorway" || cls === "trunk" ? NAMED_MW.test(streets[0]) : (a.streets.get(streets[0]) ?? 0) >= a.km * 0.5) ? streets[0] : undefined,
      label,
      cls: cls as RoadClassKey,
      country: a.country,
      startKm: a.startKm,
      km: a.km,
      f0: fAt(a.i0),
      f1: fAt(a.i1),
      h: a.h,
      speed: a.h > 0 ? a.km / a.h : 0,
      limit: lim,
      tollKm: a.tollKm,
      tollEur: a.tollEur,
      toward: tw?.toward,
      exit: ex ? [ex.exit && `${ex.exit}. lehajtó`, ex.toward].filter(Boolean).join(" → ") : undefined,
      via: grouped ? streets.slice(0, 3) : undefined,
      start: "",
      end: "",
    };
  }).filter((s) => s.km > 0.05 || s.cls === "ferry");
}

export const rankOf = (c: RoadClassKey) => CLS_RANK[c];

/** a geometria [f0, f1] arány közötti darabja (a ritkított vonalon is jó) */
export function sliceFraction(geometry: LngLat[], cum: number[], f0: number, f1: number): LngLat[] {
  const total = cum[cum.length - 1] || 1;
  const a = f0 * total;
  const b = f1 * total;
  const out: LngLat[] = [];
  for (let i = 0; i < geometry.length; i++) {
    if (cum[i] >= a - 1e-9 && cum[i] <= b + 1e-9) out.push(geometry[i]);
  }
  if (out.length < 2) {
    const i = Math.max(0, Math.min(geometry.length - 2, cum.findIndex((c) => c >= a) - 1));
    return [geometry[i], geometry[i + 1]];
  }
  return out;
}
