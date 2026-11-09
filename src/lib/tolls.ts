import type { EuroClass, Vehicle } from "./types";

/**
 * ÚTDÍJ-ADATBÁZIS (EUR/km, ~2025/26-os becslés).
 * FIGYELEM: ezek tájékoztató értékek – az útdíjak évente változnak.
 * A tarifák egyetlen helyen vannak (ez a fájl), könnyen frissíthetők.
 * `verified: true` csak akkor, ha hivatalos tarifatáblából ellenőrizve lett.
 *
 * rates sorrend: [≤3,5 t, 3,5–12 t, >12 t ≤3 tengely, 4 tengely, ≥5 tengely]
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
    name: "Ausztria", system: "GO-Maut (km-alapú, CO₂-osztály)",
    classes: ["motorway", "trunk"], osmToll: true, euroAdj: false,
    rates: [0, 0.27, 0.40, 0.5724, 0.5724],
    note: "A/S úthálózat, >3,5 t. 4+ tengely, EURO VI, CO₂-osztály 1: 57,24 ct/km (nettó). 2–3 tengelyes értékek becslések. Brenner/Arlberg/Tauern szakaszfelárak nincsenek benne.",
    confidence: "source", asOf: "2026", verified: false,
  },
  HU: {
    name: "Magyarország", system: "HU-GO (km-alapú e-útdíj)",
    classes: ["motorway", "trunk"], osmToll: true, euroAdj: false,
    rates: [0, 0.25, 0.33, 0.42, 0.42],
    note: "Autópálya + gyorsforgalmi + kijelölt főutak. J4 (4+ tengely) 2026: ~163 Ft/km autópályán (~0,42 €/km, bruttó, másodlagos forrás); J2/J3 becsült.",
    confidence: "source", asOf: "2026 (másodlagos forrás, hu-go.hu-n ellenőrizendő)", verified: false,
  },
  SK: {
    name: "Szlovákia", system: "emyto (km-alapú)",
    classes: ["motorway", "trunk"], osmToll: true, euroAdj: true,
    rates: [0, 0.10, 0.14, 0.18, 0.20],
    note: "Autópálya, gyorsút és I. osztályú utak egy része, >3,5 t.", confidence: "estimate", asOf: "2026 (becslés)", verified: false,
  },
  CZ: {
    name: "Csehország", system: "Mýto (km-alapú)",
    classes: ["motorway", "trunk", "primary"], osmToll: true, euroAdj: true,
    rates: [0, 0.08, 0.12, 0.15, 0.16],
    note: "Autópálya + I. osztályú utak, >3,5 t.", confidence: "estimate", asOf: "2026 (becslés)", verified: false,
  },
  PL: {
    name: "Lengyelország", system: "e-TOLL (km-alapú)",
    classes: ["motorway", "trunk", "primary"], osmToll: true, euroAdj: true,
    rates: [0, 0.07, 0.11, 0.12, 0.13],
    note: "2026.02.01-től: ≥12 t, EURO V+: 0,56 zł/km autópálya/gyorsforgalmi, 0,42 zł/km országos út (~4,3 zł/€). Egységes átlagdíjjal számolva; régebbi EURO normák drágábbak.",
    confidence: "source", asOf: "2026.02.01", verified: false,
  },
  RO: {
    name: "Románia", system: "TollRo (új km-alapú rendszer, 2026)", classes: ["motorway", "trunk", "primary"], osmToll: true,
    rates: [0, 0.04, 0.06, 0.08, 0.09],
    note: "Az új kilométer-alapú teherautó-díj 2026-ban indult (az indulás dátumára és a tarifákra ellentmondó források vannak) – NAGYON bizonytalan becslés. Duna-hidak külön.",
    confidence: "estimate", asOf: "2026 (bizonytalan)", verified: false,
  },
  BG: {
    name: "Bulgária", system: "BGTOLL (km-alapú)",
    classes: ["motorway", "trunk", "primary"], osmToll: true,
    rates: [0, 0.07, 0.11, 0.14, 0.17],
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

export function tierOf(v: Vehicle): Tier {
  if (v.weight <= 3.5) return 0;
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

/** EUR / km az adott országra, járműre. 0 ha nem km-alapú. */
export function ratePerKm(rule: TollRule, v: Vehicle): number {
  if (rule.minWeight !== undefined && v.weight <= rule.minWeight) return 0;
  if (rule.perTonneKm) return rule.perTonneKm * v.weight;
  if (!rule.rates) return 0;
  const base = rule.rates[tierOf(v)];
  return rule.euroAdj ? base * EURO_ADJ[v.euro] : base;
}

export function fixedFee(rule: TollRule, v: Vehicle): number {
  return rule.fixed ? rule.fixed[tierOf(v)] : 0;
}
