# 🚛 Kamion útvonaltervező és útdíj-kalkulátor

Teljesen ingyenes, OpenStreetMap-alapú kamionos útvonaltervező és fuvarköltség-kalkulátor (Next.js).

## Mit tud?

- **Kamion-routing** – a jármű magassága, szélessége, hossza, össztömege, tengelyterhelése és ADR (veszélyes áru) jelölése alapján; kerüli a tiltott / korlátozott utakat (Valhalla `truck` profil).
- **Alternatív útvonalak** – költség- és időösszehasonlítással (2 pont esetén max. 3 változat), köztes pontokkal (max. 10).
- **Útdíj-számítás** – élszintű (útszakasz-szintű) díjköteles km országonként, jármű-kategória (tömeg/tengelyszám) és EURO norma szerint. Támogatott: DE, AT, HU, SK, CZ, PL, RO, BG, SI, HR, IT, FR, ES, PT, CH, BE.
- **Teljes fuvarköltség** – útdíj + üzemanyag + sofőr + jármű-km költség, EUR és HUF.
- **Tilalmi idősávok** – hétvégi/éjszakai tehergépjármű-tilalmak ellenőrzése az indulási időből becsült áthaladási idők alapján (DE, AT, HU, CZ, SK, PL, FR, IT, SI, CH).
- **EU 561/2006 menetrend** – kötelező szünetek, napi pihenők, várható érkezés.
- **Tiltás-réteg a térképen** – az adott járművet érintő súly-/magasság-/szélesség-/hossz-/tengelyterhelés-korlátok és `hgv=no` utak (OSM Overpass), kattintásra indoklással.
- **Ajánlati ár** – árrés (%) és üres visszaút figyelembevételével, EUR/HUF/km bontásban.
- **Napi bontás** – a 45 perces szünetek és a napi pihenők becsült helye és ideje a térképen is (☕ / 🌙).
- **Kamionparkolók** – OSM-alapú réteg (kapacitás, díj, őrzöttség, ahol az OSM-ben szerepel).
- **Térkép jobb klikk** – útvonal innen / köztes pont / cél; **megosztható link** és legutóbbi útvonalak.
- **Export** – GPX (kamionos navigációhoz), CSV költségtábla, nyomtatás.

## Futtatás

```bash
npm install
npm run dev      # http://localhost:3000
```

Nincs szükség API-kulcsra. Használt ingyenes szolgáltatások:

| Feladat | Szolgáltatás |
|---|---|
| Térképcsempék | OpenStreetMap |
| Routing + úthálózati attribútumok | Valhalla (FOSSGIS publikus példány) |
| Címkeresés | Photon (komoot) |
| Tiltások / korlátozások | Overpass API |

## Éles használat: saját Valhalla szerver (ajánlott)

A publikus szerverek „fair use” alapúak (kis forgalom). Éles, nagyobb használathoz futtass saját Valhallát – szintén ingyenes:

```bash
docker compose up -d     # első indításkor letölti és feldolgozza a közép-európai OSM-adatot (órák)
echo 'VALHALLA_URL=http://localhost:8002' > .env.local
```

A `docker-compose.yml` a teljes európai Geofabrik-kivonatot tölti le (nagy: kisebb régióhoz módosítsd a `tile_urls`-t). **A compose-fájl nincs végigtesztelve** – a Valhalla Docker-dokumentációját is nézd meg. A Valhalla alapértelmezett `trace_attributes` limitje 200 km, ezért saját szerverhez állítsd be: `TRACE_CHUNK_KM=150` (az app ennyi km-es darabokban kéri le az útdíjhoz szükséges éleket).

## ⚠️ Fontos: az adatok pontossága

- **Az útdíj-tarifák megbízhatósága országonként eltér**, a felületen jelölve (*forrás szerint* / *becslés*). 2026-os, nyilvános másodlagos forrásból megerősítve: DE (34,8 ct/km), AT (57,24 ct/km), HU (J4 ~163 Ft/km), PL (0,56 zł/km), CH. Becslés: CZ, SK, RO (új TollRo, bizonytalan), HR, SI, IT, FR, ES, PT, BG, BE. Hivatalos táblából egyik sincs ellenőrizve (`verified: false`). A tarifák a [`src/lib/tolls.ts`](src/lib/tolls.ts) fájlban egy helyen szerkeszthetők – éles használat előtt vesd össze a hivatalos rendszerekkel (Toll Collect, GO-Maut, HU-GO, emyto, Mýto, e-TOLL, stb.).
- Alagút- és szakaszdíjak (`src/lib/specials.ts`): modellezve a Fréjus, a Mont Blanc és a Brenner (A13); a Gran San Bernardo, Tauern/Katschberg, Arlberg, Karawanken, Gleinalm/Bosruck, Øresund és Storebælt csak figyelmeztetés (a díj nincs bekalkulálva). Duna-hidak, Eurotunnel, NL/DK/SE útdíjak, DE CO₂-osztályok részletei nincsenek modellezve.
- A díjköteles útosztályokat az OSM `road_class` / `toll=yes` adatokból becsüli, ez a valóságtól eltérhet.
- A tilalmi idősávok (`src/lib/bans.ts`) tájékoztatók; **ünnepnapokat, nyári és helyi tilalmakat nem tartalmaznak.**
- A menetidő a Valhalla becslésén (90 km/h csúcssebesség) alapul.

## Szerkezet

```
src/lib/tolls.ts      útdíj-szabályok és -tarifák (szerkeszthető)
src/lib/bans.ts       hétvégi/éjszakai tilalmak
src/lib/planner.ts    routing → élek → országok → díjak → költség → menetrend
src/lib/valhalla.ts   Valhalla kliens (VALHALLA_URL env)
src/lib/countries.ts  országhatár-felismerés (Natural Earth, offline)
src/app/api/*         route, geocode, restrictions
src/components/*      Planner, MapView (MapLibre GL), Results
```
