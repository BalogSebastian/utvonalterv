export type LngLat = [number, number];

export interface Waypoint {
  lat: number;
  lon: number;
  label: string;
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
  driverHourly: number; // EUR / óra (teljes költség)
  vehicleKm: number; // EUR / km (kopás, szerviz, amortizáció)
  eurHuf: number; // HUF / EUR
}

export interface RouteOptions {
  avoidTolls: boolean;
  avoidHighways: boolean;
  /** indulási idő ISO (helyi, tz nélkül) */
  departure: string;
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
  confidence: "source" | "estimate" | "none";
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
  confidence: "source" | "estimate";
  asOf: string;
}

export interface TripStop {
  id: string;
  anchored?: boolean;
  /** a menetrend-szabály megsértése ennél a megállónál */
  warn?: string;
  /** az útvonal mentén megtett arány 0..1 */
  f: number;
  kind: "break" | "rest";
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
  /** alagút-/szakaszdíjak (benne vannak a tollTotalEur-ban, ha modelled) */
  specials: SpecialItem[];
  specialsTotalEur: number;
  fuelLiters: number;
  fuelCostEur: number;
  driverCostEur: number;
  vehicleCostEur: number;
  totalEur: number;
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
}
