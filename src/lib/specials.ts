import type { Vehicle } from "./types";

/**
 * Alagút-, híd- és szakaszdíjak, amik a km-alapú útdíjon felül jelentkeznek.
 * Az útvonalon az OSM-élek nevei alapján ismerjük fel őket (Valhalla `edge.names`).
 * `fees` nélküli tétel: csak figyelmeztetés, a díj nincs bekalkulálva.
 */
export interface SpecialToll {
  id: string;
  name: string;
  country: string;
  /** az él nevei, országa és középpontja [lng,lat] alapján egyezik-e */
  test: (names: string[], cc: string, at: [number, number]) => boolean;
  /** a szakasz teljes hossza (km): részleges áthaladásnál arányosan számolunk */
  sectionKm?: number;
  /** a szakaszon a km-alapú országos útdíj helyett ez a díj fizetendő (AT Sondermaut) */
  replacesKm?: boolean;
  /** legalább ennyi km egyező él kell az érvényesítéshez */
  minKm: number;
  /** egy (teljes) áthaladás ára EUR: [≤3,5 t, 2 tengely, 3 tengely, 4+ tengely] */
  fees?: [number, number, number, number];
  note: string;
  confidence: "source" | "estimate";
  asOf: string;
}

const any = (names: string[], re: RegExp) => names.some((n) => re.test(n));

export const SPECIALS: SpecialToll[] = [
  {
    id: "frejus", name: "Fréjus közúti alagút (T4, IT–FR, 12,9 km)", country: "FR/IT",
    test: (n) => any(n, /traforo stradale del fr[eé]jus|tunnel routier du fr[eé]jus/i),
    minKm: 8,
    fees: [56.4, 204.8, 411.6, 411.6],
    note: "Egy irányra, bruttó (ÁFA-val). 2 tengelyes: 204,80 €; 3+ tengelyes: 411,60 €. Másodlagos forrás (a SITAF-nál ellenőrizendő); +1,19% 2026-ban.",
    confidence: "source", asOf: "2026",
  },
  {
    id: "montblanc", name: "Mont Blanc alagút (FR–IT, 11,6 km)", country: "FR/IT",
    test: (n) => any(n, /tunnel du mont[- ]blanc|traforo del monte bianco/i),
    minKm: 8,
    fees: [56.4, 204.8, 411.6, 411.6],
    note: "Egy irányra, bruttó. Ugyanaz a másodlagos forrás adja, mint a Fréjusnél – az ATMB/SITAF díjtáblájánál ellenőrizendő.",
    confidence: "source", asOf: "2026",
  },
  // --- Ausztria, Sondermaut-szakaszok: hivatalos GO-Maut 2026 tarifa (EUR, nettó, EURO VI, CO₂-osztály 1, >3,5 t) ---
  // forrás: go-maut.at „GO-Maut Tarife 2026 Streckenmaut” (érvényes 2026.01.01-től)
  {
    id: "a13", name: "A13 Brenner autópálya (Innsbruck-Amras – Brenner, 35 km)", country: "AT",
    test: (n, cc) => cc === "AT" && any(n, /^A ?13$/i),
    minKm: 5, sectionKm: 35, replacesKm: true,
    fees: [12.5, 27.63, 38.57, 57.65],
    note: "Hivatalos 2026-os szakaszdíj, nappal. 4+ tengely éjjel (22–05 óra): 110,34 €. A km-alapú GO-Maut helyett fizetendő.",
    confidence: "source", asOf: "2026.01.01 (ASFINAG)",
  },
  {
    id: "a12", name: "A12 Inntal autópálya (Kufstein – Innsbruck-Amras, 75 km)", country: "AT",
    test: (n, cc, [x]) => cc === "AT" && x > 11.42 && any(n, /^A ?12$/i),
    minKm: 5, sectionKm: 75, replacesKm: true,
    fees: [0, 25.0, 34.78, 51.71],
    note: "Emelt tarifájú szakasz (~0,69 €/km 4+ tengelynél). Hivatalos 2026-os díj, a megtett km arányában.",
    confidence: "source", asOf: "2026.01.01 (ASFINAG)",
  },
  {
    id: "a10", name: "A10 Tauern autópálya (Flachau – Rennweg, Tauern + Katschberg alagút, 47 km)", country: "AT",
    test: (n, cc, [, y]) => cc === "AT" && y < 47.36 && y > 47.0 && any(n, /^A ?10$/i),
    minKm: 5, sectionKm: 47, replacesKm: true,
    fees: [0, 23.9, 33.35, 49.74],
    note: "Hivatalos 2026-os szakaszdíj. A km-alapú GO-Maut helyett fizetendő.",
    confidence: "source", asOf: "2026.01.01 (ASFINAG)",
  },
  {
    id: "gleinalm", name: "A9 Gleinalm alagút (St. Michael – Übelbach, 25 km)", country: "AT",
    test: (n, cc, [, y]) => cc === "AT" && y < 47.345 && y > 47.2 && any(n, /^A ?9$/i),
    minKm: 4, sectionKm: 25, replacesKm: true,
    fees: [0, 13.51, 18.84, 28.11],
    note: "Hivatalos 2026-os szakaszdíj.", confidence: "source", asOf: "2026.01.01 (ASFINAG)",
  },
  {
    id: "bosruck", name: "A9 Bosruck alagút (Spital/Pyhrn – Ardning, 10 km)", country: "AT",
    test: (n, cc, [, y]) => cc === "AT" && y < 47.67 && y > 47.58 && any(n, /^A ?9$/i),
    minKm: 2, sectionKm: 10, replacesKm: true,
    fees: [0, 5.54, 7.74, 11.54],
    note: "Hivatalos 2026-os szakaszdíj.", confidence: "source", asOf: "2026.01.01 (ASFINAG)",
  },
  {
    id: "karawanken", name: "A11 Karawanken alagút (St. Jakob – országhatár, 10 km)", country: "AT",
    test: (n, cc, [, y]) => cc === "AT" && y < 46.56 && any(n, /^A ?11$/i),
    minKm: 2, sectionKm: 10, replacesKm: true,
    fees: [0, 10.0, 13.98, 20.91],
    note: "Hivatalos 2026-os szakaszdíj (osztrák rész). A szlovén oldal a DarsGo díjában.", confidence: "source", asOf: "2026.01.01 (ASFINAG)",
  },
  {
    id: "arlberg", name: "S16 Arlberg alagút (St. Anton – Langen, 16 km)", country: "AT",
    test: (n, cc, [x]) => cc === "AT" && x > 10.08 && x < 10.32 && any(n, /^S ?16$|arlberg/i),
    minKm: 3, sectionKm: 16, replacesKm: true,
    fees: [0, 10.28, 14.35, 21.43],
    note: "Hivatalos 2026-os szakaszdíj.", confidence: "source", asOf: "2026.01.01 (ASFINAG)",
  },
  // --- csak figyelmeztetés: a díj nincs bekalkulálva ---
  { id: "gsb", name: "Gran San Bernardo alagút (CH–IT)", country: "CH/IT", test: (n) => any(n, /gr(an|and)[- ]saint?[- ]bernard|gran san bernardo/i), minKm: 3, note: "Alagútdíj külön fizetendő.", confidence: "estimate", asOf: "" },
  { id: "oresund", name: "Øresund híd (DK–SE)", country: "DK/SE", test: (n) => any(n, /[øöo]resund/i), minKm: 3, note: "Hídidíj külön fizetendő.", confidence: "estimate", asOf: "" },
  { id: "storebaelt", name: "Storebælt híd (DK)", country: "DK", test: (n) => any(n, /storeb[æe]lt|great belt/i), minKm: 3, note: "Hídidíj külön fizetendő.", confidence: "estimate", asOf: "" },
];

const AT_EURO: Record<Vehicle["euro"], number> = { euro6: 1, euro5: 60.24 / 57.24, euro4: 63.24 / 57.24, older: 66.54 / 57.24 };

/** a szakaszdíj; részleges áthaladásnál a megtett km arányában */
export function specialFee(sp: SpecialToll, v: Vehicle, km?: number): number {
  if (!sp.fees) return 0;
  let fee: number;
  if (v.weight <= 3.5) fee = sp.fees[0];
  else if (v.axles <= 2) fee = sp.fees[1];
  else if (v.axles === 3) fee = sp.fees[2];
  else fee = sp.fees[3];
  if (sp.replacesKm && v.weight > 3.5) fee *= AT_EURO[v.euro];
  if (sp.sectionKm && km !== undefined) fee *= Math.min(1, km / sp.sectionKm);
  return fee;
}
