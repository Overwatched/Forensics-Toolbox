# Utveckling & bygg (Forensics Toolbox)

Lokal offline-verktygslåda för IT-forensik (Electron). Baserad på [CryptoToolbox](https://github.com/AdrianNeshad/CryptoToolbox).

## Förutsättningar

- **Node.js 20+** och npm  
  På Bazzite/Fedora: `brew install node`
- **unzip** (används av `postinstall` om Electron-binären saknas)
- Linux för lokal test; multi-OS-bygg via GitHub Actions (Windows + Linux + macOS)

## Snabbstart (Linux – rekommenderas under utveckling)

```bash
cd ~/Documents/Forensics-Toolbox
npm install
npm start
```

`npm start` kör Electron med `ELECTRON_RUN_AS_NODE` avstängt (annars kan appen krascha i vissa miljöer, t.ex. Cursor).

Öppna inte `Toolbox.html` direkt i Firefox/Chrome/Brave — `file://` blockerar ofta `src/style.css` och sidan ser ostylad ut. Appen är tänkt att köras via Electron (dev: `npm start`, användare: GitHub Releases).

### Om Electron klagar på saknad binär

```text
Error: Electron failed to install correctly...
```

Orsak: zip laddades ner men packades inte upp (förekommer med nyare Node, t.ex. v26).

```bash
npm run postinstall   # scripts/ensure-electron.js → unzip till node_modules/electron/dist
npm start
```

GPU/VSync-varningar i terminalen på Linux är oftast ofarliga.

## npm-skript

| Kommando | Syfte |
|----------|--------|
| `npm install` | Beroenden + `postinstall` (säkerställ Electron-binär) |
| `npm start` | Kör appen live (Linux-test) |
| `npm run postinstall` | Packa upp/ladda Electron-binär vid behov |
| `npm run pack:linux` | Snabb Linux-dir under `release/` |
| `npm run dist:linux` | Linux AppImage (+ dir) → `release/` |
| `npm run dist` / `dist:win` | Windows NSIS + portable `.exe` (kör på **Windows** eller CI) |
| `npm run dist:portable` | Endast portable `.exe` |
| `npm run dist:installer` | Endast NSIS-installer |
| `npm run sync-version` | Synkar version från `Toolbox.html` → `package.json` |

## Windows-build (målplattform)

Cross-build från en enda maskin är opålitligt. Använd:

1. **GitHub Actions** – `.github/workflows/build-release.yml` bygger **Windows + Linux + macOS** parallellt (matrix) vid push till `main` (ignorerar rena `.md`-ändringar), eller  
2. Lokalt: `npm run dist` (Windows), `npm run dist:linux`, `npm run dist:mac`

Artifacts (efter finalize / CI):

- `ForensicsToolbox-X.Y.exe` (portable)
- `ForensicsToolbox-X.Y-Installer.exe`

Versionen läses från texten `Version X.Y` i `Toolbox.html`.

## Projektstruktur

```text
Toolbox.html          # Hub / sidopanel
electron/main.js      # Electron-shell
src/                  # Delad UI (tema, navigation)
tools/_shared/        # Delat verktygs-skal (toolkit.js: temahantering)
tools/<namn>/         # Ett verktyg per mapp (HTML/JS/CSS)
documentation/        # Referens / guider i iframe
scripts/              # sync-version, ensure-electron, finalize-artifacts
```

### Lägga till ett verktyg

1. Skapa `tools/<namn>/` med HTML (+ ev. JS/CSS)
2. Ladda det delade skalet i `<head>` före verktygets `style.css`: `<script src="../_shared/toolkit.js"></script>`. Det sätter temat (från förälderns `?theme=`/`postMessage`) innan sidan målas — duplicera inte tema-koden per verktyg. Lyssnar verktyget på andra meddelanden (t.ex. `select-db`) behåller det sin egen lyssnare för just dem.
3. Lägg till knapp i `Toolbox.html`: `data-type="frame"` och `data-src="tools/<namn>/..."`

## Tester

- `npm test` letar upp alla `tools/**/*.test.js` via `scripts/run-tests.js` och kör dem
  med Nodes inbyggda testkörare (inga beroenden). Filerna skickas som explicita
  argument, eftersom `node --test` tolkar glob-mönster och kataloger olika i olika
  Node-versioner
- CI kör samma kommando i ett eget jobb **innan** bygget, så en trasig avkodning
  eller hashimplementation aldrig når en release
- `tools/hash-calculator/hashing.test.js` jämför de rena JS-implementationerna mot
  Nodes `crypto` för längder runt varje blockgräns, och verifierar att resultatet
  är oberoende av hur indata delas upp i bitar

## Versionering

- Visa version i hubben: `Version 1.1` i `Toolbox.html`
- `sync-version` sätter `package.json` till `1.1.0` (semver för electron-builder)
- Höj versionen i `Toolbox.html` innan release/push om du vill ha ny GitHub Release-tagg
- `npm run pack-html` skapar `release/ForensicsToolbox-X.Y-html.zip` (Toolbox.html utan exe)

## Kända begränsningar

- Offline för lokala verktyg; externa länkar/nedladdningar kräver nät och bekräftelsedialog
- Windows-signing är avstängd (`signAndEditExecutable: false`)
- `npm audit`-varningar i Electron-kedjan är vanliga; åtgärda inte med `audit fix --force` utan översikt
