"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { driverTrip, encodeTrip, googleLinks, gpxFor, navPoints, simplify } from "@/lib/navlinks";
import { dt, dur } from "@/lib/format";
import type { RouteResult, Waypoint } from "@/lib/types";

interface Props {
  route: RouteResult;
  waypoints: Waypoint[];
  departure: string;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** „Sofőrnek küldés”: a sofőr egy koppintással indítja a navigációt (Google Maps / Waze / OsmAnd). */
export default function DriverSend({ route, waypoints, departure }: Props) {
  const points = useMemo(() => navPoints(route, waypoints), [route, waypoints]);
  const links = useMemo(() => googleLinks(points), [points]);
  const trip = useMemo(() => driverTrip(route, waypoints, points, departure), [route, waypoints, points, departure]);
  const [pageUrl, setPageUrl] = useState("");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    let alive = true;
    void encodeTrip(trip).then((enc) => { if (alive) setPageUrl(`${window.location.origin}/sofor#d=${enc}`); });
    return () => { alive = false; };
  }, [trip]);

  useEffect(() => {
    if (!showQr || !links[0]) return;
    let alive = true;
    // a QR az első navigációs linket tartalmazza: beolvasás után azonnal indul a Google Maps
    void QRCode.toString(links[0].url, { type: "svg", margin: 1, errorCorrectionLevel: "L" }).then((s) => { if (alive) setQr(s); });
    return () => { alive = false; };
  }, [showQr, links]);

  const text = [
    `🚛 ${trip.t}`,
    `Indulás: ${dt(departure)} · érkezés: ${dt(trip.arr)} · ${trip.km} km · ${dur(trip.driveMin)} vezetés`,
    ...trip.w.slice(0, 4),
    "",
    links.length > 1 ? "▶ Navigáció (Google Maps) – a szakaszokat sorban nyisd meg:" : "▶ Navigáció (Google Maps):",
    ...links.map((l) => (links.length > 1 ? `${l.label} (${l.from} → ${l.to}): ${l.url}` : l.url)),
    "",
    pageUrl ? `Részletek, pihenők, Waze / OsmAnd: ${pageUrl}` : "",
  ].filter((x, i, a) => x !== "" || (a[i - 1] ?? "") !== "").join("\n");

  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: trip.t, text }); return; } catch { /* megszakítva */ }
    }
    await copy();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt("Másold ki az üzenetet:", text); }
  };
  const enc = encodeURIComponent(text);

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-950/30">
      <h3 className="h3 !mb-1">📲 Sofőrnek küldés · navigáció</h3>
      <p className="mb-2.5 text-[11px] leading-snug text-slate-600 dark:text-slate-400">
        A sofőr a linkre koppintva azonnal indítja a Google Maps navigációt a kamionos útvonalon: a megállók mellett {points.filter((p) => !p.stop).length} irányító pontot (határátkelők, kompok, köztes pontok) is kap, hogy a Google ne térjen el tőle{links.length > 1 ? `; ${links.length} szakasz (a Google linkenként max. 9 köztes pontot fogad)` : ""}.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn !justify-center !bg-blue-600 !text-white hover:!bg-blue-700" onClick={share}>📤 Küldés…</button>
        <button className="btn !justify-center" onClick={copy}>{copied ? "Másolva ✓" : "📋 Üzenet másolása"}</button>
        <a className="btn !justify-center" href={`https://wa.me/?text=${enc}`} target="_blank" rel="noreferrer">WhatsApp</a>
        <a className="btn !justify-center" href={`viber://forward?text=${enc}`}>Viber</a>
        <a className="btn !justify-center" href={`mailto:?subject=${encodeURIComponent("Útvonal: " + trip.t)}&body=${enc}`}>E-mail</a>
        <a className="btn !justify-center" href={`sms:?&body=${enc}`}>SMS</a>
      </div>
      <div className="mt-2.5 space-y-1.5">
        {links.map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs shadow-sm hover:ring-1 hover:ring-blue-400 dark:bg-slate-900">
            <span className="min-w-0 truncate"><b>Google Maps{links.length > 1 ? ` · ${l.label}` : ""}</b> · {l.from} → {l.to}</span>
            <span className="shrink-0 text-slate-500">{l.points} pont ↗</span>
          </a>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {pageUrl && <a className="chip" href={pageUrl} target="_blank" rel="noreferrer">👁 Sofőr-oldal</a>}
        <button className="chip" onClick={() => setShowQr((s) => !s)}>{showQr ? "QR elrejtése" : "▦ QR-kód"}</button>
        <button className="chip" onClick={() => download("utvonal-osmand.gpx", gpxFor(trip.t, points, simplify(route.geometry, 0.00015, 6000)), "application/gpx+xml")}>GPX (OsmAnd)</button>
      </div>
      {showQr && qr && (
        <div className="mt-2.5 flex items-center gap-3">
          <div className="h-36 w-36 shrink-0 rounded-lg bg-white p-1.5" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-400">A sofőr a telefon kamerájával beolvassa, és {links.length > 1 ? "az 1. szakasz" : "a"} navigáció rögtön indul a Google Maps-ben.</p>
        </div>
      )}
      <p className="mt-2 text-[10px] leading-snug text-slate-500">
        A Google Maps és a Waze személyautós útvonalat számol (nem ismeri a kamionos korlátozásokat) – az irányító pontok a megtervezett nyomvonalon tartják. Pontos kamionos nyomvonal-követéshez: OsmAnd (ingyenes) → GPX importálása → „Navigáció a nyomvonal mentén”.
      </p>
    </section>
  );
}
