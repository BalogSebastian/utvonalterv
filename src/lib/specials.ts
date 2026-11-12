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
  confidence: "official" | "source" | "estimate";
  asOf: string;
}

const any = (names: string[], re: RegExp) => names.some((n) => re.test(n));

export const SPECIALS: SpecialToll[] = [
  {
    id: "frejus", name: "Fréjus közúti alagút (T4, IT–FR, 12,9 km)", country: "FR/IT",
    test: (n) => any(n, /traforo stradale del fr[eé]jus|tunnel routier du fr[eé]jus|fr[eé]jus/i),
    minKm: 8,
    fees: [56.4, 204.8, 411.6, 411.6],
    note: "Egy irányra, ÁFA-val. 4. osztály (≥3 tengely, EURO 5–6): 411,60 € (SITAF, 2026.01.01-től, olasz oldal; francia oldalon ~404,90 €). 2 tengely: 204,80 €. EURO 0–4 kamion kitiltva.",
    confidence: "official", asOf: "2026.01.01 (SITAF)",
  },
  {
    id: "montblanc", name: "Mont Blanc alagút (FR–IT, 11,6 km)", country: "FR/IT",
    test: (n) => any(n, /tunnel du mont[- ]blanc|traforo del monte bianco/i),
    minKm: 8,
    fees: [56.4, 204.8, 411.6, 411.6],
    note: "Egy irányra, ÁFA-val. 4. osztály: ~411,60 € (olasz oldal) / ~404,90 € (francia oldal) – a 2025-ös hivatalos díj +1,19% (2026). EURO 0–4 kamion kitiltva.",
    confidence: "source", asOf: "2026 (ATMB/GEIE-TMB 2025 × 1,0119)",
  },
  {
    id: "gsb", name: "Nagy Szent Bernát alagút (CH–IT, 5,8 km)", country: "CH/IT",
    test: (n) => any(n, /gr(an|and)[- ]s(ain)?t?[- ]?bernard|gran san bernardo/i),
    minKm: 3,
    fees: [30, 101, 150, 202],
    note: "4. osztály (≥4 tengely, >3 m): 202,00 € / 192,50 CHF egy irányra (hivatalos, 2026.02.01-től). A 2–3 tengelyes díj becslés.",
    confidence: "official", asOf: "2026.02.01 (letunnel.com)",
  },
  {
    id: "felbertauern", name: "Felbertauern alagút (AT, 5,3 km)", country: "AT",
    test: (n, cc) => cc === "AT" && any(n, /felbertauern/i),
    minKm: 3,
    fees: [12, 40, 55, 72],
    note: "≥4 tengelyes kamion: 72,00 € egy irányra (hivatalos; GO-Box nem használható). A 2–3 tengelyes díj becslés. A 40 t-s tranzit-szabályokat ellenőrizd.",
    confidence: "official", asOf: "2026 (felbertauern.at)",
  },
  {
    id: "oresund", name: "Øresund híd (DK–SE)", country: "DK/SE",
    test: (n) => any(n, /[øöo]resunds?(bron|broen|bridge)?/i),
    minKm: 3,
    fees: [60, 78.4, 78.4, 78.4],
    note: "ØresundBUSINESS (1–500 út/hó, >9 m kamionnál éves díj nélkül): 78,40 € ÁFA nélkül. Kapunál fizetve: 1324 DKK (~177 €).",
    confidence: "official", asOf: "2026 (oresundsbron.com)",
  },
  {
    id: "storebaelt", name: "Storebælt híd (DK)", country: "DK",
    test: (n) => any(n, /storeb[æe]lt|great belt|[øo]stbroen|vestbroen/i),
    minKm: 6,
    fees: [40, 109, 109, 109],
    note: "Kamion 10–20 m: 1020 DKK listaár ÁFA-val (~137 €; nettó ~109 €). Üzleti szerződéssel, EURO 6-tal 887 DKK.",
    confidence: "official", asOf: "2026 (storebaelt.dk)",
  },
  {
    id: "liefkenshoek", name: "Liefkenshoek alagút (Antwerpen, BE)", country: "BE",
    test: (n, cc) => cc === "BE" && any(n, /liefkenshoek/i),
    minKm: 1,
    fees: [6.2, 17.6, 17.6, 17.6],
    note: "2. kategória, nappal (06–22 h) Teletol-lal 17,60 € (kártyával 21,90 €, készpénz 25 €); éjjel az autós díj (4,40 €). A Viapass km-díj külön.",
    confidence: "source", asOf: "2026 (ADAC)",
  },
  {
    id: "westerschelde", name: "Westerschelde alagút (NL)", country: "NL",
    test: (n, cc) => cc === "NL" && any(n, /westerschelde/i),
    minKm: 3,
    fees: [0, 25, 25, 25],
    note: "4. kategória (>12 m): 25,00 € (T-Tag-gel 15,00 €). Személyautóknak 2024 óta ingyenes.",
    confidence: "official", asOf: "2026 (westerscheldetunnel.nl)",
  },
  {
    id: "herrentunnel", name: "Herrentunnel (Lübeck, DE)", country: "DE",
    test: (n, cc) => cc === "DE" && any(n, /herrentunnel/i),
    minKm: 0.5,
    fees: [3, 10, 14, 17.6],
    note: "D osztály (≥4 tengely): 17,60 € készpénz / 14,60 € Quick-Box-szal (2025.03.01 óta).",
    confidence: "official", asOf: "2025.03.01 (herrentunnel.de)",
  },
  {
    id: "warnow", name: "Warnowtunnel (Rostock, DE)", country: "DE",
    test: (n, cc) => cc === "DE" && any(n, /warnow ?tunnel/i),
    minKm: 0.5,
    fees: [5, 12, 15, 20.3],
    note: "≥4 tengely: készpénz 23,00 € (máj.–okt.) / 20,30 € (nov.–ápr.); kártyával / boxszal 17,07 €.",
    confidence: "official", asOf: "2025/26 (warnowquerung.de)",
  },
  {
    id: "giurgiu-ruse", name: "Duna-híd Giurgiu – Ruse (RO–BG)", country: "RO/BG",
    test: (_n, cc, [x, y]) => (cc === "RO" || cc === "BG") && x > 25.96 && x < 26.02 && y > 43.86 && y < 43.9,
    minKm: 1,
    fees: [6, 25, 37, 37],
    note: "A román oldali díj 2026.10.01-től megszűnt; a bolgár oldal (Ruse → Giurgiu irány) díjköteles, ~37 € (>12 t, ≥4 tengely – becslés a párhuzamos hídból).",
    confidence: "estimate", asOf: "2026.10",
  },
  {
    id: "calafat-vidin", name: "Duna-híd 2 Calafat – Vidin (RO–BG)", country: "RO/BG",
    test: (_n, cc, [x, y]) => (cc === "RO" || cc === "BG") && x > 22.93 && x < 22.99 && y > 43.92 && y < 43.99,
    minKm: 1,
    fees: [6, 25, 37, 37],
    note: ">12 t, ≥4 tengely: 37,00 € mindkét irányban (hivatalos).",
    confidence: "official", asOf: "2026 (vidincalafatbridge.bg)",
  },
  {
    id: "dartford", name: "Dartford Crossing (UK)", country: "GB",
    test: (n, cc) => cc === "GB" && any(n, /dartford|queen elizabeth ii bridge/i),
    minKm: 1,
    fees: [3.5, 9.8, 9.8, 9.8],
    note: "D osztály (>2 tengely): 8,40 £ (~9,80 €), 06–22 h; éjjel ingyenes.",
    confidence: "official", asOf: "2026 (gov.uk Dart Charge)",
  },
  {
    id: "humber", name: "Humber híd (UK)", country: "GB",
    test: (n, cc) => cc === "GB" && any(n, /humber bridge/i),
    minKm: 1,
    fees: [2, 17.5, 17.5, 17.5],
    note: "Kamion: 15,00 £ (~17,50 €) számla nélkül / 12,00 £ számlával; 2026.02 óta rendszámfelismeréses.",
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
  // --- Lengyelország: koncessziós autópályák (az e-TOLL helyett, kapus díj, bruttó → nettó) ---
  {
    id: "pl-a2", name: "A2 Świecko – Konin koncessziós autópálya (PL, 255 km)", country: "PL",
    test: (n, cc, [x]) => cc === "PL" && x < 18.25 && any(n, /^A ?2$/i),
    minKm: 5, sectionKm: 255, replacesKm: true,
    fees: [30, 102, 102, 102],
    note: "Autostrada Wielkopolska, 4. kategória (2026.09.11-től): teljes szakasz 535 zł bruttó (≈ 102 € nettó), a megtett km arányában.",
    confidence: "official", asOf: "2026.09.11 (autostrada-a2.pl)",
  },
  {
    id: "pl-a4", name: "A4 Katowice – Kraków koncessziós autópálya (PL, 61 km)", country: "PL",
    test: (n, cc, [x]) => cc === "PL" && x > 19.12 && x < 19.81 && any(n, /^A ?4$/i),
    minKm: 5, sectionKm: 61, replacesKm: true,
    fees: [10, 12.3, 21.1, 21.1],
    note: "Stalexport, 4–5. kategória: 2 kapu × 55 zł = 110 zł bruttó (≈ 21 € nettó), 2026.04.01-től.",
    confidence: "official", asOf: "2026.04.01 (autostrada-a4.com.pl)",
  },
  {
    id: "pl-a1", name: "A1 Rusocin – Nowa Wieś (Toruń) koncessziós autópálya (PL, 152 km)", country: "PL",
    test: (n, cc, [, y]) => cc === "PL" && y > 53.05 && any(n, /^A ?1$/i),
    minKm: 5, sectionKm: 152, replacesKm: true,
    fees: [6, 13.6, 13.6, 13.6],
    note: "AmberOne, 2–4. kategória: 71 zł bruttó a teljes szakaszra (≈ 13,60 € nettó).",
    confidence: "source", asOf: "a1.com.pl díjtábla (2026-ban is ennyi)",
  },
  {
    id: "si-karavanke", name: "Karavanke alagút – szlovén oldal (SI)", country: "SI",
    test: (n, cc, [, y]) => cc === "SI" && y > 46.42 && any(n, /karavank|^A ?2$/i) && y < 46.47,
    minKm: 1.5, sectionKm: 4, replacesKm: true,
    fees: [3, 5.92, 6.56, 13.13],
    note: "Átalánydíj áthaladásonként: R2 5,92 / R3 6,56 / R4 13,13 € (másodlagos forrás).",
    confidence: "source", asOf: "2026",
  },
  // --- csak figyelmeztetés: a díj nincs bekalkulálva ---
  { id: "lascera", name: "Munt la Schera alagút (CH–IT)", country: "CH/IT", test: (n) => any(n, /munt la schera/i), minKm: 1, note: "3,60 m magasságkorlát, egysávos – 4 m-es nyerges szerelvénynek alkalmatlan!", confidence: "estimate", asOf: "" },
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
  if (sp.replacesKm && sp.country === "AT" && v.weight > 3.5) fee *= AT_EURO[v.euro];
  if (sp.sectionKm && km !== undefined) fee *= Math.min(1, km / sp.sectionKm);
  return fee;
}
