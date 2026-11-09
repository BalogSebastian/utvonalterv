import { COUNTRY_NAMES } from "./country-names";
import type { BanWarning } from "./types";

interface Window {
  /** 0 = vasárnap … 6 = szombat */
  startDow: number;
  startMin: number; // perc a naptól
  /** időtartam percben */
  durMin: number;
}

interface BanRule {
  minWeight: number; // t – efölött érvényes
  windows: Window[];
  text: string;
}

const d = (h: number, m = 0) => h * 60 + m;
const DAY = 24 * 60;

/**
 * Tájékoztató jellegű hétvégi / éjszakai tehergépjármű-forgalmi korlátozások.
 * Ünnepnapokat, nyári extra tilalmakat és helyi tilalmakat NEM tartalmaz –
 * indulás előtt mindig ellenőrizd a hivatalos forrásnál.
 */
export const BANS: Record<string, BanRule> = {
  DE: { minWeight: 7.5, windows: [{ startDow: 0, startMin: 0, durMin: d(22) }], text: "Vasárnap és ünnepnap 00–22 h tilalom (>7,5 t)" },
  AT: { minWeight: 7.5, windows: [{ startDow: 6, startMin: d(15), durMin: d(31) }], text: "Szombat 15:00 – vasárnap 22:00 tilalom (>7,5 t)" },
  HU: { minWeight: 7.5, windows: [{ startDow: 6, startMin: d(22), durMin: d(24) }], text: "Szombat 22:00 – vasárnap 22:00 tilalom (>7,5 t); nyáron plusz szombati sávok" },
  CZ: { minWeight: 7.5, windows: [{ startDow: 0, startMin: d(13), durMin: d(9) }], text: "Vasárnap 13–22 h tilalom (>7,5 t)" },
  SK: { minWeight: 7.5, windows: [{ startDow: 6, startMin: d(22), durMin: d(24) }], text: "Hétvégi tilalom (szombat 22:00 – vasárnap 22:00, >7,5 t) – ellenőrizendő" },
  PL: { minWeight: 12, windows: [{ startDow: 0, startMin: d(6), durMin: d(16) }], text: "Vasárnap és ünnepnap 06–22 h tilalom (>12 t)" },
  FR: { minWeight: 7.5, windows: [{ startDow: 6, startMin: d(22), durMin: d(24) }], text: "Szombat 22:00 – vasárnap 22:00 tilalom (>7,5 t)" },
  IT: { minWeight: 7.5, windows: [{ startDow: 0, startMin: d(9), durMin: d(13) }], text: "Vasárnap 09–22 h tilalom (>7,5 t); nyáron szombati sávok is" },
  SI: { minWeight: 7.5, windows: [{ startDow: 0, startMin: d(8), durMin: d(13) }], text: "Vasárnap 08–21 h tilalom (>7,5 t)" },
  CH: {
    minWeight: 3.5,
    windows: [
      { startDow: 0, startMin: 0, durMin: DAY },
      ...[0, 1, 2, 3, 4, 5, 6].map((dow) => ({ startDow: dow, startMin: d(22), durMin: d(7) })),
    ],
    text: "Vasárnap egész nap és minden éjjel 22–05 h tilalom (>3,5 t)",
  },
};

/** naiv helyi idő (ms), a hét napjait UTC-mezőkkel kezeljük (időzóna-független) */
function overlaps(win: Window, enter: number, leave: number): boolean {
  const first = new Date(enter);
  const startDay = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate()) - DAY * 60000;
  const lastDay = leave + DAY * 60000;
  for (let t = startDay; t <= lastDay; t += DAY * 60000) {
    if (new Date(t).getUTCDay() !== win.startDow) continue;
    const s = t + win.startMin * 60000;
    const e = s + win.durMin * 60000;
    if (s < leave && e > enter) return true;
  }
  return false;
}

export function banWarnings(
  legs: { country: string; enter: number; leave: number }[],
  weight: number,
): BanWarning[] {
  const out: BanWarning[] = [];
  for (const l of legs) {
    const rule = BANS[l.country];
    if (!rule || weight <= rule.minWeight) continue;
    const hit = rule.windows.some((w) => overlaps(w, l.enter, l.leave));
    out.push({
      country: l.country,
      severity: hit ? "danger" : "info",
      text: hit
        ? `${COUNTRY_NAMES[l.country] ?? l.country}: a tervezett áthaladás tilalmi idősávba esik! ${rule.text}.`
        : `${COUNTRY_NAMES[l.country] ?? l.country}: ${rule.text} – az áthaladási idő nem érinti.`,
    });
  }
  return out;
}
