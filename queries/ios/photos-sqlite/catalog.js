/* Genererad från photos-sqlite/catalog.json — används när fetch() blockeras (file://). */
window.PHOTOS_SQLITE_CATALOG = {
  "id": "photos-sqlite",
  "title": "iOS Queries",
  "dbPathHint": "Media/PhotoData/Photos.sqlite (+ -wal och -shm)",
  "timeNote": "Tiderna konverteras med datetime(..., 'unixepoch', 'localtime'). Kolumnnamnen är desamma som i databasen — döp om i SQL:en om du vill.",
  "source": "https://github.com/abrignoni/iLEAPP",
  "questions": [
    {
      "id": "full-story",
      "recommended": true,
      "label": "Standardquery för Photos.sqlite",
      "subtitle": "Rekommenderad väg — tider, app-fält och lagring för valda filnamn",
      "params": [
        "filename"
      ],
      "group": "investigate"
    },
    {
      "id": "when-created",
      "label": "När skapades bildfilen?",
      "subtitle": "ZDATECREATED, ZADDEDDATE, ZEXIFTIMESTAMPSTRING",
      "params": [
        "filename"
      ],
      "group": "investigate"
    },
    {
      "id": "which-app",
      "label": "Vilken app skapade bildfilen?",
      "subtitle": "ZCREATORBUNDLEID, ZEDITORBUNDLEID",
      "params": [
        "filename"
      ],
      "group": "investigate"
    },
    {
      "id": "when-modified",
      "label": "När ändrades bildfilen senast?",
      "subtitle": "ZMODIFICATIONDATE, ZEDITORBUNDLEID",
      "params": [
        "filename"
      ],
      "group": "investigate"
    },
    {
      "id": "where-stored",
      "label": "Var lagras bildfilen?",
      "subtitle": "ZDIRECTORY, ZFILENAME, ZORIGINALFILENAME",
      "params": [
        "filename"
      ],
      "group": "investigate"
    },
    {
      "id": "cloud-hints",
      "label": "Molnrelaterade fält",
      "subtitle": "ZCLOUDLOCALSTATE där kolumnen finns",
      "params": [
        "filename"
      ],
      "group": "investigate"
    },
    {
      "id": "list-by-app",
      "label": "Lista bilder från en viss app",
      "subtitle": "Filtrera på ZCREATORBUNDLEID / ZEDITORBUNDLEID",
      "params": [
        "bundleId"
      ],
      "group": "investigate"
    },
    {
      "id": "schema-probe",
      "label": "Lista tabeller i databasen",
      "subtitle": "sqlite_master — Z*-tabeller",
      "params": [],
      "group": "advanced"
    },
    {
      "id": "columns-asset",
      "label": "Visa kolumner (asset-tabeller)",
      "subtitle": "PRAGMA table_info",
      "params": [],
      "group": "advanced"
    },
    {
      "id": "full-story-alt-join",
      "label": "Standardquery med alternativ JOIN",
      "subtitle": "ZADDITIONALASSETATTRIBUTES.ZGENERICASSET i stället för ZASSET",
      "params": [
        "filename"
      ],
      "group": "advanced",
      "onlyBands": [
        "ios17-plus"
      ]
    }
  ],
  "paramLabels": {
    "filename": "Filnamn eller del av filnamn (komma-separerade om flera)",
    "bundleId": "App / bundle-ID (t.ex. camera, whatsapp, com.apple.camera)"
  },
  "bands": [
    {
      "id": "ios10-12",
      "label": "iOS 10–12",
      "versionMin": 10,
      "versionMax": 12,
      "notes": "",
      "queries": [
        {
          "id": "full-story",
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "when-created",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZCREATORBUNDLEID\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED DESC;"
        },
        {
          "id": "which-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "when-modified",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  aa.ZEDITORBUNDLEID,\n  aa.ZCREATORBUNDLEID\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZMODIFICATIONDATE DESC;"
        },
        {
          "id": "where-stored",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%';"
        },
        {
          "id": "cloud-hints",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%';"
        },
        {
          "id": "list-by-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE IFNULL(aa.ZCREATORBUNDLEID, '') LIKE '%{{bundleId}}%'\n   OR IFNULL(aa.ZEDITORBUNDLEID, '') LIKE '%{{bundleId}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "schema-probe",
          "sql": "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Z%' ORDER BY name;"
        },
        {
          "id": "columns-asset",
          "sql": "PRAGMA table_info(ZGENERICASSET);\nPRAGMA table_info(ZADDITIONALASSETATTRIBUTES);"
        }
      ]
    },
    {
      "id": "ios13-14",
      "label": "iOS 13–14",
      "versionMin": 13,
      "versionMax": 14,
      "notes": "",
      "queries": [
        {
          "id": "full-story",
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  a.ZKIND,\n  a.ZTRASHEDSTATE,\n  a.ZFAVORITE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "when-created",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZCREATORBUNDLEID\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED DESC;"
        },
        {
          "id": "which-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "when-modified",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  aa.ZEDITORBUNDLEID,\n  aa.ZCREATORBUNDLEID\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZMODIFICATIONDATE DESC;"
        },
        {
          "id": "where-stored",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%';"
        },
        {
          "id": "cloud-hints",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID,\n  a.ZCLOUDLOCALSTATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%';"
        },
        {
          "id": "list-by-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE IFNULL(aa.ZCREATORBUNDLEID, '') LIKE '%{{bundleId}}%'\n   OR IFNULL(aa.ZEDITORBUNDLEID, '') LIKE '%{{bundleId}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "schema-probe",
          "sql": "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Z%' ORDER BY name;"
        },
        {
          "id": "columns-asset",
          "sql": "PRAGMA table_info(ZGENERICASSET);\nPRAGMA table_info(ZADDITIONALASSETATTRIBUTES);"
        }
      ]
    },
    {
      "id": "ios15-16",
      "label": "iOS 15–16",
      "versionMin": 15,
      "versionMax": 16,
      "notes": "",
      "queries": [
        {
          "id": "full-story",
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  a.ZKIND,\n  a.ZTRASHEDSTATE,\n  a.ZFAVORITE,\n  a.ZHIDDEN,\n  a.ZUNIFORMTYPEIDENTIFIER,\n  aa.ZTIMEZONENAME\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "when-created",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZCREATORBUNDLEID\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED DESC;"
        },
        {
          "id": "which-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "when-modified",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  aa.ZEDITORBUNDLEID,\n  aa.ZCREATORBUNDLEID\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZMODIFICATIONDATE DESC;"
        },
        {
          "id": "where-stored",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%';"
        },
        {
          "id": "cloud-hints",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID,\n  a.ZCLOUDLOCALSTATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%';"
        },
        {
          "id": "list-by-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE IFNULL(aa.ZCREATORBUNDLEID, '') LIKE '%{{bundleId}}%'\n   OR IFNULL(aa.ZEDITORBUNDLEID, '') LIKE '%{{bundleId}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "schema-probe",
          "sql": "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Z%' ORDER BY name;"
        },
        {
          "id": "columns-asset",
          "sql": "PRAGMA table_info(ZGENERICASSET);\nPRAGMA table_info(ZADDITIONALASSETATTRIBUTES);"
        }
      ]
    },
    {
      "id": "ios17-plus",
      "label": "iOS 17 → latest",
      "versionMin": 17,
      "versionMax": 99,
      "notes": "",
      "queries": [
        {
          "id": "full-story",
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  a.ZKIND,\n  a.ZTRASHEDSTATE,\n  a.ZFAVORITE,\n  a.ZHIDDEN,\n  a.ZUNIFORMTYPEIDENTIFIER,\n  aa.ZTIMEZONENAME\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "when-created",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZCREATORBUNDLEID\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZDATECREATED DESC;"
        },
        {
          "id": "which-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "when-modified",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  aa.ZEDITORBUNDLEID,\n  aa.ZCREATORBUNDLEID\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZMODIFICATIONDATE DESC;"
        },
        {
          "id": "where-stored",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%';"
        },
        {
          "id": "cloud-hints",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID,\n  a.ZCLOUDLOCALSTATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%';"
        },
        {
          "id": "list-by-app",
          "sql": "SELECT\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK\nWHERE IFNULL(aa.ZCREATORBUNDLEID, '') LIKE '%{{bundleId}}%'\n   OR IFNULL(aa.ZEDITORBUNDLEID, '') LIKE '%{{bundleId}}%'\nORDER BY a.ZADDEDDATE DESC;"
        },
        {
          "id": "schema-probe",
          "sql": "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Z%' ORDER BY name;"
        },
        {
          "id": "columns-asset",
          "sql": "PRAGMA table_info(ZGENERICASSET);\nPRAGMA table_info(ZADDITIONALASSETATTRIBUTES);"
        },
        {
          "id": "full-story-alt-join",
          "sql": "SELECT\n  a.Z_PK,\n  a.ZDIRECTORY,\n  a.ZFILENAME,\n  aa.ZORIGINALFILENAME,\n  datetime(a.ZDATECREATED + 978307200, 'unixepoch', 'localtime') AS ZDATECREATED,\n  datetime(a.ZMODIFICATIONDATE + 978307200, 'unixepoch', 'localtime') AS ZMODIFICATIONDATE,\n  datetime(a.ZADDEDDATE + 978307200, 'unixepoch', 'localtime') AS ZADDEDDATE,\n  aa.ZEXIFTIMESTAMPSTRING,\n  aa.ZCREATORBUNDLEID,\n  aa.ZEDITORBUNDLEID,\n  a.ZKIND,\n  a.ZTRASHEDSTATE,\n  a.ZFAVORITE,\n  a.ZHIDDEN,\n  a.ZUNIFORMTYPEIDENTIFIER,\n  aa.ZTIMEZONENAME\nFROM ZGENERICASSET a\nLEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZGENERICASSET = a.Z_PK\nWHERE a.ZFILENAME LIKE '%{{filename}}%'\n   OR IFNULL(aa.ZORIGINALFILENAME, '') LIKE '%{{filename}}%'\nORDER BY a.ZADDEDDATE DESC;"
        }
      ]
    }
  ]
};
