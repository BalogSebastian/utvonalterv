# 🚛 Kamion útvonaltervező és útdíj-kalkulátor

Teljesen ingyenes, OpenStreetMap-alapú kamionos útvonaltervező és fuvarköltség-kalkulátor (Next.js).

## Mit tud?

- **Kamion-routing** – magasság, szélesség, hossz, össztömeg, tengelyterhelés, ADR alapján (Valhalla `truck`), autópálya-folyosó javítással.
- **Útdíj 2026-os hivatalos tarifákkal (nettó)** – élszintű díjköteles km országonként, jármű-kategória (tömeg / tengelyszám) és EURO-norma szerint. Hivatalos táblából: DE, AT, HU (J2–J5), SK, CZ, PL (+ A1/A2/A4 koncesszió), BG, CH, BE (régiónként), NL (2026.07-től), DK, IT, SE, LU, GB, LV, EE; díjpéldákból számolt átlag: FR, ES, PT, SI, HR, RS, MK, LT; becslés: RO (TollRo indulása bizonytalan), GR. A felület mutatja a becsült **útdíj-pontosságot** (a tarifák megbízhatóságával súlyozva).
- **Alagút-, híd- és szakaszdíjak** – Fréjus, Mont Blanc, Nagy Szent Bernát, Felbertauern, AT Sondermaut (A9/A10/A11/A12/A13/S16), Karavanke, Øresund, Storebælt, Liefkenshoek, Westerschelde, Herrentunnel, Warnow, Duna-hidak (RO–BG), Dartford, Humber.
- **No-Go zónák** – országok (pl. Svájc) és saját rajzolt területek (sokszög / kör). A publikus Valhalla legfeljebb 10 km kerületű kizáró poligont fogad el, ezért a nagy zónákat iteratívan kerüljük ki (a behatoló szakasz útjait kizárva újratervezünk); a végső útvonalat élszintű országadattal ellenőrizzük.
- **Svájc alapból kihagyva** – Svájc alapértelmezett No-Go zóna (a régi mentett beállításokba is bekerül, de kivehető). A határ menti pontok országát pontosan (geokódolóval) azonosítjuk, és a rövid határ menti behatolásokat a routing-szerver közigazgatási adataival ellenőrizzük, így pl. Konstanz vagy Basel környéke nem okoz téves „elkerülhetetlen” jelzést.
- **Feltételes határátkelők** – olyan átkelők, amelyek csak akkor használhatók, ha a fuvarnak van felrakása / lerakása az adott ország(ok)ban (felrakás vagy lerakás / csak felrakás / csak lerakás). Ha a feltétel nem teljesül, az átkelőt lezárjuk (kis kizáró poligon + szükség esetén iteratív kizárás), az eredményben látszik, melyiket használja / kerüli el. Az útpontoknál beállítható a rakodás típusa (alapból: indulás = felrakás, érkezés = lerakás, köztes = mindkettő). Közös céges lista: `BUILTIN_CROSSINGS` a `src/lib/crossings.ts`-ben; saját lista a felületen (térképes kijelölés, JSON export / import).
- **Sofőrnek küldés** – egy üzenet (WhatsApp, Viber, SMS, e-mail, rendszer-megosztás) Google Maps navigációs linkekkel: a link megnyitásakor azonnal indul a navigáció, a megállók mellett irányító pontokkal (határátkelők, kompok, köztes pontok), hogy a Google a kamionos útvonalon maradjon (linkenként max. 9 köztes pont, ezért hosszú útnál szakaszok). QR-kód, mobilos sofőr-oldal (`/sofor`) Waze / Apple Térkép gombokkal és GPX-szel OsmAnd-hoz (pontos nyomvonal-követés).
- **Komp / vasút** – 35 járat katalógusa (Dover–Calais, Eurotunnel, Hoek–Harwich, Rotterdam–Hull, IJmuiden–Newcastle, Scandlines, TT-Line, Stena, Adria, GNV, RoLa Wörgl–Brenner / Trento…) menetidővel, beszállással, fekhellyel és árral; a saját szerződéses ár / menetidő járatonként felülírható. A routing által választott kompot a katalógusból árazzuk.
- **Google Maps-szerű húzás** – az útvonal megfogható, húzás közben élő előnézet; köztes pontok húzhatók, dupla kattintással törölhetők.
- **Menetrend és ETA (EU 561/2006)** – 4,5 óránként 45 perc, napi 9 (hetente 2× 10) óra vezetés, 11 (hetente 3× 9) órás pihenő, a komp fekhellyel napi pihenőnek számít (9. cikk); a hétvégi / ünnepnapi / nyári **tilalmak kivárása** beépül az érkezési időbe (ünnepnapok országonként, húsvét-alapúak is; helyi időzóna).
- **Ideális pihenők** – a szünetek és pihenők egy kattintással a határidő előtti legközelebbi valós kamionparkolóhoz / pihenőhöz illeszthetők (OSM).
- **Teljes fuvarköltség** – útdíj + komp + üzemanyag + sofőr (óradíj + napidíj) + jármű (km-költség + napi amortizáció / biztosítás), ajánlati ár árréssel.
- **Flotta** – több jármű profilként menthető, egy alapértelmezettként töltődik be; a No-Go zónák, kompárak és költségek is megmaradnak.
- **Több egyidejű felhasználó** – a szerver sorba állítja a routing-kéréseket (`VALHALLA_CONCURRENCY`), memóriacache-t és kérés-összevonást használ, hiba esetén újrapróbál / másik szerverre vált (`VALHALLA_URLS`).
- Tiltás- és parkoló-réteg (Overpass), jobb klikk menü, megosztható link, GPX / CSV export, nyomtatás.

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

Saját szerveren a No-Go zónák pontosabbak: emeld meg a `service_limits.max_exclude_polygons_length` értéket a `valhalla.json`-ban (pl. 10000000), és állítsd be `VALHALLA_MAX_EXCLUDE_KM=10000`-re – ilyenkor a zónákat a szerver natívan zárja ki. Több szerver: `VALHALLA_URLS=http://a:8002,http://b:8002`.

A `docker-compose.yml` a teljes európai Geofabrik-kivonatot tölti le (nagy: kisebb régióhoz módosítsd a `tile_urls`-t). **A compose-fájl nincs végigtesztelve** – a Valhalla Docker-dokumentációját is nézd meg. A Valhalla alapértelmezett `trace_attributes` limitje 200 km, ezért saját szerverhez állítsd be: `TRACE_CHUNK_KM=150` (az app ennyi km-es darabokban kéri le az útdíjhoz szükséges éleket).

## ⚠️ Fontos: az adatok pontossága

- Az útdíjak **nettó** (ÁFA nélküli) összegek. A tarifák forrása és érvényessége tételenként a felületen látható (`asOf`), és a `src/lib/tolls.ts` / `src/lib/specials.ts` fájlokban egy helyen frissíthetők. Devizás tarifák átváltása: `FX` a `tolls.ts`-ben (a forint a felhasználói beállításból).
- Kapus rendszerekben (FR, IT, ES, PT, HR, RS) a díj hivatalos díjpéldákból számolt km-átlag – egy-egy szakaszon a valós díj eltérhet.
- A díjköteles úthálózatot az OSM `road_class` / `toll=yes` adatokból azonosítjuk.
- A komp-árak többsége szerződéses / dinamikus; a katalógusban jelölve, mi hivatalos díjtábla és mi becslés – a saját árat érdemes beírni.
- A tilalmak országos szabályok + nemzeti ünnepek; regionális ünnepek, helyi és évente kihirdetett extra napok (pl. FR „samedis rouges”) nincsenek benne.

## Szerkezet

```
src/lib/tolls.ts      útdíj-szabályok és -tarifák (szerkeszthető)
src/lib/specials.ts   alagút-, híd- és szakaszdíjak
src/lib/ferries.ts    komp- és vasúti járatok katalógusa
src/lib/zones.ts      No-Go zónák (ország / saját terület), elkerülés
src/lib/crossings.ts  feltételes határátkelők (közös lista + szabályok)
src/lib/navlinks.ts   sofőr-navigáció: Google Maps / Waze linkek, GPX, sofőr-oldal
src/lib/wpcountry.ts  útpontok pontos országa (határ mentén geokódolóval)
src/lib/schedule.ts   menetrend-szimuláció (561/2006, tilalmak, komp), költségek
src/lib/bans.ts       hétvégi/ünnepnapi/nyári/éjszakai tilalmak, ünnepnapok
src/lib/planner.ts    routing → élek → országok → díjak → költség → menetrend
src/lib/valhalla.ts   Valhalla kliens (VALHALLA_URL env)
src/lib/countries.ts  országhatár-felismerés (Natural Earth, offline)
src/app/api/*         route, preview, zones, parkings, geocode, restrictions
src/components/*      Planner, MapView (MapLibre GL), Results
```
