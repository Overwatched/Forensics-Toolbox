/* Genererad från android/samsung/catalog.json — används när fetch() blockeras (file://). */
window.SAMSUNG_ANDROID_CATALOG = {
  "id": "samsung-android",
  "title": "Samsung (Android)",
  "sourceNote": "Samsungs egna textfiler. Filen tolkas som i Härkomst och raderna läggs i en tabell i minnet; filen i extraktionen ändras inte. Formatet är inte beskrivet av Samsung, utan kontrollerat mot en telefon (SM-A336B). Rubins databaser är SQLite, krypterade med SQLCipher; de dekrypteras i minnet och ändras inte.",
  "paramLabels": {},
  "databases": [
    {
      "id": "samsung-err-p",
      "label": "eRR.p: starter och nedstängningar",
      "convert": "err-p",
      "blurb": "Varje start, omstart och nedstängning med tid, zon och ofta orsaken (batteriet tog slut, vald på telefonen, uppdatering, kommando från en dator, låst i tre dygn). Ofta år bakåt.",
      "dbPathHint": "/data/system/users/service/data/eRR.p",
      "paths": [
        "data/system/users/service/data/eRR.p"
      ],
      "source": "Tolkningen i Härkomst (tools/provenance/samsung-logs.js)",
      "queries": [
        {
          "id": "err-all",
          "title": "Alla rader",
          "recommended": true,
          "subtitle": "Visar varje rad i filens ordning: tiden som den står och i UTC, vad som hände, koden, orsaken i klartext, om det var en krasch och om klockan var fel.",
          "returns": "rad, tid, UTC, vad, kod, orsak, orsak i ord, krasch, fel klocka, raden",
          "sql": "-- En rad per start (ON), omstart (REBOOT) och nedstängning (SHUTDOWN), i den ordning telefonen skrev dem.\n-- tid står som i filen, med zon. utc är räknad med radens egen zon.\n-- fel_klocka = 1: raden har en tid före raden innan, så klockan gick fel när den skrevs.\nSELECT rad, tid, utc, vad, kod, orsak, orsak_i_ord, krasch, fel_klocka, text\nFROM err\nORDER BY rad;"
        },
        {
          "id": "err-downs",
          "title": "Nedstängningar och omstarter med orsak",
          "subtitle": "Visar bara REBOOT och SHUTDOWN, med orsaken i klartext och om det var en krasch.",
          "returns": "rad, tid, UTC, vad, orsak, orsak i ord, krasch",
          "sql": "SELECT rad, tid, utc, vad, orsak, orsak_i_ord, krasch\nFROM err\nWHERE vad IN ('REBOOT', 'SHUTDOWN') AND fel_klocka = 0\nORDER BY rad;"
        },
        {
          "id": "err-locked",
          "title": "Låst i tre dygn före omstarten",
          "subtitle": "Omstarterna med orsaken device_locked_3days, och de 72 timmarna före då telefonen var låst.",
          "returns": "rad, låst från (UTC), omstart (UTC), tid, orsak",
          "sql": "-- Telefonen startar om sig själv efter tre dygn utan upplåsning. Tiden före omstarten var den låst.\nSELECT rad, datetime(unix_ms / 1000 - 259200, 'unixepoch') AS last_fran_utc, utc AS omstart_utc, tid, orsak\nFROM err\nWHERE orsak = 'device_locked_3days' AND fel_klocka = 0\nORDER BY rad;"
        },
        {
          "id": "err-clock",
          "title": "Hjälp: rader med fel klocka",
          "group": "advanced",
          "subtitle": "Raderna vars tid ligger före raden innan. De skrevs när telefonens klocka stod fel, till exempel efter att batteriet tagit helt slut.",
          "returns": "rad, tid, vad, raden",
          "sql": "SELECT rad, tid, vad, text\nFROM err\nWHERE fel_klocka = 1\nORDER BY rad;"
        }
      ]
    },
    {
      "id": "samsung-rubin-logging",
      "label": "Rubin: inferenceengine_logging.db",
      "cipher": "rubin-logging",
      "blurb": "Samsungs Customization Service (Rubin) loggar appar i förgrunden, skärmen, ändrade inställningar, positioner, Wi-Fi, Bluetooth, laddning och rörelse. Krypterad; dekrypteras i minnet med Rubins nyckel ur secrets.json.",
      "dbPathHint": "/data/data/com.samsung.android.rubin.app/databases/inferenceengine_logging.db",
      "paths": [
        "data/data/com.samsung.android.rubin.app/databases/inferenceengine_logging.db"
      ],
      "source": "Kontrollerad mot Samsung A33 (Android 16, 2026-11-19). Krypterad med SQLCipher 2: lösenordet är värdet Logging för com.samsung.android.rubin.app i secrets.json (extra/Secrets/ i zippen), som byte, med PBKDF2-HMAC-SHA1 i 4000 varv och HMAC-SHA1 på sidor om 4096 byte. Tiderna är Unix-ms med telefonens zon i timezone_id och telefonens egen text i time_string. Rubin rensar gamla rader: i labbtelefonen räckte app_usage till 2026-09-30 och location_log hade 3 rader, alla från extraktionsdagen.",
      "queries": [
        {
          "id": "rubin-events",
          "title": "Händelser i tidsspann",
          "recommended": true,
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar allt Rubin loggade i tidsspannet i en tidslinje: appen i förgrunden, skärmen, ändrade inställningar (flygplansläge, Wi-Fi, Bluetooth, plats), positioner, Wi-Fi- och Bluetooth-anslutningar, laddning och rörelse. tid_som_skrivet är telefonens egen text i zonen som står bredvid.",
          "returns": "tid, tid som skrivet, zon, källa, vad, detalj, rad",
          "sql": "-- En rad per händelse ur Rubins logg (inferenceengine_logging.db), i tidsordning. Tiderna är Unix-ms; time_string är\n-- telefonens egen text i zonen timezone_id. Rubin rensar gamla rader, så loggen räcker ofta bara dagar bakåt.\nSELECT * FROM (\n  SELECT start_time AS ms, start_time_string AS tid_som_skrivet, timezone_id AS zon, 'app_usage' AS kalla, 'app i förgrunden' AS vad,\n    package_name || ' till ' || end_time_string AS detalj, _id AS rad FROM app_usage\n  UNION ALL SELECT time, time_string, timezone_id, 'screen_state_log', CASE screen_state WHEN 1 THEN 'skärmen på' WHEN 0 THEN 'skärmen av' ELSE 'skärm ' || screen_state END,\n    'user_present ' || user_present || ', use_keyguard ' || use_keyguard, _id FROM screen_state_log\n  UNION ALL SELECT event_time, event_time_string, timezone_id, 'setting_change', 'inställning', setting_id || ' = ' || value, _id FROM setting_change\n  UNION ALL SELECT time, time_string, timezone_id, 'location_log', 'position', latitude || ', ' || longitude || ' (±' || round(accuracy) || ' m, ' || provider || ')', _id FROM location_log\n  UNION ALL SELECT time, time_string, timezone_id, 'wifi_connection_log', 'Wi-Fi ' || lower(connection_type), ssid || ' ' || bssid, _id FROM wifi_connection_log\n  UNION ALL SELECT b.time, b.time_string, b.timezone_id, 'all_bluetooth_log', 'Bluetooth ' || lower(b.connection_type), COALESCE(d.name, '') || ' ' || b.address, b._id\n    FROM all_bluetooth_log b LEFT JOIN all_bluetooth_dictionary d ON d.address = b.address\n  UNION ALL SELECT time, time_string, timezone_id, 'charging_log', CASE connected WHEN 1 THEN 'laddare in' ELSE 'laddare ur' END, 'nivå ' || level || ' %', _id FROM charging_log\n  UNION ALL SELECT time, time_string, timezone_id, 'motion_log', 'rörelse', motion_type, _id FROM motion_log\n)\nWHERE ms BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY ms;"
        },
        {
          "id": "rubin-apps",
          "title": "Appar i förgrunden",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar app_usage: appen och aktiviteten i förgrunden med start och slut, i telefonens zon. Ett komplement till usagestats som Rubin sparar för sig, med egna rensningar.",
          "returns": "start, slut, längd, app, aktivitet, zon, rad",
          "sql": "SELECT start_time_string AS start, end_time_string AS slut, round((end_time - start_time) / 1000.0, 1) AS sekunder, package_name AS app, class_name AS aktivitet, timezone_id AS zon, _id AS rad, start_time AS start_ms\nFROM app_usage\nWHERE start_time <= {{unixMsEnd}} AND end_time >= {{unixMsStart}}\nORDER BY start_time;"
        },
        {
          "id": "rubin-locations",
          "title": "Positioner",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar location_log: telefonens position med noggrannhet, källa (passive_network, lastKnown_network, gps) och tid. Kan jämföras med bildens position. Rubin sparar bara några rader åt gången.",
          "returns": "tid, lat, lon, noggrannhet, källa, höjd, hastighet, zon, rad",
          "sql": "SELECT time_string AS tid, latitude AS lat, longitude AS lon, round(accuracy) AS noggrannhet_m, provider AS kalla, round(altitude) AS hojd_m, speed AS hastighet, timezone_id AS zon, _id AS rad, time AS ms\nFROM location_log\nWHERE time BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY time;"
        },
        {
          "id": "rubin-settings",
          "title": "Ändrade inställningar",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar setting_change: när flygplansläge, Wi-Fi, Bluetooth, plats och andra lägen slogs av och på, med värdet efter ändringen.",
          "returns": "tid, inställning, värde, zon, rad",
          "sql": "SELECT event_time_string AS tid, setting_id AS installning, value AS varde, timezone_id AS zon, _id AS rad, event_time AS ms\nFROM setting_change\nWHERE event_time BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY event_time;"
        },
        {
          "id": "rubin-connections",
          "title": "Wi-Fi, Bluetooth och laddning",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar anslutningarna till Wi-Fi-nät och Bluetooth-enheter (med enhetens namn ur all_bluetooth_dictionary) och när laddaren sattes i och togs ur.",
          "returns": "tid, vad, nät eller enhet, adress, zon, rad",
          "sql": "SELECT * FROM (\n  SELECT time AS ms, time_string AS tid, 'Wi-Fi ' || lower(connection_type) AS vad, ssid AS namn, bssid AS adress, timezone_id AS zon, 'wifi_connection_log' AS tabell, _id AS rad FROM wifi_connection_log\n  UNION ALL SELECT b.time, b.time_string, 'Bluetooth ' || lower(b.connection_type), d.name, b.address, b.timezone_id, 'all_bluetooth_log', b._id\n    FROM all_bluetooth_log b LEFT JOIN all_bluetooth_dictionary d ON d.address = b.address\n  UNION ALL SELECT time, time_string, CASE connected WHEN 1 THEN 'laddare in' ELSE 'laddare ur' END, 'nivå ' || level || ' %', NULL, timezone_id, 'charging_log', _id FROM charging_log\n)\nWHERE ms BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY ms;"
        },
        {
          "id": "rubin-api",
          "title": "Appar som frågade Rubin",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar api_call_log: vilken app (med version) som anropade Rubins tjänster och när. Säger att appen var igång, inte vad den gjorde.",
          "returns": "tid, app, version, anrop, zon, rad",
          "sql": "SELECT time_string AS tid, package_name AS app, package_version AS version, authority AS anrop, timezone_id AS zon, _id AS rad, time AS ms\nFROM api_call_log\nWHERE time BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY time;"
        },
        {
          "id": "rubin-coverage",
          "title": "Hur långt loggen räcker",
          "params": [],
          "subtitle": "Visar första och sista tiden och antalet rader i varje tabell med data. Rubin rensar gamla rader, så luckor och korta perioder är vanliga.",
          "returns": "tabell, rader, första, sista",
          "sql": "SELECT 'app_usage' AS tabell, count(*) AS rader, datetime(min(start_time) / 1000, 'unixepoch', 'localtime') AS forsta, datetime(max(start_time) / 1000, 'unixepoch', 'localtime') AS sista FROM app_usage\nUNION ALL SELECT 'screen_state_log', count(*), datetime(min(time) / 1000, 'unixepoch', 'localtime'), datetime(max(time) / 1000, 'unixepoch', 'localtime') FROM screen_state_log\nUNION ALL SELECT 'setting_change', count(*), datetime(min(event_time) / 1000, 'unixepoch', 'localtime'), datetime(max(event_time) / 1000, 'unixepoch', 'localtime') FROM setting_change\nUNION ALL SELECT 'location_log', count(*), datetime(min(time) / 1000, 'unixepoch', 'localtime'), datetime(max(time) / 1000, 'unixepoch', 'localtime') FROM location_log\nUNION ALL SELECT 'wifi_connection_log', count(*), datetime(min(time) / 1000, 'unixepoch', 'localtime'), datetime(max(time) / 1000, 'unixepoch', 'localtime') FROM wifi_connection_log\nUNION ALL SELECT 'all_bluetooth_log', count(*), datetime(min(time) / 1000, 'unixepoch', 'localtime'), datetime(max(time) / 1000, 'unixepoch', 'localtime') FROM all_bluetooth_log\nUNION ALL SELECT 'charging_log', count(*), datetime(min(time) / 1000, 'unixepoch', 'localtime'), datetime(max(time) / 1000, 'unixepoch', 'localtime') FROM charging_log\nUNION ALL SELECT 'motion_log', count(*), datetime(min(time) / 1000, 'unixepoch', 'localtime'), datetime(max(time) / 1000, 'unixepoch', 'localtime') FROM motion_log\nUNION ALL SELECT 'api_call_log', count(*), datetime(min(time) / 1000, 'unixepoch', 'localtime'), datetime(max(time) / 1000, 'unixepoch', 'localtime') FROM api_call_log;"
        },
        {
          "id": "rubin-tables",
          "title": "Hjälp: lista tabellerna",
          "group": "advanced",
          "params": [],
          "subtitle": "Visar tabellerna i databasen med antalet rader. Använd den om en query ger fel om en tabell som saknas: Rubins tabeller skiljer mellan versioner.",
          "returns": "tabell",
          "sql": "SELECT name AS tabell FROM sqlite_master WHERE type = 'table' ORDER BY name;"
        },
        {
          "id": "role-location",
          "hidden": true,
          "role": "location",
          "title": "Härkomst: Rubins positioner i tidsfönstret",
          "description": "Används av Härkomst. location_log i fönstret, med noggrannhet och källa. Tider i Unix-ms.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "time": "time",
            "latitude": "latitude",
            "longitude": "longitude",
            "accuracy": "accuracy",
            "provider": "provider",
            "zone": "timezone_id",
            "id": "_id"
          },
          "sql": "SELECT _id, time, latitude, longitude, accuracy, provider, timezone_id\nFROM location_log\nWHERE time BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY time;"
        },
        {
          "id": "role-app-usage",
          "hidden": true,
          "role": "app-usage",
          "title": "Härkomst: Rubins appar i förgrunden i tidsfönstret",
          "description": "Används av Härkomst. app_usage vars intervall når in i fönstret: appen med start och slut i Unix-ms.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "start": "start_time",
            "end": "end_time",
            "app": "package_name",
            "activity": "class_name",
            "zone": "timezone_id",
            "id": "_id"
          },
          "sql": "SELECT _id, start_time, end_time, package_name, class_name, timezone_id\nFROM app_usage\nWHERE start_time <= {{unixMsEnd}} AND end_time >= {{unixMsStart}}\nORDER BY start_time;"
        },
        {
          "id": "role-coverage",
          "hidden": true,
          "role": "coverage",
          "title": "Härkomst: hur långt Rubins appar och positioner räcker",
          "description": "Används av Härkomst. Första och sista tiden och antalet rader i app_usage och location_log.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "first": "first",
            "last": "last",
            "rows": "rows",
            "locFirst": "loc_first",
            "locLast": "loc_last",
            "locRows": "loc_rows"
          },
          "sql": "SELECT (SELECT min(start_time) FROM app_usage) AS first, (SELECT max(end_time) FROM app_usage) AS last, (SELECT count(*) FROM app_usage) AS rows,\n  (SELECT min(time) FROM location_log) AS loc_first, (SELECT max(time) FROM location_log) AS loc_last, (SELECT count(*) FROM location_log) AS loc_rows;"
        }
      ]
    },
    {
      "id": "samsung-rubin-monitoring",
      "label": "Rubin: inferenceengine_monitoring.db",
      "cipher": "rubin-monitoring",
      "blurb": "Rubins slutsatser: hemma eller borta, platsens slag, sammanhang och gång med telefonen i handen. Krypterad; dekrypteras i minnet med Rubins nyckel ur secrets.json.",
      "dbPathHint": "/data/data/com.samsung.android.rubin.app/databases/inferenceengine_monitoring.db",
      "paths": [
        "data/data/com.samsung.android.rubin.app/databases/inferenceengine_monitoring.db"
      ],
      "source": "Kontrollerad mot Samsung A33 (Android 16, 2026-11-19). Krypterad med SQLCipher 2: lösenordet är värdet Monitoring för com.samsung.android.rubin.app i secrets.json (extra/Secrets/ i zippen), som byte, med PBKDF2-HMAC-SHA1 i 4000 varv och HMAC-SHA1 på sidor om 4096 byte. Tiderna är Unix-ms med telefonens zon i timezone_id och telefonens egen text i time_string. Rubin rensar gamla rader: i labbtelefonen räckte app_usage till 2026-09-30 och location_log hade 3 rader, alla från extraktionsdagen.",
      "queries": [
        {
          "id": "rubin-context",
          "title": "Platser och sammanhang i tidsspann",
          "recommended": true,
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar vad Rubin drog för slutsatser om var telefonen var och vad den gjorde: hemma eller borta (home_in_out_event), plats (current_place_log, alt_place_log), sammanhang (tpo_context_event, collectable_context_event) och gång med telefonen i handen (smombie_event_monitor). Det är Rubins tolkningar, inte mätningar.",
          "returns": "tid, tid som skrivet, källa, vad, detalj, säkerhet, rad",
          "sql": "SELECT * FROM (\n  SELECT time AS ms, time_string AS tid_som_skrivet, 'home_in_out_event' AS kalla, in_out_state AS vad, 'place_id ' || place_id AS detalj, NULL AS sakerhet, _id AS rad FROM home_in_out_event\n  UNION ALL SELECT time, time_string, 'current_place_log', place_category, registered_type, confidence, _id FROM current_place_log\n  UNION ALL SELECT time, time_string, 'alt_place_log', place_category, 'place_id ' || place_id, confidence, _id FROM alt_place_log\n  UNION ALL SELECT event_time, event_time_text, 'tpo_context_event', tpo_context, category || ' / ' || subcategory, confidence, _id FROM tpo_context_event\n  UNION ALL SELECT time, time_text, 'collectable_context_event', collectable_context, source || ' / ' || subcategory, NULL, _id FROM collectable_context_event\n  UNION ALL SELECT timestamp, timestamp_text, 'smombie_event_monitor', activity_type, foreground_package || ' (' || activity_duration || ' s)', NULL, _id FROM smombie_event_monitor\n)\nWHERE ms BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY ms;"
        },
        {
          "id": "rubin-mon-tables",
          "title": "Hjälp: lista tabellerna",
          "group": "advanced",
          "params": [],
          "subtitle": "Visar tabellerna i databasen. Använd den om en query ger fel om en tabell som saknas: Rubins tabeller skiljer mellan versioner.",
          "returns": "tabell",
          "sql": "SELECT name AS tabell FROM sqlite_master WHERE type = 'table' ORDER BY name;"
        }
      ]
    }
  ]
};
