/* Genererad från ios/telegram/catalog.json — används när fetch() blockeras (file://). */
window.TELEGRAM_IOS_CATALOG = {
  "id": "telegram-ios",
  "title": "Telegram iOS Queries",
  "sourceNote": "Betafunktion. Telegrams databaser på iOS ligger i appgruppen group.ph.telegra.Telegraph under telegram-data/account-<id>/. De är inte krypterade när ingen lösenkod är satt i Telegram. Telegram lagrar meddelanden och kontakter i ett eget format (Postbox) i tabellerna t0, t1, … med nyckel och värde som blobbar. Forensics Toolbox avkodar dem i minnet till tabeller som börjar med tg_; de finns inte i filen. Tiderna är unixsekunder. Formatet är kontrollerat mot en labbtelefon (iOS 26.4.1, Telegram 13.1.2, 2026-11-03) och kan skilja sig mellan Telegram-versioner, så kontrollera mot databasen.",
  "paramLabels": {
    "resourceId": "Resursens id (filnamnet under postbox/media/)"
  },
  "databases": [
    {
      "id": "telegram-ios-postbox",
      "label": "iOS — db_sqlite (Telegram)",
      "blurb": "Meddelanden, bilder, videor, samtal, kontakter och chattar. De ligger i Telegrams eget format i t7 och t2 och avkodas i minnet till tg_message, tg_resource och tg_peer.",
      "dbPathHint": "/private/var/mobile/Containers/Shared/AppGroup/<GUID>/telegram-data/account-<id>/postbox/db/db_sqlite (+ -wal), i appgruppen group.ph.telegra.Telegraph. Mediefilerna ligger i postbox/media/ med resursens id som namn.",
      "paths": [
        "postbox/db/db_sqlite"
      ],
      "derive": "telegram-postbox",
      "source": "Kontrollerad mot en labbtelefon (iOS 26.4.1, Telegram 13.1.2, 2026-11-03). t7: nyckeln är peer, namnrymd, tid (unixsekunder) och id; värdet har flaggor (4 = mottaget), avsändare, text, attribut och media. Medierna är bilder (TelegramMediaImage, med en resurs per storlek), filer och videor (TelegramMediaFile) och samtal (TelegramMediaAction 14). En bild för engångsvisning har tidsgränsen 2147483647. t2 har kontakterna och chattarna. Resursens id är filens namn under postbox/media/. Skickade bilder är omkodade av Telegram och har inte originalets storlek eller summa. Tabellerna tg_message, tg_resource och tg_peer finns inte i filen: Forensics Toolbox avkodar dem i minnet ur t7 och t2 när databasen öppnas, så queryn går inte att köra i ett annat SQLite-verktyg. Kontrollen av nycklarna i t7 är vanlig SQL.",
      "queries": [
        {
          "id": "messages",
          "title": "Meddelanden i tidsspann",
          "recommended": true,
          "timeEpoch": "unix",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar meddelandena i tidsspannet: tid, riktning, chatt, avsändare, text, media med storlek och mått, engångsvisning och samtal.",
          "returns": "tid, riktning, chatt, från, text, media, mime, storlek, mått, längd, engångsvisning, samtal, id, UTC",
          "sql": "SELECT\n  datetime(m.timestamp, 'unixepoch', 'localtime') AS tid_lokal,\n  CASE WHEN m.incoming = 1 THEN 'mottaget' ELSE 'skickat' END AS riktning,\n  COALESCE(p.name, CASE m.peer_type WHEN 0 THEN 'användare' WHEN 1 THEN 'grupp' WHEN 2 THEN 'kanal' WHEN 3 THEN 'hemlig chatt' ELSE 'typ ' || m.peer_type END || ' ' || m.peer_tg_id) AS chatt,\n  CASE WHEN m.incoming = 1 THEN COALESCE(a.name, 'Telegram-id ' || m.author_tg_id) ELSE 'den här telefonen' END AS fran,\n  m.text,\n  m.media,\n  m.media_mime AS mime,\n  m.media_size AS storlek,\n  CASE WHEN m.media_width IS NOT NULL THEN m.media_width || '×' || m.media_height END AS matt,\n  m.media_duration AS langd_s,\n  CASE WHEN m.view_once = 1 THEN 'ja' END AS engangsvisning,\n  CASE WHEN m.media = 'samtal' THEN COALESCE(m.call_duration || ' s', 'ingen längd') || CASE WHEN m.call_video = 1 THEN ', video' ELSE '' END END AS samtal,\n  m.id AS meddelande_id,\n  m.peer_id,\n  m.decode_error AS avkodningsfel,\n  datetime(m.timestamp, 'unixepoch') AS tid_utc\nFROM tg_message m\nLEFT JOIN tg_peer p ON p.peer_id = m.peer_id\nLEFT JOIN tg_peer a ON a.peer_id = m.author_id\nWHERE m.timestamp BETWEEN {{unixStart}} AND {{unixEnd}}\nORDER BY m.timestamp, m.id;"
        },
        {
          "id": "media",
          "title": "Bilder, videor och filer",
          "params": [],
          "subtitle": "Alla meddelanden med media, med resursernas id. Resursens id är filens namn under postbox/media/.",
          "returns": "tid, riktning, chatt, media, mime, storlek, mått, filnamn, engångsvisning, resurser, id, UTC",
          "sql": "SELECT\n  datetime(m.timestamp, 'unixepoch', 'localtime') AS tid_lokal,\n  CASE WHEN m.incoming = 1 THEN 'mottaget' ELSE 'skickat' END AS riktning,\n  COALESCE(p.name, CASE m.peer_type WHEN 0 THEN 'användare' WHEN 1 THEN 'grupp' WHEN 2 THEN 'kanal' WHEN 3 THEN 'hemlig chatt' ELSE 'typ ' || m.peer_type END || ' ' || m.peer_tg_id) AS chatt,\n  m.media,\n  m.media_mime AS mime,\n  m.media_size AS storlek,\n  CASE WHEN m.media_width IS NOT NULL THEN m.media_width || '×' || m.media_height END AS matt,\n  m.media_file_name AS filnamn,\n  CASE WHEN m.view_once = 1 THEN 'ja' END AS engangsvisning,\n  (SELECT group_concat(r.resource_id, ', ') FROM tg_resource r WHERE r.peer_id = m.peer_id AND r.namespace = m.namespace AND r.message_id = m.id AND r.role <> 'miniatyr') AS resurser,\n  m.id AS meddelande_id,\n  m.peer_id,\n  datetime(m.timestamp, 'unixepoch') AS tid_utc\nFROM tg_message m\nLEFT JOIN tg_peer p ON p.peer_id = m.peer_id\nLEFT JOIN tg_peer a ON a.peer_id = m.author_id\nWHERE m.media IS NOT NULL AND m.media NOT IN ('samtal', 'tjänstemeddelande')\nORDER BY m.timestamp, m.id;"
        },
        {
          "id": "resource",
          "title": "En resurs efter id",
          "params": [
            "resourceId"
          ],
          "subtitle": "Vilket meddelande en fil under postbox/media/ hör till. Ange filens namn, med eller utan _partial.",
          "returns": "resurs, del, storlek, mått, tid, riktning, chatt, id, UTC",
          "sql": "SELECT\n  r.resource_id AS resurs,\n  r.role AS del,\n  r.size AS storlek,\n  CASE WHEN r.width IS NOT NULL THEN r.width || '×' || r.height END AS matt,\n  datetime(m.timestamp, 'unixepoch', 'localtime') AS tid_lokal,\n  CASE WHEN m.incoming = 1 THEN 'mottaget' ELSE 'skickat' END AS riktning,\n  COALESCE(p.name, CASE m.peer_type WHEN 0 THEN 'användare' WHEN 1 THEN 'grupp' WHEN 2 THEN 'kanal' WHEN 3 THEN 'hemlig chatt' ELSE 'typ ' || m.peer_type END || ' ' || m.peer_tg_id) AS chatt,\n  m.id AS meddelande_id,\n  m.peer_id,\n  datetime(m.timestamp, 'unixepoch') AS tid_utc\nFROM tg_resource r\nJOIN tg_message m ON m.peer_id = r.peer_id AND m.namespace = r.namespace AND m.id = r.message_id\nLEFT JOIN tg_peer p ON p.peer_id = m.peer_id\nWHERE r.resource_id = '{{resourceId}}' OR r.resource_id || '_partial' = '{{resourceId}}'\nORDER BY m.timestamp;"
        },
        {
          "id": "calls",
          "title": "Samtal",
          "params": [],
          "subtitle": "Samtalen i chattarna: tid, riktning, ljud eller video, längd och hur samtalet avslutades (Telegrams kod).",
          "returns": "tid, riktning, chatt, slag, längd, avslut, id, UTC",
          "sql": "SELECT\n  datetime(m.timestamp, 'unixepoch', 'localtime') AS tid_lokal,\n  CASE WHEN m.incoming = 1 THEN 'inkommande' ELSE 'utgående' END AS riktning,\n  COALESCE(p.name, CASE m.peer_type WHEN 0 THEN 'användare' WHEN 1 THEN 'grupp' WHEN 2 THEN 'kanal' WHEN 3 THEN 'hemlig chatt' ELSE 'typ ' || m.peer_type END || ' ' || m.peer_tg_id) AS chatt,\n  CASE WHEN m.call_video = 1 THEN 'video' ELSE 'ljud' END AS slag,\n  m.call_duration AS langd_s,\n  m.call_discard AS avslut,\n  m.id AS meddelande_id,\n  m.peer_id,\n  datetime(m.timestamp, 'unixepoch') AS tid_utc\nFROM tg_message m\nLEFT JOIN tg_peer p ON p.peer_id = m.peer_id\nLEFT JOIN tg_peer a ON a.peer_id = m.author_id\nWHERE m.media = 'samtal'\nORDER BY m.timestamp;"
        },
        {
          "id": "chats",
          "title": "Kontakter och chattar",
          "params": [],
          "subtitle": "Kontakterna, grupperna och kanalerna i t2 med antal meddelanden och det senaste.",
          "returns": "typ, namn, användarnamn, telefon, Telegram-id, meddelanden, senaste, peer",
          "sql": "SELECT\n  p.kind AS typ,\n  p.name AS namn,\n  p.username AS anvandarnamn,\n  p.phone AS telefon,\n  p.peer_tg_id AS telegram_id,\n  (SELECT count(*) FROM tg_message m WHERE m.peer_id = p.peer_id) AS meddelanden,\n  (SELECT datetime(max(m.timestamp), 'unixepoch', 'localtime') FROM tg_message m WHERE m.peer_id = p.peer_id) AS senaste_lokal,\n  p.peer_id,\n  p.class AS klass,\n  p.decode_error AS avkodningsfel\nFROM tg_peer p\nORDER BY meddelanden DESC, p.name;"
        },
        {
          "id": "message-keys",
          "title": "Kontroll: meddelandenas nycklar i t7",
          "group": "advanced",
          "params": [],
          "subtitle": "Läser tid, id och peer direkt ur nycklarna i t7 med vanlig SQL, utan avkodningen. Går att köra i vilket SQLite-verktyg som helst och jämföra med Meddelanden i tidsspann.",
          "returns": "tid, id, namnrymd, peer, värdets längd, nyckel i hex, UTC",
          "sql": "WITH k AS (\n  SELECT hex(key) AS h, length(value) AS varde_byte FROM t7 WHERE length(key) = 20\n), d AS (\n  SELECT h, varde_byte,\n    (instr('0123456789ABCDEF', substr(h, 1, 1)) - 1) * 1152921504606846976 + (instr('0123456789ABCDEF', substr(h, 2, 1)) - 1) * 72057594037927936 + (instr('0123456789ABCDEF', substr(h, 3, 1)) - 1) * 4503599627370496 + (instr('0123456789ABCDEF', substr(h, 4, 1)) - 1) * 281474976710656 +\n    (instr('0123456789ABCDEF', substr(h, 5, 1)) - 1) * 17592186044416 + (instr('0123456789ABCDEF', substr(h, 6, 1)) - 1) * 1099511627776 + (instr('0123456789ABCDEF', substr(h, 7, 1)) - 1) * 68719476736 + (instr('0123456789ABCDEF', substr(h, 8, 1)) - 1) * 4294967296 +\n    (instr('0123456789ABCDEF', substr(h, 9, 1)) - 1) * 268435456 + (instr('0123456789ABCDEF', substr(h, 10, 1)) - 1) * 16777216 + (instr('0123456789ABCDEF', substr(h, 11, 1)) - 1) * 1048576 + (instr('0123456789ABCDEF', substr(h, 12, 1)) - 1) * 65536 +\n    (instr('0123456789ABCDEF', substr(h, 13, 1)) - 1) * 4096 + (instr('0123456789ABCDEF', substr(h, 14, 1)) - 1) * 256 + (instr('0123456789ABCDEF', substr(h, 15, 1)) - 1) * 16 + (instr('0123456789ABCDEF', substr(h, 16, 1)) - 1) AS peer_id,\n    (instr('0123456789ABCDEF', substr(h, 17, 1)) - 1) * 268435456 + (instr('0123456789ABCDEF', substr(h, 18, 1)) - 1) * 16777216 + (instr('0123456789ABCDEF', substr(h, 19, 1)) - 1) * 1048576 + (instr('0123456789ABCDEF', substr(h, 20, 1)) - 1) * 65536 +\n    (instr('0123456789ABCDEF', substr(h, 21, 1)) - 1) * 4096 + (instr('0123456789ABCDEF', substr(h, 22, 1)) - 1) * 256 + (instr('0123456789ABCDEF', substr(h, 23, 1)) - 1) * 16 + (instr('0123456789ABCDEF', substr(h, 24, 1)) - 1) AS namnrymd,\n    (instr('0123456789ABCDEF', substr(h, 25, 1)) - 1) * 268435456 + (instr('0123456789ABCDEF', substr(h, 26, 1)) - 1) * 16777216 + (instr('0123456789ABCDEF', substr(h, 27, 1)) - 1) * 1048576 + (instr('0123456789ABCDEF', substr(h, 28, 1)) - 1) * 65536 +\n    (instr('0123456789ABCDEF', substr(h, 29, 1)) - 1) * 4096 + (instr('0123456789ABCDEF', substr(h, 30, 1)) - 1) * 256 + (instr('0123456789ABCDEF', substr(h, 31, 1)) - 1) * 16 + (instr('0123456789ABCDEF', substr(h, 32, 1)) - 1) AS tid,\n    (instr('0123456789ABCDEF', substr(h, 33, 1)) - 1) * 268435456 + (instr('0123456789ABCDEF', substr(h, 34, 1)) - 1) * 16777216 + (instr('0123456789ABCDEF', substr(h, 35, 1)) - 1) * 1048576 + (instr('0123456789ABCDEF', substr(h, 36, 1)) - 1) * 65536 +\n    (instr('0123456789ABCDEF', substr(h, 37, 1)) - 1) * 4096 + (instr('0123456789ABCDEF', substr(h, 38, 1)) - 1) * 256 + (instr('0123456789ABCDEF', substr(h, 39, 1)) - 1) * 16 + (instr('0123456789ABCDEF', substr(h, 40, 1)) - 1) AS meddelande_id\n  FROM k\n)\nSELECT\n  datetime(tid, 'unixepoch', 'localtime') AS tid_lokal,\n  meddelande_id,\n  namnrymd,\n  peer_id,\n  varde_byte,\n  h AS nyckel_hex,\n  datetime(tid, 'unixepoch') AS tid_utc\nFROM d\nORDER BY tid, meddelande_id;"
        },
        {
          "id": "tables",
          "title": "Hjälp: tabeller och antal rader",
          "group": "advanced",
          "params": [],
          "subtitle": "Listar tabellerna i filen och de som avkodats i minnet, med antal rader för de viktigaste.",
          "returns": "var, tabell, rader",
          "sql": "SELECT * FROM (\nSELECT 'i filen' AS var, name AS tabell,\n  CASE name WHEN 't7' THEN (SELECT count(*) FROM t7) WHEN 't2' THEN (SELECT count(*) FROM t2) WHEN 't6' THEN (SELECT count(*) FROM t6) END AS rader\nFROM sqlite_master WHERE type = 'table'\nUNION ALL\nSELECT 'avkodad i minnet', name,\n  CASE name WHEN 'tg_message' THEN (SELECT count(*) FROM tg_message) WHEN 'tg_resource' THEN (SELECT count(*) FROM tg_resource) WHEN 'tg_peer' THEN (SELECT count(*) FROM tg_peer) END\nFROM sqlite_temp_master WHERE type = 'table'\n)\nORDER BY var DESC, rader IS NULL, tabell;"
        },
        {
          "id": "role-messages",
          "hidden": true,
          "role": "messages",
          "title": "Härkomst: meddelanden i tidsfönstret",
          "description": "Används av Härkomst. Meddelandena i fönstret med tid, riktning, media, chatt och avsändare. Texten tas inte med.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "unix",
          "fields": {
            "id": "id",
            "peerId": "peer_id",
            "peerType": "peer_type",
            "peerTgId": "peer_tg_id",
            "namespace": "namespace",
            "time": "timestamp",
            "incoming": "incoming",
            "media": "media",
            "mime": "media_mime",
            "size": "media_size",
            "width": "media_width",
            "height": "media_height",
            "duration": "media_duration",
            "fileName": "media_file_name",
            "viewOnce": "view_once",
            "action": "action",
            "callDuration": "call_duration",
            "callVideo": "call_video",
            "hasText": "has_text",
            "chatName": "chat_name",
            "sender": "sender",
            "decodeError": "decode_error"
          },
          "sql": "SELECT\n  m.id, m.peer_id, m.peer_type, m.peer_tg_id, m.namespace, m.timestamp, m.incoming, m.media, m.media_mime, m.media_size, m.media_width, m.media_height,\n  m.media_duration, m.media_file_name, m.view_once, m.action, m.call_duration, m.call_video, CASE WHEN length(m.text) > 0 THEN 1 ELSE 0 END AS has_text,\n  COALESCE(p.name, 'Telegram-id ' || m.peer_tg_id) AS chat_name,\n  CASE WHEN m.incoming = 1 THEN COALESCE(a.name, 'Telegram-id ' || m.author_tg_id) ELSE 'den här telefonen' END AS sender,\n  m.decode_error\nFROM tg_message m\nLEFT JOIN tg_peer p ON p.peer_id = m.peer_id\nLEFT JOIN tg_peer a ON a.peer_id = m.author_id\nWHERE m.timestamp BETWEEN {{unixStart}} AND {{unixEnd}}\nORDER BY m.timestamp, m.id;"
        },
        {
          "id": "role-resources",
          "hidden": true,
          "role": "resources",
          "title": "Härkomst: alla resurser i meddelandena",
          "description": "Används av Härkomst. Varje resurs (en storlek av en bild, en video, en miniatyr) med meddelandets tid, riktning och chatt. Ingen tidsgräns: filen jämförs med varje resurs.",
          "params": [],
          "epoch": "unix",
          "fields": {
            "resourceId": "resource_id",
            "role": "role",
            "size": "size",
            "width": "width",
            "height": "height",
            "messageId": "message_id",
            "peerId": "peer_id",
            "namespace": "namespace",
            "time": "timestamp",
            "incoming": "incoming",
            "media": "media",
            "viewOnce": "view_once",
            "peerType": "peer_type",
            "chatName": "chat_name",
            "sender": "sender"
          },
          "sql": "SELECT\n  r.resource_id, r.role, r.size, r.width, r.height, r.message_id, r.peer_id, r.namespace,\n  m.timestamp, m.incoming, m.media, m.view_once, m.peer_type,\n  COALESCE(p.name, 'Telegram-id ' || m.peer_tg_id) AS chat_name,\n  CASE WHEN m.incoming = 1 THEN COALESCE(a.name, 'Telegram-id ' || m.author_tg_id) ELSE 'den här telefonen' END AS sender\nFROM tg_resource r\nJOIN tg_message m ON m.peer_id = r.peer_id AND m.namespace = r.namespace AND m.id = r.message_id\nLEFT JOIN tg_peer p ON p.peer_id = m.peer_id\nLEFT JOIN tg_peer a ON a.peer_id = m.author_id\nORDER BY m.timestamp, r.message_id;"
        },
        {
          "id": "role-coverage",
          "hidden": true,
          "role": "coverage",
          "title": "Härkomst: täckning",
          "params": [],
          "epoch": "unix",
          "fields": {
            "first": "first_date",
            "last": "last_date",
            "rows": "n_rows"
          },
          "sql": "SELECT\n  MIN(timestamp) AS first_date,\n  MAX(timestamp) AS last_date,\n  COUNT(*) AS n_rows\nFROM tg_message\nWHERE timestamp > 0;"
        }
      ]
    },
    {
      "id": "telegram-ios-storage",
      "label": "iOS — media/storage/db_sqlite (Telegram)",
      "blurb": "Telegrams register över filerna under postbox/media/: vilken chatt och vilket meddelande varje resurs hör till, och bilder som valts ur bildbiblioteket (med bibliotekets id). Avkodas i minnet till tg_storage.",
      "dbPathHint": "/private/var/mobile/Containers/Shared/AppGroup/<GUID>/telegram-data/account-<id>/postbox/media/storage/db/db_sqlite (+ -wal), i appgruppen group.ph.telegra.Telegraph.",
      "paths": [
        "postbox/media/storage/db/db_sqlite"
      ],
      "derive": "telegram-storage",
      "source": "Kontrollerad mot en labbtelefon (iOS 26.4.1, Telegram 13.1.2, 2026-11-03). t15 har resursens id per hash, t16 chatten och meddelandet resursen hör till. Meddelande saknas när det inte var känt när resursen registrerades, till exempel medan en bild laddades upp. En bild som valts ur bildbiblioteket har resursen ph-<bibliotekets id>_L0_001-…, där bibliotekets id är ZUUID i Photos.sqlite, och storleken är den uppladdade bildens. I labbet var den lika stor som bilden i meddelandet som skickades. Typerna 1 bild och 2 video är sedda i labbet. Tabellen tg_storage finns inte i filen: Forensics Toolbox avkodar den i minnet ur t15 och t16 när databasen öppnas. Lagringsdatabasen kan sakna poster om Telegrams cache har tömts.",
      "queries": [
        {
          "id": "storage",
          "title": "Resurser per chatt och meddelande",
          "recommended": true,
          "params": [],
          "subtitle": "Resurserna som hör till en chatt: id, typ, storlek, chatt, meddelande och bildbibliotekets id för bilder valda därifrån.",
          "returns": "resurs, typ, storlek, chatt, meddelande, bildbibliotekets id, peer",
          "sql": "SELECT\n  s.resource_id AS resurs,\n  CASE s.content_type WHEN 1 THEN 'bild' WHEN 2 THEN 'video' WHEN 0 THEN 'övrigt' ELSE 'typ ' || s.content_type END AS typ,\n  s.size AS storlek,\n  CASE s.peer_type WHEN 0 THEN 'användare' WHEN 1 THEN 'grupp' WHEN 2 THEN 'kanal' WHEN 3 THEN 'hemlig chatt' ELSE 'typ ' || s.peer_type END || ' ' || s.peer_tg_id AS chatt,\n  s.message_id AS meddelande_id,\n  s.library_uuid AS bildbibliotekets_id,\n  s.peer_id\nFROM tg_storage s\nWHERE s.peer_id IS NOT NULL\nORDER BY s.peer_id, s.message_id IS NULL, s.message_id, s.resource_id;"
        },
        {
          "id": "library-picks",
          "title": "Bilder valda ur bildbiblioteket",
          "params": [],
          "subtitle": "Bilder som valts ur bildbiblioteket i en chatt, med bibliotekets id (ZUUID i Photos.sqlite) och den uppladdade bildens storlek.",
          "returns": "bildbibliotekets id, chatt, uppladdad storlek, resurs, peer",
          "sql": "SELECT\n  s.library_uuid AS bildbibliotekets_id,\n  CASE s.peer_type WHEN 0 THEN 'användare' WHEN 1 THEN 'grupp' WHEN 2 THEN 'kanal' WHEN 3 THEN 'hemlig chatt' ELSE 'typ ' || s.peer_type END || ' ' || s.peer_tg_id AS chatt,\n  s.size AS uppladdad_storlek,\n  s.resource_id AS resurs,\n  s.peer_id\nFROM tg_storage s\nWHERE s.library_uuid IS NOT NULL\n  AND (s.peer_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM tg_storage x WHERE x.resource_id = s.resource_id AND x.peer_id IS NOT NULL))\nORDER BY s.peer_id, s.library_uuid;"
        },
        {
          "id": "storage-resource",
          "title": "En resurs efter id",
          "params": [
            "resourceId"
          ],
          "subtitle": "Chatten och meddelandet för en fil under postbox/media/. Ange filens namn, med eller utan _partial.",
          "returns": "resurs, typ, storlek, chatt, meddelande, bildbibliotekets id, peer",
          "sql": "SELECT\n  s.resource_id AS resurs,\n  CASE s.content_type WHEN 1 THEN 'bild' WHEN 2 THEN 'video' WHEN 0 THEN 'övrigt' ELSE 'typ ' || s.content_type END AS typ,\n  s.size AS storlek,\n  CASE s.peer_type WHEN 0 THEN 'användare' WHEN 1 THEN 'grupp' WHEN 2 THEN 'kanal' WHEN 3 THEN 'hemlig chatt' ELSE 'typ ' || s.peer_type END || ' ' || s.peer_tg_id AS chatt,\n  s.message_id AS meddelande_id,\n  s.library_uuid AS bildbibliotekets_id,\n  s.peer_id\nFROM tg_storage s\nWHERE s.resource_id = '{{resourceId}}' OR s.resource_id || '_partial' = '{{resourceId}}';"
        },
        {
          "id": "tables",
          "title": "Hjälp: tabeller och antal rader",
          "group": "advanced",
          "params": [],
          "subtitle": "Listar tabellerna i filen och den som avkodats i minnet.",
          "returns": "var, tabell, rader",
          "sql": "SELECT * FROM (\nSELECT 'i filen' AS var, name AS tabell,\n  CASE name WHEN 't15' THEN (SELECT count(*) FROM t15) WHEN 't16' THEN (SELECT count(*) FROM t16) END AS rader\nFROM sqlite_master WHERE type = 'table'\nUNION ALL\nSELECT 'avkodad i minnet', name, CASE name WHEN 'tg_storage' THEN (SELECT count(*) FROM tg_storage) END\nFROM sqlite_temp_master WHERE type = 'table'\n)\nORDER BY var DESC, rader IS NULL, tabell;"
        },
        {
          "id": "role-storage",
          "hidden": true,
          "role": "storage",
          "title": "Härkomst: resurser per chatt",
          "description": "Används av Härkomst. Alla resurser som hör till en chatt, med meddelande och bildbibliotekets id.",
          "params": [],
          "fields": {
            "resourceId": "resource_id",
            "contentType": "content_type",
            "size": "size",
            "peerId": "peer_id",
            "peerType": "peer_type",
            "peerTgId": "peer_tg_id",
            "messageNamespace": "message_namespace",
            "messageId": "message_id",
            "libraryUuid": "library_uuid"
          },
          "sql": "SELECT\n  s.resource_id, s.content_type, s.size, s.peer_id, s.peer_type, s.peer_tg_id, s.message_namespace, s.message_id, s.library_uuid\nFROM tg_storage s\nWHERE s.peer_id IS NOT NULL\nORDER BY s.peer_id, s.message_id;"
        }
      ]
    }
  ]
};
