/* Genererad från photos-sqlite/catalog.json — används när fetch() blockeras (file://). */
window.PHOTOS_SQLITE_CATALOG = {
  "id": "photos-sqlite",
  "title": "iOS Queries",
  "dbPathHint": "Media/PhotoData/Photos.sqlite (+ -wal och -shm)",
  "paths": [
    "private/var/mobile/Media/PhotoData/Photos.sqlite",
    "private/var/mobile/Library/Photos/Libraries/Syndication.photoslibrary/database/Photos.sqlite"
  ],
  "timeNote": "Tiderna konverteras med datetime(..., 'unixepoch', 'localtime'). Kolumnnamnen är desamma som i databasen — döp om i SQL:en om du vill.",
  "source": "https://github.com/abrignoni/iLEAPP",
  "questions": [
    {
      "id": "full-story",
      "recommended": true,
      "label": "Standardquery för Photos.sqlite",
      "subtitle": "Hämtar allt viktigt om bilderna: tider, vilken app som skapade och redigerade dem, kamera, position och var de lagras. Lämna filnamn tomt för alla.",
      "params": [
        "filename"
      ],
      "group": "investigate"
    },
    {
      "id": "when-created",
      "label": "När skapades bildfilen?",
      "subtitle": "Visar när bilden skapades, när den lades till i biblioteket, tiden i EXIF och vilken tidszon som gällde",
      "params": [
        "filename"
      ],
      "group": "investigate"
    },
    {
      "id": "which-app",
      "label": "Vilken app skapade bildfilen?",
      "subtitle": "Appen som skapade eller importerade bilden, och appen som redigerade den",
      "params": [
        "filename"
      ],
      "group": "investigate"
    },
    {
      "id": "apps-summary",
      "label": "Vilka appar har lagt till bilder?",
      "subtitle": "Antal bilder per app. Klistra in bundle-id:na i App-ID → Omvänd uppslagning",
      "params": [],
      "group": "investigate"
    },
    {
      "id": "list-by-app",
      "label": "Lista bilder från en viss app",
      "subtitle": "Filtrera på skapar- eller redigeringsappens bundle-id",
      "params": [
        "bundleId"
      ],
      "group": "investigate"
    },
    {
      "id": "device",
      "label": "Vilken kamera eller enhet tog bilden?",
      "subtitle": "Märke, modell och objektiv från ZEXTENDEDATTRIBUTES",
      "params": [
        "filename"
      ],
      "group": "investigate"
    },
    {
      "id": "location",
      "label": "Var togs bilden?",
      "subtitle": "Latitud och longitud. -180 betyder att position saknas",
      "params": [
        "filename"
      ],
      "group": "investigate"
    },
    {
      "id": "location-window",
      "label": "Bilder med position i ett tidsspann",
      "subtitle": "Alla bilder med GPS-position som skapades inom tidsspannet",
      "params": [
        "timeStart",
        "timeEnd"
      ],
      "group": "investigate"
    },
    {
      "id": "screenshots",
      "label": "Skärmdumpar och skärminspelningar",
      "subtitle": "ZKINDSUBTYPE 10 (skärmdump) och 103 (skärminspelning) inom tidsspannet",
      "params": [
        "timeStart",
        "timeEnd"
      ],
      "group": "investigate",
      "onlyBands": [
        "ios14",
        "ios15-16",
        "ios17-plus"
      ]
    },
    {
      "id": "when-modified",
      "label": "När ändrades bildfilen senast?",
      "subtitle": "Visar när bilden senast ändrades och vilken app som ändrade den",
      "params": [
        "filename"
      ],
      "group": "investigate"
    },
    {
      "id": "edited",
      "label": "Redigerade bilder",
      "subtitle": "Bilder med en sparad redigering: när, i vilken app och med vilket format",
      "params": [],
      "group": "investigate"
    },
    {
      "id": "shared-with-you",
      "label": "Delat med dig (t.ex. Meddelanden)",
      "subtitle": "Bilder som tagits emot via Delat med dig, med mottagande app",
      "params": [],
      "group": "investigate",
      "onlyBands": [
        "ios15-16",
        "ios17-plus"
      ]
    },
    {
      "id": "hidden-trashed",
      "label": "Dolda och raderade bilder",
      "subtitle": "ZHIDDEN = 1 (album Dolda) eller ZTRASHEDSTATE = 1 (Nyligen raderade)",
      "params": [],
      "group": "investigate"
    },
    {
      "id": "people",
      "label": "Vilka personer finns på bilden?",
      "subtitle": "Namngivna personer och ansikten som Bilder-appen har hittat",
      "params": [
        "filename"
      ],
      "group": "investigate",
      "onlyBands": [
        "ios14",
        "ios15-16",
        "ios17-plus"
      ]
    },
    {
      "id": "by-person",
      "label": "Bilder där en viss person finns med",
      "subtitle": "Sök på namnet som personen har fått i Bilder-appen",
      "params": [
        "person"
      ],
      "group": "investigate",
      "onlyBands": [
        "ios14",
        "ios15-16",
        "ios17-plus"
      ]
    },
    {
      "id": "albums",
      "label": "Album i biblioteket",
      "subtitle": "Namngivna album med antal och skapad-tid",
      "params": [],
      "group": "investigate"
    },
    {
      "id": "where-stored",
      "label": "Var lagras bildfilen?",
      "subtitle": "Visar mappen och filnamnet på telefonen, och vad filen hette innan den importerades",
      "params": [
        "filename"
      ],
      "group": "investigate"
    },
    {
      "id": "cloud-hints",
      "label": "Molnrelaterade fält",
      "subtitle": "iCloud-status för bilden och dess original",
      "params": [
        "filename"
      ],
      "group": "investigate"
    },
    {
      "id": "schema-probe",
      "label": "Hjälp: lista tabellerna i databasen",
      "subtitle": "Söker inte efter bilder. Visar vilka Z-tabeller som finns, så att du kan se om en query passar den här iOS-versionen",
      "params": [],
      "group": "advanced"
    },
    {
      "id": "columns-asset",
      "label": "Hjälp: lista kolumnerna i bildtabellerna",
      "subtitle": "Söker inte efter bilder. Visar kolumnerna i bildtabellen (ZASSET, i iOS 10–13 ZGENERICASSET) och ZADDITIONALASSETATTRIBUTES, om en query klagar på att en kolumn saknas",
      "params": [],
      "group": "advanced"
    },
    {
      "id": "album-join-tables",
      "label": "Hjälp: hitta tabellen som kopplar bilder till album",
      "subtitle": "Numret i Z_nnASSETS skiljer mellan iOS-versioner. Kolumnerna visar hur tabellen ska kopplas",
      "params": [],
      "group": "advanced"
    },
    {
      "id": "full-story-alt-join",
      "label": "Standardquery med alternativ JOIN",
      "subtitle": "Kopplar via ZADDITIONALASSETATTRIBUTES.ZASSET om app-fälten blir tomma",
      "params": [
        "filename"
      ],
      "group": "advanced",
      "onlyBands": [
        "ios14",
        "ios15-16",
        "ios17-plus"
      ]
    },
    {
      "id": "role-file",
      "hidden": true,
      "role": "file",
      "label": "Härkomst: filens rad",
      "subtitle": "Används av Härkomst. Raden för ett exakt filnamn (ZFILENAME eller ZORIGINALFILENAME) med råa Cocoa-tider.",
      "params": [
        "filename"
      ],
      "epoch": "cocoa"
    },
    {
      "id": "role-neighbours",
      "hidden": true,
      "role": "neighbours",
      "label": "Härkomst: bilder i tidsfönstret",
      "subtitle": "Används av Härkomst. Bilder vars ZDATECREATED ligger i tidsfönstret, med råa Cocoa-tider.",
      "params": [
        "timeStart",
        "timeEnd"
      ],
      "epoch": "cocoa"
    },
    {
      "id": "role-sequence",
      "hidden": true,
      "role": "sequence",
      "label": "Härkomst: grannarna i nummerordning",
      "subtitle": "Används av Härkomst. Bilderna med filnumret före och efter, oavsett filändelse.",
      "params": [
        "prevStem",
        "nextStem"
      ],
      "epoch": "cocoa"
    }
  ],
  "bands": [
    {
      "id": "ios10-13",
      "ios": [
        10,
        13
      ],
      "label": "iOS 10–13",
      "versionMin": 10,
      "versionMax": 13,
      "notes": "Bildtabellen heter ZGENERICASSET. Kolumnerna är kontrollerade mot iLEAPP för iOS 11–13; iOS 10 är inte kontrollerat.",
      "queries": [
        {
          "id": "full-story",
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZTIMEZONENAME,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  a.ZTRASHEDSTATE,\n  a.ZHIDDEN,\n  a.ZFAVORITE,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  ext.ZCAMERAMAKE,\n  ext.ZCAMERAMODEL\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "when-created",
          "sql": "SELECT\n  a.ZFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZTIMEZONENAME,\n  aa.ZTIMEZONEOFFSET\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "which-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  a.ZSAVEDASSETTYPE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "apps-summary",
          "sql": "SELECT\n  aa.ZCREATORBUNDLEID,\n  COUNT(*) AS antal,\n  datetime(MIN(a.ZADDEDDATE) + 978307200, 'unixepoch', 'localtime') AS forst_tillagd,\n  datetime(MAX(a.ZADDEDDATE) + 978307200, 'unixepoch', 'localtime') AS senast_tillagd\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nGROUP BY aa.ZCREATORBUNDLEID\nORDER BY antal DESC;"
        },
        {
          "id": "list-by-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE IFNULL(aa.ZCREATORBUNDLEID, '') LIKE '%{{bundleId}}%'\n   OR IFNULL(aa.ZEDITORBUNDLEID, '') LIKE '%{{bundleId}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "device",
          "sql": "SELECT\n  a.ZFILENAME,\n  ext.ZCAMERAMAKE,\n  ext.ZCAMERAMODEL,\n  ext.ZLENSMODEL,\n  aa.ZCREATORBUNDLEID,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "location",
          "sql": "SELECT\n  a.ZFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  aa.ZTIMEZONENAME,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  ext.ZLATITUDE AS EXT_ZLATITUDE,\n  ext.ZLONGITUDE AS EXT_ZLONGITUDE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "location-window",
          "sql": "SELECT\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  a.ZFILENAME,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  aa.ZTIMEZONENAME,\n  aa.ZCREATORBUNDLEID\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZLATITUDE IS NOT NULL\n  AND a.ZLATITUDE != -180\n  AND a.ZDATECREATED BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "when-modified",
          "sql": "SELECT\n  a.ZFILENAME,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  aa.ZEDITORBUNDLEID\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZMODIFICATIONDATE DESC;"
        },
        {
          "id": "edited",
          "sql": "SELECT\n  datetime(u.ZADJUSTMENTTIMESTAMP + 978307200, 'unixepoch', 'localtime') AS ZADJUSTMENTTIMESTAMP,\n  a.ZFILENAME,\n  u.ZEDITORLOCALIZEDNAME,\n  u.ZADJUSTMENTFORMATIDENTIFIER,\n  aa.ZEDITORBUNDLEID,\n  aa.ZCREATORBUNDLEID\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZUNMANAGEDADJUSTMENT u ON u.Z_PK = aa.ZUNMANAGEDADJUSTMENT\nWHERE aa.ZUNMANAGEDADJUSTMENT > 0\nORDER BY u.ZADJUSTMENTTIMESTAMP DESC;"
        },
        {
          "id": "hidden-trashed",
          "sql": "SELECT\n  a.ZFILENAME,\n  a.ZHIDDEN,\n  a.ZTRASHEDSTATE,\n  datetime(a.ZTRASHEDDATE + 978307200, 'unixepoch', 'localtime') AS ZTRASHEDDATE,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  aa.ZCREATORBUNDLEID\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZHIDDEN = 1\n   OR a.ZTRASHEDSTATE = 1\nORDER BY a.ZTRASHEDDATE DESC;"
        },
        {
          "id": "albums",
          "sql": "SELECT\n  g.Z_PK,\n  g.ZTITLE,\n  g.ZKIND,\n  g.ZCACHEDCOUNT,\n  datetime(g.ZCREATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZCREATIONDATE,\n  g.ZTRASHEDSTATE\nFROM ZGENERICALBUM g\nWHERE g.ZTITLE IS NOT NULL\nORDER BY g.ZCREATIONDATE DESC;"
        },
        {
          "id": "where-stored",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  cm.ZORIGINALFILENAME AS CLOUD_ZORIGINALFILENAME\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZCLOUDMASTER cm ON cm.Z_PK = a.ZMASTER\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDIRECTORY, a.ZFILENAME;"
        },
        {
          "id": "cloud-hints",
          "sql": "SELECT\n  a.ZFILENAME,\n  a.ZSAVEDASSETTYPE,\n  cm.ZCLOUDLOCALSTATE AS CLOUD_ZCLOUDLOCALSTATE,\n  datetime(cm.ZIMPORTDATE + 978307200, 'unixepoch', 'localtime') AS CLOUD_ZIMPORTDATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZCLOUDMASTER cm ON cm.Z_PK = a.ZMASTER\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZFILENAME;"
        },
        {
          "id": "schema-probe",
          "sql": "SELECT name, type\nFROM sqlite_master\nWHERE type = 'table'\n  AND name LIKE 'Z%'\nORDER BY name;"
        },
        {
          "id": "columns-asset",
          "sql": "SELECT 'ZGENERICASSET' AS tabell, name, type\nFROM pragma_table_info('ZGENERICASSET')\nUNION ALL\nSELECT 'ZADDITIONALASSETATTRIBUTES', name, type\nFROM pragma_table_info('ZADDITIONALASSETATTRIBUTES');"
        },
        {
          "id": "album-join-tables",
          "sql": "SELECT m.name AS tabell, group_concat(p.name, ', ') AS kolumner\nFROM sqlite_master m, pragma_table_info(m.name) p\nWHERE m.type = 'table'\n  AND m.name GLOB 'Z_[0-9]*ASSETS'\nGROUP BY m.name\nORDER BY m.name;"
        },
        {
          "id": "role-file",
          "fields": {
            "pk": "Z_PK",
            "directory": "ZDIRECTORY",
            "filename": "ZFILENAME",
            "originalFilename": "ZORIGINALFILENAME",
            "created": "ZDATECREATED",
            "added": "ZADDEDDATE",
            "modified": "ZMODIFICATIONDATE",
            "exifTime": "ZEXIFTIMESTAMPSTRING",
            "zoneName": "ZTIMEZONENAME",
            "zoneOffset": "ZTIMEZONEOFFSET",
            "importedBy": "ZIMPORTEDBY",
            "importer": "ZCREATORBUNDLEID",
            "editor": "ZEDITORBUNDLEID",
            "savedAssetType": "ZSAVEDASSETTYPE",
            "trashed": "ZTRASHEDSTATE",
            "hidden": "ZHIDDEN",
            "latitude": "ZLATITUDE",
            "longitude": "ZLONGITUDE",
            "cameraMake": "ZCAMERAMAKE",
            "cameraModel": "ZCAMERAMODEL"
          },
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  a.ZDATECREATED,\n  a.ZADDEDDATE,\n  a.ZMODIFICATIONDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZTIMEZONENAME,\n  aa.ZTIMEZONEOFFSET,\n  aa.ZIMPORTEDBY,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  a.ZSAVEDASSETTYPE,\n  a.ZTRASHEDSTATE,\n  a.ZHIDDEN,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  ext.ZCAMERAMAKE,\n  ext.ZCAMERAMODEL\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME = '{{filename}}'\n   OR aa.ZORIGINALFILENAME = '{{filename}}'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "role-neighbours",
          "fields": {
            "pk": "Z_PK",
            "directory": "ZDIRECTORY",
            "filename": "ZFILENAME",
            "created": "ZDATECREATED",
            "added": "ZADDEDDATE",
            "importedBy": "ZIMPORTEDBY",
            "importer": "ZCREATORBUNDLEID",
            "trashed": "ZTRASHEDSTATE"
          },
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  a.ZDATECREATED,\n  a.ZADDEDDATE,\n  aa.ZIMPORTEDBY,\n  aa.ZCREATORBUNDLEID,\n  a.ZTRASHEDSTATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZDATECREATED BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY a.ZDATECREATED\nLIMIT 300;"
        },
        {
          "id": "role-sequence",
          "fields": {
            "pk": "Z_PK",
            "directory": "ZDIRECTORY",
            "filename": "ZFILENAME",
            "created": "ZDATECREATED",
            "added": "ZADDEDDATE",
            "importedBy": "ZIMPORTEDBY",
            "importer": "ZCREATORBUNDLEID",
            "trashed": "ZTRASHEDSTATE"
          },
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  a.ZDATECREATED,\n  a.ZADDEDDATE,\n  aa.ZIMPORTEDBY,\n  aa.ZCREATORBUNDLEID,\n  a.ZTRASHEDSTATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '{{prevStem}}.%'\n   OR a.ZFILENAME LIKE '{{nextStem}}.%'\nORDER BY a.ZFILENAME;"
        }
      ]
    },
    {
      "id": "ios14",
      "ios": [
        14,
        14
      ],
      "label": "iOS 14",
      "versionMin": 14,
      "versionMax": 14,
      "notes": "Bildtabellen heter ZASSET från iOS 14.",
      "queries": [
        {
          "id": "full-story",
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZTIMEZONENAME,\n  aa.ZCREATORBUNDLEID,\n  aa.ZIMPORTEDBYDISPLAYNAME,\n  aa.ZEDITORBUNDLEID,\n  a.ZKIND,\n  a.ZKINDSUBTYPE,\n  a.ZTRASHEDSTATE,\n  a.ZHIDDEN,\n  a.ZFAVORITE,\n  a.ZUNIFORMTYPEIDENTIFIER,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  ext.ZCAMERAMAKE,\n  ext.ZCAMERAMODEL\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "when-created",
          "sql": "SELECT\n  a.ZFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZTIMEZONENAME,\n  aa.ZTIMEZONEOFFSET\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "which-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID,\n  aa.ZIMPORTEDBYDISPLAYNAME,\n  aa.ZEDITORBUNDLEID,\n  a.ZSAVEDASSETTYPE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "apps-summary",
          "sql": "SELECT\n  aa.ZCREATORBUNDLEID,\n  MAX(aa.ZIMPORTEDBYDISPLAYNAME) AS ZIMPORTEDBYDISPLAYNAME,\n  COUNT(*) AS antal,\n  datetime(MIN(a.ZADDEDDATE) + 978307200, 'unixepoch', 'localtime') AS forst_tillagd,\n  datetime(MAX(a.ZADDEDDATE) + 978307200, 'unixepoch', 'localtime') AS senast_tillagd\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nGROUP BY aa.ZCREATORBUNDLEID\nORDER BY antal DESC;"
        },
        {
          "id": "list-by-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE IFNULL(aa.ZCREATORBUNDLEID, '') LIKE '%{{bundleId}}%'\n   OR IFNULL(aa.ZEDITORBUNDLEID, '') LIKE '%{{bundleId}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "device",
          "sql": "SELECT\n  a.ZFILENAME,\n  ext.ZCAMERAMAKE,\n  ext.ZCAMERAMODEL,\n  ext.ZLENSMODEL,\n  aa.ZCREATORBUNDLEID,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "location",
          "sql": "SELECT\n  a.ZFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  aa.ZTIMEZONENAME,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  ext.ZLATITUDE AS EXT_ZLATITUDE,\n  ext.ZLONGITUDE AS EXT_ZLONGITUDE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "location-window",
          "sql": "SELECT\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  a.ZFILENAME,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  aa.ZTIMEZONENAME,\n  aa.ZCREATORBUNDLEID\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZLATITUDE IS NOT NULL\n  AND a.ZLATITUDE != -180\n  AND a.ZDATECREATED BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "screenshots",
          "sql": "SELECT\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  CASE a.ZKINDSUBTYPE WHEN 10 THEN 'Skärmdump' WHEN 103 THEN 'Skärminspelning' END AS typ,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZKINDSUBTYPE IN (10, 103)\n  AND a.ZDATECREATED BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "when-modified",
          "sql": "SELECT\n  a.ZFILENAME,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  aa.ZEDITORBUNDLEID\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZMODIFICATIONDATE DESC;"
        },
        {
          "id": "edited",
          "sql": "SELECT\n  datetime(u.ZADJUSTMENTTIMESTAMP + 978307200, 'unixepoch', 'localtime') AS ZADJUSTMENTTIMESTAMP,\n  a.ZFILENAME,\n  u.ZEDITORLOCALIZEDNAME,\n  u.ZADJUSTMENTFORMATIDENTIFIER,\n  aa.ZEDITORBUNDLEID,\n  aa.ZCREATORBUNDLEID\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZUNMANAGEDADJUSTMENT u ON u.Z_PK = aa.ZUNMANAGEDADJUSTMENT\nWHERE aa.ZUNMANAGEDADJUSTMENT > 0\nORDER BY u.ZADJUSTMENTTIMESTAMP DESC;"
        },
        {
          "id": "hidden-trashed",
          "sql": "SELECT\n  a.ZFILENAME,\n  a.ZHIDDEN,\n  a.ZTRASHEDSTATE,\n  datetime(a.ZTRASHEDDATE + 978307200, 'unixepoch', 'localtime') AS ZTRASHEDDATE,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  aa.ZCREATORBUNDLEID\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZHIDDEN = 1\n   OR a.ZTRASHEDSTATE = 1\nORDER BY a.ZTRASHEDDATE DESC;"
        },
        {
          "id": "people",
          "sql": "SELECT\n  a.ZFILENAME,\n  p.ZFULLNAME,\n  p.ZDISPLAYNAME,\n  f.ZMANUAL,\n  f.ZHIDDEN\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nINNER JOIN ZDETECTEDFACE f ON f.ZASSET = a.Z_PK\nLEFT JOIN ZPERSON p ON p.Z_PK = f.ZPERSON\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZFILENAME;"
        },
        {
          "id": "by-person",
          "sql": "SELECT\n  p.ZFULLNAME,\n  p.ZDISPLAYNAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  a.ZDIRECTORY,\n  a.ZFILENAME\nFROM ZASSET a\nINNER JOIN ZDETECTEDFACE f ON f.ZASSET = a.Z_PK\nINNER JOIN ZPERSON p ON p.Z_PK = f.ZPERSON\nWHERE IFNULL(p.ZFULLNAME, '') LIKE '%{{person}}%'\n   OR IFNULL(p.ZDISPLAYNAME, '') LIKE '%{{person}}%'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "albums",
          "sql": "SELECT\n  g.Z_PK,\n  g.ZTITLE,\n  g.ZKIND,\n  g.ZCACHEDCOUNT,\n  datetime(g.ZCREATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZCREATIONDATE,\n  g.ZTRASHEDSTATE\nFROM ZGENERICALBUM g\nWHERE g.ZTITLE IS NOT NULL\nORDER BY g.ZCREATIONDATE DESC;"
        },
        {
          "id": "where-stored",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  cm.ZORIGINALFILENAME AS CLOUD_ZORIGINALFILENAME\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZCLOUDMASTER cm ON cm.Z_PK = a.ZMASTER\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDIRECTORY, a.ZFILENAME;"
        },
        {
          "id": "cloud-hints",
          "sql": "SELECT\n  a.ZFILENAME,\n  a.ZCLOUDLOCALSTATE,\n  a.ZCLOUDASSETGUID,\n  a.ZSAVEDASSETTYPE,\n  cm.ZCLOUDLOCALSTATE AS CLOUD_ZCLOUDLOCALSTATE,\n  datetime(cm.ZIMPORTDATE + 978307200, 'unixepoch', 'localtime') AS CLOUD_ZIMPORTDATE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZCLOUDMASTER cm ON cm.Z_PK = a.ZMASTER\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZFILENAME;"
        },
        {
          "id": "schema-probe",
          "sql": "SELECT name, type\nFROM sqlite_master\nWHERE type = 'table'\n  AND name LIKE 'Z%'\nORDER BY name;"
        },
        {
          "id": "columns-asset",
          "sql": "SELECT 'ZASSET' AS tabell, name, type\nFROM pragma_table_info('ZASSET')\nUNION ALL\nSELECT 'ZADDITIONALASSETATTRIBUTES', name, type\nFROM pragma_table_info('ZADDITIONALASSETATTRIBUTES');"
        },
        {
          "id": "album-join-tables",
          "sql": "SELECT m.name AS tabell, group_concat(p.name, ', ') AS kolumner\nFROM sqlite_master m, pragma_table_info(m.name) p\nWHERE m.type = 'table'\n  AND m.name GLOB 'Z_[0-9]*ASSETS'\nGROUP BY m.name\nORDER BY m.name;"
        },
        {
          "id": "full-story-alt-join",
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZTIMEZONENAME,\n  aa.ZCREATORBUNDLEID,\n  aa.ZIMPORTEDBYDISPLAYNAME,\n  aa.ZEDITORBUNDLEID,\n  a.ZKIND,\n  a.ZKINDSUBTYPE,\n  a.ZTRASHEDSTATE,\n  a.ZHIDDEN,\n  a.ZFAVORITE,\n  a.ZUNIFORMTYPEIDENTIFIER,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  ext.ZCAMERAMAKE,\n  ext.ZCAMERAMODEL\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "role-file",
          "fields": {
            "pk": "Z_PK",
            "directory": "ZDIRECTORY",
            "filename": "ZFILENAME",
            "originalFilename": "ZORIGINALFILENAME",
            "created": "ZDATECREATED",
            "added": "ZADDEDDATE",
            "modified": "ZMODIFICATIONDATE",
            "exifTime": "ZEXIFTIMESTAMPSTRING",
            "zoneName": "ZTIMEZONENAME",
            "zoneOffset": "ZTIMEZONEOFFSET",
            "importedBy": "ZIMPORTEDBY",
            "importer": "ZCREATORBUNDLEID",
            "importerName": "ZIMPORTEDBYDISPLAYNAME",
            "kind": "ZKIND",
            "kindSubtype": "ZKINDSUBTYPE",
            "uti": "ZUNIFORMTYPEIDENTIFIER",
            "cloudLocalState": "ZCLOUDLOCALSTATE",
            "editor": "ZEDITORBUNDLEID",
            "savedAssetType": "ZSAVEDASSETTYPE",
            "trashed": "ZTRASHEDSTATE",
            "hidden": "ZHIDDEN",
            "latitude": "ZLATITUDE",
            "longitude": "ZLONGITUDE",
            "cameraMake": "ZCAMERAMAKE",
            "cameraModel": "ZCAMERAMODEL"
          },
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  a.ZDATECREATED,\n  a.ZADDEDDATE,\n  a.ZMODIFICATIONDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZTIMEZONENAME,\n  aa.ZTIMEZONEOFFSET,\n  aa.ZIMPORTEDBY,\n  aa.ZCREATORBUNDLEID,\n  aa.ZIMPORTEDBYDISPLAYNAME,\n  aa.ZEDITORBUNDLEID,\n  a.ZSAVEDASSETTYPE,\n  a.ZKIND,\n  a.ZKINDSUBTYPE,\n  a.ZUNIFORMTYPEIDENTIFIER,\n  a.ZCLOUDLOCALSTATE,\n  a.ZTRASHEDSTATE,\n  a.ZHIDDEN,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  ext.ZCAMERAMAKE,\n  ext.ZCAMERAMODEL\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME = '{{filename}}'\n   OR aa.ZORIGINALFILENAME = '{{filename}}'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "role-neighbours",
          "fields": {
            "pk": "Z_PK",
            "directory": "ZDIRECTORY",
            "filename": "ZFILENAME",
            "created": "ZDATECREATED",
            "added": "ZADDEDDATE",
            "importedBy": "ZIMPORTEDBY",
            "importer": "ZCREATORBUNDLEID",
            "kindSubtype": "ZKINDSUBTYPE",
            "trashed": "ZTRASHEDSTATE"
          },
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  a.ZDATECREATED,\n  a.ZADDEDDATE,\n  aa.ZIMPORTEDBY,\n  aa.ZCREATORBUNDLEID,\n  a.ZKINDSUBTYPE,\n  a.ZTRASHEDSTATE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZDATECREATED BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY a.ZDATECREATED\nLIMIT 300;"
        },
        {
          "id": "role-sequence",
          "fields": {
            "pk": "Z_PK",
            "directory": "ZDIRECTORY",
            "filename": "ZFILENAME",
            "created": "ZDATECREATED",
            "added": "ZADDEDDATE",
            "importedBy": "ZIMPORTEDBY",
            "importer": "ZCREATORBUNDLEID",
            "kindSubtype": "ZKINDSUBTYPE",
            "trashed": "ZTRASHEDSTATE"
          },
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  a.ZDATECREATED,\n  a.ZADDEDDATE,\n  aa.ZIMPORTEDBY,\n  aa.ZCREATORBUNDLEID,\n  a.ZKINDSUBTYPE,\n  a.ZTRASHEDSTATE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '{{prevStem}}.%'\n   OR a.ZFILENAME LIKE '{{nextStem}}.%'\nORDER BY a.ZFILENAME;"
        }
      ]
    },
    {
      "id": "ios15-16",
      "ios": [
        15,
        16
      ],
      "label": "iOS 15–16",
      "versionMin": 15,
      "versionMax": 16,
      "notes": "Skaparappen ligger i ZIMPORTEDBYBUNDLEIDENTIFIER från iOS 15 (hette ZCREATORBUNDLEID tidigare).",
      "queries": [
        {
          "id": "full-story",
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZTIMEZONENAME,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  aa.ZIMPORTEDBYDISPLAYNAME,\n  aa.ZEDITORBUNDLEID,\n  a.ZKIND,\n  a.ZKINDSUBTYPE,\n  a.ZTRASHEDSTATE,\n  a.ZHIDDEN,\n  a.ZFAVORITE,\n  a.ZUNIFORMTYPEIDENTIFIER,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  ext.ZCAMERAMAKE,\n  ext.ZCAMERAMODEL\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "when-created",
          "sql": "SELECT\n  a.ZFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZTIMEZONENAME,\n  aa.ZTIMEZONEOFFSET\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "which-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  aa.ZIMPORTEDBYDISPLAYNAME,\n  aa.ZEDITORBUNDLEID,\n  a.ZSAVEDASSETTYPE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "apps-summary",
          "sql": "SELECT\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  MAX(aa.ZIMPORTEDBYDISPLAYNAME) AS ZIMPORTEDBYDISPLAYNAME,\n  COUNT(*) AS antal,\n  datetime(MIN(a.ZADDEDDATE) + 978307200, 'unixepoch', 'localtime') AS forst_tillagd,\n  datetime(MAX(a.ZADDEDDATE) + 978307200, 'unixepoch', 'localtime') AS senast_tillagd\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nGROUP BY aa.ZIMPORTEDBYBUNDLEIDENTIFIER\nORDER BY antal DESC;"
        },
        {
          "id": "list-by-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  aa.ZEDITORBUNDLEID,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE IFNULL(aa.ZIMPORTEDBYBUNDLEIDENTIFIER, '') LIKE '%{{bundleId}}%'\n   OR IFNULL(aa.ZEDITORBUNDLEID, '') LIKE '%{{bundleId}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "device",
          "sql": "SELECT\n  a.ZFILENAME,\n  ext.ZCAMERAMAKE,\n  ext.ZCAMERAMODEL,\n  ext.ZLENSMODEL,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "location",
          "sql": "SELECT\n  a.ZFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  aa.ZTIMEZONENAME,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  ext.ZLATITUDE AS EXT_ZLATITUDE,\n  ext.ZLONGITUDE AS EXT_ZLONGITUDE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "location-window",
          "sql": "SELECT\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  a.ZFILENAME,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  aa.ZTIMEZONENAME,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZLATITUDE IS NOT NULL\n  AND a.ZLATITUDE != -180\n  AND a.ZDATECREATED BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "screenshots",
          "sql": "SELECT\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  CASE a.ZKINDSUBTYPE WHEN 10 THEN 'Skärmdump' WHEN 103 THEN 'Skärminspelning' END AS typ,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZKINDSUBTYPE IN (10, 103)\n  AND a.ZDATECREATED BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "when-modified",
          "sql": "SELECT\n  a.ZFILENAME,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  aa.ZEDITORBUNDLEID\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZMODIFICATIONDATE DESC;"
        },
        {
          "id": "edited",
          "sql": "SELECT\n  datetime(u.ZADJUSTMENTTIMESTAMP + 978307200, 'unixepoch', 'localtime') AS ZADJUSTMENTTIMESTAMP,\n  a.ZFILENAME,\n  u.ZEDITORLOCALIZEDNAME,\n  u.ZADJUSTMENTFORMATIDENTIFIER,\n  aa.ZEDITORBUNDLEID,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZUNMANAGEDADJUSTMENT u ON u.Z_PK = aa.ZUNMANAGEDADJUSTMENT\nWHERE aa.ZUNMANAGEDADJUSTMENT > 0\nORDER BY u.ZADJUSTMENTTIMESTAMP DESC;"
        },
        {
          "id": "shared-with-you",
          "sql": "SELECT\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  a.ZFILENAME,\n  a.ZSYNDICATIONSTATE,\n  aa.ZSYNDICATIONIDENTIFIER,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  aa.ZIMPORTEDBYDISPLAYNAME,\n  a.ZSAVEDASSETTYPE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE aa.ZSYNDICATIONIDENTIFIER IS NOT NULL\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "hidden-trashed",
          "sql": "SELECT\n  a.ZFILENAME,\n  a.ZHIDDEN,\n  a.ZTRASHEDSTATE,\n  datetime(a.ZTRASHEDDATE + 978307200, 'unixepoch', 'localtime') AS ZTRASHEDDATE,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZHIDDEN = 1\n   OR a.ZTRASHEDSTATE = 1\nORDER BY a.ZTRASHEDDATE DESC;"
        },
        {
          "id": "people",
          "sql": "SELECT\n  a.ZFILENAME,\n  p.ZFULLNAME,\n  p.ZDISPLAYNAME,\n  f.ZMANUAL,\n  f.ZHIDDEN\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nINNER JOIN ZDETECTEDFACE f ON f.ZASSET = a.Z_PK\nLEFT JOIN ZPERSON p ON p.Z_PK = f.ZPERSON\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZFILENAME;"
        },
        {
          "id": "by-person",
          "sql": "SELECT\n  p.ZFULLNAME,\n  p.ZDISPLAYNAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  a.ZDIRECTORY,\n  a.ZFILENAME\nFROM ZASSET a\nINNER JOIN ZDETECTEDFACE f ON f.ZASSET = a.Z_PK\nINNER JOIN ZPERSON p ON p.Z_PK = f.ZPERSON\nWHERE IFNULL(p.ZFULLNAME, '') LIKE '%{{person}}%'\n   OR IFNULL(p.ZDISPLAYNAME, '') LIKE '%{{person}}%'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "albums",
          "sql": "SELECT\n  g.Z_PK,\n  g.ZTITLE,\n  g.ZKIND,\n  g.ZCACHEDCOUNT,\n  datetime(g.ZCREATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZCREATIONDATE,\n  g.ZTRASHEDSTATE,\n  g.ZIMPORTEDBYBUNDLEIDENTIFIER\nFROM ZGENERICALBUM g\nWHERE g.ZTITLE IS NOT NULL\nORDER BY g.ZCREATIONDATE DESC;"
        },
        {
          "id": "where-stored",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  cm.ZORIGINALFILENAME AS CLOUD_ZORIGINALFILENAME\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZCLOUDMASTER cm ON cm.Z_PK = a.ZMASTER\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDIRECTORY, a.ZFILENAME;"
        },
        {
          "id": "cloud-hints",
          "sql": "SELECT\n  a.ZFILENAME,\n  a.ZCLOUDLOCALSTATE,\n  a.ZCLOUDASSETGUID,\n  a.ZSAVEDASSETTYPE,\n  cm.ZCLOUDLOCALSTATE AS CLOUD_ZCLOUDLOCALSTATE,\n  datetime(cm.ZIMPORTDATE + 978307200, 'unixepoch', 'localtime') AS CLOUD_ZIMPORTDATE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZCLOUDMASTER cm ON cm.Z_PK = a.ZMASTER\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZFILENAME;"
        },
        {
          "id": "schema-probe",
          "sql": "SELECT name, type\nFROM sqlite_master\nWHERE type = 'table'\n  AND name LIKE 'Z%'\nORDER BY name;"
        },
        {
          "id": "columns-asset",
          "sql": "SELECT 'ZASSET' AS tabell, name, type\nFROM pragma_table_info('ZASSET')\nUNION ALL\nSELECT 'ZADDITIONALASSETATTRIBUTES', name, type\nFROM pragma_table_info('ZADDITIONALASSETATTRIBUTES');"
        },
        {
          "id": "album-join-tables",
          "sql": "SELECT m.name AS tabell, group_concat(p.name, ', ') AS kolumner\nFROM sqlite_master m, pragma_table_info(m.name) p\nWHERE m.type = 'table'\n  AND m.name GLOB 'Z_[0-9]*ASSETS'\nGROUP BY m.name\nORDER BY m.name;"
        },
        {
          "id": "full-story-alt-join",
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZTIMEZONENAME,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  aa.ZIMPORTEDBYDISPLAYNAME,\n  aa.ZEDITORBUNDLEID,\n  a.ZKIND,\n  a.ZKINDSUBTYPE,\n  a.ZTRASHEDSTATE,\n  a.ZHIDDEN,\n  a.ZFAVORITE,\n  a.ZUNIFORMTYPEIDENTIFIER,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  ext.ZCAMERAMAKE,\n  ext.ZCAMERAMODEL\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "role-file",
          "fields": {
            "pk": "Z_PK",
            "directory": "ZDIRECTORY",
            "filename": "ZFILENAME",
            "originalFilename": "ZORIGINALFILENAME",
            "created": "ZDATECREATED",
            "added": "ZADDEDDATE",
            "modified": "ZMODIFICATIONDATE",
            "exifTime": "ZEXIFTIMESTAMPSTRING",
            "zoneName": "ZTIMEZONENAME",
            "zoneOffset": "ZTIMEZONEOFFSET",
            "importedBy": "ZIMPORTEDBY",
            "importer": "ZIMPORTEDBYBUNDLEIDENTIFIER",
            "importerName": "ZIMPORTEDBYDISPLAYNAME",
            "kind": "ZKIND",
            "kindSubtype": "ZKINDSUBTYPE",
            "uti": "ZUNIFORMTYPEIDENTIFIER",
            "cloudLocalState": "ZCLOUDLOCALSTATE",
            "editor": "ZEDITORBUNDLEID",
            "savedAssetType": "ZSAVEDASSETTYPE",
            "trashed": "ZTRASHEDSTATE",
            "hidden": "ZHIDDEN",
            "latitude": "ZLATITUDE",
            "longitude": "ZLONGITUDE",
            "cameraMake": "ZCAMERAMAKE",
            "cameraModel": "ZCAMERAMODEL"
          },
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  a.ZDATECREATED,\n  a.ZADDEDDATE,\n  a.ZMODIFICATIONDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZTIMEZONENAME,\n  aa.ZTIMEZONEOFFSET,\n  aa.ZIMPORTEDBY,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  aa.ZIMPORTEDBYDISPLAYNAME,\n  aa.ZEDITORBUNDLEID,\n  a.ZSAVEDASSETTYPE,\n  a.ZKIND,\n  a.ZKINDSUBTYPE,\n  a.ZUNIFORMTYPEIDENTIFIER,\n  a.ZCLOUDLOCALSTATE,\n  a.ZTRASHEDSTATE,\n  a.ZHIDDEN,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  ext.ZCAMERAMAKE,\n  ext.ZCAMERAMODEL\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME = '{{filename}}'\n   OR aa.ZORIGINALFILENAME = '{{filename}}'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "role-neighbours",
          "fields": {
            "pk": "Z_PK",
            "directory": "ZDIRECTORY",
            "filename": "ZFILENAME",
            "created": "ZDATECREATED",
            "added": "ZADDEDDATE",
            "importedBy": "ZIMPORTEDBY",
            "importer": "ZIMPORTEDBYBUNDLEIDENTIFIER",
            "kindSubtype": "ZKINDSUBTYPE",
            "trashed": "ZTRASHEDSTATE"
          },
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  a.ZDATECREATED,\n  a.ZADDEDDATE,\n  aa.ZIMPORTEDBY,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  a.ZKINDSUBTYPE,\n  a.ZTRASHEDSTATE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZDATECREATED BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY a.ZDATECREATED\nLIMIT 300;"
        },
        {
          "id": "role-sequence",
          "fields": {
            "pk": "Z_PK",
            "directory": "ZDIRECTORY",
            "filename": "ZFILENAME",
            "created": "ZDATECREATED",
            "added": "ZADDEDDATE",
            "importedBy": "ZIMPORTEDBY",
            "importer": "ZIMPORTEDBYBUNDLEIDENTIFIER",
            "kindSubtype": "ZKINDSUBTYPE",
            "trashed": "ZTRASHEDSTATE"
          },
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  a.ZDATECREATED,\n  a.ZADDEDDATE,\n  aa.ZIMPORTEDBY,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  a.ZKINDSUBTYPE,\n  a.ZTRASHEDSTATE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '{{prevStem}}.%'\n   OR a.ZFILENAME LIKE '{{nextStem}}.%'\nORDER BY a.ZFILENAME;"
        }
      ]
    },
    {
      "id": "ios17-plus",
      "ios": [
        17,
        99
      ],
      "label": "iOS 17 och senare",
      "versionMin": 17,
      "versionMax": 99,
      "notes": "Kontrollerat mot iLEAPP för iOS 17, 18 och 26.",
      "queries": [
        {
          "id": "full-story",
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZTIMEZONENAME,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  aa.ZIMPORTEDBYDISPLAYNAME,\n  aa.ZEDITORBUNDLEID,\n  a.ZKIND,\n  a.ZKINDSUBTYPE,\n  a.ZTRASHEDSTATE,\n  a.ZHIDDEN,\n  a.ZFAVORITE,\n  a.ZUNIFORMTYPEIDENTIFIER,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  ext.ZCAMERAMAKE,\n  ext.ZCAMERAMODEL\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "when-created",
          "sql": "SELECT\n  a.ZFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZTIMEZONENAME,\n  aa.ZTIMEZONEOFFSET\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "which-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  aa.ZIMPORTEDBYDISPLAYNAME,\n  aa.ZEDITORBUNDLEID,\n  a.ZSAVEDASSETTYPE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "apps-summary",
          "sql": "SELECT\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  MAX(aa.ZIMPORTEDBYDISPLAYNAME) AS ZIMPORTEDBYDISPLAYNAME,\n  COUNT(*) AS antal,\n  datetime(MIN(a.ZADDEDDATE) + 978307200, 'unixepoch', 'localtime') AS forst_tillagd,\n  datetime(MAX(a.ZADDEDDATE) + 978307200, 'unixepoch', 'localtime') AS senast_tillagd\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nGROUP BY aa.ZIMPORTEDBYBUNDLEIDENTIFIER\nORDER BY antal DESC;"
        },
        {
          "id": "list-by-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  aa.ZEDITORBUNDLEID,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE IFNULL(aa.ZIMPORTEDBYBUNDLEIDENTIFIER, '') LIKE '%{{bundleId}}%'\n   OR IFNULL(aa.ZEDITORBUNDLEID, '') LIKE '%{{bundleId}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "device",
          "sql": "SELECT\n  a.ZFILENAME,\n  ext.ZCAMERAMAKE,\n  ext.ZCAMERAMODEL,\n  ext.ZLENSMODEL,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "location",
          "sql": "SELECT\n  a.ZFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  aa.ZTIMEZONENAME,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  ext.ZLATITUDE AS EXT_ZLATITUDE,\n  ext.ZLONGITUDE AS EXT_ZLONGITUDE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "location-window",
          "sql": "SELECT\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  a.ZFILENAME,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  aa.ZTIMEZONENAME,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZLATITUDE IS NOT NULL\n  AND a.ZLATITUDE != -180\n  AND a.ZDATECREATED BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "screenshots",
          "sql": "SELECT\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  CASE a.ZKINDSUBTYPE WHEN 10 THEN 'Skärmdump' WHEN 103 THEN 'Skärminspelning' END AS typ,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZKINDSUBTYPE IN (10, 103)\n  AND a.ZDATECREATED BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "when-modified",
          "sql": "SELECT\n  a.ZFILENAME,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  aa.ZEDITORBUNDLEID\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZMODIFICATIONDATE DESC;"
        },
        {
          "id": "edited",
          "sql": "SELECT\n  datetime(u.ZADJUSTMENTTIMESTAMP + 978307200, 'unixepoch', 'localtime') AS ZADJUSTMENTTIMESTAMP,\n  a.ZFILENAME,\n  u.ZEDITORLOCALIZEDNAME,\n  u.ZADJUSTMENTFORMATIDENTIFIER,\n  aa.ZEDITORBUNDLEID,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZUNMANAGEDADJUSTMENT u ON u.Z_PK = aa.ZUNMANAGEDADJUSTMENT\nWHERE aa.ZUNMANAGEDADJUSTMENT > 0\nORDER BY u.ZADJUSTMENTTIMESTAMP DESC;"
        },
        {
          "id": "shared-with-you",
          "sql": "SELECT\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  a.ZFILENAME,\n  a.ZSYNDICATIONSTATE,\n  aa.ZSYNDICATIONIDENTIFIER,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  aa.ZIMPORTEDBYDISPLAYNAME,\n  a.ZSAVEDASSETTYPE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE aa.ZSYNDICATIONIDENTIFIER IS NOT NULL\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "hidden-trashed",
          "sql": "SELECT\n  a.ZFILENAME,\n  a.ZHIDDEN,\n  a.ZTRASHEDSTATE,\n  datetime(a.ZTRASHEDDATE + 978307200, 'unixepoch', 'localtime') AS ZTRASHEDDATE,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZHIDDEN = 1\n   OR a.ZTRASHEDSTATE = 1\nORDER BY a.ZTRASHEDDATE DESC;"
        },
        {
          "id": "people",
          "sql": "SELECT\n  a.ZFILENAME,\n  p.ZFULLNAME,\n  p.ZDISPLAYNAME,\n  f.ZMANUAL,\n  f.ZHIDDEN\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nINNER JOIN ZDETECTEDFACE f ON f.ZASSETFORFACE = a.Z_PK\nLEFT JOIN ZPERSON p ON p.Z_PK = f.ZPERSONFORFACE\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZFILENAME;"
        },
        {
          "id": "by-person",
          "sql": "SELECT\n  p.ZFULLNAME,\n  p.ZDISPLAYNAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  a.ZDIRECTORY,\n  a.ZFILENAME\nFROM ZASSET a\nINNER JOIN ZDETECTEDFACE f ON f.ZASSETFORFACE = a.Z_PK\nINNER JOIN ZPERSON p ON p.Z_PK = f.ZPERSONFORFACE\nWHERE IFNULL(p.ZFULLNAME, '') LIKE '%{{person}}%'\n   OR IFNULL(p.ZDISPLAYNAME, '') LIKE '%{{person}}%'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "albums",
          "sql": "SELECT\n  g.Z_PK,\n  g.ZTITLE,\n  g.ZKIND,\n  g.ZCACHEDCOUNT,\n  datetime(g.ZCREATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZCREATIONDATE,\n  g.ZTRASHEDSTATE,\n  g.ZIMPORTEDBYBUNDLEIDENTIFIER\nFROM ZGENERICALBUM g\nWHERE g.ZTITLE IS NOT NULL\nORDER BY g.ZCREATIONDATE DESC;"
        },
        {
          "id": "where-stored",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  cm.ZORIGINALFILENAME AS CLOUD_ZORIGINALFILENAME\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZCLOUDMASTER cm ON cm.Z_PK = a.ZMASTER\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZDIRECTORY, a.ZFILENAME;"
        },
        {
          "id": "cloud-hints",
          "sql": "SELECT\n  a.ZFILENAME,\n  a.ZCLOUDLOCALSTATE,\n  a.ZCLOUDASSETGUID,\n  a.ZSAVEDASSETTYPE,\n  cm.ZCLOUDLOCALSTATE AS CLOUD_ZCLOUDLOCALSTATE,\n  datetime(cm.ZIMPORTDATE + 978307200, 'unixepoch', 'localtime') AS CLOUD_ZIMPORTDATE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZCLOUDMASTER cm ON cm.Z_PK = a.ZMASTER\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZFILENAME;"
        },
        {
          "id": "schema-probe",
          "sql": "SELECT name, type\nFROM sqlite_master\nWHERE type = 'table'\n  AND name LIKE 'Z%'\nORDER BY name;"
        },
        {
          "id": "columns-asset",
          "sql": "SELECT 'ZASSET' AS tabell, name, type\nFROM pragma_table_info('ZASSET')\nUNION ALL\nSELECT 'ZADDITIONALASSETATTRIBUTES', name, type\nFROM pragma_table_info('ZADDITIONALASSETATTRIBUTES');"
        },
        {
          "id": "album-join-tables",
          "sql": "SELECT m.name AS tabell, group_concat(p.name, ', ') AS kolumner\nFROM sqlite_master m, pragma_table_info(m.name) p\nWHERE m.type = 'table'\n  AND m.name GLOB 'Z_[0-9]*ASSETS'\nGROUP BY m.name\nORDER BY m.name;"
        },
        {
          "id": "full-story-alt-join",
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZTIMEZONENAME,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  aa.ZIMPORTEDBYDISPLAYNAME,\n  aa.ZEDITORBUNDLEID,\n  a.ZKIND,\n  a.ZKINDSUBTYPE,\n  a.ZTRASHEDSTATE,\n  a.ZHIDDEN,\n  a.ZFAVORITE,\n  a.ZUNIFORMTYPEIDENTIFIER,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  ext.ZCAMERAMAKE,\n  ext.ZCAMERAMODEL\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "role-file",
          "fields": {
            "pk": "Z_PK",
            "directory": "ZDIRECTORY",
            "filename": "ZFILENAME",
            "originalFilename": "ZORIGINALFILENAME",
            "created": "ZDATECREATED",
            "added": "ZADDEDDATE",
            "modified": "ZMODIFICATIONDATE",
            "exifTime": "ZEXIFTIMESTAMPSTRING",
            "zoneName": "ZTIMEZONENAME",
            "zoneOffset": "ZTIMEZONEOFFSET",
            "importedBy": "ZIMPORTEDBY",
            "importer": "ZIMPORTEDBYBUNDLEIDENTIFIER",
            "importerName": "ZIMPORTEDBYDISPLAYNAME",
            "kind": "ZKIND",
            "kindSubtype": "ZKINDSUBTYPE",
            "uti": "ZUNIFORMTYPEIDENTIFIER",
            "cloudLocalState": "ZCLOUDLOCALSTATE",
            "editor": "ZEDITORBUNDLEID",
            "savedAssetType": "ZSAVEDASSETTYPE",
            "trashed": "ZTRASHEDSTATE",
            "hidden": "ZHIDDEN",
            "latitude": "ZLATITUDE",
            "longitude": "ZLONGITUDE",
            "cameraMake": "ZCAMERAMAKE",
            "cameraModel": "ZCAMERAMODEL"
          },
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  a.ZDATECREATED,\n  a.ZADDEDDATE,\n  a.ZMODIFICATIONDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZTIMEZONENAME,\n  aa.ZTIMEZONEOFFSET,\n  aa.ZIMPORTEDBY,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  aa.ZIMPORTEDBYDISPLAYNAME,\n  aa.ZEDITORBUNDLEID,\n  a.ZSAVEDASSETTYPE,\n  a.ZKIND,\n  a.ZKINDSUBTYPE,\n  a.ZUNIFORMTYPEIDENTIFIER,\n  a.ZCLOUDLOCALSTATE,\n  a.ZTRASHEDSTATE,\n  a.ZHIDDEN,\n  a.ZLATITUDE,\n  a.ZLONGITUDE,\n  ext.ZCAMERAMAKE,\n  ext.ZCAMERAMODEL\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nLEFT JOIN ZEXTENDEDATTRIBUTES ext ON ext.Z_PK = a.ZEXTENDEDATTRIBUTES\nWHERE a.ZFILENAME = '{{filename}}'\n   OR aa.ZORIGINALFILENAME = '{{filename}}'\nORDER BY a.ZDATECREATED;"
        },
        {
          "id": "role-neighbours",
          "fields": {
            "pk": "Z_PK",
            "directory": "ZDIRECTORY",
            "filename": "ZFILENAME",
            "created": "ZDATECREATED",
            "added": "ZADDEDDATE",
            "importedBy": "ZIMPORTEDBY",
            "importer": "ZIMPORTEDBYBUNDLEIDENTIFIER",
            "kindSubtype": "ZKINDSUBTYPE",
            "trashed": "ZTRASHEDSTATE"
          },
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  a.ZDATECREATED,\n  a.ZADDEDDATE,\n  aa.ZIMPORTEDBY,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  a.ZKINDSUBTYPE,\n  a.ZTRASHEDSTATE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZDATECREATED BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY a.ZDATECREATED\nLIMIT 300;"
        },
        {
          "id": "role-sequence",
          "fields": {
            "pk": "Z_PK",
            "directory": "ZDIRECTORY",
            "filename": "ZFILENAME",
            "created": "ZDATECREATED",
            "added": "ZADDEDDATE",
            "importedBy": "ZIMPORTEDBY",
            "importer": "ZIMPORTEDBYBUNDLEIDENTIFIER",
            "kindSubtype": "ZKINDSUBTYPE",
            "trashed": "ZTRASHEDSTATE"
          },
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  a.ZDATECREATED,\n  a.ZADDEDDATE,\n  aa.ZIMPORTEDBY,\n  aa.ZIMPORTEDBYBUNDLEIDENTIFIER,\n  a.ZKINDSUBTYPE,\n  a.ZTRASHEDSTATE\nFROM ZASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.Z_PK = a.ZADDITIONALATTRIBUTES\nWHERE a.ZFILENAME LIKE '{{prevStem}}.%'\n   OR a.ZFILENAME LIKE '{{nextStem}}.%'\nORDER BY a.ZFILENAME;"
        }
      ]
    }
  ],
  "paramLabels": {
    "filename": "Filnamn (valfritt, tomt = alla). Komma om flera.",
    "bundleId": "App / bundle-ID (valfritt, tomt = alla)",
    "person": "Personens namn (valfritt, tomt = alla)",
    "prevStem": "Föregående filnamn utan ändelse (Härkomst)",
    "nextStem": "Nästa filnamn utan ändelse (Härkomst)"
  }
};
