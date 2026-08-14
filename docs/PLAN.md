# Funktionsplan – Forensics Toolbox

**Status:** Beslut låsta för grundläggande MVP. Commit/push/CI väntar tills funktionerna nedan är byggda.

## Produktidé

1. **Verktygs-/query-läge** – tidskonvertering, SQL-mallar, länkar, referens  
2. **Bedömningsflöde** – statisk playbook som leder utredningen (hypotesstöd, inte automatisk slutsats)

Offline först. Externa verktyg = länkar + ev. “senaste release”-notis. SQL = granskade mallar med attribution.

---

## Låsta beslut

| # | Fråga | Beslut |
|---|--------|--------|
| 1 | iOS Photos / queries | **iOS 10 → senaste** (grupperade mallar där schema är likartat) |
| 2 | Playbook UI | **Statisk lista/guide** i första steget (ingen wizard ännu) |
| 3 | Android | **Hämta/anpassa queries från OSS** (ALEAPP m.fl.), med attribution + länk till källa. Så långt bakåt och framåt som projekten täcker. |
| 4 | Commit / GH Actions | **Vänta** tills grundfunktionerna nedan är på plats |
| 5 | Vendor releases | Visa **senaste kända release** för verktyg som Passware m.fl. (synlighet, inte inbäddad mjukvara) |
| — | UI-språk | Svenska i UI; SQL/kolumnnamn på engelska som i DB |

---

## A. Universal Time Converter

**Mål:** Ett indatafält → full matris av vanliga forensiska tidsformat + “detta liknar …”.

| In / ut | Format |
|---------|--------|
| Unix | s / ms / µs / ns |
| Apple | NSDate / Cocoa / Mac Absolute (epoch 2001-01-01) |
| WebKit / Chrome | µs sedan 1601-01-01 |
| Windows | FILETIME |
| Text | ISO 8601 |
| Visning | UTC + lokal |

Ersätter/utökar nuvarande Epoch Converter.

---

## B. Externa verktyg + “Latest release”

### B1. Länkar (hub)

ILEAPP, ALEAPP, Autopsy, Volatility 3, DB Browser for SQLite, ExifTool, m.fl. — namn + en mening om när man använder dem + bekräftelsedialog.

### B2. Vendor / verktygs-releases (synlighet)

Sektion eller badge-rad, t.ex.:

```text
Senast noterade releaser
  Passware …… 2026 R3   (uppdaterad 2026-08-01)
  ILEAPP ……… v1.x.x
  ALEAPP ……… v1.x.x
```

**Hur det underhålls (MVP):**

- Kuraterad JSON/YAML i repot, t.ex. `data/tool-releases.json`  
- Fält: `name`, `latest`, `url`, `notes`, `checkedAt`  
- **Ingen automatisk scraping i appen** (behåller offline-garanti; uppdateras manuellt eller via separat underhållsskript senare)

Kommersiella verktyg (Passware, etc.): endast publikt synlig release-info + länk till leverantör — ingen redistribution.

---

## C. Query-bibliotek

### C1. iOS Photos.sqlite (iOS 10 → latest)

Query-assistent:

1. Välj iOS-version (10 … latest) eller “visa närmaste mall”  
2. Välj mål: app/källa, tider, sök filnamn/UUID  
3. Valfria parametrar → genererad SQL + copy + caveat  

Mallar grupperas där schema är stabilt (t.ex. 10–12, 13–14, 15–16, 17–18+), med notis om avvikelser.

### C2. iOS kamera / app-användning

KnowledgeC och relaterade artifacts — mallar + db-path-hints, kopplade till playbook-steg.

### C3. Android via OSS (ALEAPP m.fl.)

- **Källa:** publika parsers/SQL/logik i [ALEAPP](https://github.com/abrignoni/ALEAPP) (och liknande), anpassade till våra mallar  
- **Attribution** per mall: projekt, fil/modul, licens  
- Täckning: så långt bakåt/framåt som upstream ger; dokumentera luckor  
- Vi kopierar **inte** hela ALEAPP in i appen — bara relevanta query-/path-snippets + länk “öppna i ALEAPP”

Samma UI-mönster som iOS: version/API-nivå där det spelar roll → SQL/path → copy.

### Datamodell

```text
queries/
  ios/photos-sqlite/   # metadata + sql per versionsband
  ios/knowledgec/
  android/             # adapted from ALEAPP etc., with source refs
data/
  tool-releases.json   # Passware, ILEAPP, ALEAPP, …
```

Varje mall: `id`, `title`, `os`, `versionRange`, `dbPathHint`, `sql`, `notes`, `caveats`, `source` (URL/projekt).

---

## D. Playbook (statisk) – “Bildfil – härkomst”

Kort checklista (ingen mål-/begränsningstext). Användaren kan redan forensik.

1. Filen: EXIF, tider, sökväg (app?)  
2. Kameraloggar: Photos.sqlite / MediaStore `external.db` → iOS Queries / Android Queries  
3. Var appen aktiv? KnowledgeC, Biome (iOS 15+), interactionC; Android usagestats → Android Queries  
4. Positionsinformation — jämför flera oberoende källor  
5. Andra faktorer (chatt, moln, AirDrop, skärmdump, hash, …)

---

## E. Nästa bedömningsflöden (plan — inte byggt)

Samma ton: korta steg, paths, länkar till queries när de finns. Inga mål/begränsningar.

| Flöde | När | Kärnsteg (utkast) |
|-------|-----|-------------------|
| **Okänd app** | Sideload, APK/IPA, “vad gör den här appen?” | Identitet (paket/bundle, signerare, version) → behörigheter → privat lagring + WAL → nätverk/konton → residual (KnowledgeC/usagestats, notiser, foton appen skapat) |
| **Krypto / plånbok** | Misstanke om krypto, seed, exchange | App/plånbok på enheten → seed/QR/address i foton, anteckningar, clipboard → webbläsarhistorik/exchange → hash/CyberChef på strängar → kedja mot block explorer (OSINT-länk, inte inbäddat) |
| **Position vid tid T** | Utvidgning av steg 4 i bildflödet | EXIF/DB-GPS → Significant Locations / GMS → cell/Wi-Fi → Maps-appar → jämför oberoende källor mot samma tidsfönster |
| **Chattbilaga vid tid T** | Mottagen vs skickad vs tagen | Tråd/meddelande-DB → bifogad filhash mot fotobibliotek → app aktiv (steg 3) → molnbackup |
| **Raderat material** | Saknad bild/fil | Trash/hidden-flaggor → WAL/SHM → unallocated/carve → moln/andra enheter |

**Först ut efter bildflödet:** Okänd app, därefter krypto. Position-vid-T kan återanvända steg 4. Chatt och radering väntar tills query-täckning finns.

---

## Byggordning (innan commit)

1. ~~docs/DEVELOPMENT.md~~ + denna plan  
2. ~~Universal Time Converter~~ (`tools/time-converter/`)  
3. ~~Hub: externa länkar + `tool-releases.json`-vy~~ (`data/tool-releases.json`, `documentation/tools-releases.html`)  
4. ~~Photos.sqlite query-UI + mallar iOS 10→latest~~ (`tools/photos-sqlite-queries/`, `queries/ios/photos-sqlite/`)  
5. ~~Android-queries (MediaStore / kamera / usage + ALEAPP-tips)~~ (`tools/android-queries/`, `queries/android/`)  
6. ~~Statisk playbook-sida~~ (`documentation/playbook-image-origin.html`)  
7. ~~Commit → push → multi-OS build via GH Actions~~ (Windows + Linux + macOS matrix)  

### Medvetet senare

- Interaktiv wizard med state  
- Inbyggd EXIF-parser  
- Auto-uppdatering av vendor-releases från nätet  
- “Fri” SQL-generering utan mall  

### Principer

- Caveat + versionsband på varje query  
- Hypotesstöd, inte bevisformulering  
- Attribution till Abrignoni/ALEAPP/ILEAPP och andra källor  
- Ingen bloating med dump-filer i repot
