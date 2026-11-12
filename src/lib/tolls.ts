import type { EuroClass, Vehicle } from "./types";

/**
 * ÚTDÍJ-ADATBÁZIS (EUR/km, NETTÓ – ÁFA nélkül), 2026-os hivatalos tarifatáblák alapján (lásd asOf).
 * Az útdíjak évente változnak – a `confidence` jelzi a forrás megbízhatóságát.
 * A tarifák egyetlen helyen vannak (ez a fájl), könnyen frissíthetők.
 * `verified: true` csak akkor, ha hivatalos tarifatáblából ellenőrizve lett.
 *
 * rates sorrend: [≤3,5 t, 3,5–12 t, >12 t ≤3 tengely, 4 tengely, ≥5 tengely]
 * byAxles esetén: [≤3,5 t, 2 tengely, 3 tengely, 4 tengely, ≥5 tengely]
 */
export type Tier = 0 | 1 | 2 | 3 | 4;

/** árfolyamok (1 EUR = x egység) – a forint a felhasználó beállításából jön */
export const FX = { CZK: 24.4, PLN: 4.25, RON: 5.08, DKK: 7.46, SEK: 11.1, GBP: 0.86, CHF: 0.94, NOK: 11.6, RSD: 117.2, TRY: 44 };

const EURO_IDX: Record<EuroClass, 0 | 1 | 2 | 3> = { euro6: 0, euro5: 1, euro4: 2, older: 3 };
/** EURO-norma szorzó: [VI, V, IV, III-] */
const ef = (v: Vehicle, f: [number, number, number, number]) => f[EURO_IDX[v.euro]];
const isHigh = (rc: string | undefined, high: string[]) => !rc || high.includes(rc);

export interface TollRule {
  name: string;
  /** egyedi díjfüggvény: EUR / km (nettó) a járműre és az útosztályra */
  rate?: (v: Vehicle, roadClass: string | undefined, eurHuf: number, at: [number, number] | undefined, depMs: number) => number;
  /** egyedi időalapú díj (matrica / Eurovignette / HGV levy), EUR, belépésenként */
  fixedFn?: (v: Vehicle) => number;
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
  /** forrás: 'official' = hivatalos tarifatábla, 'source' = megbízható (másodlagos) forrás, 'estimate' = becslés */
  confidence: "official" | "source" | "estimate";
  /** a tarifa érvényessége / forrása */
  asOf: string;
  verified: boolean;
}

export const TOLL_RULES: Record<string, TollRule> = {
  DE: {
    name: "Németország", system: "Toll Collect (km-alapú, CO₂-osztály)",
    classes: ["motorway", "trunk", "primary"], osmToll: false, minWeight: 3.5,
    rate: (v) => {
      // BFStrMG 1. melléklet (2024.07 óta, 2026-ban változatlan), EURO VI + CO₂-osztály 1, ct/km
      const t = v.weight < 7.5 ? 15.1 : v.weight < 12 ? 17.7 : v.weight <= 18 ? 23.8 : v.axles <= 3 ? 30.3 : v.axles === 4 ? 32.4 : 34.8;
      const f = v.weight > 18 ? ef(v, [1, 38.9 / 34.8, 41.4 / 34.8, 47.8 / 34.8]) : ef(v, [1, 1.16, 1.22, 1.38]);
      return (t * f) / 100;
    },
    note: "Minden Autobahn és Bundesstraße, >3,5 t. EURO VI, CO₂-osztály 1: 3,5–7,5 t 15,1 / 7,5–12 t 17,7 / 12–18 t 23,8 / >18 t ≤3 tengely 30,3 / 4 tengely 32,4 / 5+ tengely 34,8 ct/km. Nincs ÁFA.",
    confidence: "official", asOf: "BFStrMG 1. melléklet, 2024.07 óta (2026-ban érvényes)", verified: true,
  },
  AT: {
    name: "Ausztria", system: "GO-Maut (km-alapú, tengelyszám + EURO + CO₂-osztály)",
    classes: ["motorway", "trunk"], osmToll: true, byAxles: true,
    rates: [0, 0.2774, 0.3856, 0.5724, 0.5724],
    euroFactor: { euro6: 1, euro5: 60.24 / 57.24, euro4: 63.24 / 57.24, older: 66.54 / 57.24 },
    note: "A/S úthálózat, >3,5 t. Hivatalos 2026-os tarifa (nettó, EURO VI, CO₂-osztály 1): 2 tengely 27,74 / 3 tengely 38,56 / 4+ tengely 57,24 ct/km. A Sondermaut-szakaszok (A9, A10, A11, A12, A13, S16) külön, a szakasz tarifájával számolva.",
    confidence: "official", asOf: "2026.01.01 (ASFINAG / WKO tarifatábla)", verified: true,
  },
  HU: {
    name: "Magyarország", system: "HU-GO (km-alapú e-útdíj, J2/J3/J4/J5)",
    classes: ["motorway", "trunk", "primary"], osmToll: true,
    rate: (v, rc, eurHuf) => {
      if (v.weight <= 3.5) return 0;
      // NÚSZ 2026.01.01-i tábla, EURO VI, külterület, bruttó / 1,27 = nettó Ft/km
      const k = v.axles <= 2 ? 0 : v.axles === 3 ? 1 : v.axles === 4 ? 2 : 3;
      const mw = [88.10, 133.45, 200.28, 214.37][k];
      const main = [58.24, 87.72, 139.07, 149.59][k];
      const gross = isHigh(rc, ["motorway", "trunk"]) ? mw : main;
      return ((gross / 1.27) * ef(v, [1, 1.07, 1.15, 1.24])) / (eurHuf || 400);
    },
    note: "Gyorsforgalmi utak és főutak külön tarifával. 2026-os hivatalos díj EURO VI, külterület (bruttó Ft/km, gyorsforgalmi | főút): J2 88,10 | 58,24 · J3 133,45 | 87,72 · J4 200,28 | 139,07 · J5 214,37 | 149,59 – a kalkuláció nettó (÷1,27) összeggel számol, a megadott árfolyamon.",
    confidence: "official", asOf: "2026.01.01 (NÚSZ / toll-charge.hu tarifatábla)", verified: true,
  },
  SK: {
    name: "Szlovákia", system: "emyto (km-alapú)",
    classes: ["motorway", "trunk", "primary"], osmToll: true,
    rate: (v, rc) => {
      if (v.weight <= 3.5) return 0;
      // NV 418/2024 Z. z. 5. és 6. melléklet (2025.07.01-től), EURO VI CO₂ 1, EUR/km ÁFA nélkül
      const k = v.weight <= 12 ? 0 : v.axles <= 2 ? 1 : v.axles === 3 ? 2 : v.axles === 4 ? 3 : 4;
      const mw = [0.1039, 0.1919, 0.27, 0.3002, 0.2677][k];
      const first = [0.0921, 0.1446, 0.1927, 0.2238, 0.1942][k];
      return (isHigh(rc, ["motorway", "trunk"]) ? mw : first) * ef(v, [1, 1.1, 1.21, 1.28]);
    },
    note: "Autópálya, gyorsút és az I. osztályú utak díjköteles szakaszai, >3,5 t. 5+ tengely EURO VI: 0,2677 €/km (autópálya), 0,1942 €/km (I. o. út). Az autópályával párhuzamos I. o. utakon az autópálya-díj érvényes.",
    confidence: "official", asOf: "NV 418/2024 Z. z., 2025.07.01 óta (2026-ban nincs újabb)", verified: true,
  },
  CZ: {
    name: "Csehország", system: "Mýto CZ (km-alapú)",
    classes: ["motorway", "trunk", "primary"], osmToll: true,
    rate: (v, rc) => {
      if (v.weight <= 3.5) return 0;
      // NV 240/2014 Sb. (NV 327/2025 Sb., 2026.01.01-től), EURO VI CO₂ 1, CZK/km
      const a = v.axles <= 2 ? 0 : v.axles === 3 ? 1 : v.axles === 4 ? 2 : 3;
      const hi = isHigh(rc, ["motorway", "trunk"]);
      const T = v.weight < 7.5
        ? (hi ? [0.822, 1.0145, 1.5465, 1.7983] : [0.5784, 0.7404, 1.1405, 1.372])
        : v.weight < 12
          ? (hi ? [1.3153, 1.7363, 2.3885, 2.8853] : [0.8892, 1.1631, 1.6628, 2.0017])
          : (hi ? [2.834, 3.7433, 4.9285, 5.9644] : [1.7163, 2.242, 3.0233, 3.6509]);
      const f = hi ? ef(v, [1, 1.082, 1.156, 1.156]) : ef(v, [1, 1.134, 1.255, 1.255]);
      return (T[a] * f) / FX.CZK;
    },
    note: "Autópályák + kijelölt I. osztályú utak, >3,5 t. ≥12 t, 5+ tengely EURO VI: 5,9644 Kč/km (autópálya), 3,6509 Kč/km (I. o.). Nincs időszakos felár. Átváltás: 1 € = 24,4 Kč.",
    confidence: "official", asOf: "NV 327/2025 Sb., 2026.01.01", verified: true,
  },
  PL: {
    name: "Lengyelország", system: "e-TOLL (km-alapú) + koncessziós autópályák",
    classes: ["motorway", "trunk", "primary"], osmToll: true,
    rate: (v, rc) => {
      if (v.weight <= 3.5) return 0;
      // Dz.U. 2026 poz. 33 (2026.02.01-től), PLN/km; EURO V és VI azonos
      const hi = isHigh(rc, ["motorway", "trunk"]);
      const r = v.weight >= 12 ? (hi ? 0.56 : 0.42) : (hi ? 0.41 : 0.34);
      return (r * ef(v, [1, 1, 1.34, 1.66])) / FX.PLN;
    },
    note: "Állami A/S és GP/G utak: ≥12 t EURO 5+ 0,56 zł/km (A/S) / 0,42 zł/km (GP/G). Az A1 Rusocin–Nowa Wieś, A2 Świecko–Konin és A4 Katowice–Kraków koncessziós szakaszok külön (szakaszdíjként) számolva. Átváltás: 1 € = 4,25 zł.",
    confidence: "official", asOf: "2026.02.01 (gov.pl / Dz.U. 2026 poz. 33)", verified: true,
  },
  RO: {
    name: "Románia", system: "TollRo (km-alapú, a rovinieta helyett)", classes: ["motorway", "trunk", "primary"], osmToll: true,
    rate: (v, rc) => {
      if (v.weight <= 3.5) return 0;
      // MTI 1925/2025 (másodlagos forrás), lej/km ÁFA-val → nettó
      const hi = isHigh(rc, ["motorway", "trunk"]);
      const r = v.weight >= 12 ? (hi ? 0.48 : 0.24) : v.weight >= 7.5 ? (hi ? 0.29 : 0.14) : (hi ? 0.17 : 0.08);
      return ((r / 1.21) * ef(v, [1, 1.15, 1.15, 1.29])) / FX.RON;
    },
    note: "A TollRo 2026.10.01-re volt kitűzve, a CNAIR 2027.04.01-re kérte a halasztását – az indulás nem megerősített. ≥12 t EURO VI: 0,48 lej/km autópályán, 0,24 lej/km országos úton (bruttó). Ha még a rovinieta érvényes, az időalapú.",
    confidence: "estimate", asOf: "MTI 1925/2025 (másodlagos forrás), bizonytalan indulás", verified: false,
  },
  BG: {
    name: "Bulgária", system: "BGTOLL (km-alapú)",
    classes: ["motorway", "trunk", "primary", "secondary"], osmToll: true,
    rate: (v, rc) => {
      if (v.weight <= 3.5) return 0;
      // BGTOLL tarifa 2026.06.01-től, EURO VI CO₂ 1, EUR/km (autópálya / I. o. / II. o.)
      const k = v.weight <= 12 ? 0 : v.axles <= 3 ? 1 : 2;
      const T = [[0.08, 0.07, 0.06], [0.14, 0.13, 0.12], [0.21, 0.19, 0.18]][k];
      const r = rc === "motorway" || !rc ? T[0] : rc === "secondary" ? T[2] : T[1];
      return r * ef(v, [1, 1.24, 1.38, 1.62]);
    },
    note: "Autópálya, I. és II. osztályú utak, >3,5 t. >12 t, 4+ tengely EURO VI: 0,21 / 0,19 / 0,18 €/km.",
    confidence: "official", asOf: "2026.06.01 (bgtoll.bg)", verified: true,
  },
  SI: {
    name: "Szlovénia", system: "DarsGo (km-alapú, R2/R3/R4)", classes: ["motorway", "trunk"], osmToll: true,
    rate: (v) => {
      if (v.weight <= 3.5) return 0;
      const r = v.axles <= 2 ? 0.12 : v.axles === 3 ? 0.133 : 0.277;
      return r * ef(v, [1, 1.17, 1.33, 1.67]);
    },
    note: "Autópálya + gyorsút, >3,5 t. 2025.11.01-től (CO₂-osztályokkal), EURO VI, nettó: R2 0,120 / R3 0,133 / R4 0,277 €/km. A Karavanke alagút külön.",
    confidence: "source", asOf: "2025.11.01 (DARS ASECAP-előadás; a 2026.04-es díjjegyzék nem ellenőrzött)", verified: false,
  },
  HR: {
    name: "Horvátország", system: "HAC / ARZ / Bina-Istra (kapus, kategória III/IV)", classes: ["motorway"], osmToll: true,
    rate: (v) => (v.weight <= 3.5 ? 0.05 : v.axles <= 3 ? 0.125 : 0.172),
    note: "Kapus rendszer: IV. kat. (4+ tengely) Zágráb–Split 83,70 € (nettó 66,96 €), Zágráb–Lipovac 56,20 € (nettó 44,96 €) → átlag ~0,17 €/km nettó; III. kat. ~0,12 €/km. ENC-kedvezmény (−21,74%) nincs levonva.",
    confidence: "source", asOf: "2026 (hac.hr díjtábla)", verified: false,
  },
  IT: {
    name: "Olaszország", system: "Autostrade (kapus, tengelyszám szerinti osztály)", classes: ["motorway"], osmToll: true,
    rate: (v) => {
      // ASPI 2026.01.01, sík szakasz, ÁFA (22%) nélkül: B/3/4/5. osztály; a hegyi szakasz ~18%-kal drágább
      const gross = v.weight <= 3.5 ? 0.0745 : v.axles <= 2 ? 0.0772 : v.axles === 3 ? 0.10615 : v.axles === 4 ? 0.16108 : 0.19034;
      return (gross / 1.22) * 1.04;
    },
    note: "Autostrade per l'Italia 2026: 5. osztály (5+ tengely) 0,19034 €/km sík / 0,22437 €/km hegyi szakaszon ÁFA-val; 4. osztály 0,16108 / 0,18922. A22 Brennero 5. osztály nettó 0,128 (sík) / 0,151 €/km (hegyi). A kalkuláció nettó, kb. 4% hegyi-szakasz átlaggal.",
    confidence: "official", asOf: "2026.01.01 (autostrade.it, autobrennero.it)", verified: true,
  },
  FR: {
    name: "Franciaország", system: "Péage (kapus, 3. / 4. osztály)", classes: [], osmToll: true,
    rate: (v) => (v.weight <= 3.5 ? 0.085 : v.axles <= 2 ? 0.175 : 0.255),
    note: "4. osztály (>3,5 t, ≥3 tengely), 2026.02.01-től: Párizs–Lyon (A6) 218,70 €, Lyon–Marseille 81,70 €, Párizs–Bordeaux 187,60 € ÁFA-val → átlag ~0,30 €/km bruttó, ~0,255 €/km nettó. Az ingyenes (nem koncessziós) szakaszok az OSM toll-jelölés alapján kimaradnak.",
    confidence: "source", asOf: "2026.02.01 (APRR, VINCI díjtáblák alapján számolt átlag)", verified: false,
  },
  ES: {
    name: "Spanyolország", system: "Peaje (kapus AP autópályák, Pesados 1 / 2)", classes: [], osmToll: true,
    rate: (v) => (v.weight <= 3.5 ? 0.075 : v.axles <= 3 ? 0.105 : 0.139),
    note: "Csak a díjas AP-szakaszok (OSM toll=yes). Pesados 2 (≥4 tengely), pl. AP-9 A Coruña–Santiago 9,60 € ÁFA-val (2026) → ~0,14 €/km nettó. Az AP-7 / AP-4 / AP-2 2020–21 óta ingyenes.",
    confidence: "source", asOf: "2026.01.01 (Audasa díjtábla alapján)", verified: false,
  },
  PT: {
    name: "Portugália", system: "Portagem (kapus + elektronikus, Classe 2–4)", classes: [], osmToll: true,
    rate: (v) => (v.weight <= 3.5 ? 0.075 : v.axles <= 2 ? 0.115 : v.axles === 3 ? 0.155 : 0.184),
    note: "Classe 4 (≥4 tengely): A1 Lisszabon–Porto 63,10 € ÁFA-val (279 km) → ~0,184 €/km nettó (IMT 2026).",
    confidence: "source", asOf: "2026 (IMT díjtábla)", verified: false,
  },
  CH: {
    name: "Svájc", system: "LSVA / RPLP (tonna-km, minden úton)", classes: [], osmToll: false, allRoads: true,
    rate: (v) => {
      if (v.weight <= 3.5) return 0;
      const rp = v.euro === "euro6" ? 2.39 : v.euro === "older" ? 3.26 : 2.82;
      return ((rp / 100) * v.weight) / FX.CHF;
    },
    note: "Minden közúton, a megengedett össztömeg alapján: III. kat. (EURO VI) 2,39 Rp/t·km, II. kat. 2,82, I. kat. 3,26. 40 t, 100 km = 95,60 CHF. Átváltás: 1 € = 0,94 CHF.",
    confidence: "official", asOf: "2025.01.01 óta (BAZG), 2026-ban változatlan", verified: true,
  },
  BE: {
    name: "Belgium", system: "Viapass (km-alapú, Flandria / Vallónia / Brüsszel)", classes: ["motorway", "trunk"], osmToll: false,
    rate: (v, _rc, _h, at) => {
      if (v.weight <= 3.5) return 0;
      const k = v.weight <= 12 ? 0 : v.weight <= 32 ? 1 : 2;
      const v5 = v.euro !== "euro6";
      const [x, y] = at ?? [4.4, 51];
      const brussels = x > 4.24 && x < 4.49 && y > 50.76 && y < 50.92;
      const wallonia = !brussels && y < 50.73;
      if (brussels) return [0.099, 0.166, 0.171][k] * (v5 ? 1.15 : 1);
      if (wallonia) return (v5 ? [0.077, 0.188, 0.221] : [0.061, 0.172, 0.205])[k];
      return (v5 ? [0.114, 0.246, 0.299] : [0.101, 0.233, 0.285])[k];
    },
    note: "2026.07.01-től, EURO VI CO₂ 1, 3,5–12 / 12–32 / >32 t: Flandria 0,101 / 0,233 / 0,285 €/km, Vallónia 0,061 / 0,172 / 0,205 €/km (ÁFA nélkül), Brüsszel 0,099 / 0,166 / 0,171 €/km. A régió a koordináta alapján közelítve.",
    confidence: "official", asOf: "2026.07.01 (viapass.be)", verified: true,
  },
  NL: {
    name: "Hollandia", system: "Vrachtwagenheffing (km-alapú, 2026.07.01-től)", classes: ["motorway", "trunk"], osmToll: false,
    rate: (v, _rc, _h, _at, dep) => {
      if (v.weight <= 3.5) return 0;
      const k = v.weight <= 12 ? 0 : v.weight <= 18 ? 1 : v.weight <= 32 ? 2 : 3;
      const d = new Date(dep);
      const discounted = d.getUTCFullYear() === 2026 && d.getUTCMonth() >= 8;
      const base = discounted ? [0.088, 0.125, 0.141, 0.156] : d.getUTCFullYear() >= 2027 ? [0.116, 0.165, 0.186, 0.206] : [0.113, 0.161, 0.181, 0.201];
      return base[k] * (v.euro === "euro6" ? 1 : 1.17);
    },
    note: "2026.07.01-jén indult (az Eurovignette megszűnt). EURO VI CO₂ 1, 3,5–12 / 12–18 / 18–32 / >32 t: 2026. szept.–dec. ideiglenes 22,3%-os kedvezménnyel 0,088 / 0,125 / 0,141 / 0,156 €/km; 2027-től >32 t: 0,206 €/km.",
    confidence: "official", asOf: "Staatscourant 2026-18058 / RDW 2027", verified: true,
  },
  DK: {
    name: "Dánia", system: "KmToll (km-alapú, 2025 óta)", classes: ["motorway", "trunk"], osmToll: false,
    rate: (v, _rc, _h, _at, dep) => {
      const dkk = v.weight >= 32 ? 1.1 : v.weight >= 18 ? 1.0 : v.weight >= 12 ? 0.86 : dep >= Date.UTC(2027, 0, 5) && v.weight > 3.5 ? 0.78 : 0;
      return dkk / FX.DKK;
    },
    note: "Állami autópályák és egyes főutak, CO₂-osztály 1, környezeti zónán kívül: 12–18 t 0,86 / 18–32 t 1,00 / >32 t 1,10 DKK/km (nincs EURO-szorzó). 3,5–12 t 2027.01.05-től. A Storebælt és az Øresund híd külön.",
    confidence: "official", asOf: "2025 (vejafgifter.dk Annex B v1.2)", verified: true,
  },
  SE: {
    name: "Svédország", system: "Eurovignette (időalapú, ≥12 t)", classes: [], osmToll: false,
    fixedFn: (v) => (v.weight < 12 ? 0 : (v.axles >= 4 ? (v.euro === "euro6" ? 147 : 158) : 90) / FX.SEK),
    note: "Napi díj, ≥12 t: 4+ tengely EURO VI 147 SEK, EURO V 158 SEK, ≤3 tengely 90 SEK (egy napra számolva; hosszabb tartózkodásnál heti 509 SEK).",
    confidence: "official", asOf: "SFS 2025:918 (2025.11.15-től)", verified: true,
  },
  LU: {
    name: "Luxemburg", system: "Eurovignette (időalapú, ≥12 t)", classes: [], osmToll: false,
    fixedFn: (v) => (v.weight < 12 ? 0 : v.axles >= 4 ? 13 : 8),
    note: "Napi díj, ≥12 t, EURO VI: 4+ tengely 13 €, 1–3 tengely 8 €.",
    confidence: "official", asOf: "2025.03.25 (douanes.public.lu)", verified: true,
  },
  GB: {
    name: "Egyesült Királyság", system: "HGV Road User Levy (időalapú, ≥12 t)", classes: [], osmToll: false,
    fixedFn: (v) => (v.weight < 12 ? 0 : (v.weight > 38 ? (v.euro === "euro6" ? 9.67 : 10.74) : v.weight > 31 ? 7.74 : 3.22) / FX.GBP),
    note: "Napi díj (2026.04.01-től), EURO VI: A sáv (12–31 t) 3,22 £, B (31–38 t) 7,74 £, C (>38 t) 9,67 £. A Dartford és a Humber átkelő külön.",
    confidence: "official", asOf: "2026.04.01 (gov.uk)", verified: true,
  },
  RS: {
    name: "Szerbia", system: "Putevi Srbije (kapus, K2–K4)", classes: ["motorway"], osmToll: true,
    rate: (v) => (v.weight <= 3.5 ? 0.04 : v.axles <= 2 ? 0.1 : v.axles === 3 ? 0.15 : 0.218),
    note: "K4 (≥4 tengely), 2026.07.01-től: Belgrád–Preševo 105,50 €, Belgrád–Niš 60,50 €, Stara Pazova–Subotica 43,50 € → ~0,26 €/km bruttó (~0,22 nettó). K4-nek 2026-tól TAG kötelező.",
    confidence: "source", asOf: "2026.07.01 (putevi-srbije.rs)", verified: false,
  },
  MK: {
    name: "Észak-Macedónia", system: "Fizetőkapuk (IV. kategória)", classes: ["motorway"], osmToll: true,
    rate: (v) => (v.weight <= 3.5 ? 0.04 : v.axles <= 3 ? 0.1 : 0.16),
    note: "IV. kategória: Tabanovce–Gevgelija folyosó ~1700–1900 MKD (~30 €) → ~0,16 €/km.",
    confidence: "source", asOf: "roads.org.mk díjtábla", verified: false,
  },
  GR: {
    name: "Görögország", system: "Kapus koncessziós autópályák", classes: ["motorway"], osmToll: true,
    rate: (v) => (v.weight <= 3.5 ? 0.06 : v.axles <= 3 ? 0.1 : 0.14),
    note: "Hivatalos kamion-tarifa nem elérhető – BECSLÉS (a személyautós díj ~2,5×-e).", confidence: "estimate", asOf: "2026 (becslés)", verified: false,
  },
  LV: {
    name: "Lettország", system: "Úthasználati matrica (időalapú)", classes: [], osmToll: false,
    fixedFn: (v) => (v.weight <= 3.5 ? 0 : v.weight <= 12 ? 10 : v.axles >= 4 ? (v.euro === "euro6" ? 22 : 30) : 14),
    note: "Napi díj, >12 t EURO VI: 4+ tengely 22 €, 2–3 tengely 14 €; 3,5–12 t 10 €.", confidence: "official", asOf: "2026.03.01 (likumi.lv)", verified: true,
  },
  EE: {
    name: "Észtország", system: "Úthasználati díj (időalapú, minden úton)", classes: [], osmToll: false,
    fixedFn: (v) => (v.weight <= 3.5 ? 0 : v.weight <= 12 ? 13 : v.axles >= 4 ? (v.euro === "euro6" ? 22 : 26) : 14),
    note: "Napi díj, >12 t EURO VI: 4+ tengely 22 €, ≤3 tengely 14 €; 3,5–12 t 13 €.", confidence: "official", asOf: "2024.01.01 óta (teetasu.ee)", verified: true,
  },
  LT: {
    name: "Litvánia", system: "e-matrica (időalapú; 2027-től km-alapú Via Toll)", classes: [], osmToll: false,
    fixedFn: (v) => (v.weight <= 3.5 ? 0 : v.axles >= 4 ? 23 : 13),
    note: "Napi díj, N3 EURO VI: 4+ tengely 23 €, ≤3 tengely 13 €. 2027.01.01-től km-alapú (~0,11 €/km).", confidence: "source", asOf: "2024.01.01 (vialietuva.lt)", verified: false,
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
  if (rule.fixedFn && !rule.rate && !rule.rates) return false;
  if (rule.allRoads) return true;
  if (rule.osmToll && osmToll) return true;
  return !!roadClass && rule.classes.includes(roadClass);
}

/**
 * EUR / km az adott országra, járműre és útosztályra. 0 ha nem km-alapú.
 * @param eurHuf a forintos tarifák átváltásához
 */
export function ratePerKm(rule: TollRule, v: Vehicle, roadClass?: string, eurHuf = 400, at?: [number, number], depMs = Date.now()): number {
  if (rule.minWeight !== undefined && v.weight <= rule.minWeight) return 0;
  if (rule.rate) return rule.rate(v, roadClass, eurHuf, at, Number.isFinite(depMs) ? depMs : Date.now());
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
  if (rule.fixedFn) return rule.fixedFn(v);
  return rule.fixed ? rule.fixed[tierOf(v, rule.byAxles)] : 0;
}
