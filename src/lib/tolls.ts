import type { EuroClass, Vehicle } from "./types";

/**
 * ÚTDÍJ-ADATBÁZIS (EUR/km, ~2025/26-os becslés).
 * FIGYELEM: ezek tájékoztató értékek – az útdíjak évente változnak.
 * A tarifák egyetlen helyen vannak (ez a fájl), könnyen frissíthetők.
 * `verified: true` csak akkor, ha hivatalos tarifatáblából ellenőrizve lett.
 *
 * rates sorrend: [≤3,5 t, 3,5–12 t, >12 t ≤3 tengely, 4 tengely, ≥5 tengely]
 * byAxles esetén: [≤3,5 t, 2 tengely, 3 tengely, 4 tengely, ≥5 tengely]
 */
export type Tier = 0 | 1 | 2 | 3 | 4;

export interface TollRule {
  name: string;
  system: string;
  /** a díjköteles OSM útosztályok (Valhalla road_class) */
  classes: string[];
  /** OSM toll=yes jelölés is díjkötelessé teszi az élt */
  osmToll: boolean;
  /** minden út díjköteles (pl. svájci LSVA) */
  allRoads?: boolean;
  rates?: [number, number, number, number, number];
  /** a nem autópálya (gyorsforgalmi) díjköteles utak díja, ha eltér (pl. HU főutak, CZ/SK/PL I. osztályú utak) */
  ratesOther?: [number, number, number, number, number];
  /** az autópálya-díj ezekre az útosztályokra vonatkozik (alap: motorway) */
  highClasses?: string[];
  /** a kategória a tengelyszám szerint (>3,5 t: 2 / 3 / 4+ tengely), nem a tömeg szerint (AT, HU) */
  byAxles?: boolean;
  /** a tarifák pénzneme (HUF esetén a felhasználó árfolyamával számolunk) */
  currency?: "EUR" | "HUF";
  /** saját EURO-norma szorzók (ha a hivatalos tábla ismert) */
  euroFactor?: Record<EuroClass, number>;
  /** tonna-km alapú díj (CH LSVA), EUR / t·km */
  perTonneKm?: number;
  /** a megadott tömeg alatt nincs kilométer-alapú díj (t) */
  minWeight?: number;
  /** a díj függ az EURO normától */
  euroAdj?: boolean;
  /** egyszeri / időalapú díj belépésenként, tier szerint */
  fixed?: [number, number, number, number, number];
  note: string;
  /** forrás-megbízhatóság: 'source' = kereséssel megerősített (másodlagos forrás), 'estimate' = becslés */
  confidence: "source" | "estimate";
  /** a tarifa érvényessége / forrása */
  asOf: string;
  verified: boolean;
}

export const TOLL_RULES: Record<string, TollRule> = {
  DE: {
    name: "Németország", system: "Toll Collect (km-alapú, CO₂-osztály)",
    classes: ["motorway", "trunk", "primary"], osmToll: false, minWeight: 7.5, euroAdj: true,
    rates: [0, 0.17, 0.303, 0.324, 0.348],
    note: "Autobahn + Bundesstraße, >7,5 t. EURO VI, CO₂-osztály 1; 18 t felett 3/4/5+ tengely: 30,3 / 32,4 / 34,8 ct/km.",
    confidence: "source", asOf: "2024.07 óta változatlan (2026-ban is érvényes)", verified: false,
  },
  AT: {
    name: "Ausztria", system: "GO-Maut (km-alapú, tengelyszám + EURO + CO₂-osztály)",
    classes: ["motorway", "trunk"], osmToll: true, byAxles: true,
    rates: [0, 0.2774, 0.3856, 0.5724, 0.5724],
    euroFactor: { euro6: 1, euro5: 60.24 / 57.24, euro4: 63.24 / 57.24, older: 66.54 / 57.24 },
    note: "A/S úthálózat, >3,5 t. Hivatalos 2026-os tarifa (nettó, EURO VI, CO₂-osztály 1): 2 tengely 27,74 / 3 tengely 38,56 / 4+ tengely 57,24 ct/km. A Sondermaut-szakaszok (A9, A10, A11, A12, A13, S16) külön, a szakasz tarifájával számolva.",
    confidence: "source", asOf: "2026.01.01 (ASFINAG / WKO tarifatábla)", verified: true,
  },

  HU: {
    name: "Magyarország", system: "HU-GO (km-alapú e-útdíj, J2/J3/J4)",
    classes: ["motorway", "trunk", "primary"], highClasses: ["motorway"], osmToll: true, byAxles: true, currency: "HUF",
    rates: [0, 65.89, 105.32, 163.26, 163.26],
    ratesOther: [0, 53.3, 88.15, 150.97, 150.97],
    note: "Autópálya/gyorsút és főutak külön tarifával (Ft/km, J2/J3/J4 = 2/3/4+ tengely). A forintos díjat a megadott árfolyamon váltjuk át.",
    confidence: "source", asOf: "2026.01 (hu-go.hu tarifatábla; a 2026. márciusi főúti emelésről ellentmondó hírek)", verified: false,
  },

  SK: {
    name: "Szlovákia", system: "emyto (km-alapú)",
    classes: ["motorway", "trunk", "primary"], highClasses: ["motorway", "trunk"], osmToll: true, euroAdj: true,
    rates: [0, 0.10, 0.20, 0.21, 0.22],
    ratesOther: [0, 0.10, 0.19, 0.20, 0.21],
    note: "Autópálya, gyorsút és I. osztályú utak, >3,5 t.", confidence: "estimate", asOf: "2026 (becslés)", verified: false,
  },

  CZ: {
    name: "Csehország", system: "Mýto (km-alapú)",
    classes: ["motorway", "trunk", "primary"], highClasses: ["motorway", "trunk"], osmToll: true, euroAdj: true,
    rates: [0, 0.11, 0.26, 0.30, 0.34],
    ratesOther: [0, 0.06, 0.14, 0.16, 0.18],
    note: "Autópálya + I. osztályú utak (az utóbbi kb. fele annyi), >3,5 t. Pénteki csúcsidőben drágább.", confidence: "estimate", asOf: "2026 (becslés)", verified: false,
  },

  PL: {
    name: "Lengyelország", system: "e-TOLL (km-alapú)",
    classes: ["motorway", "trunk", "primary"], highClasses: ["motorway", "trunk"], osmToll: true, euroAdj: true,
    rates: [0, 0.06, 0.12, 0.12, 0.13],
    ratesOther: [0, 0.05, 0.10, 0.10, 0.10],
    note: "Autópálya/gyorsforgalmi és országos utak. A koncessziós autópálya-szakaszok (A1, A2, A4 egyes részei) drágábbak.",
    confidence: "estimate", asOf: "2026 (becslés)", verified: false,
  },

  RO: {
    name: "Románia", system: "TollRo (új km-alapú rendszer, 2026)", classes: ["motorway", "trunk", "primary"], osmToll: true,
    rates: [0, 0.04, 0.06, 0.08, 0.09],
    note: "Az új kilométer-alapú teherautó-díj 2026-ban indult (az indulás dátumára és a tarifákra ellentmondó források vannak) – NAGYON bizonytalan becslés. Duna-hidak külön.",
    confidence: "estimate", asOf: "2026 (bizonytalan)", verified: false,
  },
  BG: {
    name: "Bulgária", system: "BGTOLL (km-alapú)",
    classes: ["motorway", "trunk", "primary"], highClasses: ["motorway"], osmToll: true,
    rates: [0, 0.06, 0.10, 0.12, 0.12],
    ratesOther: [0, 0.05, 0.08, 0.10, 0.10],
    note: "Autópálya + I. osztályú utak, >3,5 t.", confidence: "estimate", asOf: "2026 (becslés)", verified: false,
  },

  SI: {
    name: "Szlovénia", system: "DarsGo (km-alapú)", classes: ["motorway", "trunk"], osmToll: true,
    rates: [0, 0.14, 0.20, 0.26, 0.29],
    note: "Autópálya + gyorsforgalmi.", confidence: "estimate", asOf: "2026 (becslés, források: 0,15–0,35 €/km)", verified: false,
  },
  HR: {
    name: "Horvátország", system: "Pályadíj (szakaszos, kapus)", classes: ["motorway"], osmToll: true,
    rates: [0.05, 0.08, 0.10, 0.11, 0.11],
    note: "Kapus rendszer, IV. kategória – a források ellentmondóak, becslés.",
    confidence: "estimate", asOf: "2026 (becslés)", verified: false,
  },
  IT: {
    name: "Olaszország", system: "Autostrade (kapus, tengelyszám)", classes: ["motorway"], osmToll: true,
    rates: [0.09, 0.11, 0.13, 0.14, 0.15],
    note: "Tengelyszám szerinti osztály; sík terepen kb. 0,12–0,16 €/km (5. osztály), alpesi alagutak felárasak.",
    confidence: "estimate", asOf: "2026 (becslés)", verified: false,
  },
  FR: {
    name: "Franciaország", system: "Péage (kapus)", classes: ["motorway"], osmToll: true,
    rates: [0.09, 0.15, 0.20, 0.25, 0.28],
    note: "4. osztály. Mont-Blanc / Fréjus alagutak külön díjasak.", confidence: "estimate", asOf: "2026 (0,16–0,35 €/km, koncesszió szerint)", verified: false,
  },
  ES: {
    name: "Spanyolország", system: "Peaje (kapus)", classes: [], osmToll: true,
    rates: [0.09, 0.12, 0.15, 0.17, 0.17], note: "Csak díjas (AP) autópályák.", confidence: "estimate", asOf: "2026 (becslés)", verified: false,
  },
  PT: {
    name: "Portugália", system: "Portagem", classes: [], osmToll: true,
    rates: [0.08, 0.12, 0.18, 0.20, 0.20], note: "Csak díjas autópályák.", confidence: "estimate", asOf: "2026 (becslés)", verified: false,
  },
  CH: {
    name: "Svájc", system: "LSVA (tonna-km alapú, minden út)", classes: [], osmToll: false, allRoads: true,
    perTonneKm: 0.0235, minWeight: 3.5,
    note: "Minden közúton, a megengedett össztömeg alapján. Alagútdíjak külön.", confidence: "source", asOf: "LSVA III, 2026 – 40 t-nál ~0,74–0,95 €/km, minden úton", verified: false,
  },
  BE: {
    name: "Belgium", system: "Viapass (km-alapú)", classes: ["motorway", "trunk"], osmToll: false,
    rates: [0, 0.10, 0.13, 0.15, 0.16], note: "Autópályák és főutak, >3,5 t.", confidence: "estimate", asOf: "2026 (becslés)", verified: false,
  },
};

const EURO_ADJ: Record<EuroClass, number> = { euro6: 1, euro5: 1.12, euro4: 1.2, older: 1.3 };

export function tierOf(v: Vehicle, byAxles = false): Tier {
  if (v.weight <= 3.5) return 0;
  if (byAxles) return v.axles <= 2 ? 1 : v.axles === 3 ? 2 : v.axles === 4 ? 3 : 4;
  if (v.weight <= 12) return 1;
  if (v.axles <= 3) return 2;
  if (v.axles === 4) return 3;
  return 4;
}

export function isTolledEdge(rule: TollRule, roadClass: string | undefined, osmToll: boolean): boolean {
  if (rule.allRoads) return true;
  if (rule.osmToll && osmToll) return true;
  return !!roadClass && rule.classes.includes(roadClass);
}

/**
 * EUR / km az adott országra, járműre és útosztályra. 0 ha nem km-alapú.
 * @param eurHuf a forintos tarifák átváltásához
 */
export function ratePerKm(rule: TollRule, v: Vehicle, roadClass?: string, eurHuf = 400): number {
  if (rule.minWeight !== undefined && v.weight <= rule.minWeight) return 0;
  if (rule.perTonneKm) return rule.perTonneKm * v.weight;
  if (!rule.rates) return 0;
  const high = !roadClass || (rule.highClasses ?? ["motorway"]).includes(roadClass);
  const table = !high && rule.ratesOther ? rule.ratesOther : rule.rates;
  let r = table[tierOf(v, rule.byAxles)];
  if (rule.currency === "HUF") r /= eurHuf || 400;
  if (rule.euroFactor) r *= rule.euroFactor[v.euro];
  else if (rule.euroAdj) r *= EURO_ADJ[v.euro];
  return r;
}

export function fixedFee(rule: TollRule, v: Vehicle): number {
  return rule.fixed ? rule.fixed[tierOf(v, rule.byAxles)] : 0;
}
