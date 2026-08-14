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
      "dbPathHints": [
        "/data/data/com.android.providers.media/databases/external.db",
        "/data/data/com.android.providers.media.module/databases/external.db",
        "media/0/external.db (vissa extrakt)"
      ],
      "queries": [
        {
          "id": "schema-probe",
          "title": "Schema-probe (tabeller)",
          "goal": "probe",
          "params": [],
          "sql": "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
        },
        {
          "id": "columns-files",
          "title": "Schema-probe (kolumner files)",
          "goal": "probe",
          "params": [],
          "sql": "PRAGMA table_info(files);"
        },
        {
          "id": "by-filename-files",
          "title": "Sök filnamn i files (tider + MIME)",
          "goal": "filename",
          "params": [
            "filename"
          ],
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  mime_type,\n  media_type,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  datetime(date_modified, 'unixepoch', 'localtime') AS date_modified,\n  CASE\n    WHEN date_taken > 1000000000000 THEN datetime(date_taken/1000, 'unixepoch', 'localtime')\n    WHEN date_taken > 0 THEN datetime(date_taken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS date_taken,\n  width,\n  height,\n  owner_package_name\nFROM files\nWHERE IFNULL(_display_name, '') LIKE '%{{filename}}%'\n   OR IFNULL(_data, '') LIKE '%{{filename}}%'\nORDER BY date_added DESC;",
          "recommended": true
        },
        {
          "id": "by-filename-images",
          "title": "Sök filnamn i images (äldre schema)",
          "goal": "filename",
          "params": [
            "filename"
          ],
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  mime_type,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  datetime(date_modified, 'unixepoch', 'localtime') AS date_modified,\n  CASE\n    WHEN datetaken > 1000000000000 THEN datetime(datetaken/1000, 'unixepoch', 'localtime')\n    WHEN datetaken > 0 THEN datetime(datetaken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS datetaken,\n  bucket_display_name\nFROM images\nWHERE IFNULL(_display_name, '') LIKE '%{{filename}}%'\n   OR IFNULL(_data, '') LIKE '%{{filename}}%'\nORDER BY date_added DESC;"
        },
        {
          "id": "by-package",
          "title": "Filer skapade/ägda av paket (owner_package_name)",
          "goal": "creator",
          "params": [
            "packageName"
          ],
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  mime_type,\n  owner_package_name,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  datetime(date_modified, 'unixepoch', 'localtime') AS date_modified,\n  CASE\n    WHEN date_taken > 1000000000000 THEN datetime(date_taken/1000, 'unixepoch', 'localtime')\n    WHEN date_taken > 0 THEN datetime(date_taken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS date_taken\nFROM files\nWHERE IFNULL(owner_package_name, '') LIKE '%{{packageName}}%'\nORDER BY date_added DESC;"
        },
        {
          "id": "recent-images",
          "title": "Senaste bild-/mediafiler (översikt)",
          "goal": "overview",
          "params": [],
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  mime_type,\n  media_type,\n  owner_package_name,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  CASE\n    WHEN date_taken > 1000000000000 THEN datetime(date_taken/1000, 'unixepoch', 'localtime')\n    WHEN date_taken > 0 THEN datetime(date_taken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS date_taken\nFROM files\nWHERE mime_type LIKE 'image/%'\n   OR mime_type LIKE 'video/%'\n   OR media_type IN (1, 3)\nORDER BY date_added DESC\nLIMIT 200;"
        },
        {
          "id": "around-time",
          "title": "Media runt tidpunkt (Unix s)",
          "goal": "timerange",
          "params": [
            "unixStart",
            "unixEnd"
          ],
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  mime_type,\n  owner_package_name,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  datetime(date_modified, 'unixepoch', 'localtime') AS date_modified,\n  CASE\n    WHEN date_taken > 1000000000000 THEN datetime(date_taken/1000, 'unixepoch', 'localtime')\n    WHEN date_taken > 0 THEN datetime(date_taken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS date_taken\nFROM files\nWHERE (date_added BETWEEN {{unixStart}} AND {{unixEnd}})\n   OR (\n        CASE\n          WHEN date_taken > 1000000000000 THEN date_taken/1000\n          ELSE date_taken\n        END\n      ) BETWEEN {{unixStart}} AND {{unixEnd}}\nORDER BY date_added DESC;"
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
          "id": "schema-probe",
          "title": "Schema-probe (tabeller)",
          "goal": "probe",
          "params": [],
          "sql": "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
        },
        {
          "id": "usage-by-package",
          "title": "Usage per paket (generisk mall)",
          "goal": "creator",
          "params": [
            "packageName"
          ],
          "sql": "-- Justera tabell-/kolumnnamn efter schema-probe!\n-- Exempelmall:\nSELECT *\nFROM sqlite_master\nWHERE type='table' AND name LIKE '%usage%';\n\n-- När du vet tabellen, exempel:\n-- SELECT *\n-- FROM usage_stats\n-- WHERE package LIKE '%{{packageName}}%'\n-- ORDER BY last_time_used DESC;"
        },
        {
          "id": "aleapp-hint",
          "title": "ALEAPP-tips (usagestats XML)",
          "goal": "overview",
          "params": [],
          "sql": "-- Android App Usage (UsageStats)\n-- Typisk path: /data/system/usagestats/<user_id>/\n-- Innehåll: daily/weekly/monthly/yearly XML (eller analog struktur per Android-version)\n--\n-- Rekommenderat flöde:\n-- 1) Extrahera usagestats-mappen från filsystemsimage\n-- 2) Kör ALEAPP med relevant usage-artefakt aktiverad\n-- 3) Läs rapport: last time used / time in foreground / activity\n-- 4) Korsreferera med MediaStore date_taken/date_added för bildfilen\n--\n-- ALEAPP: https://github.com/abrignoni/ALEAPP\n-- Sök i ALEAPP artifacts efter: usagestats, appusage, offlineUsage, etc."
        }
      ]
    },
    {
      "id": "camera",
      "label": "Kameraaktivitet",
      "apiHint": "Beroende på OEM; MediaStore + app-privata DB:er",
      "dbPathHints": [
        "MediaStore external.db (date_taken nära kameratid)",
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
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  mime_type,\n  owner_package_name,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  CASE\n    WHEN date_taken > 1000000000000 THEN datetime(date_taken/1000, 'unixepoch', 'localtime')\n    WHEN date_taken > 0 THEN datetime(date_taken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS date_taken\nFROM files\nWHERE IFNULL(_data, '') LIKE '%/DCIM/Camera/%'\n   OR IFNULL(_data, '') LIKE '%/DCIM/CAMERA/%'\nORDER BY date_added DESC\nLIMIT 300;"
        },
        {
          "id": "dcim-around-time",
          "title": "DCIM/Camera runt tidpunkt (Unix s)",
          "goal": "timerange",
          "params": [
            "unixStart",
            "unixEnd"
          ],
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  mime_type,\n  owner_package_name,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  CASE\n    WHEN date_taken > 1000000000000 THEN datetime(date_taken/1000, 'unixepoch', 'localtime')\n    WHEN date_taken > 0 THEN datetime(date_taken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS date_taken\nFROM files\nWHERE (IFNULL(_data, '') LIKE '%/DCIM/Camera/%' OR IFNULL(_data, '') LIKE '%/DCIM/CAMERA/%')\n  AND (\n    (date_added BETWEEN {{unixStart}} AND {{unixEnd}})\n    OR (\n      CASE WHEN date_taken > 1000000000000 THEN date_taken/1000 ELSE date_taken END\n    ) BETWEEN {{unixStart}} AND {{unixEnd}}\n  )\nORDER BY date_added DESC;"
        },
        {
          "id": "camera-package",
          "title": "Media ägd av kamera-app",
          "goal": "camera",
          "params": [],
          "sql": "SELECT\n  _id,\n  _data,\n  _display_name,\n  owner_package_name,\n  mime_type,\n  datetime(date_added, 'unixepoch', 'localtime') AS date_added,\n  CASE\n    WHEN date_taken > 1000000000000 THEN datetime(date_taken/1000, 'unixepoch', 'localtime')\n    WHEN date_taken > 0 THEN datetime(date_taken, 'unixepoch', 'localtime')\n    ELSE NULL\n  END AS date_taken\nFROM files\nWHERE IFNULL(owner_package_name, '') LIKE '%camera%'\n   OR IFNULL(owner_package_name, '') LIKE '%Camera%'\n   OR IFNULL(owner_package_name, '') IN (\n        'com.google.android.GoogleCamera',\n        'com.sec.android.app.camera',\n        'com.android.camera',\n        'com.huawei.camera',\n        'com.miui.camera'\n      )\nORDER BY date_added DESC\nLIMIT 300;"
        },
        {
          "id": "aleapp-camera-hint",
          "title": "ALEAPP-tips (OEM camera/gallery)",
          "goal": "overview",
          "params": [],
          "sql": "-- Kamera / gallery artifacts (Android)\n-- Utöver MediaStore, kolla ALEAPP för bland annat:\n--   - Samsung CMH / gallery databases\n--   - Google Camera private app data\n--   - OEM 'recent images' / clipboard / cache\n--\n-- Flöde:\n-- 1) Hitta tid för bildfilen (MediaStore / EXIF)\n-- 2) DCIM/Camera + owner_package_name (SQL ovan)\n-- 3) Kör ALEAPP på fullt filsystemsextrakt\n-- 4) Korsreferera app usage (usagestats) runt samma tid\n--\n-- ALEAPP: https://github.com/abrignoni/ALEAPP"
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
