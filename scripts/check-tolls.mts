/**
 * Útdíj-ellenőrző: valódi útvonalakon (élő Valhalla) kiírja országonként a díjköteles km-t és a díjat.
 * Futtatás: npm run check:tolls [útvonal-név-részlet]
 * Összevetésre való a hivatalos díjkalkulátorokkal (Toll Collect, GO-Maut, HU-GO, Mýto…).
 */
import { planRoutes } from "../src/lib/planner";
import { DEFAULT_COSTS } from "../src/lib/presets";

const vehicle = { weight: 40, axleLoad: 11.5, height: 4, width: 2.55, length: 16.5, axles: 5, euro: "euro6", hazmat: false, consumption: 30 } as const;
const CASES: Record<string, [number, number][]> = {
  "Budapest–München": [[47.4979, 19.0402], [48.1351, 11.582]],
  "Rostock–Berlin (L-út nem díjköteles)": [[54.0924, 12.0991], [52.52, 13.405]],
  "Milánó–Barcelona (AP-7, Fréjus)": [[45.4642, 9.19], [41.3874, 2.1686]],
  "Varsó–Prága": [[52.2297, 21.0122], [50.0755, 14.4378]],
  "Szeged–Zalaegerszeg (HU főutak)": [[46.253, 20.148], [46.842, 16.842]],
  "Kassel–Nürnberg": [[51.3127, 9.4797], [49.4521, 11.0767]],
};

const only = process.argv[2];
for (const [name, pts] of Object.entries(CASES)) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) continue;
  const waypoints = pts.map(([lat, lon], i) => ({ lat, lon, label: `P${i}` }));
  const req = { waypoints, vehicle, costs: DEFAULT_COSTS, options: { avoidTolls: false, avoidHighways: false, departure: "2026-11-17T06:00" } };
  const { routes } = await planRoutes(req as never);
  const r = routes[0];
  console.log(`\n=== ${name}: ${r.distanceKm.toFixed(0)} km, útdíj összesen ${r.tollTotalEur.toFixed(2)} € (pontosság ${(r.tollConfidence * 100).toFixed(0)}%)`);
  for (const t of r.tollBreakdown) {
    console.log(`  ${t.country}  díjköteles ${t.tollKm.toFixed(1).padStart(6)} km  ${t.perKm.toFixed(4)} €/km  összesen ${t.total.toFixed(2).padStart(8)} €  [${t.roads.join(", ")}]`);
  }
  for (const s of r.specials) console.log(`  + ${s.name}: ${s.fee.toFixed(2)} € (${s.km.toFixed(1)} km)`);
}
