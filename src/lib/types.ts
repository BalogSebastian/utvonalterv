export type LngLat = [number, number];

export interface Waypoint {
  lat: number;
  lon: number;
  label: string;
  /** az útvonal húzásával létrejött áthaladási pont (nem megálló) */
  via?: boolean;
  /** komp / vasúti járat (a katalógus azonosítója); lat/lon ilyenkor a járat közepe */
  ferry?: string;
}

export type EuroClass = "euro6" | "euro5" | "euro4" | "older";

export interface Vehicle {
  /** teljes tömeg tonnában */
  weight: number;
  /** tengelyterhelés tonnában */
  axleLoad: number;
  height: number;
  width: number;
  length: number;
  axles: number;
  euro: EuroClass;
  hazmat: boolean;
  /** átlagfogyasztás l/100 km */
  consumption: number;
}

export interface CostInputs {
  fuelPrice: number; // EUR / liter
  driverHourly: number; // EUR / óra (teljes munkáltatói költség)
  /** EUR / nap: napidíj, szállás */
  driverDaily: number;
  vehicleKm: number; // EUR / km (gumi, szerviz, kopás)
  /** EUR / nap: amortizáció / lízing, biztosítás, gépjárműadó */
  vehicleDaily: number;
  eurHuf: number; // HUF / EUR
}

/** No-Go zóna: egész ország vagy saját rajzolt terület */
export interface NoGoArea {
  id: string;
  name: string;
  /** zárt gyűrű [lng,lat][] */
  ring: LngLat[];
}

export interface NoGo {
  /** ISO alpha-2 országkódok */
  countries: string[];
  areas: NoGoArea[];
}

/** a felhasználó saját (pl. szerződéses) komp-ára / menetideje */
export interface FerryOverride {
  priceEur?: number;
  durationH?: number;
}

export interface RouteOptions {
  avoidTolls: boolean;
  avoidHighways: boolean;
  /** indulási idő ISO (helyi, tz nélkül) */
  departure: string;
  noGo?: NoGo;
  ferryOverrides?: Record<string, FerryOverride>;
  /** EU 561/2006 rugalmasság: heti 2× 10 órás vezetés, 3× 9 órás csökkentett pihenő */
  flexRules?: boolean;
  /** a hétvégi / ünnepnapi tilalmak kivárása beépül az érkezési időbe */
  waitBans?: boolean;
  /** a már ismert kizárt pontok (No-Go zóna) – a húzás közbeni előnézethez */
  exclude?: { lat: number; lon: number }[];
}

export interface RouteRequest {
  waypoints: Waypoint[];
  vehicle: Vehicle;
  costs: CostInputs;
  options: RouteOptions;
}

export interface TollSegment {
  country: string;
  km: number;
  rate: number;
  cost: number;
  note?: string;
}

export interface CountryLeg {
  country: string;
  startKm: number;
  km: number;
  tollKm: number;
  toll: number;
  /** becsült belépés/kilépés (ISO, helyi indulási idő alapján) */
  enter: string;
  leave: string;
}

export interface BanWarning {
  country: string;
  severity: "danger" | "warn" | "info";
  text: string;
}

export interface TollBreakdownItem {
  country: string;
  tollKm: number;
  perKm: number;
  fixed: number;
  total: number;
  note: string;
  roads: string[];
  confidence: "official" | "source" | "estimate" | "none";
  asOf: string;
}

export interface SpecialItem {
  id: string;
  name: string;
  country: string;
  km: number;
  /** EUR; 0 ha a díj nincs bekalkulálva */
  fee: number;
  modelled: boolean;
  note: string;
  confidence: "official" | "source" | "estimate";
  asOf: string;
}

export interface TripStop {
  id: string;
  /** valós kamionparkoló neve, ha oda illesztettük */
  place?: string;
  anchored?: boolean;
  /** a menetrend-szabály megsértése ennél a megállónál */
  warn?: string;
  /** az útvonal mentén megtett arány 0..1 */
  f: number;
  kind: "break" | "rest" | "wait" | "ferry";
  /** a megálló hossza (óra) */
  durH?: number;
  /** vezetés kezdete óta, óra */
  atH: number;
  /** út menti km */
  km: number;
  lat: number;
  lon: number;
  country: string;
  /** becsült időpont (ISO, helyi) */
  time: string;
  day: number;
}

export interface DriveSchedule {
  drivingH: number;
  breaks45: number;
  dailyRests: number;
  totalH: number;
  days: number;
  arrival: string;
  /** a célország helyi ideje szerinti érkezés (ha eltér) */
  arrivalLocal?: string;
  /** tilalom miatti várakozás (óra) */
  waitH: number;
  /** komp / vasút (óra, beszállással) */
  ferryH: number;
}

/** útvonal-arány (0..1) → addig megtett vezetési idő (óra), szakaszonként lineáris */
export type TimeProfile = [number, number][];

export interface FerryLeg {
  id: string;
  name: string;
  kind: "ferry" | "rail";
  from: string;
  to: string;
  f0: number;
  f1: number;
  km: number;
  durationH: number;
  checkInH: number;
  priceEur: number;
  /** van-e kabin / fekhely (a hajóút napi pihenőnek számíthat, 561/2006 9. cikk) */
  berth: boolean;
  /** a katalógusból / a felhasználó áraiból jött, vagy csak becsült */
  priced: "catalog" | "user" | "estimate";
  note: string;
  geometry: LngLat[];
}

export interface RouteResult {
  id: number;
  distanceKm: number;
  drivingMin: number;
  /** [lng,lat][] */
  geometry: LngLat[];
  /** toll-szakaszok geometriái a térképen való kiemeléshez */
  tollGeometry: LngLat[][];
  countries: CountryLeg[];
  tollBreakdown: TollBreakdownItem[];
  tollTotalEur: number;
  /** km közúton (komp nélkül) */
  roadKm: number;
  /** a teljes távolság díjköteles km-ei */
  tollKm: number;
  ferries: FerryLeg[];
  ferryTotalEur: number;
  profile: TimeProfile;
  /** a No-Go zónák figyelmeztetései / érintett km */
  noGo: { name: string; km: number; unavoidable: boolean }[];
  /** alagút-/szakaszdíjak (benne vannak a tollTotalEur-ban, ha modelled) */
  specials: SpecialItem[];
  specialsTotalEur: number;
  fuelLiters: number;
  fuelCostEur: number;
  driverCostEur: number;
  vehicleCostEur: number;
  totalEur: number;
  /** tájékoztató: az útdíj-számítás becsült pontossága (0..1) a tarifák megbízhatósága alapján */
  tollConfidence: number;
  schedule: DriveSchedule;
  stops: TripStop[];
  warnings: BanWarning[];
  highways: boolean;
  ferry: boolean;
  tollAccuracy: "edge" | "maneuver";
  maneuvers: { text: string; km: number; min: number; street?: string }[];
}

export interface RouteResponse {
  routes: RouteResult[];
  source: string;
  /** a No-Go zónák elkerüléséhez használt kizárt pontok (az előnézethez újrahasznosítható) */
  exclude: { lat: number; lon: number }[];
}
