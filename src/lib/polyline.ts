import type { LngLat } from "./types";

/** Valhalla/OSRM polyline decode (precision 6). Visszatér: [lng, lat][] */
export function decodePolyline(str: string, precision = 6): LngLat[] {
  const factor = Math.pow(10, precision);
  const out: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < str.length) {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

function encNum(n: number): string {
  let v = n < 0 ? ~(n << 1) : n << 1;
  let s = "";
  while (v >= 0x20) {
    s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return s + String.fromCharCode(v + 63);
}

export function encodePolyline(coords: LngLat[], precision = 6): string {
  const f = Math.pow(10, precision);
  let pl = 0;
  let pg = 0;
  let out = "";
  for (const [lng, lat] of coords) {
    const la = Math.round(lat * f);
    const lo = Math.round(lng * f);
    out += encNum(la - pl) + encNum(lo - pg);
    pl = la;
    pg = lo;
  }
  return out;
}
