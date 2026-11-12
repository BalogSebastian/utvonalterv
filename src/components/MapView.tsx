"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MLMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LngLat, NoGoArea, RouteResult, Vehicle, Waypoint } from "@/lib/types";
import { cumulative, snapToRoute } from "@/lib/schedule";
import { circleRing } from "@/lib/zones";

// A worker a public/ mappából jön (a Turbopack nem tudja automatikusan becsomagolni).
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

interface Props {
  waypoints: (Waypoint | null)[];
  routes: RouteResult[];
  selected: number;
  vehicle: Vehicle;
  showRestrictions: boolean;
  showParking: boolean;
  onContext: (kind: "from" | "to" | "via", lat: number, lon: number) => void;
  pickMode: number | null;
  onPick: (lat: number, lon: number) => void;
  onSelectRoute: (i: number) => void;
  onStopMove: (id: string, f: number) => void;
  onStopDrop: (id: string, lng: number, lat: number) => void;
  onWaypointDrag: (i: number, lat: number, lon: number) => void;
  /** az útvonal megfogása és elengedése: új áthaladási pont (f = arány az útvonal mentén) */
  onRouteDrag: (f: number, lat: number, lon: number) => void;
  /** áthaladási pont törlése (dupla kattintás a ponton) */
  onWaypointRemove: (i: number) => void;
  /** igaz: az új útvonalnál ne zoomoljon rá (húzás után) */
  keepView?: boolean;
  /** No-Go zónák megjelenítése */
  zoneCountries: string[];
  zoneAreas: NoGoArea[];
  /** zóna rajzolása: sokszög (kattintások) vagy kör (középpont) */
  drawMode: "poly" | "circle" | null;
  circleKm: number;
  onDrawDone: (ring: LngLat[]) => void;
  onDrawCancel: () => void;
  /** élő előnézet az útvonal húzása közben */
  onRoutePreview?: (f: number, lat: number, lon: number) => Promise<LngLat[] | null>;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function blockReason(p: Record<string, unknown>, v: Vehicle): string | null {
  if (p.hgv) return "Tehergépjármű-forgalom tilos (hgv=no)";
  const mw = p.maxweight as number | null;
  if (mw != null && v.weight > mw) return `Súlykorlát: ${mw} t (a jármű ${v.weight} t)`;
  const mh = p.maxheight as number | null;
  if (mh != null && v.height > mh) return `Magasságkorlát: ${mh} m (a jármű ${v.height} m)`;
  const mwd = p.maxwidth as number | null;
  if (mwd != null && v.width > mwd) return `Szélességkorlát: ${mwd} m (a jármű ${v.width} m)`;
  const ml = p.maxlength as number | null;
  if (ml != null && v.length > ml) return `Hosszkorlát: ${ml} m (a jármű ${v.length} m)`;
  const ma = p.maxaxleload as number | null;
  if (ma != null && v.axleLoad > ma) return `Tengelyterhelés-korlát: ${ma} t (a jármű ${v.axleLoad} t)`;
  if (p.hazmat && v.hazmat) return "Veszélyes áru (ADR) szállítása tilos";
  return null;
}

function supportsWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

export default function MapView({
  waypoints, routes, selected, vehicle, showRestrictions, showParking, onContext, pickMode, onPick, onSelectRoute, onStopMove, onStopDrop, onWaypointDrag, onRouteDrag, onWaypointRemove, keepView,
  zoneCountries, zoneAreas, drawMode, circleKm, onDrawDone, onDrawCancel, onRoutePreview,
}: Props) {
  const drawRef = useRef({ drawMode, circleKm, onDrawDone, onDrawCancel });
  const previewRef = useRef(onRoutePreview);
  const [drawPts, setDrawPts] = useState<LngLat[]>([]);
  const drawPtsRef = useRef<LngLat[]>([]);
  // rajzmód váltásakor a félkész sokszög törlődik
  const [prevDraw, setPrevDraw] = useState(drawMode);
  if (prevDraw !== drawMode) { setPrevDraw(drawMode); setDrawPts([]); }
  const zoneCache = useRef(new Map<string, GeoJSON.Feature>());
  const [glOk] = useState(supportsWebGL2);
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [restrStatus, setRestrStatus] = useState<string>("");
  const [parkStatus, setParkStatus] = useState<string>("");
  const [menu, setMenu] = useState<{ x: number; y: number; lat: number; lon: number } | null>(null);
  const stopMarkers = useRef<Marker[]>([]);
  const rawRestr = useRef<GeoJSON.FeatureCollection>(EMPTY);
  const pickRef = useRef({ pickMode, onPick });
  const selectRef = useRef(onSelectRoute);
  const stopMoveRef = useRef(onStopMove);
  const stopDropRef = useRef(onStopDrop);
  const wpDragRef = useRef(onWaypointDrag);
  const routeDragRef = useRef(onRouteDrag);
  const wpRemoveRef = useRef(onWaypointRemove);
  const keepViewRef = useRef(keepView);
  /** a kijelölt útvonal + a pontok (a húzás eseménykezelői ezt olvassák) */
  const dragCtx = useRef<{ geometry: [number, number][]; cum: number[]; wps: Waypoint[] }>({ geometry: [], cum: [], wps: [] });
  const vehicleRef = useRef(vehicle);

  useEffect(() => {
    pickRef.current = { pickMode, onPick };
    selectRef.current = onSelectRoute;
    stopMoveRef.current = onStopMove;
    stopDropRef.current = onStopDrop;
    wpDragRef.current = onWaypointDrag;
    routeDragRef.current = onRouteDrag;
    wpRemoveRef.current = onWaypointRemove;
    keepViewRef.current = keepView;
    vehicleRef.current = vehicle;
    drawRef.current = { drawMode, circleKm, onDrawDone, onDrawCancel };
    previewRef.current = onRoutePreview;
  });

  // init
  useEffect(() => {
    if (!glOk || !el.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: el.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [`${window.location.origin}/api/tiles/{z}/{x}/{y}`],
            tileSize: 256,
            maxzoom: 19,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [17.5, 48.5],
      zoom: 5,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.on("load", () => {
      for (const id of ["zones", "alt", "main", "toll", "ferry", "restr", "park", "drag", "handle", "draw"]) map.addSource(id, { type: "geojson", data: EMPTY });
      map.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#dc2626", "fill-opacity": 0.1 } });
      map.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": "#dc2626", "line-width": 2, "line-dasharray": [2, 1.5], "line-opacity": 0.8 } });
      map.addLayer({ id: "alt-line", type: "line", source: "alt", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#64748b", "line-width": 5, "line-opacity": 0.55 } });
      map.addLayer({ id: "main-case", type: "line", source: "main", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 9 } });
      map.addLayer({ id: "main-line", type: "line", source: "main", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#2563eb", "line-width": 6 } });
      map.addLayer({ id: "toll-line", type: "line", source: "toll", layout: { "line-cap": "butt", "line-join": "round" },
        paint: { "line-color": "#f59e0b", "line-width": 3, "line-dasharray": [1.2, 1] } });
      map.addLayer({ id: "ferry-case", type: "line", source: "ferry", layout: { "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": 7 } });
      map.addLayer({ id: "ferry-line", type: "line", source: "ferry", layout: { "line-cap": "round" },
        paint: { "line-color": "#0d9488", "line-width": 4, "line-dasharray": [1.4, 1.2] } });
      map.addLayer({ id: "draw-fill", type: "fill", source: "draw", filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#dc2626", "fill-opacity": 0.15 } });
      map.addLayer({ id: "draw-line", type: "line", source: "draw", paint: { "line-color": "#dc2626", "line-width": 2.5 } });
      map.addLayer({ id: "draw-pt", type: "circle", source: "draw", filter: ["==", "$type", "Point"], paint: { "circle-radius": 5, "circle-color": "#fff", "circle-stroke-color": "#dc2626", "circle-stroke-width": 2.5 } });
      map.addLayer({ id: "drag-line", type: "line", source: "drag", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#1d4ed8", "line-width": 4, "line-dasharray": [1.5, 1.2], "line-opacity": 0.9 } });
      map.addLayer({ id: "handle-dot", type: "circle", source: "handle",
        paint: { "circle-radius": 7, "circle-color": "#ffffff", "circle-stroke-color": "#1d4ed8", "circle-stroke-width": 3 } });
      map.addLayer({ id: "restr-line", type: "line", source: "restr", layout: { "line-cap": "round" },
        paint: { "line-color": "#dc2626", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 8], "line-opacity": 0.9 } });

      map.addLayer({ id: "park-circle", type: "circle", source: "park",
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 4, 14, 9], "circle-color": "#1d4ed8", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
      map.addLayer({ id: "park-label", type: "symbol", source: "park", minzoom: 9,
        layout: { "text-field": "P", "text-size": 11, "text-allow-overlap": true }, paint: { "text-color": "#ffffff" } });
      map.on("click", "park-circle", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties ?? {};
        const esc = (x: unknown) => String(x ?? "").replace(/[<>&]/g, "");
        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(
          `<div style="font:13px system-ui;max-width:240px"><b>${esc(p.name)}</b>${p.capacity ? `<br/>Kamionhelyek: ${esc(p.capacity)}` : ""}${p.fee ? `<br/>Díj: ${esc(p.fee)}` : ""}${p.supervised ? `<br/>Őrzött: ${esc(p.supervised)}` : ""}${p.operator ? `<br/>${esc(p.operator)}` : ""}</div>`,
        ).addTo(map);
      });
      map.on("mouseenter", "park-circle", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "park-circle", () => (map.getCanvas().style.cursor = ""));
      map.on("contextmenu", (e) => setMenu({ x: e.point.x, y: e.point.y, lat: e.lngLat.lat, lon: e.lngLat.lng }));
      map.on("movestart", () => setMenu(null));
      map.on("click", "alt-line", (e) => {
        const idx = e.features?.[0]?.properties?.idx;
        if (typeof idx === "number") selectRef.current(idx);
      });
      map.on("click", "restr-line", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        new maplibregl.Popup({ closeButton: true })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="font:13px system-ui;max-width:240px"><b>${f.properties?.name || "Névtelen út"}</b><br/>${f.properties?.reason}</div>`)
          .addTo(map);
      });
      for (const l of ["alt-line", "restr-line"]) {
        map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
      }
      // --- az útvonal szabad húzása (Google Maps-szerűen) ---
      const canvas = map.getCanvas();
      const setSrc = (id: string, data: GeoJSON.FeatureCollection) => (map.getSource(id) as GeoJSONSource).setData(data);
      const point = (c: [number, number]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } }] });
      let dragging: { f: number; prev: [number, number]; next: [number, number]; moved: boolean; seq: number; busy: boolean; pending: [number, number] | null; last: number } | null = null;
      let dragSeq = 0;
      const runPreview = (lng: number, lat: number) => {
        const d = dragging;
        const fn = previewRef.current;
        if (!d || !fn) return;
        if (d.busy) { d.pending = [lng, lat]; return; }
        d.busy = true;
        d.last = Date.now();
        const seq = d.seq;
        fn(d.f, lat, lng).then((coords) => {
          if (!dragging || dragging.seq !== seq) return;
          if (coords && coords.length > 1) setSrc("drag", { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] });
        }).catch(() => undefined).finally(() => {
          if (!dragging || dragging.seq !== seq) return;
          dragging.busy = false;
          const p = dragging.pending;
          dragging.pending = null;
          if (p) setTimeout(() => runPreview(p[0], p[1]), 120);
        });
      };
      const neighbours = (f: number) => {
        const { geometry, cum, wps } = dragCtx.current;
        const fs = wps.map((w, i) => (i === 0 ? 0 : i === wps.length - 1 ? 1 : snapToRoute(geometry, cum, [w.lon, w.lat]).f));
        let at = wps.length - 1;
        for (let i = 1; i < wps.length; i++) if (fs[i] >= f) { at = i; break; }
        const a = wps[at - 1];
        const b = wps[at];
        return { prev: [a.lon, a.lat] as [number, number], next: [b.lon, b.lat] as [number, number] };
      };
      const startDrag = (lng: number, lat: number) => {
        const { geometry, cum, wps } = dragCtx.current;
        if (geometry.length < 2 || wps.length < 2 || pickRef.current.pickMode !== null || drawRef.current.drawMode) return false;
        const snap = snapToRoute(geometry, cum, [lng, lat]);
        dragging = { f: snap.f, ...neighbours(snap.f), moved: false, seq: ++dragSeq, busy: false, pending: null, last: 0 };
        map.dragPan.disable();
        setMenu(null);
        canvas.style.cursor = "grabbing";
        return true;
      };
      const moveDrag = (lng: number, lat: number) => {
        if (!dragging) return;
        const first = !dragging.moved;
        dragging.moved = true;
        setSrc("handle", point([lng, lat]));
        if (first || !previewRef.current) setSrc("drag", { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [dragging.prev, [lng, lat], dragging.next] } }] });
        runPreview(lng, lat);
      };
      const endDrag = (lng: number, lat: number) => {
        if (!dragging) return;
        const d = dragging;
        dragging = null;
        map.dragPan.enable();
        canvas.style.cursor = "";
        setSrc("drag", EMPTY);
        setSrc("handle", EMPTY);
        if (d.moved) routeDragRef.current(d.f, lat, lng);
      };
      map.on("mousemove", (e) => {
        if (dragging) { moveDrag(e.lngLat.lng, e.lngLat.lat); return; }
        if (pickRef.current.pickMode !== null || drawRef.current.drawMode) return;
        const hit = map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ["main-line"] }).length > 0;
        const { geometry, cum } = dragCtx.current;
        if (hit && geometry.length > 1) {
          setSrc("handle", point(snapToRoute(geometry, cum, [e.lngLat.lng, e.lngLat.lat]).point));
          canvas.style.cursor = "grab";
        } else {
          setSrc("handle", EMPTY);
          if (canvas.style.cursor === "grab") canvas.style.cursor = "";
        }
      });
      map.on("mousedown", "main-line", (e) => {
        if (e.originalEvent.button !== 0) return;
        if (startDrag(e.lngLat.lng, e.lngLat.lat)) e.preventDefault();
      });
      map.on("mouseup", (e) => endDrag(e.lngLat.lng, e.lngLat.lat));
      canvas.addEventListener("mouseleave", () => { if (dragging) { dragging = null; map.dragPan.enable(); setSrc("drag", EMPTY); setSrc("handle", EMPTY); } });
      // érintőképernyő: hosszan nyomva fogja meg az útvonalat
      let touchTimer: ReturnType<typeof setTimeout> | undefined;
      map.on("touchstart", "main-line", (e) => {
        if (e.points.length !== 1) return;
        const ll = e.lngLat;
        touchTimer = setTimeout(() => { if (startDrag(ll.lng, ll.lat)) moveDrag(ll.lng, ll.lat); }, 350);
      });
      map.on("touchmove", (e) => {
        if (dragging) { e.preventDefault(); moveDrag(e.lngLat.lng, e.lngLat.lat); }
        else clearTimeout(touchTimer);
      });
      map.on("touchend", (e) => { clearTimeout(touchTimer); endDrag(e.lngLat.lng, e.lngLat.lat); });

      setReady(true);
    });
    map.on("click", (e) => {
      const dm = drawRef.current.drawMode;
      if (dm === "circle") { drawRef.current.onDrawDone(circleRing([e.lngLat.lng, e.lngLat.lat], drawRef.current.circleKm || 10)); return; }
      if (dm === "poly") {
        const next = [...drawPtsRef.current, [e.lngLat.lng, e.lngLat.lat] as LngLat];
        drawPtsRef.current = next;
        setDrawPts(next);
        return;
      }
      if (pickRef.current.pickMode !== null) pickRef.current.onPick(e.lngLat.lat, e.lngLat.lng);
    });
    map.on("dblclick", (e) => {
      if (drawRef.current.drawMode !== "poly") return;
      e.preventDefault();
      const pts = drawPtsRef.current;
      if (pts.length >= 3) drawRef.current.onDrawDone(pts);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [glOk]);

  // cursor in pick / draw mode
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    m.getCanvas().style.cursor = pickMode !== null || drawMode ? "crosshair" : "";
    if (drawMode === "poly") m.doubleClickZoom.disable();
    else m.doubleClickZoom.enable();
    drawPtsRef.current = [];
  }, [pickMode, drawMode, ready]);

  // rajzolás közbeni sokszög
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const feats: GeoJSON.Feature[] = drawPts.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } }));
    if (drawPts.length >= 2) feats.push({ type: "Feature", properties: {}, geometry: drawPts.length >= 3 ? { type: "Polygon", coordinates: [[...drawPts, drawPts[0]]] } : { type: "LineString", coordinates: drawPts } });
    (map.getSource("draw") as GeoJSONSource).setData({ type: "FeatureCollection", features: feats });
  }, [drawPts, ready]);

  // Esc: rajzolás megszakítása
  useEffect(() => {
    if (!drawMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") drawRef.current.onDrawCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawMode]);

  // No-Go zónák
  const zoneKey = zoneCountries.join(",");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let alive = true;
    (async () => {
      const feats: GeoJSON.Feature[] = [];
      for (const cc of zoneKey ? zoneKey.split(",") : []) {
        let f = zoneCache.current.get(cc);
        if (!f) {
          try {
            const r = await fetch(`/api/zones?cc=${cc}`);
            if (r.ok) { f = (await r.json()) as GeoJSON.Feature; zoneCache.current.set(cc, f); }
          } catch { /* hálózati hiba */ }
        }
        if (f) feats.push(f);
      }
      for (const a of zoneAreas) feats.push({ type: "Feature", properties: { name: a.name }, geometry: { type: "Polygon", coordinates: [[...a.ring, a.ring[0]]] } });
      if (alive) (map.getSource("zones") as GeoJSONSource).setData({ type: "FeatureCollection", features: feats });
    })();
    return () => { alive = false; };
  }, [zoneKey, zoneAreas, ready]);

  // markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    const placed = waypoints.map((w, i) => ({ w, i })).filter((x): x is { w: Waypoint; i: number } => !!x.w);
    placed.forEach(({ w, i }) => {
      const first = i === 0;
      const last = i === waypoints.length - 1;
      const d = document.createElement("div");
      if (w.ferry) {
        d.textContent = w.label.startsWith("🚆") ? "🚆" : "⛴";
        d.title = `${w.label} · dupla kattintás: törlés`;
        d.style.cssText = "width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;background:#ccfbf1;border:2px solid #0d9488;box-shadow:0 1px 4px rgba(0,0,0,.45);cursor:pointer";
        d.addEventListener("dblclick", (ev) => { ev.stopPropagation(); ev.preventDefault(); wpRemoveRef.current(i); });
        markers.current.push(new maplibregl.Marker({ element: d }).setLngLat([w.lon, w.lat]).addTo(map));
        return;
      }
      const via = !first && !last && w.via;
      d.textContent = first ? "A" : last ? "B" : via ? "" : String(i);
      d.style.cssText = via
        ? "width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid #1d4ed8;box-shadow:0 1px 4px rgba(0,0,0,.45)"
        : `width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 13px system-ui;color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);background:${first ? "#16a34a" : last ? "#dc2626" : "#475569"}`;
      d.style.cursor = "grab";
      d.title = first || last
        ? "Húzd az áthelyezéshez (új útvonalat számol)"
        : "Húzd az áthelyezéshez · dupla kattintás: törlés";
      if (!first && !last) {
        d.addEventListener("dblclick", (ev) => { ev.stopPropagation(); ev.preventDefault(); wpRemoveRef.current(i); });
      }
      const mk = new maplibregl.Marker({ element: d, draggable: true }).setLngLat([w.lon, w.lat]).addTo(map);
      mk.on("dragend", () => {
        const ll = mk.getLngLat();
        wpDragRef.current(i, ll.lat, ll.lng);
      });
      markers.current.push(mk);
    });
    if (placed.length === 1 && routes.length === 0) map.easeTo({ center: [placed[0].w.lon, placed[0].w.lat], zoom: Math.max(map.getZoom(), 9) });
  }, [waypoints, ready, routes.length]);

  // routes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const sel = routes[selected];
    dragCtx.current = {
      geometry: sel?.geometry ?? [],
      cum: sel ? cumulative(sel.geometry) : [],
      wps: waypoints.filter((w): w is Waypoint => !!w),
    };
    const set = (id: string, data: GeoJSON.FeatureCollection) => (map.getSource(id) as GeoJSONSource).setData(data);
    set("main", sel ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: sel.geometry } }] } : EMPTY);
    set("alt", {
      type: "FeatureCollection",
      features: routes.flatMap((r, i) =>
        i === selected ? [] : [{ type: "Feature" as const, properties: { idx: i }, geometry: { type: "LineString" as const, coordinates: r.geometry } }],
      ),
    });
    set("ferry", sel ? { type: "FeatureCollection", features: (sel.ferries ?? []).map((fr) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: fr.geometry } })) } : EMPTY);
    set("toll", sel ? { type: "FeatureCollection", features: sel.tollGeometry.map((g) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: g } })) } : EMPTY);
  }, [routes, selected, ready, waypoints]);

  // fit bounds on new route set (húzás után a nézet marad)
  const lastFit = useRef<unknown>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !routes.length) return;
    if (lastFit.current === routes[0].geometry) return;
    lastFit.current = routes[0].geometry;
    if (keepViewRef.current) return;
    const b = new maplibregl.LngLatBounds();
    routes[0].geometry.forEach((c) => b.extend(c));
    map.fitBounds(b, { padding: { top: 60, bottom: 60, left: 60, right: 60 }, duration: 800 });
  }, [routes, ready]);

  // napi szünetek / pihenők jelölői
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    stopMarkers.current.forEach((m) => m.remove());
    stopMarkers.current = [];
    const route = routes[selected];
    if (!route) return;
    const cum = cumulative(route.geometry);
    for (const st of route.stops) {
      if (st.kind === "ferry") continue;
      const d = document.createElement("div");
      if (st.kind === "wait") {
        d.textContent = "⏳";
        d.title = `${st.place ?? "Várakozás"} – ${(st.durH ?? 0).toFixed(1)} óra`;
        d.style.cssText = "font-size:15px;width:28px;height:28px;border-radius:50%;background:#fef3c7;border:2px solid #d97706;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.45)";
        stopMarkers.current.push(new maplibregl.Marker({ element: d, offset: [16, -16] }).setLngLat([st.lon, st.lat]).addTo(map));
        continue;
      }
      d.textContent = st.kind === "rest" ? "🌙" : "☕";
      d.title = `${st.kind === "rest" ? "Napi pihenő" : "45 perc szünet"}${st.place ? ` – ${st.place}` : ""} – ${st.day}. nap, ~${Math.round(st.km)}. km – húzd bárhová: az útvonal mentén vagy egy másik városba`;
      d.style.cssText = `font-size:15px;width:28px;height:28px;border-radius:50%;background:#fff;border:2px solid ${st.warn ? "#dc2626" : "#334155"};display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.45);cursor:grab`;
      const mk = new maplibregl.Marker({ element: d, draggable: true }).setLngLat([st.lon, st.lat]).addTo(map);
      // szabadon húzható: az útvonal közelében az útvonal mentén mozog, távol új köztes pont lesz
      mk.on("dragend", () => {
        const ll = mk.getLngLat();
        const snap = snapToRoute(route.geometry, cum, [ll.lng, ll.lat]);
        if (snap.distKm < 2) stopMoveRef.current(st.id, snap.f);
        else stopDropRef.current(st.id, ll.lng, ll.lat);
      });
      stopMarkers.current.push(mk);
    }
  }, [routes, selected, ready]);

  // kamionparkolók / pihenők
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = () => map.getSource("park") as GeoJSONSource;
    if (!showParking) {
      src().setData(EMPTY);
      return;
    }
    let ctrl: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (map.getZoom() < 8.5) {
        setParkStatus("Közelíts rá (zoom ≥ 9) a kamionparkolók betöltéséhez.");
        src().setData(EMPTY);
        return;
      }
      const b = map.getBounds();
      ctrl?.abort();
      ctrl = new AbortController();
      setParkStatus("Parkolók betöltése…");
      try {
        const res = await fetch(`/api/restrictions?mode=parking&s=${b.getSouth()}&w=${b.getWest()}&n=${b.getNorth()}&e=${b.getEast()}`, { signal: ctrl.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        src().setData(data);
        setParkStatus(`${data.features.length} kamionparkoló / pihenőhely a nézetben`);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setParkStatus((e as Error).message || "Betöltési hiba");
      }
    };
    const onMove = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 700);
    };
    map.on("moveend", onMove);
    load();
    return () => {
      map.off("moveend", onMove);
      ctrl?.abort();
      clearTimeout(timer);
    };
  }, [showParking, ready]);

  // restrictions overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = () => map.getSource("restr") as GeoJSONSource;
    if (!showRestrictions) {
      src().setData(EMPTY);
      return;
    }
    let ctrl: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const apply = () => {
      const feats = rawRestr.current.features
        .map((f) => {
          const reason = blockReason(f.properties ?? {}, vehicleRef.current);
          return reason ? { ...f, properties: { ...f.properties, reason } } : null;
        })
        .filter(Boolean) as GeoJSON.Feature[];
      src().setData({ type: "FeatureCollection", features: feats });
      setRestrStatus(`${feats.length} tiltott / korlátozott útszakasz a jármű számára (${rawRestr.current.features.length} korlátozás a nézetben)`);
    };
    const load = async () => {
      if (map.getZoom() < 10.5) {
        setRestrStatus("Közelíts rá (zoom ≥ 11) a korlátozások betöltéséhez.");
        src().setData(EMPTY);
        return;
      }
      const b = map.getBounds();
      ctrl?.abort();
      ctrl = new AbortController();
      setRestrStatus("Korlátozások betöltése…");
      try {
        const res = await fetch(`/api/restrictions?s=${b.getSouth()}&w=${b.getWest()}&n=${b.getNorth()}&e=${b.getEast()}`, { signal: ctrl.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        rawRestr.current = data;
        apply();
      } catch (e) {
        if ((e as Error).name !== "AbortError") setRestrStatus((e as Error).message || "Betöltési hiba");
      }
    };
    const onMove = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 700);
    };
    map.on("moveend", onMove);
    load();
    return () => {
      map.off("moveend", onMove);
      ctrl?.abort();
      clearTimeout(timer);
    };
  }, [showRestrictions, ready]);

  // re-evaluate restrictions on vehicle change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !showRestrictions) return;
    const feats = rawRestr.current.features
      .map((f) => {
        const reason = blockReason(f.properties ?? {}, vehicle);
        return reason ? { ...f, properties: { ...f.properties, reason } } : null;
      })
      .filter(Boolean) as GeoJSON.Feature[];
    (map.getSource("restr") as GeoJSONSource).setData({ type: "FeatureCollection", features: feats });
  }, [vehicle, showRestrictions, ready]);

  if (!glOk) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-slate-600 dark:text-slate-300">
        A térkép megjelenítéséhez WebGL2 szükséges, amit ez a böngésző/eszköz nem támogat.
        Kapcsold be a hardveres gyorsítást a böngésző beállításaiban, vagy használj másik böngészőt.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={el} className="h-full w-full" />
      {drawMode && (
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900/90 px-4 py-2 text-sm text-white shadow">
          <span>{drawMode === "circle" ? `Kattints a kör középpontjára (${circleKm} km sugár)` : `Kattints a sarokpontokra (${drawPts.length}) · dupla kattintás: kész`}</span>
          {drawMode === "poly" && drawPts.length >= 3 && <button className="rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-semibold" onClick={() => onDrawDone(drawPts)}>Kész</button>}
          {drawMode === "poly" && drawPts.length > 0 && <button className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs" onClick={() => { const n = drawPts.slice(0, -1); drawPtsRef.current = n; setDrawPts(n); }}>↶</button>}
          <button className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs" onClick={onDrawCancel}>Mégse (Esc)</button>
        </div>
      )}
      {pickMode !== null && (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2 text-sm text-white shadow">
          Kattints a térképen a pont kijelöléséhez
        </div>
      )}
      {showRestrictions && restrStatus && (
        <div className="absolute bottom-8 left-1/2 max-w-[90%] -translate-x-1/2 rounded-lg bg-white/95 px-3 py-1.5 text-xs text-slate-700 shadow dark:bg-slate-900/95 dark:text-slate-200">
          <span className="mr-1.5 inline-block h-2 w-5 rounded-sm bg-red-600 align-middle" />
          {restrStatus}
        </div>
      )}
      {showParking && parkStatus && (
        <div className="absolute bottom-16 left-1/2 max-w-[90%] -translate-x-1/2 rounded-lg bg-white/95 px-3 py-1.5 text-xs text-slate-700 shadow dark:bg-slate-900/95 dark:text-slate-200">
          <span className="mr-1.5 inline-block h-3 w-3 rounded-full bg-blue-700 align-middle" />{parkStatus}
        </div>
      )}
      {menu && (
        <div className="absolute z-20 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800" style={{ left: Math.min(menu.x, 9999), top: menu.y }}>
          {([["from", "🟢 Útvonal innen"], ["via", "⚪ Köztes pont ide"], ["to", "🔴 Útvonal ide"]] as const).map(([k, label]) => (
            <button key={k} className="block w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
              onClick={() => { onContext(k, menu.lat, menu.lon); setMenu(null); }}>{label}</button>
          ))}
        </div>
      )}
      <div className="absolute bottom-8 right-3 hidden rounded-lg bg-white/95 p-2 text-xs text-slate-700 shadow sm:block dark:bg-slate-900/95 dark:text-slate-200">
        <div><span className="mr-1.5 inline-block h-1.5 w-5 rounded-sm bg-blue-600 align-middle" />Útvonal</div>
        <div><span className="mr-1.5 inline-block w-5 border-t-2 border-dashed border-amber-500 align-middle" />Díjköteles szakasz</div>
        <div><span className="mr-1.5 inline-block h-1.5 w-5 rounded-sm bg-slate-500 align-middle" />Alternatíva</div>
        <div><span className="mr-1.5 inline-block w-5 border-t-2 border-dashed border-teal-600 align-middle" />Komp / vasút</div>
        <div><span className="mr-1.5 inline-block h-2.5 w-5 rounded-sm border border-dashed border-red-600 bg-red-600/10 align-middle" />No-Go zóna</div>
        <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Az útvonal megfogható és húzható</div>
      </div>
    </div>
  );
}
