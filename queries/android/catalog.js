/* Genererad från android/catalog.json — används när fetch() blockeras (file://). */
window.ANDROID_QUERIES_CATALOG = {
  "id": "android-queries",
  "title": "Android Queries",
  "source": "https://github.com/abrignoni/ALEAPP",
  "sourceNote": "SQL-mallar för MediaStore m.fl. Kolumnnamnen är desamma som i databasen. Tiderna konverteras med datetime(..., 'unixepoch', 'localtime').",
  "categories": [
    {
      "id": "mediastore",
      "label": "MediaStore / filer",
      "apiHint": "API 21+ (Android 5) → latest",
      "paths": [
        "data/data/com.android.providers.media/databases/external.db",
        "data/data/com.google.android.providers.media.module/databases/external.db",
        "data/data/com.android.providers.media.module/databases/external.db"
      ],
      "dbPathHints": [
        "/data/data/com.android.providers.media/databases/external.db",
        "/data/data/com.android.providers.media.module/databases/external.db",
        "/data/data/com.google.android.providers.media.module/databases/external.db (Pixel)",
        "media/0/external.db (vissa extrakt)"
      ],
      "queries": [
        {
          "id": "by-filename-files",
          "title": "Sök filnamn i files (tider + MIME)",
          "goal": "filename",
          "params": [
            "filename"
          ],
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  mime_type,\n  media_type,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  datetime(date_modified, 'unixepoch', 'localtime') AS date_modified,\n  CASE\n    WHEN datetaken > 1000000000000 THEN datetime(datetaken/1000, 'unixepoch', 'localtime')\n    WHEN datetaken > 0 THEN datetime(datetaken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS datetaken,\n  width,\n  height,\n  owner_package_name\nFROM files\nWHERE IFNULL(_display_name, '') LIKE '%{{filename}}%'\n   OR IFNULL(_data, '') LIKE '%{{filename}}%'\nORDER BY date_added DESC;",
          "description": "Letar upp en fil på namn eller sökväg. Visar när den lades till, ändrades och togs, MIME-typ, storlek och vilken app som äger filen.",
          "recommended": true
        },
        {
          "id": "by-filename-images",
          "title": "Sök filnamn i images (äldre schema)",
          "goal": "filename",
          "params": [
            "filename"
          ],
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  mime_type,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  datetime(date_modified, 'unixepoch', 'localtime') AS date_modified,\n  CASE\n    WHEN datetaken > 1000000000000 THEN datetime(datetaken/1000, 'unixepoch', 'localtime')\n    WHEN datetaken > 0 THEN datetime(datetaken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS datetaken,\n  bucket_display_name\nFROM images\nWHERE IFNULL(_display_name, '') LIKE '%{{filename}}%'\n   OR IFNULL(_data, '') LIKE '%{{filename}}%'\nORDER BY date_added DESC;",
          "description": "Samma sökning för äldre Android, där bilderna ligger i tabellen images i stället för files."
        },
        {
          "id": "by-package",
          "title": "Filer skapade/ägda av paket (owner_package_name)",
          "goal": "creator",
          "params": [
            "packageName"
          ],
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  mime_type,\n  owner_package_name,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  datetime(date_modified, 'unixepoch', 'localtime') AS date_modified,\n  CASE\n    WHEN datetaken > 1000000000000 THEN datetime(datetaken/1000, 'unixepoch', 'localtime')\n    WHEN datetaken > 0 THEN datetime(datetaken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS datetaken\nFROM files\nWHERE IFNULL(owner_package_name, '') LIKE '%{{packageName}}%'\nORDER BY date_added DESC;",
          "description": "Listar filer som en viss app har skapat eller äger, till exempel whatsapp. Nyast först."
        },
        {
          "id": "recent-images",
          "title": "Senaste bild-/mediafiler (översikt)",
          "goal": "overview",
          "params": [],
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  mime_type,\n  media_type,\n  owner_package_name,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  CASE\n    WHEN datetaken > 1000000000000 THEN datetime(datetaken/1000, 'unixepoch', 'localtime')\n    WHEN datetaken > 0 THEN datetime(datetaken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS datetaken\nFROM files\nWHERE mime_type LIKE 'image/%'\n   OR mime_type LIKE 'video/%'\n   OR media_type IN (1, 3)\nORDER BY date_added DESC\nLIMIT 200;",
          "description": "De 200 senast tillagda bilderna och videorna, med ägar-app och tid."
        },
        {
          "id": "around-time",
          "title": "Media runt tidpunkt (Unix s)",
          "goal": "timerange",
          "params": [
            "unixStart",
            "unixEnd"
          ],
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  mime_type,\n  owner_package_name,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  datetime(date_modified, 'unixepoch', 'localtime') AS date_modified,\n  CASE\n    WHEN datetaken > 1000000000000 THEN datetime(datetaken/1000, 'unixepoch', 'localtime')\n    WHEN datetaken > 0 THEN datetime(datetaken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS datetaken\nFROM files\nWHERE (date_added BETWEEN {{unixStart}} AND {{unixEnd}})\n   OR (\n        CASE\n          WHEN datetaken > 1000000000000 THEN datetaken/1000\n          ELSE datetaken\n        END\n      ) BETWEEN {{unixStart}} AND {{unixEnd}}\nORDER BY date_added DESC;",
          "description": "Bilder och video som lades till eller togs mellan två tidpunkter."
        },
        {
          "id": "schema-probe",
          "title": "Hjälp: lista tabellerna i databasen",
          "goal": "probe",
          "params": [],
          "sql": "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
          "group": "advanced",
          "description": "Visar vilka tabeller som finns. Använd den om en query ger fel om tabell som saknas."
        },
        {
          "id": "columns-files",
          "title": "Hjälp: lista kolumnerna i files",
          "goal": "probe",
          "params": [],
          "sql": "PRAGMA table_info(files);",
          "group": "advanced",
          "description": "Visar kolumnerna i tabellen files. Använd den om en query ger fel om kolumn som saknas."
        },
        {
          "id": "role-file",
          "hidden": true,
          "role": "file",
          "title": "Härkomst: filens rad",
          "description": "Används av Härkomst. Raden för ett exakt filnamn med råa tider (datetaken i ms eller s, date_added och date_modified i s).",
          "params": [
            "filename"
          ],
          "epoch": "unixS",
          "fields": {
            "pk": "_id",
            "path": "_data",
            "filename": "_display_name",
            "relativePath": "relative_path",
            "mime": "mime_type",
            "importer": "owner_package_name",
            "created": {
              "col": "datetaken",
              "epoch": "unixAuto"
            },
            "added": "date_added",
            "modified": "date_modified",
            "trashed": "is_trashed",
            "pending": "is_pending",
            "size": "_size"
          },
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  relative_path,\n  mime_type,\n  owner_package_name,\n  datetaken,\n  date_added,\n  date_modified,\n  is_trashed,\n  is_pending,\n  _size\nFROM files\nWHERE _display_name = '{{filename}}'\nORDER BY datetaken;"
        },
        {
          "id": "role-neighbours",
          "hidden": true,
          "role": "neighbours",
          "title": "Härkomst: media i tidsfönstret",
          "description": "Används av Härkomst. Bilder och video under DCIM och Pictures vars datetaken ligger i tidsfönstret. Saknas datetaken (vanligt för filer som en app sparar till galleriet, t.ex. Snapchat) används date_added.",
          "params": [
            "unixStart",
            "unixEnd"
          ],
          "epoch": "unixS",
          "fields": {
            "pk": "_id",
            "filename": "_display_name",
            "relativePath": "relative_path",
            "importer": "owner_package_name",
            "created": {
              "col": "datetaken",
              "epoch": "unixAuto"
            },
            "added": "date_added"
          },
          "sql": "SELECT\n  _id,\n  _display_name,\n  relative_path,\n  owner_package_name,\n  datetaken,\n  date_added\nFROM files\nWHERE (relative_path LIKE 'DCIM/%' OR relative_path LIKE 'Pictures/%')\n  AND COALESCE(CASE WHEN datetaken > 1000000000000 THEN datetaken / 1000 WHEN datetaken > 0 THEN datetaken END, date_added) BETWEEN {{unixStart}} AND {{unixEnd}}\nORDER BY COALESCE(datetaken, date_added * 1000)\nLIMIT 300;"
        }
      ]
    },
    {
      "id": "usage",
      "label": "App-användning",
      "apiHint": "API 21+ (UsageStats) → latest",
      "dbPathHints": [
        "/data/system/usagestats/ (XML per dag/intervall — inte SQL)",
        "/data/data/com.android.providers.settings/ eller OEM-specifika usage-DB:er",
        "Vissa verktyg exporterar parsed usage till SQLite/CSV via ALEAPP"
      ],
      "queries": [
        {
          "id": "usage-by-package",
          "title": "Hitta tabeller med app-användning",
          "goal": "creator",
          "params": [
            "packageName"
          ],
          "sql": "-- Justera tabell-/kolumnnamn efter schema-probe!\n-- Exempelmall:\nSELECT *\nFROM sqlite_master\nWHERE type='table' AND name LIKE '%usage%';\n\n-- När du vet tabellen, exempel:\n-- SELECT *\n-- FROM usage_stats\n-- WHERE package LIKE '%{{packageName}}%'\n-- ORDER BY last_time_used DESC;",
          "description": "Söker efter tabeller vars namn innehåller usage. Kommentaren visar hur du sedan filtrerar på paket. UsageStats ligger oftast i XML, inte i SQLite.",
          "recommended": true
        },
        {
          "id": "schema-probe",
          "title": "Hjälp: lista tabellerna i databasen",
          "goal": "probe",
          "params": [],
          "sql": "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
          "group": "advanced",
          "description": "Visar vilka tabeller som finns i databasen du har öppnat."
        },
        {
          "id": "aleapp-hint",
          "title": "Tips: läs UsageStats med ALEAPP",
          "goal": "overview",
          "params": [],
          "sql": "-- Android App Usage (UsageStats)\n-- Typisk path: /data/system/usagestats/<user_id>/\n-- Innehåll: daily/weekly/monthly/yearly XML (eller analog struktur per Android-version)\n--\n-- Rekommenderat flöde:\n-- 1) Extrahera usagestats-mappen från filsystemsimage\n-- 2) Kör ALEAPP med relevant usage-artefakt aktiverad\n-- 3) Läs rapport: last time used / time in foreground / activity\n-- 4) Korsreferera med MediaStore datetaken/date_added för bildfilen\n--\n-- ALEAPP: https://github.com/abrignoni/ALEAPP\n-- Sök i ALEAPP artifacts efter: usagestats, appusage, offlineUsage, etc.",
          "group": "advanced",
          "description": "Ingen query, bara arbetsgång för UsageStats-XML med ALEAPP."
        }
      ]
    },
    {
      "id": "camera",
      "label": "Kameraaktivitet",
      "apiHint": "Beroende på OEM; MediaStore + app-privata DB:er",
      "paths": [
        "data/data/com.android.providers.media/databases/external.db",
        "data/data/com.google.android.providers.media.module/databases/external.db",
        "data/data/com.android.providers.media.module/databases/external.db"
      ],
      "dbPathHints": [
        "MediaStore external.db (datetaken nära kameratid)",
        "/data/data/com.google.android.GoogleCamera/…",
        "/data/data/com.sec.android.app.camera/… (Samsung)",
        "OEM gallery DB:er (cmh.db m.fl. — se ALEAPP)"
      ],
      "queries": [
        {
          "id": "dcim-camera",
          "title": "MediaStore: filer under DCIM/Camera",
          "goal": "camera",
          "params": [],
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  mime_type,\n  owner_package_name,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  CASE\n    WHEN datetaken > 1000000000000 THEN datetime(datetaken/1000, 'unixepoch', 'localtime')\n    WHEN datetaken > 0 THEN datetime(datetaken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS datetaken\nFROM files\nWHERE IFNULL(_data, '') LIKE '%/DCIM/Camera/%'\n   OR IFNULL(_data, '') LIKE '%/DCIM/CAMERA/%'\nORDER BY date_added DESC\nLIMIT 300;",
          "description": "Filer i mappen DCIM/Camera, alltså bilder tagna med kameran. Visar tid och ägar-app.",
          "recommended": true
        },
        {
          "id": "dcim-around-time",
          "title": "DCIM/Camera runt tidpunkt (Unix s)",
          "goal": "timerange",
          "params": [
            "unixStart",
            "unixEnd"
          ],
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  mime_type,\n  owner_package_name,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  CASE\n    WHEN datetaken > 1000000000000 THEN datetime(datetaken/1000, 'unixepoch', 'localtime')\n    WHEN datetaken > 0 THEN datetime(datetaken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS datetaken\nFROM files\nWHERE (IFNULL(_data, '') LIKE '%/DCIM/Camera/%' OR IFNULL(_data, '') LIKE '%/DCIM/CAMERA/%')\n  AND (\n    (date_added BETWEEN {{unixStart}} AND {{unixEnd}})\n    OR (\n      CASE WHEN datetaken > 1000000000000 THEN datetaken/1000 ELSE datetaken END\n    ) BETWEEN {{unixStart}} AND {{unixEnd}}\n  )\nORDER BY date_added DESC;",
          "description": "Kamerabilder i DCIM/Camera som lades till eller togs mellan två tidpunkter."
        },
        {
          "id": "camera-package",
          "title": "Media ägd av kamera-app",
          "goal": "camera",
          "params": [],
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  owner_package_name,\n  mime_type,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  CASE\n    WHEN datetaken > 1000000000000 THEN datetime(datetaken/1000, 'unixepoch', 'localtime')\n    WHEN datetaken > 0 THEN datetime(datetaken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS datetaken\nFROM files\nWHERE IFNULL(owner_package_name, '') LIKE '%camera%'\n   OR IFNULL(owner_package_name, '') LIKE '%Camera%'\n   OR IFNULL(owner_package_name, '') IN (\n        'com.google.android.GoogleCamera',\n        'com.sec.android.app.camera',\n        'com.android.camera',\n        'com.huawei.camera',\n        'com.miui.camera'\n      )\nORDER BY date_added DESC\nLIMIT 300;",
          "description": "Media som ägs av en kameraapp (Google, Samsung, Huawei, Xiaomi med flera), oavsett mapp."
        },
        {
          "id": "aleapp-camera-hint",
          "title": "Tips: OEM-kamera och galleri i ALEAPP",
          "goal": "overview",
          "params": [],
          "sql": "-- Kamera / gallery artifacts (Android)\n-- Utöver MediaStore, kolla ALEAPP för bland annat:\n--   - Samsung CMH / gallery databases\n--   - Google Camera private app data\n--   - OEM 'recent images' / clipboard / cache\n--\n-- Flöde:\n-- 1) Hitta tid för bildfilen (MediaStore / EXIF)\n-- 2) DCIM/Camera + owner_package_name (SQL ovan)\n-- 3) Kör ALEAPP på fullt filsystemsextrakt\n-- 4) Korsreferera app usage (usagestats) runt samma tid\n--\n-- ALEAPP: https://github.com/abrignoni/ALEAPP",
          "group": "advanced",
          "description": "Ingen query, bara arbetsgång för tillverkarnas kamera- och galleridatabaser."
        }
      ]
    }
  ],
  "paramLabels": {
    "filename": "Filnamn eller del av filnamn (komma-separerade om flera)",
    "packageName": "Paketnamn-delsträng (t.ex. whatsapp, GoogleCamera)",
    "unixStart": "Start (Unix-sekunder)",
    "unixEnd": "Slut (Unix-sekunder)"
  }
};
