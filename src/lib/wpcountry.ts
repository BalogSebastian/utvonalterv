import { countryAt } from "./countries";
import type { LngLat, Waypoint } from "./types";

/**
 * Egy pont pontos országa. A beépített (1:50m) határ a határ közelében pontatlan
 * (pl. Konstanz a durva poligonon Svájcba esik), ezért ha a pont ~6 km-en belül van egy
 * határhoz, a Photon geokódolót kérdezzük meg; hiba esetén marad a durva becslés.
 */
const memo = new Map<string, string | null>();

function nearBorder([x, y]: LngLat, here: string | null): boolean {
  const k = Math.cos((y * Math.PI) / 180);
  for (const km of [2, 6]) {
    for (let a = 0; a < 8; a++) {
      const t = (a / 8) * Math.PI * 2;
      const p: LngLat = [x + (Math.cos(t) * km) / (111.32 * k), y + (Math.sin(t) * km) / 110.57];
      if (countryAt(p) !== here) return true;
    }
  }
  return false;
}

export async function preciseCountry(p: LngLat): Promise<string | null> {
  const key = `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  if (memo.has(key)) return memo.get(key)!;
  const coarse = countryAt(p);
  let cc = coarse;
  if (nearBorder(p, coarse)) {
    try {
      const r = await fetch(`https://photon.komoot.io/reverse?lat=${p[1]}&lon=${p[0]}&limit=1`, {
        headers: { "User-Agent": "tesotter-truck-planner/1.1" },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const j = (await r.json()) as { features?: { properties?: { countrycode?: string } }[] };
        const c = j.features?.[0]?.properties?.countrycode;
        if (c && /^[A-Za-z]{2}$/.test(c)) cc = c.toUpperCase();
      }
    } catch { /* marad a durva becslés */ }
  }
  memo.set(key, cc);
  if (memo.size > 2000) memo.delete(memo.keys().next().value as string);
  return cc;
}

/** a pontok országa (via / komp pontoknál is, a sorrend megmarad) */
export function waypointCountries(wps: Waypoint[]): Promise<(string | null)[]> {
  return Promise.all(wps.map((w) => (w.ferry ? Promise.resolve(null) : preciseCountry([w.lon, w.lat]))));
}
