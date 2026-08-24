# Forensics Toolbox

Lokal verktygslåda för **IT-forensik**. Körs helt offline som Electron-app (ladda ner en release, eller `npm start` under utveckling).

Forkad och omarbetad från [AdrianNeshad/CryptoToolbox](https://github.com/AdrianNeshad/CryptoToolbox) (Verktygslådan).

## Verktyg (v0.8)

| Verktyg | Beskrivning |
|---------|-------------|
| Time Converter | Unix, Apple Cocoa/NSDate, WebKit/Chrome, FILETIME, ISO — full matris + tolkningsjämförelse |
| Hash Calculator | MD5 / SHA-1 / SHA-256 (fler algoritmer valbara) |
| Magic Text | Gissar format (JSON, protobuf, plist, JWT, …) + egna flikar när du redan vet |
| QR Code Decoder | Avkoda QR från bild |
| CyberChef | Offline encoding / decoding / crypto |
| Queries | iOS/Android — Photos.sqlite, knowledgeC, MediaStore, tidsspann |
| Externa verktyg | Sökbar katalog med runda länkar (iLEAPP, Autopsy, start.me, …) |
| Playbook: Bildfil härkomst | Kort checklista: EXIF, kamera, app, position |
| Vanliga artifacts | Referens för Windows / browser / Linux |
| Verktyg & releaser | Kuraterad lista (iLEAPP, ALEAPP, Passware 2026 v3, …) |

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

Öppna inte `Toolbox.html` direkt i webbläsaren om sidan ser ostylad ut — vissa webbläsare blockerar lokala filer via `file://`. Appen är tänkt att köras via Electron (`npm start` eller en nedladdad release). JSON-sidor (t.ex. Verktyg & releaser) har en `.js`-fallback så de fungerar även när `fetch()` av `.json` blockeras.

Paketerad Linux-build (AppImage + uppackad mapp):

```bash
npm run dist:linux
# AppImage: release/ForensicsToolbox-0.8.AppImage
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
npm run dist          # NSIS-installer + portable .exe → release/
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

- `ForensicsToolbox-0.8.exe` — portabel Windows
- `ForensicsToolbox-0.8-html.zip` — packa upp och öppna `Toolbox.html` (ingen .exe)

| Mål | Kommando | Output |
|-----|----------|--------|
| Testa nu (Linux) | `npm start` | Electron live |
| Linux AppImage | `npm run dist:linux` | `release/*.AppImage` |
| macOS | `npm run dist:mac` | `release/*.dmg` / `.zip` |
| Windows .exe | `npm run dist` (på Windows/CI) | `release/*.exe` |
## Lägga till ett verktyg

1. Skapa `tools/<namn>/` med HTML/JS/CSS
2. Lägg till en knapp i `Toolbox.html` med `data-type="frame"` och `data-src="tools/<namn>/..."`
3. Lyssna på tema via `postMessage` (`source: 'forensics-toolbox'`)

## Attribution

- App-shell och många UI-mönster: [CryptoToolbox](https://github.com/AdrianNeshad/CryptoToolbox) av Adrian Neshad
- CyberChef: [GCHQ/CyberChef](https://github.com/gchq/CyberChef)
