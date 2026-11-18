/** Útszakasz-ellenőrző: kiírja, melyik úton, hány km-en és mikor halad az útvonal. Futtatás: npx tsx scripts/check-sections.mts */
import { planRoutes } from "../src/lib/planner";
import { DEFAULT_COSTS } from "../src/lib/presets";

const vehicle = { weight: 40, axleLoad: 11.5, height: 4, width: 2.55, length: 16.5, axles: 5, euro: "euro6", hazmat: false, consumption: 30 } as const;
const CASES: Record<string, [number, number][]> = {
  "Budapest–München": [[47.4979, 19.0402], [48.1351, 11.582]],
  "Szeged–Zalaegerszeg": [[46.253, 20.148], [46.842, 16.842]],
};
const only = process.argv[2];
for (const [name, pts] of Object.entries(CASES)) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) continue;
  const waypoints = pts.map(([lat, lon], i) => ({ lat, lon, label: `P${i}` }));
  const req = { waypoints, vehicle, costs: DEFAULT_COSTS, options: { avoidTolls: false, avoidHighways: false, departure: "2026-11-17T06:00" } };
  const { routes } = await planRoutes(req as never);
  const r = routes[0];
  console.log(`\n=== ${name}: ${r.distanceKm.toFixed(1)} km, vezetés ${(r.drivingMin / 60).toFixed(2)} h, útdíj ${r.tollTotalEur.toFixed(2)} €, szakasz: ${r.sections.length}`);
  for (const s of r.sections) {
    console.log(`${s.start.slice(11)} ${s.country} ${s.cls.padEnd(9)} ${s.label.padEnd(26)} ${s.km.toFixed(1).padStart(6)} km ${(s.h * 60).toFixed(0).padStart(4)} p ${s.speed.toFixed(0).padStart(3)} km/h lim ${String(s.limit ?? "-").padStart(3)} toll ${s.tollEur.toFixed(2)} ${s.euro?.join(",") ?? ""} ${s.via?.join("|") ?? ""} ${s.toward ? "→ " + s.toward : ""}`);
  }
  const sum = r.sections.reduce((a, s) => a + s.km, 0);
  const tsum = r.sections.reduce((a, s) => a + s.tollEur, 0);
  console.log(`  Σkm=${sum.toFixed(1)} (távolság ${r.distanceKm.toFixed(1)}), Σtoll=${tsum.toFixed(2)} (útdíj ${r.tollTotalEur.toFixed(2)})`);
}
