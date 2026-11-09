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
  /** az él nevei (és országa) alapján egyezik-e */
  test: (names: string[], cc: string) => boolean;
  /** legalább ennyi km egyező él kell az érvényesítéshez */
  minKm: number;
  /** egy áthaladás ára EUR: [≤3,5 t, 2 tengely, 3 tengely, 4+ tengely] */
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
  {
    id: "brenner", name: "Brenner autópálya (A13, Innsbruck–Brenner, 35 km)", country: "AT",
    test: (n, cc) => cc === "AT" && any(n, /^A ?13$/i),
    minKm: 20,
    fees: [12.5, 9, 14, 20.9],
    note: "GO-Maut Streckenmaut, nettó. 4+ tengely EURO VI CO₂-oszt. 3/4: ~20,4–21,3 €. A 2–3 tengelyes értékek becslések.",
    confidence: "source", asOf: "2026",
  },
  // --- csak figyelmeztetés: a díj nincs bekalkulálva ---
  { id: "gsb", name: "Gran San Bernardo alagút (CH–IT)", country: "CH/IT", test: (n) => any(n, /gr(an|and)[- ]saint?[- ]bernard|gran san bernardo/i), minKm: 3, note: "Alagútdíj külön fizetendő.", confidence: "estimate", asOf: "" },
  { id: "tauern", name: "Tauern / Katschberg alagút (A10)", country: "AT", test: (n) => any(n, /tauerntunnel|katschberg/i), minKm: 3, note: "Streckenmaut külön fizetendő.", confidence: "estimate", asOf: "" },
  { id: "arlberg", name: "Arlberg alagút (S16)", country: "AT", test: (n) => any(n, /arlberg/i), minKm: 3, note: "Streckenmaut külön fizetendő.", confidence: "estimate", asOf: "" },
  { id: "karawanken", name: "Karawanken alagút (A11, AT–SI)", country: "AT/SI", test: (n) => any(n, /karawanken/i), minKm: 3, note: "Streckenmaut külön fizetendő.", confidence: "estimate", asOf: "" },
  { id: "gleinalm", name: "Gleinalm / Bosruck (A9)", country: "AT", test: (n) => any(n, /gleinalm|bosruck/i), minKm: 3, note: "Streckenmaut külön fizetendő.", confidence: "estimate", asOf: "" },
  { id: "oresund", name: "Øresund híd (DK–SE)", country: "DK/SE", test: (n) => any(n, /[øöo]resund/i), minKm: 3, note: "Hídidíj külön fizetendő.", confidence: "estimate", asOf: "" },
  { id: "storebaelt", name: "Storebælt híd (DK)", country: "DK", test: (n) => any(n, /storeb[æe]lt|great belt/i), minKm: 3, note: "Hídidíj külön fizetendő.", confidence: "estimate", asOf: "" },
];

export function specialFee(sp: SpecialToll, v: Vehicle): number {
  if (!sp.fees) return 0;
  if (v.weight <= 3.5) return sp.fees[0];
  if (v.axles <= 2) return sp.fees[1];
  if (v.axles === 3) return sp.fees[2];
  return sp.fees[3];
}
