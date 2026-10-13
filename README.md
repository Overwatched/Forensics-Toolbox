# Forensics Toolbox

Lokal verktygslåda för **IT-forensik**. Körs helt offline som Electron-app (ladda ner en release, eller `npm start` under utveckling).

Forkad och omarbetad från [AdrianNeshad/CryptoToolbox](https://github.com/AdrianNeshad/CryptoToolbox) (Verktygslådan).

## Verktyg (v1.7)

| Verktyg | Beskrivning |
|---------|-------------|
| App-ID | Sök appnamn — Android-paket och iOS bundle-id, med butikslänk. Omvänd uppslagning: klistra in id:n och få appnamn |
| EXIF & karta | Metadata för en hel mapp med ExifTool (WebAssembly, offline). Tid med tidszon, enhet, programvara, GPS, flaggor, filnamnsmönster. Karta med rutt, turer, tidsfilter och export. Läser bara |
| Positioner | Karta och rutt från GPX, KML, CSV, GeoJSON, Google-tidslinje, inklistrade koordinater och positioner från EXIF & karta |
| Time Converter | Unix, Apple Cocoa/NSDate, WebKit/Chrome, FILETIME, ISO — full matris + tolkningsjämförelse |
| iOS Keychain | Krypterad iPhone-/iPad-backup — konton, lösenord, tokens och certifikat |
| Hash Calculator | MD5 / SHA-1 / SHA-256 (fler algoritmer valbara), drag-and-drop, stora filer läses i bitar, jämför mot känd hash |
| Filjämförelse | Två textfiler eller inklistrade texter, rad för rad. Binärt innehåll jämförs med SHA-256 |
| Magic Text | Gissar format (JSON, protobuf, plist, JWT, …) + egna flikar när du redan vet |
| QR Code Decoder | Avkoda QR från bild |
| CyberChef | Offline encoding / decoding / crypto |
| Queries | iOS/Android — Photos.sqlite (app, kamera, position, skärmdumpar, redigeringar, Delat med dig, personer, album), knowledgeC, MediaStore, tidsspann |
| Externa verktyg | Sökbar katalog med runda länkar (iLEAPP, Crypto Toolbox, Autopsy, …) |
| Playbook: Bildfil härkomst | Kort checklista: EXIF, kamera, app, position |
| Playbook: Okänd app | Paket/bundle, behörigheter, privat lagring, residual |
| Playbook: Krypto / plånbok | Var på enheten det ligger — seed och plånboksfiler i Crypto Toolbox |
| Vanliga artifacts | Referens för Windows / browser / Linux |

## Dokumentation

- [Utveckling & bygg](docs/DEVELOPMENT.md) – `npm start`, Linux/Windows-build, Electron-felsökning  
- [Funktionsplan](docs/PLAN.md) – tidskonvertering, queries, bedömningsflöden (innan commit)

## Kom igång

Node.js 20+ (inkl. npm). På den här maskinen (Bazzite) fungerar t.ex.:

```bash
brew install node
```

## Köra / testa (Linux)

Snabbast — ingen paketering:

```bash
npm install
npm start          # Electron-fönster (rekommenderas för test)
```

Öppna inte `Toolbox.html` direkt i webbläsaren om sidan ser ostylad ut — vissa webbläsare blockerar lokala filer via `file://`. Appen är tänkt att köras via Electron (`npm start` eller en nedladdad release). Query-katalogerna har en `.js`-fallback så de fungerar även när `fetch()` av `.json` blockeras.

Paketerad Linux-build (AppImage + uppackad mapp):

```bash
npm run dist:linux
# AppImage: release/ForensicsToolbox-1.7.0.AppImage
# Uppackad:  release/linux-unpacked/  → kör ./forensics-toolbox
```

Snabb “dir”-pack utan installer:

```bash
npm run pack:linux
```

## Bygga för Windows

**Lokal Windows-maskin** (eller CI):

```bash
npm install
npm run fetch-maps    # offlinekartor till maps/ (1,3 GB, en gång)
npm run dist          # NSIS-installer + portabel zip → release/
# eller
npm run dist:portable
npm run dist:installer
```

**macOS (lokalt):**

```bash
npm run dist:mac      # osignerat DMG + ZIP
```

**CI (rekommenderas):** GitHub Actions bygger **Windows + Linux + macOS** parallellt via matrix
(`.github/workflows/build-release.yml`) vid push till `main`.

Release-filer (GitHub Releases):

- `ForensicsToolbox-1.7-Installer.exe` — Windows-installer
- `ForensicsToolbox-1.7-Portable.zip` — portabel Windows (packa upp, kör `Forensics Toolbox.exe`)
- `ForensicsToolbox-1.7.0.AppImage`, `ForensicsToolbox-1.7.0-x64.dmg` / `-arm64.dmg` — Linux och macOS
- `ForensicsToolbox-1.7-html.zip` — packa upp och öppna `Toolbox.html` (ingen .exe, kartfilerna ingår inte)

Appen och de paketerade filerna är runt 1,5 GB, eftersom offlinekartorna ingår.

| Mål | Kommando | Output |
|-----|----------|--------|
| Testa nu (Linux) | `npm start` | Electron live |
| Linux AppImage | `npm run dist:linux` | `release/*.AppImage` |
| macOS | `npm run dist:mac` | `release/*.dmg` / `.zip` |
| Windows | `npm run dist` (på Windows/CI) | `release/*.exe`, `release/*-Portable.zip` |
## Lägga till ett verktyg

1. Skapa `tools/<namn>/` med HTML/JS/CSS
2. Ladda det delade skalet först i `<head>`: `<script src="../_shared/toolkit.js"></script>` (före verktygets `style.css`). Det sköter temahanteringen — duplicera ingen tema-kod i verktyget.
3. Lägg till en knapp i `Toolbox.html` med `data-type="frame"` och `data-src="tools/<namn>/..."`

## Attribution

- App-shell och många UI-mönster: [CryptoToolbox](https://github.com/AdrianNeshad/CryptoToolbox) av Adrian Neshad
- CyberChef: [GCHQ/CyberChef](https://github.com/gchq/CyberChef)
- Kartor: © [OpenStreetMap](https://www.openstreetmap.org/copyright)-bidragsgivare (ODbL), [Protomaps](https://protomaps.com), [MapLibre GL](https://maplibre.org), onlinekarta från [OpenFreeMap](https://openfreemap.org). Licenser i `tools/exif-viewer/vendor/maps/LICENSES.txt`
