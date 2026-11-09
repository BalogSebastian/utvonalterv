import type { CostInputs, Vehicle } from "./types";

export const VEHICLE_PRESETS: { id: string; name: string; v: Vehicle }[] = [
  {
    id: "artic40", name: "Nyerges szerelvény 40 t (5 tengely)",
    v: { weight: 40, axleLoad: 11.5, height: 4, width: 2.55, length: 16.5, axles: 5, euro: "euro6", hazmat: false, consumption: 31 },
  },
  {
    id: "truck-trailer40", name: "Pótkocsis szerelvény 40 t (6 tengely)",
    v: { weight: 40, axleLoad: 11.5, height: 4, width: 2.55, length: 18.75, axles: 6, euro: "euro6", hazmat: false, consumption: 33 },
  },
  {
    id: "rigid26", name: "Szóló 26 t (3 tengely)",
    v: { weight: 26, axleLoad: 10, height: 3.8, width: 2.55, length: 10, axles: 3, euro: "euro6", hazmat: false, consumption: 27 },
  },
  {
    id: "rigid18", name: "Szóló 18 t (2 tengely)",
    v: { weight: 18, axleLoad: 10, height: 3.6, width: 2.55, length: 9.5, axles: 2, euro: "euro6", hazmat: false, consumption: 24 },
  },
  {
    id: "truck12", name: "Közepes teher 12 t",
    v: { weight: 12, axleLoad: 8, height: 3.4, width: 2.5, length: 8, axles: 2, euro: "euro6", hazmat: false, consumption: 20 },
  },
  {
    id: "van35", name: "Kisteher 3,5 t",
    v: { weight: 3.5, axleLoad: 2, height: 2.8, width: 2.1, length: 6, axles: 2, euro: "euro6", hazmat: false, consumption: 11 },
  },
  {
    id: "adr40", name: "ADR tartálykocsi 40 t",
    v: { weight: 40, axleLoad: 11.5, height: 4, width: 2.55, length: 16.5, axles: 5, euro: "euro6", hazmat: true, consumption: 32 },
  },
];

export const DEFAULT_COSTS: CostInputs = {
  fuelPrice: 1.55,
  driverHourly: 22,
  vehicleKm: 0.25,
  eurHuf: 400,
};
