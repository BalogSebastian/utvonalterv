export const eur = (n: number) =>
  new Intl.NumberFormat("hu-HU", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
export const eur2 = (n: number) =>
  new Intl.NumberFormat("hu-HU", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
export const huf = (n: number) =>
  new Intl.NumberFormat("hu-HU", { style: "currency", currency: "HUF", maximumFractionDigits: 0 }).format(n);
export const km = (n: number) => `${new Intl.NumberFormat("hu-HU", { maximumFractionDigits: n < 10 ? 1 : 0 }).format(n)} km`;
export function dur(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} ó ${m.toString().padStart(2, "0")} p` : `${m} p`;
}
export function dt(iso: string) {
  const d = new Date(`${iso}:00Z`);
  const days = ["vas", "hét", "kedd", "sze", "csüt", "pén", "szo"];
  return `${days[d.getUTCDay()]} ${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}. ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
export function flag(cc: string) {
  if (!/^[A-Z]{2}$/.test(cc)) return "🏳️";
  return String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)));
}
