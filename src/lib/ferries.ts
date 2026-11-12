import type { FerryOverride, LngLat, Vehicle, Waypoint } from "./types";

/**
 * KOMP- ÉS VASÚTI (SHUTTLE) JÁRATOK katalógusa.
 * Az ár: egy irány, kísért (sofőrrel utazó) 16,5 m-es / 40 t-s nyerges szerelvény, sofőrrel.
 * A fuvarozói árak szerződésfüggők és dinamikusak – a felületen járatonként felülírhatók
 * (a saját szerződéses ár a böngészőben megmarad).
 */
export interface Port { name: string; lat: number; lon: number }

export interface FerryLine {
  id: string;
  name: string;
  operator: string;
  kind: "ferry" | "rail";
  region: string;
  a: Port;
  b: Port;
  /** menetidő (óra) */
  durationH: number;
  /** beszállás / check-in (óra) */
  checkInH: number;
  /** EUR, 16,5 m kísért kamion, egy irány (a → b) */
  priceEur: number;
  /** ár b → a irányban, ha eltér */
  priceRevEur?: number;
  /** kabin / fekhely jár-e a sofőrnek (a hajóút napi pihenőnek számíthat) */
  berth: boolean;
  departures?: string;
  note: string;
  confidence: "official" | "ratecard" | "estimate";
  asOf: string;
  /** köztes pontok a tengeri útvonal rajzolásához (a → b irányban) */
  via?: LngLat[];
}

export const FERRIES: FerryLine[] = [
  { id: "eurotunnel", name: "Eurotunnel Le Shuttle Freight (Folkestone – Calais)", operator: "Getlink / Le Shuttle Freight", kind: "rail", region: "La Manche", a: { name: "Folkestone terminál", lat: 51.095, lon: 1.135 }, b: { name: "Coquelles (Calais) terminál", lat: 50.932, lon: 1.811 }, durationH: 0.6, checkInH: 1.0, priceEur: 352, berth: false, departures: "4–6 indulás / óra", note: "Nem számlás (walk-up) ár >13 m kísért járműre, áramdíj-pótlék és csúcsnapi felár nélkül. Sofőr a Club Carban, fekhely nincs.", confidence: "official", asOf: "2026 (leshuttlefreight.com)" },
  { id: "dover-calais", name: "Dover – Calais", operator: "P&O Ferries / DFDS / Irish Ferries", kind: "ferry", region: "La Manche", a: { name: "Dover Eastern Docks", lat: 51.127, lon: 1.335 }, b: { name: "Calais kikötő", lat: 50.966, lon: 1.865 }, durationH: 1.5, checkInH: 1.0, priceEur: 380, berth: false, departures: "40–50 / nap", note: "Nincs nyilvános kamion-alapár (ajánlat + BAF/ETS pótlék) – BECSLÉS, írd felül a szerződéses áraddal. Sofőr: társalgó + étkezés.", confidence: "estimate", asOf: "2026" },
  { id: "dover-dunkirk", name: "Dover – Dunkerque", operator: "DFDS", kind: "ferry", region: "La Manche", a: { name: "Dover Eastern Docks", lat: 51.127, lon: 1.335 }, b: { name: "Dunkerque (Loon-Plage)", lat: 51.015, lon: 2.2 }, durationH: 2.0, checkInH: 1.0, priceEur: 380, berth: false, departures: "10–12 / nap", note: "Nincs nyilvános alapár – BECSLÉS. Sofőr: társalgó.", confidence: "estimate", asOf: "2026" },
  { id: "hoek-harwich", name: "Hoek van Holland – Harwich", operator: "Stena Line", kind: "ferry", region: "Északi-tenger", a: { name: "Hoek van Holland", lat: 51.978, lon: 4.12 }, b: { name: "Harwich International", lat: 51.946, lon: 1.255 }, durationH: 7.0, checkInH: 1.5, priceEur: 650, berth: true, departures: "2 / nap", note: "Nincs nyilvános alapár – BECSLÉS. Kísért egységnél kabin és étkezés általában jár (éjszakai járat: napi pihenőnek számíthat).", confidence: "estimate", asOf: "2026" },
  { id: "rotterdam-hull", name: "Rotterdam Europoort – Hull", operator: "P&O Ferries", kind: "ferry", region: "Északi-tenger", a: { name: "Rotterdam Europoort", lat: 51.947, lon: 4.143 }, b: { name: "Hull King George Dock", lat: 53.739, lon: -0.278 }, durationH: 11.5, checkInH: 1.5, priceEur: 900, berth: true, departures: "1 / nap (éjszakai)", note: "Nincs nyilvános alapár – BECSLÉS. Kabin + étkezés: a hajóút napi pihenőnek számíthat (561/2006 9. cikk).", confidence: "estimate", asOf: "2026", via: [[3.6,52.3], [0.4,53.55], [-0.05,53.62]] },
  { id: "vlaardingen-immingham", name: "Vlaardingen – Immingham", operator: "DFDS", kind: "ferry", region: "Északi-tenger", a: { name: "Vlaardingen", lat: 51.898, lon: 4.335 }, b: { name: "Immingham", lat: 53.63, lon: -0.19 }, durationH: 13.0, checkInH: 1.5, priceEur: 800, berth: true, departures: "1–2 / nap", note: "Főleg kíséretlen pótkocsi, kevés sofőrhely. BECSLÉS.", confidence: "estimate", asOf: "2026", via: [[4.12,51.98], [3.6,52.3], [0.4,53.55]] },
  { id: "ijmuiden-newcastle", name: "IJmuiden – Newcastle (North Shields)", operator: "DFDS", kind: "ferry", region: "Északi-tenger", a: { name: "IJmuiden", lat: 52.462, lon: 4.598 }, b: { name: "North Shields", lat: 55.008, lon: -1.447 }, durationH: 15.5, checkInH: 1.5, priceEur: 1000, berth: true, departures: "1 / nap", note: "Nincs nyilvános alapár – BECSLÉS. Kabin + étkezés.", confidence: "estimate", asOf: "2026", via: [[4.3,52.5], [-1.2,55.0]] },
  { id: "portsmouth-cherbourg", name: "Portsmouth – Cherbourg", operator: "Brittany Ferries", kind: "ferry", region: "La Manche", a: { name: "Portsmouth", lat: 50.812, lon: -1.088 }, b: { name: "Cherbourg", lat: 49.65, lon: -1.617 }, durationH: 4.0, checkInH: 1.5, priceEur: 550, berth: false, departures: "1–2 / nap", note: "Nincs nyilvános alapár – BECSLÉS.", confidence: "estimate", asOf: "2026", via: [[-1.1,50.75]] },
  { id: "portsmouth-lehavre", name: "Portsmouth – Le Havre", operator: "Brittany Ferries", kind: "ferry", region: "La Manche", a: { name: "Portsmouth", lat: 50.812, lon: -1.088 }, b: { name: "Le Havre", lat: 49.483, lon: 0.12 }, durationH: 6.0, checkInH: 1.5, priceEur: 600, berth: true, departures: "~1 / nap", note: "Nincs nyilvános alapár – BECSLÉS. Éjszakai járaton kabin.", confidence: "estimate", asOf: "2026", via: [[-1.1,50.75], [-0.6,50.2]] },
  { id: "dublin-holyhead", name: "Dublin – Holyhead", operator: "Irish Ferries / Stena Line", kind: "ferry", region: "Ír-tenger", a: { name: "Dublin kikötő", lat: 53.347, lon: -6.195 }, b: { name: "Holyhead", lat: 53.31, lon: -4.63 }, durationH: 3.25, checkInH: 1.0, priceEur: 450, berth: false, departures: "~8 / nap", note: "Nincs nyilvános alapár – BECSLÉS.", confidence: "estimate", asOf: "2026" },
  { id: "rosslare-cherbourg", name: "Rosslare – Cherbourg", operator: "Stena Line / Brittany Ferries", kind: "ferry", region: "Ír-tenger", a: { name: "Rosslare Europort", lat: 52.253, lon: -6.335 }, b: { name: "Cherbourg", lat: 49.65, lon: -1.617 }, durationH: 18.0, checkInH: 2.0, priceEur: 1100, berth: true, departures: "heti 3–5", note: "Nincs nyilvános alapár – BECSLÉS. Kabin + étkezés.", confidence: "estimate", asOf: "2026", via: [[-5.9,51.8], [-5.9,49.95], [-3.0,49.75]] },
  { id: "rosslare-dunkirk", name: "Rosslare – Dunkerque", operator: "DFDS", kind: "ferry", region: "Ír-tenger", a: { name: "Rosslare Europort", lat: 52.253, lon: -6.335 }, b: { name: "Dunkerque (Loon-Plage)", lat: 51.015, lon: 2.2 }, durationH: 24.0, checkInH: 2.0, priceEur: 1300, berth: true, departures: "heti 7 (2026. szept.-től)", note: "Nincs nyilvános alapár – BECSLÉS. Kabin + étkezés.", confidence: "estimate", asOf: "2026", via: [[-5.9,51.8], [-5.9,49.95], [-1.0,50.25], [1.4,50.95]] },
  { id: "puttgarden-rodby", name: "Puttgarden – Rødby", operator: "Scandlines", kind: "ferry", region: "Balti-tenger", a: { name: "Puttgarden", lat: 54.5, lon: 11.226 }, b: { name: "Rødby", lat: 54.656, lon: 11.351 }, durationH: 0.75, checkInH: 0.5, priceEur: 303, berth: false, departures: "30 percenként, 0–24", note: "Hivatalos 2026-os tarifa 17 m-re 265,30 € + kb. 38 € BAF/ETS/GIR pótlék (2026. júl.), ÁFA nélkül; sofőr ingyen.", confidence: "official", asOf: "2026.01.01 (Scandlines tarifa)" },
  { id: "rostock-gedser", name: "Rostock – Gedser", operator: "Scandlines", kind: "ferry", region: "Balti-tenger", a: { name: "Rostock Überseehafen", lat: 54.153, lon: 12.105 }, b: { name: "Gedser", lat: 54.574, lon: 11.927 }, durationH: 2.0, checkInH: 0.75, priceEur: 275, berth: false, departures: "8–9 / nap", note: "Hivatalos tarifa 17 m-re 236,20 € + GIR 1,66 €/m + havi BAF/ETS (becsült összesen ~275 €); sofőr ingyen.", confidence: "official", asOf: "2026 (Scandlines tarifa)" },
  { id: "helsingor-helsingborg", name: "Helsingør – Helsingborg", operator: "Øresundslinjen (Molslinjen)", kind: "ferry", region: "Balti-tenger", a: { name: "Helsingør", lat: 56.037, lon: 12.615 }, b: { name: "Helsingborg", lat: 56.043, lon: 12.693 }, durationH: 0.33, checkInH: 0.5, priceEur: 201, berth: false, departures: "15–20 percenként, 0–24", note: "Hivatalos 2026: „kamion 26 m-ig” 169,30 € + ~1,89 €/m energia-pótlék, ÁFA nélkül; sofőr ingyen.", confidence: "official", asOf: "2026 (Molslinjen tarifa)" },
  { id: "rostock-trelleborg", name: "Rostock – Trelleborg", operator: "TT-Line / Stena Line", kind: "ferry", region: "Balti-tenger", a: { name: "Rostock Überseehafen", lat: 54.153, lon: 12.105 }, b: { name: "Trelleborg", lat: 55.367, lon: 13.155 }, durationH: 6.0, checkInH: 1.0, priceEur: 500, berth: true, departures: "5–7 / nap", note: "Szerződéses méterár (TT-Line: min. 132 € + 14,50 € hajózási díj + BAF/ETS) – BECSLÉS. Egy sofőr benne; fekhely.", confidence: "estimate", asOf: "2026" },
  { id: "travemunde-trelleborg", name: "Travemünde – Trelleborg", operator: "TT-Line", kind: "ferry", region: "Balti-tenger", a: { name: "Travemünde Skandinavienkai", lat: 53.952, lon: 10.858 }, b: { name: "Trelleborg", lat: 55.367, lon: 13.155 }, durationH: 8.0, checkInH: 1.0, priceEur: 550, berth: true, departures: "3–4 / nap", note: "Szerződéses méterár (min. 156 € + 14,50 € + BAF/ETS) – BECSLÉS. Fekhely.", confidence: "estimate", asOf: "2026", via: [[11.2,54.3], [12.6,54.9]] },
  { id: "travemunde-malmo", name: "Travemünde – Malmö", operator: "Finnlines", kind: "ferry", region: "Balti-tenger", a: { name: "Travemünde Skandinavienkai", lat: 53.952, lon: 10.858 }, b: { name: "Malmö", lat: 55.625, lon: 12.995 }, durationH: 9.0, checkInH: 1.0, priceEur: 600, berth: true, departures: "3–4 / nap", note: "Nincs nyilvános alapár – BECSLÉS. Kabin + étkezés.", confidence: "estimate", asOf: "2026", via: [[11.2,54.3], [12.6,54.9], [12.8,55.4]] },
  { id: "kiel-goteborg", name: "Kiel – Göteborg", operator: "Stena Line", kind: "ferry", region: "Balti-tenger", a: { name: "Kiel Schwedenkai", lat: 54.326, lon: 10.142 }, b: { name: "Göteborg", lat: 57.693, lon: 11.913 }, durationH: 14.5, checkInH: 1.5, priceEur: 800, berth: true, departures: "1 / nap (éjszakai)", note: "Nincs nyilvános alapár – BECSLÉS. Kabin.", confidence: "estimate", asOf: "2026", via: [[10.25,54.5], [10.9,55.0], [11.05,55.7], [11.5,56.6]] },
  { id: "swinoujscie-ystad", name: "Świnoujście – Ystad", operator: "Unity Line / Polferries", kind: "ferry", region: "Balti-tenger", a: { name: "Świnoujście", lat: 53.911, lon: 14.262 }, b: { name: "Ystad", lat: 55.426, lon: 13.823 }, durationH: 7.0, checkInH: 1.0, priceEur: 600, berth: true, departures: "3–5 / nap", note: "Hivatalos POLSCA tarifa: 25 €/megkezdett m (17 m = 425 €) + BES 10,30 €/m ≈ 600 € nettó; egy sofőr fekhellyel és 2 étkezéssel.", confidence: "official", asOf: "2026.03.30 (POLSCA tarifa)", via: [[14.3,54.1]] },
  { id: "gdynia-karlskrona", name: "Gdynia – Karlskrona", operator: "Stena Line", kind: "ferry", region: "Balti-tenger", a: { name: "Gdynia", lat: 54.53, lon: 18.54 }, b: { name: "Karlskrona Verkö", lat: 56.16, lon: 15.64 }, durationH: 10.75, checkInH: 1.5, priceEur: 550, berth: true, departures: "2–3 / nap", note: "Nincs nyilvános alapár – BECSLÉS. Kabin.", confidence: "estimate", asOf: "2026", via: [[18.9,54.75], [17.5,55.6]] },
  { id: "travemunde-helsinki", name: "Travemünde – Helsinki (Vuosaari)", operator: "Finnlines", kind: "ferry", region: "Balti-tenger", a: { name: "Travemünde Skandinavienkai", lat: 53.952, lon: 10.858 }, b: { name: "Helsinki Vuosaari", lat: 60.207, lon: 25.19 }, durationH: 29.0, checkInH: 2.0, priceEur: 1600, berth: true, departures: "heti 6–7", note: "Nincs nyilvános alapár – BECSLÉS. Kabin + étkezés.", confidence: "estimate", asOf: "2026", via: [[11.2,54.3], [13.5,54.8], [18.0,56.5], [20.5,58.6], [23.0,59.7]] },
  { id: "helsinki-tallinn", name: "Helsinki – Tallinn", operator: "Tallink / Eckerö / Viking Line", kind: "ferry", region: "Balti-tenger", a: { name: "Helsinki West Harbour", lat: 60.15, lon: 24.915 }, b: { name: "Tallinn Old City Harbour", lat: 59.445, lon: 24.77 }, durationH: 2.25, checkInH: 1.0, priceEur: 350, berth: false, departures: "15–20 / nap", note: "Nincs nyilvános alapár – BECSLÉS.", confidence: "estimate", asOf: "2026" },
  { id: "ancona-igoumenitsa", name: "Ancona – Igoumenitsa", operator: "Anek-Superfast / Minoan (Grimaldi)", kind: "ferry", region: "Adria", a: { name: "Ancona", lat: 43.618, lon: 13.505 }, b: { name: "Igoumenitsa", lat: 39.497, lon: 20.257 }, durationH: 15.5, checkInH: 2.0, priceEur: 880, berth: true, departures: "~1 / nap", note: "Superfast 16,6–18 m: 794–977 € naptól függően, üzemanyag- és ETS-pótlékkal (2024-es tábla, elavult) – a 2026-os ár ismeretlen.", confidence: "ratecard", asOf: "2024 (Superfast tarifa)", via: [[16.5,41.8], [18.8,40.2]] },
  { id: "ancona-patras", name: "Ancona – Patras", operator: "Anek-Superfast / Minoan (Grimaldi)", kind: "ferry", region: "Adria", a: { name: "Ancona", lat: 43.618, lon: 13.505 }, b: { name: "Patras", lat: 38.222, lon: 21.722 }, durationH: 21.5, checkInH: 2.0, priceEur: 1000, berth: true, departures: "~1 / nap", note: "BECSLÉS (a Superfast 2024-es táblája alapján).", confidence: "estimate", asOf: "2026", via: [[16.5,41.8], [18.8,40.2], [20.4,38.7]] },
  { id: "bari-igoumenitsa", name: "Bari – Igoumenitsa", operator: "Anek-Superfast", kind: "ferry", region: "Adria", a: { name: "Bari", lat: 41.137, lon: 16.857 }, b: { name: "Igoumenitsa", lat: 39.497, lon: 20.257 }, durationH: 9.5, checkInH: 2.0, priceEur: 650, berth: true, departures: "~1 / nap", note: "Nincs nyilvános alapár – BECSLÉS.", confidence: "estimate", asOf: "2026", via: [[18.9,40.5]] },
  { id: "bari-patras", name: "Bari – Patras", operator: "Anek-Superfast", kind: "ferry", region: "Adria", a: { name: "Bari", lat: 41.137, lon: 16.857 }, b: { name: "Patras", lat: 38.222, lon: 21.722 }, durationH: 15.5, checkInH: 2.0, priceEur: 800, berth: true, departures: "~1 / nap", note: "Nincs nyilvános alapár – BECSLÉS.", confidence: "estimate", asOf: "2026", via: [[19.2,39.6], [20.4,38.7]] },
  { id: "brindisi-igoumenitsa", name: "Brindisi – Igoumenitsa", operator: "Hellenic Mediterranean Lines / Grimaldi", kind: "ferry", region: "Adria", a: { name: "Brindisi Costa Morena", lat: 40.64, lon: 17.965 }, b: { name: "Igoumenitsa", lat: 39.497, lon: 20.257 }, durationH: 8.0, checkInH: 2.0, priceEur: 385, priceRevEur: 285, berth: true, departures: "1–2 / nap", note: "HML 13,51–16,50 m: Brindisi→Igoumenitsa 320 € (H–Cs) / 385 € (P/V) / 430 € (Szo); vissza 285–380 €; kabin + étkezés (másodlagos, dátum nélküli tábla).", confidence: "ratecard", asOf: "HML díjtábla (ferries.gr)" },
  { id: "venice-patras", name: "Velence (Fusina) – Patras", operator: "Anek-Superfast", kind: "ferry", region: "Adria", a: { name: "Venezia Fusina", lat: 45.418, lon: 12.256 }, b: { name: "Patras", lat: 38.222, lon: 21.722 }, durationH: 32.5, checkInH: 2.0, priceEur: 1300, berth: true, departures: "heti 2–3", note: "Nincs nyilvános alapár – BECSLÉS.", confidence: "estimate", asOf: "2026", via: [[12.9,44.9], [16.5,41.8], [18.8,40.2], [20.4,38.7]] },
  { id: "genoa-barcelona", name: "Genova – Barcelona", operator: "GNV", kind: "ferry", region: "Nyugati-Földközi", a: { name: "Genova", lat: 44.414, lon: 8.91 }, b: { name: "Barcelona", lat: 41.367, lon: 2.17 }, durationH: 19.0, checkInH: 2.0, priceEur: 1944, berth: true, departures: "heti 1–3", note: "Hivatalos GNV díjtábla: 106,50 €/folyóméter (alap + BAF + LSS + ETS + FuelEU) + 137 € kezelés + 11,80 € fuvarlevél + 38 € sofőr ≈ 1944 € 16,5 m-re, ÁFA nélkül.", confidence: "official", asOf: "2026.10.08 (GNV listino)", via: [[8.0,43.6], [4.0,42.0]] },
  { id: "civitavecchia-barcelona", name: "Civitavecchia – Barcelona", operator: "Grimaldi", kind: "ferry", region: "Nyugati-Földközi", a: { name: "Civitavecchia", lat: 42.1, lon: 11.78 }, b: { name: "Barcelona", lat: 41.367, lon: 2.17 }, durationH: 20.0, checkInH: 2.0, priceEur: 1600, berth: true, departures: "heti 6", note: "Nincs nyilvános alapár – BECSLÉS.", confidence: "estimate", asOf: "2026", via: [[9.25,41.33], [4.0,41.6]] },
  { id: "barcelona-palma", name: "Barcelona – Palma de Mallorca", operator: "Baleària / GNV / Trasmed", kind: "ferry", region: "Nyugati-Földközi", a: { name: "Barcelona", lat: 41.367, lon: 2.17 }, b: { name: "Palma", lat: 39.56, lon: 2.63 }, durationH: 7.5, checkInH: 1.5, priceEur: 1018, berth: true, departures: "≥1 / nap / társaság", note: "Hivatalos GNV díjtábla: 55,65 €/fm + SECA 50 € + kezelés 40 € + 10 € ≈ 1018 € 16,5 m-re; sofőr ingyen, fekhellyel.", confidence: "official", asOf: "2026.10.09 (GNV listino)" },
  { id: "algeciras-tanger", name: "Algeciras – Tanger Med", operator: "FRS / DFDS / Baleària / AML", kind: "ferry", region: "Nyugati-Földközi", a: { name: "Algeciras", lat: 36.135, lon: -5.435 }, b: { name: "Tanger Med", lat: 35.885, lon: -5.505 }, durationH: 1.5, checkInH: 2.0, priceEur: 700, berth: false, departures: "20+ / nap", note: "Nincs nyilvános alapár (csak BAF 4,36 €/fm) – BECSLÉS.", confidence: "estimate", asOf: "2026" },
  { id: "rola-brenner", name: "RoLa Wörgl – Brenner (gördülő országút)", operator: "Rail Cargo Operator (ÖBB)", kind: "rail", region: "Alpok", a: { name: "Wörgl RoLa terminál", lat: 47.49, lon: 12.06 }, b: { name: "Brennersee RoLa terminál", lat: 47.0, lon: 11.51 }, durationH: 2.0, checkInH: 2.75, priceEur: 206, priceRevEur: 166, berth: false, departures: "20+ / nap", note: "Hivatalos 2026. júl. 1-jei tarifa ≤40,5 t, 1–2 sofőrrel, ÁFA nélkül: Wörgl→Brenner 206 €, Brenner→Wörgl 166 € (≤44 t: 333 / 299 €). Felár: ünnepnap +50 €, ADR +35 €, foglalás nélkül +35 €. Az A13 szakaszdíj és a GO-Maut ezen a szakaszon nem fizetendő.", confidence: "official", asOf: "2026.07.01 (RCO tarifa)", via: [[11.39,47.27], [11.45,47.1]] },
  { id: "rola-trento", name: "RoLa Wörgl – Trento (éjszakai)", operator: "Rail Cargo Operator (ÖBB)", kind: "rail", region: "Alpok", a: { name: "Wörgl RoLa terminál", lat: 47.49, lon: 12.06 }, b: { name: "Trento Roncafort", lat: 46.09, lon: 11.1 }, durationH: 7.0, checkInH: 6.0, priceEur: 418, berth: false, departures: "1 / nap (éjszakai)", note: "Hivatalos 2026-os tarifa ≤40,5 t, 1–2 sofőrrel, ÁFA nélkül: 418 € (≤44 t: 554 €). Beszállás Wörglben 17:15-ig, indulás 23:30.", confidence: "official", asOf: "2026 (RCO tarifa)", via: [[11.39,47.27], [11.51,47.0], [11.35,46.5]] },
];

export const ferryById = (id: string) => FERRIES.find((f) => f.id === id);

const hav = (a: LngLat, b: LngLat) => {
  const dx = (b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180) * 111.32;
  return Math.hypot(dx, (b[1] - a[1]) * 110.57);
};

/** a járat vonala a → b (vagy fordítva) */
export function ferryPath(f: FerryLine, reverse: boolean): LngLat[] {
  const p: LngLat[] = [[f.a.lon, f.a.lat], ...(f.via ?? []), [f.b.lon, f.b.lat]];
  return reverse ? p.reverse() : p;
}

export function pathKm(p: LngLat[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += hav(p[i - 1], p[i]);
  return s;
}

/** a járat középpontja (a pontlistában ezt a koordinátát kapja) */
export function ferryMid(f: FerryLine): LngLat {
  const p = ferryPath(f, false);
  const total = pathKm(p);
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const d = hav(p[i - 1], p[i]);
    if (acc + d >= total / 2) {
      const t = (total / 2 - acc) / (d || 1);
      return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t];
    }
    acc += d;
  }
  return p[0];
}

export function ferryWaypoint(f: FerryLine): Waypoint {
  const [lon, lat] = ferryMid(f);
  return { lat, lon, label: `${f.kind === "rail" ? "🚆" : "⛴"} ${f.name}`, ferry: f.id };
}

/** ár a jármű hossza szerint (sávméter-arányosan, a 16,5 m-es árból; min. 35%) */
export function ferryPrice(f: FerryLine, v: Vehicle, o?: FerryOverride, reverse = false): number {
  if (o?.priceEur !== undefined && Number.isFinite(o.priceEur)) return o.priceEur;
  const base = reverse && f.priceRevEur !== undefined ? f.priceRevEur : f.priceEur;
  // vasúti shuttle: egységár (nem méterarányos)
  if (f.kind === "rail") return base;
  if (v.weight <= 3.5) return base * 0.35;
  return base * Math.max(0.35, Math.min(1.25, v.length / 16.5));
}

export interface Segments {
  /** közúti szakaszok pontlistái */
  roads: Waypoint[][];
  /** a szakaszok közötti járatok (roads[i] után ferries[i]) */
  ferries: { line: FerryLine; reverse: boolean }[];
  /** a sorrend: "r" = közúti szakasz, "f" = járat */
  order: ("r" | "f")[];
}

const portWp = (p: Port): Waypoint => ({ lat: p.lat, lon: p.lon, label: p.name });

/**
 * A pontlista szétbontása a kiválasztott járatok mentén. A járat iránya automatikus:
 * az előző ponthoz közelebbi kikötőből indul.
 */
export function splitByFerries(wps: Waypoint[]): Segments {
  const roads: Waypoint[][] = [];
  const ferries: Segments["ferries"] = [];
  const order: Segments["order"] = [];
  let cur: Waypoint[] = [];
  wps.forEach((w, i) => {
    const line = w.ferry ? ferryById(w.ferry) : undefined;
    if (!line) { cur.push(w); return; }
    const prev = cur[cur.length - 1] ?? wps.slice(i + 1).find((x) => !x.ferry);
    const ref: LngLat = prev ? [prev.lon, prev.lat] : [line.a.lon, line.a.lat];
    // ha a járat az első elem, a következő ponthoz távolabbi kikötőből indulunk
    const nearA = hav(ref, [line.a.lon, line.a.lat]) <= hav(ref, [line.b.lon, line.b.lat]);
    const reverse = cur.length ? !nearA : nearA;
    const dep = reverse ? line.b : line.a;
    const arr = reverse ? line.a : line.b;
    if (cur.length) {
      cur.push(portWp(dep));
      roads.push(cur);
      order.push("r");
    }
    ferries.push({ line, reverse });
    order.push("f");
    cur = [portWp(arr)];
  });
  if (cur.length > 1) { roads.push(cur); order.push("r"); }
  return { roads, ferries, order };
}

/** automatikusan (a routing által) választott kompút párosítása a katalógussal a kikötők alapján */
export function matchFerry(start: LngLat, end: LngLat): { line: FerryLine; reverse: boolean } | null {
  let best: { line: FerryLine; reverse: boolean; d: number } | null = null;
  for (const f of FERRIES) {
    const A: LngLat = [f.a.lon, f.a.lat];
    const B: LngLat = [f.b.lon, f.b.lat];
    const fwd = hav(start, A) + hav(end, B);
    const rev = hav(start, B) + hav(end, A);
    const d = Math.min(fwd, rev);
    if (d < 40 && (!best || d < best.d)) best = { line: f, reverse: rev < fwd, d };
  }
  return best ? { line: best.line, reverse: best.reverse } : null;
}
