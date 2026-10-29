/* Genererad från snapchat/catalog.json — används när fetch() blockeras (file://). */
window.SNAPCHAT_CATALOG = {
  "id": "snapchat",
  "title": "Snapchat Queries",
  "sourceNote": "Betafunktion. Snapchats egna databaser på iOS, lästa ur appens behållare. Tiderna är Unix-millisekunder och visas här med datetime(…/1000, 'unixepoch', 'localtime'). Tabeller, kolumner och typkoder är kontrollerade mot en extraktion (iOS 18.5, Snapchat 2025). Strukturen kan skilja sig mellan Snapchat-versioner, så kontrollera alltid mot databasen.",
  "paramLabels": {
    "timeStart": "Från (ÅÅÅÅ-MM-DD TT:MM)",
    "timeEnd": "Till (ÅÅÅÅ-MM-DD TT:MM)",
    "cacheKey": "Cachenyckel (filnamnet i file_manager-mappen)",
    "conversationId": "Konversations-id (client_conversation_id)"
  },
  "databases": [
    {
      "id": "snapchat-cache",
      "label": "iOS — cache_controller.db (Snapchat cache)",
      "blurb": "Snapchats register över cachade mediefiler: filnamnet i file_manager-mappen (CACHE_KEY), typ av media, extern nyckel (konversation och meddelande för chattmedia), när filen skapades, går ut och raderades.",
      "dbPathHint": "/private/var/mobile/Containers/Data/Application/<GUID>/Documents/global_scoped/cachecontroller/cache_controller.db (+ -wal). Filerna ligger utan ändelse i Documents/com.snap.file_manager_3_SCContent_<konto>/<CACHE_KEY>",
      "paths": [
        "Documents/global_scoped/cachecontroller/cache_controller.db"
      ],
      "source": "Kontrollerad mot extraktion (iOS 18.5). Typkoder: 3 chattmedia (EXTERNAL_KEY 1:<konversation>:<server_message_id>:0:0), 34 inspelning med Snapchats kamera (<UUID>~1, samma fil som Library/Caches/user_scoped/<uid>/recorded_videos/), 16/24 story-video och första bildruta, 7/13 bilder från Snapchats CDN, 1/12 linser.",
      "queries": [
        {
          "id": "cached-media",
          "title": "Cachade mediefiler i tidsspann",
          "subtitle": "Visar varje fil Snapchat lade i sin cache inom tidsspannet: cachenyckel (= filnamnet i file_manager-mappen), typ, extern nyckel, storlek och när den går ut, raderades och senast lästes. Typtolkningen är härledd ur en extraktion och ska ses som en ledtråd.",
          "recommended": true,
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "returns": "skapad, cachenyckel, typ, typtolkning, extern nyckel, storlek, går ut, raderad, senast läst, UTC, konto",
          "sql": "SELECT\n  datetime(c.CREATION_TIMESTAMP_MILLIS / 1000, 'unixepoch', 'localtime') AS skapad_lokal,\n  c.CACHE_KEY,\n  c.MEDIA_CONTEXT_TYPE,\n  CASE c.MEDIA_CONTEXT_TYPE\n    WHEN 3 THEN 'chattmedia'\n    WHEN 34 THEN 'inspelning med Snapchats kamera'\n    WHEN 16 THEN 'story-video'\n    WHEN 24 THEN 'story, första bildruta'\n    WHEN 7 THEN 'bild från Snapchats CDN'\n    WHEN 13 THEN 'nedladdning från Snapchats CDN'\n    WHEN 1 THEN 'lins'\n    WHEN 12 THEN 'linspaket'\n    WHEN 4 THEN 'Team Snapchat'\n    WHEN 6 THEN 'Team Snapchat'\n    ELSE 'okänd typ'\n  END AS typ_tolkning,\n  c.EXTERNAL_KEY,\n  m.FILE_SIZE_BYTES,\n  datetime(c.EXPIRATION_TIMESTAMP_MILLIS / 1000, 'unixepoch', 'localtime') AS gar_ut_lokal,\n  CASE WHEN c.DELETED_TIMESTAMP_MILLIS > 0 THEN datetime(c.DELETED_TIMESTAMP_MILLIS / 1000, 'unixepoch', 'localtime') END AS raderad_lokal,\n  datetime(m.LAST_READ_TIMESTAMP_MILLIS / 1000, 'unixepoch', 'localtime') AS senast_last_lokal,\n  datetime(c.CREATION_TIMESTAMP_MILLIS / 1000, 'unixepoch') AS skapad_utc,\n  c.USER_ID\nFROM CACHE_FILE_CLAIM c\nLEFT JOIN CACHE_FILE_METADATA m ON m.CACHE_KEY = c.CACHE_KEY AND m.USER_ID = c.USER_ID\nWHERE c.CREATION_TIMESTAMP_MILLIS BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY c.CREATION_TIMESTAMP_MILLIS;"
        },
        {
          "id": "by-cache-key",
          "title": "En fil i cachen, efter cachenyckel",
          "subtitle": "Visar registerraden för en fil i file_manager-mappen. Cachenyckeln är filnamnet utan ändelse, eller delen före understrecket för filer med suffix som _PREFETCH.",
          "timeEpoch": "unix-ms",
          "params": [
            "cacheKey"
          ],
          "returns": "skapad, typ, typtolkning, extern nyckel, storlek, går ut, raderad, senast läst, UTC, konto",
          "sql": "SELECT\n  datetime(c.CREATION_TIMESTAMP_MILLIS / 1000, 'unixepoch', 'localtime') AS skapad_lokal,\n  c.CACHE_KEY,\n  c.MEDIA_CONTEXT_TYPE,\n  CASE c.MEDIA_CONTEXT_TYPE\n    WHEN 3 THEN 'chattmedia'\n    WHEN 34 THEN 'inspelning med Snapchats kamera'\n    WHEN 16 THEN 'story-video'\n    WHEN 24 THEN 'story, första bildruta'\n    WHEN 7 THEN 'bild från Snapchats CDN'\n    WHEN 13 THEN 'nedladdning från Snapchats CDN'\n    WHEN 1 THEN 'lins'\n    WHEN 12 THEN 'linspaket'\n    ELSE 'okänd typ'\n  END AS typ_tolkning,\n  c.EXTERNAL_KEY,\n  m.FILE_SIZE_BYTES,\n  datetime(c.EXPIRATION_TIMESTAMP_MILLIS / 1000, 'unixepoch', 'localtime') AS gar_ut_lokal,\n  CASE WHEN c.DELETED_TIMESTAMP_MILLIS > 0 THEN datetime(c.DELETED_TIMESTAMP_MILLIS / 1000, 'unixepoch', 'localtime') END AS raderad_lokal,\n  datetime(m.LAST_READ_TIMESTAMP_MILLIS / 1000, 'unixepoch', 'localtime') AS senast_last_lokal,\n  datetime(c.CREATION_TIMESTAMP_MILLIS / 1000, 'unixepoch') AS skapad_utc,\n  c.USER_ID\nFROM CACHE_FILE_CLAIM c\nLEFT JOIN CACHE_FILE_METADATA m ON m.CACHE_KEY = c.CACHE_KEY AND m.USER_ID = c.USER_ID\nWHERE c.CACHE_KEY = '{{cacheKey}}'\nORDER BY c.CREATION_TIMESTAMP_MILLIS;"
        },
        {
          "id": "tables",
          "title": "Hjälp: tabeller och antal rader",
          "subtitle": "Listar tabellerna i databasen. Bra för att se om CACHE_FILE_CLAIM och CACHE_FILE_METADATA finns i den här Snapchat-versionen.",
          "group": "advanced",
          "params": [],
          "returns": "tabellnamn",
          "sql": "SELECT name AS tabell\nFROM sqlite_master\nWHERE type = 'table'\nORDER BY name;"
        },
        {
          "id": "role-cache-window",
          "hidden": true,
          "role": "cache-window",
          "title": "Härkomst: cachade filer i tidsfönstret",
          "subtitle": "Används av Härkomst. Råa millisekundtider.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "unixMs",
          "fields": {
            "key": "CACHE_KEY",
            "context": "MEDIA_CONTEXT_TYPE",
            "external": "EXTERNAL_KEY",
            "created": "CREATION_TIMESTAMP_MILLIS",
            "expires": "EXPIRATION_TIMESTAMP_MILLIS",
            "deleted": "DELETED_TIMESTAMP_MILLIS",
            "size": "FILE_SIZE_BYTES",
            "lastRead": "LAST_READ_TIMESTAMP_MILLIS",
            "user": "USER_ID"
          },
          "sql": "SELECT\n  c.CACHE_KEY,\n  c.MEDIA_CONTEXT_TYPE,\n  c.EXTERNAL_KEY,\n  c.CREATION_TIMESTAMP_MILLIS,\n  c.EXPIRATION_TIMESTAMP_MILLIS,\n  c.DELETED_TIMESTAMP_MILLIS,\n  m.FILE_SIZE_BYTES,\n  m.LAST_READ_TIMESTAMP_MILLIS,\n  c.USER_ID\nFROM CACHE_FILE_CLAIM c\nLEFT JOIN CACHE_FILE_METADATA m ON m.CACHE_KEY = c.CACHE_KEY AND m.USER_ID = c.USER_ID\nWHERE c.CREATION_TIMESTAMP_MILLIS BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY c.CREATION_TIMESTAMP_MILLIS\nLIMIT 2000;"
        },
        {
          "id": "role-cache-key",
          "hidden": true,
          "role": "cache-key",
          "title": "Härkomst: registerraden för en cachenyckel",
          "subtitle": "Används av Härkomst när filen ligger i Snapchats file_manager-mapp.",
          "params": [
            "cacheKey"
          ],
          "epoch": "unixMs",
          "fields": {
            "key": "CACHE_KEY",
            "context": "MEDIA_CONTEXT_TYPE",
            "external": "EXTERNAL_KEY",
            "created": "CREATION_TIMESTAMP_MILLIS",
            "expires": "EXPIRATION_TIMESTAMP_MILLIS",
            "deleted": "DELETED_TIMESTAMP_MILLIS",
            "size": "FILE_SIZE_BYTES",
            "lastRead": "LAST_READ_TIMESTAMP_MILLIS",
            "user": "USER_ID"
          },
          "sql": "SELECT\n  c.CACHE_KEY,\n  c.MEDIA_CONTEXT_TYPE,\n  c.EXTERNAL_KEY,\n  c.CREATION_TIMESTAMP_MILLIS,\n  c.EXPIRATION_TIMESTAMP_MILLIS,\n  c.DELETED_TIMESTAMP_MILLIS,\n  m.FILE_SIZE_BYTES,\n  m.LAST_READ_TIMESTAMP_MILLIS,\n  c.USER_ID\nFROM CACHE_FILE_CLAIM c\nLEFT JOIN CACHE_FILE_METADATA m ON m.CACHE_KEY = c.CACHE_KEY AND m.USER_ID = c.USER_ID\nWHERE c.CACHE_KEY = '{{cacheKey}}'\nORDER BY c.CREATION_TIMESTAMP_MILLIS;"
        },
        {
          "id": "role-coverage",
          "hidden": true,
          "role": "coverage",
          "title": "Härkomst: cacheregistrets täckning",
          "subtitle": "Används av Härkomst. Första och sista tid samt antal rader.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "first": "first_start",
            "last": "last_start",
            "rows": "n_rows"
          },
          "sql": "SELECT\n  MIN(CREATION_TIMESTAMP_MILLIS) AS first_start,\n  MAX(CREATION_TIMESTAMP_MILLIS) AS last_start,\n  COUNT(*) AS n_rows\nFROM CACHE_FILE_CLAIM;"
        }
      ]
    },
    {
      "id": "snapchat-arroyo",
      "label": "iOS — arroyo.db (Snapchat chatt)",
      "blurb": "Chattmeddelanden och snaps: konversation, meddelandenummer, skickad och läst tid. Innehållet är protobuf. Avsändarens id går att läsa ut ur de första bytena, och mediets nyckel ligger i samma blob.",
      "dbPathHint": "/private/var/mobile/Containers/Data/Application/<GUID>/Documents/user_scoped/<användar-id>/arroyo/arroyo.db (+ -wal). Nästan allt ligger i -wal.",
      "paths": [
        "arroyo/arroyo.db"
      ],
      "source": "Kontrollerad mot extraktion (iOS 18.5). Avsändar-id: message_content börjar med 08 xx 12 12 0A 10 följt av 16 byte, samma id som snapchatter.userId i primary.docobjects. Raderade och visade snaps försvinner ur tabellen.",
      "queries": [
        {
          "id": "messages",
          "title": "Meddelanden i tidsspann",
          "subtitle": "Visar meddelanden och snaps inom tidsspannet med skickad och läst tid, konversation, meddelandenummer och avsändarens id läst ur protobufen (bara när blobben har den väntade formen). server_message_id och client_conversation_id är det som cache_controller.db:s EXTERNAL_KEY pekar på.",
          "recommended": true,
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "returns": "skickad, läst, konversation, meddelandenummer, status, avsändar-id (hex), innehållets storlek, UTC",
          "sql": "SELECT\n  datetime(creation_timestamp / 1000, 'unixepoch', 'localtime') AS skickad_lokal,\n  datetime(read_timestamp / 1000, 'unixepoch', 'localtime') AS last_lokal,\n  client_conversation_id,\n  server_message_id,\n  client_message_id,\n  message_state_type,\n  CASE WHEN hex(substr(message_content, 3, 4)) = '12120A10'\n    THEN lower(hex(substr(message_content, 7, 16))) END AS avsandare_id_hex,\n  length(message_content) AS innehall_storlek,\n  datetime(creation_timestamp / 1000, 'unixepoch') AS skickad_utc\nFROM conversation_message\nWHERE creation_timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY creation_timestamp;"
        },
        {
          "id": "conversation",
          "title": "Alla meddelanden i en konversation",
          "subtitle": "Visar alla meddelanden som finns kvar i en konversation, med skickad och läst tid och avsändarens id läst ur protobufen.",
          "timeEpoch": "unix-ms",
          "params": [
            "conversationId"
          ],
          "returns": "skickad, läst, meddelandenummer, status, avsändar-id (hex), innehållets storlek, UTC",
          "sql": "SELECT\n  datetime(creation_timestamp / 1000, 'unixepoch', 'localtime') AS skickad_lokal,\n  datetime(read_timestamp / 1000, 'unixepoch', 'localtime') AS last_lokal,\n  server_message_id,\n  client_message_id,\n  message_state_type,\n  CASE WHEN hex(substr(message_content, 3, 4)) = '12120A10'\n    THEN lower(hex(substr(message_content, 7, 16))) END AS avsandare_id_hex,\n  length(message_content) AS innehall_storlek,\n  datetime(creation_timestamp / 1000, 'unixepoch') AS skickad_utc\nFROM conversation_message\nWHERE client_conversation_id = '{{conversationId}}'\nORDER BY creation_timestamp;"
        },
        {
          "id": "tables",
          "title": "Hjälp: tabeller och antal rader",
          "subtitle": "Listar tabellerna i databasen. Bra för att se om conversation_message finns i den här Snapchat-versionen.",
          "group": "advanced",
          "params": [],
          "returns": "tabellnamn",
          "sql": "SELECT name AS tabell\nFROM sqlite_master\nWHERE type = 'table'\nORDER BY name;"
        },
        {
          "id": "role-messages",
          "hidden": true,
          "role": "messages",
          "title": "Härkomst: meddelanden i tidsfönstret",
          "subtitle": "Används av Härkomst. Råa millisekundtider och hela protobufen, som tolkas i verktyget.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "unixMs",
          "fields": {
            "conversation": "client_conversation_id",
            "serverId": "server_message_id",
            "clientId": "client_message_id",
            "created": "creation_timestamp",
            "read": "read_timestamp",
            "state": "message_state_type",
            "content": "message_content"
          },
          "sql": "SELECT\n  client_conversation_id,\n  server_message_id,\n  client_message_id,\n  creation_timestamp,\n  read_timestamp,\n  message_state_type,\n  message_content\nFROM conversation_message\nWHERE creation_timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\n   OR read_timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY creation_timestamp\nLIMIT 500;"
        },
        {
          "id": "role-coverage",
          "hidden": true,
          "role": "coverage",
          "title": "Härkomst: chattens täckning",
          "subtitle": "Används av Härkomst. Första och sista tid samt antal meddelanden som finns kvar.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "first": "first_start",
            "last": "last_start",
            "rows": "n_rows"
          },
          "sql": "SELECT\n  MIN(creation_timestamp) AS first_start,\n  MAX(creation_timestamp) AS last_start,\n  COUNT(*) AS n_rows\nFROM conversation_message;"
        }
      ]
    },
    {
      "id": "snapchat-friends",
      "label": "iOS — primary.docobjects (Snapchat konton)",
      "blurb": "Vänner och det egna kontot: användar-id och användarnamn. Namnen ligger i en binär kolumn (FlatBuffers), här visad som hex så att de går att kontrollera för hand.",
      "dbPathHint": "/private/var/mobile/Containers/Data/Application/<GUID>/Documents/user_scoped/<användar-id>/DocObjects/primary.docobjects (+ -wal)",
      "paths": [
        "DocObjects/primary.docobjects"
      ],
      "source": "Kontrollerad mot extraktion (iOS 18.5). userId är samma uuid som avsändar-id i arroyo.db. Kolumnen p är en FlatBuffer där användarnamn och visningsnamn ligger som längdprefixade strängar i klartext.",
      "queries": [
        {
          "id": "snapchatters",
          "title": "Konton (vänner och eget)",
          "subtitle": "Visar varje konto som Snapchat känner till på telefonen: användar-id och den binära kolumnen som hex. Användarnamnet syns i klartext när hex-dumpen avkodas som text.",
          "recommended": true,
          "params": [],
          "returns": "användar-id, storlek, kolumnen p som hex",
          "sql": "SELECT\n  userId,\n  length(p) AS p_storlek,\n  hex(p) AS p_hex\nFROM snapchatter\nORDER BY userId;"
        },
        {
          "id": "tables",
          "title": "Hjälp: tabeller och antal rader",
          "subtitle": "Listar tabellerna i databasen. Bra för att se om snapchatter finns i den här Snapchat-versionen.",
          "group": "advanced",
          "params": [],
          "returns": "tabellnamn",
          "sql": "SELECT name AS tabell\nFROM sqlite_master\nWHERE type = 'table'\nORDER BY name;"
        },
        {
          "id": "role-friends",
          "hidden": true,
          "role": "friends",
          "title": "Härkomst: konton",
          "subtitle": "Används av Härkomst. FlatBuffern tolkas i verktyget.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "userId": "userId",
            "p": "p"
          },
          "sql": "SELECT\n  userId,\n  p\nFROM snapchatter\nLIMIT 5000;"
        }
      ]
    },
    {
      "id": "snapchat-notifications",
      "label": "iOS — nse_db.sqlite (Snapchat notiser)",
      "blurb": "Notiser som Snapchats notistillägg behandlade: typ (snap, chat, addfriend …) och tid. Finns kvar när chatten är tömd.",
      "dbPathHint": "/private/var/mobile/Containers/Shared/AppGroup/<GUID>/User/<konto>/databases/nse_db.sqlite (+ -wal)",
      "paths": [
        "databases/nse_db.sqlite"
      ],
      "source": "Kontrollerad mot extraktion (iOS 18.5). Tabellen ProcessedNotifications har kommentarer i sitt CREATE TABLE som förklarar kolumnerna.",
      "queries": [
        {
          "id": "processed",
          "title": "Notiser i tidsspann",
          "subtitle": "Visar notiserna som behandlades inom tidsspannet, med typ och kategori. Typen snap betyder att en snap aviserades.",
          "recommended": true,
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "returns": "tid, typ, kategori, notis-id, UTC",
          "sql": "SELECT\n  datetime(timestamp / 1000, 'unixepoch', 'localtime') AS tid_lokal,\n  type,\n  category,\n  notificationId,\n  datetime(timestamp / 1000, 'unixepoch') AS tid_utc\nFROM ProcessedNotifications\nWHERE timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY timestamp;"
        },
        {
          "id": "tables",
          "title": "Hjälp: tabeller och antal rader",
          "subtitle": "Listar tabellerna i databasen. Bra för att se om ProcessedNotifications finns i den här Snapchat-versionen.",
          "group": "advanced",
          "params": [],
          "returns": "tabellnamn",
          "sql": "SELECT name AS tabell\nFROM sqlite_master\nWHERE type = 'table'\nORDER BY name;"
        },
        {
          "id": "role-notifications",
          "hidden": true,
          "role": "notifications",
          "title": "Härkomst: notiser i tidsfönstret",
          "subtitle": "Används av Härkomst. Råa millisekundtider.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "unixMs",
          "fields": {
            "time": "timestamp",
            "type": "type",
            "category": "category",
            "id": "notificationId"
          },
          "sql": "SELECT\n  timestamp,\n  type,\n  category,\n  notificationId\nFROM ProcessedNotifications\nWHERE timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY timestamp\nLIMIT 500;"
        },
        {
          "id": "role-coverage",
          "hidden": true,
          "role": "coverage",
          "title": "Härkomst: notisernas täckning",
          "subtitle": "Används av Härkomst. Första och sista tid samt antal rader.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "first": "first_start",
            "last": "last_start",
            "rows": "n_rows"
          },
          "sql": "SELECT\n  MIN(timestamp) AS first_start,\n  MAX(timestamp) AS last_start,\n  COUNT(*) AS n_rows\nFROM ProcessedNotifications;"
        }
      ]
    }
  ]
};
