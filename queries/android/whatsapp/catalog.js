/* Genererad från android/whatsapp/catalog.json — används när fetch() blockeras (file://). */
window.WHATSAPP_ANDROID_CATALOG = {
  "id": "whatsapp-android",
  "title": "WhatsApp Android Queries",
  "sourceNote": "Betafunktion. WhatsApps databaser på Android, lästa ur appens datamapp data/data/com.whatsapp (data/user/0 är samma mapp). De är inte krypterade där. Tiderna är Unix-millisekunder och visas här med datetime(…/1000, 'unixepoch', 'localtime'). Tabeller, kolumner och tider är kontrollerade mot en labbtelefon (Samsung med Android 16, WhatsApp 2.26.43, 2026-11-11). Strukturen kan skilja sig mellan WhatsApp-versioner, så kontrollera alltid mot databasen. WhatsApp Business har sin egen datamapp, com.whatsapp.w4b, som inte är kontrollerad och inte letas upp.",
  "paramLabels": {
    "sha256b64": "SHA-256 i base64 (44 tecken, som i databasen)",
    "threadId": "Chattens id (_id i chat)"
  },
  "databases": [
    {
      "id": "whatsapp-android-msgstore",
      "label": "Android — msgstore.db (WhatsApp)",
      "blurb": "Meddelanden, mediefiler, kvitton på leverans och läsning, raderade meddelanden, chattar och gruppmedlemmar. Kontona står som JID: numrets (…@s.whatsapp.net) när WhatsApp har kopplat det till kontots lid, annars lid (…@lid). Namnen står i wa.db.",
      "dbPathHint": "/data/data/com.whatsapp/databases/msgstore.db (+ -wal). Mediefilerna ligger under /data/media/0/Android/media/com.whatsapp/WhatsApp/Media/.",
      "paths": [
        "data/data/com.whatsapp/databases/msgstore.db"
      ],
      "source": "Kontrollerad mot en labbtelefon (Samsung med Android 16, WhatsApp 2.26.43, 2026-11-11), där telefonens egna tider jämfördes med den andra labbtelefonens. timestamp är för ett skickat meddelande telefonens klocka när det skrevs, och för ett mottaget avsändarens tid i hela sekunder. received_timestamp är när ett mottaget meddelande kom in på telefonen; på skickade mediefiler står där en tid strax efter att meddelandet skrevs, och vad den betyder är inte kontrollerat. receipt_user har en rad per mottagare med när meddelandet levererades (receipt_timestamp), lästes (read_timestamp) och spelades upp (played_timestamp; ingen sådan fanns i labbet). Ett meddelande som raderats för alla har typ 15, behåller tiden då det skrevs och får raderingens tid i message_revoked (sett för ett skickat meddelande). message_type: 0 text, 1 bild, 2 ljud (röstmeddelande), 3 video, 7 systemmeddelande, 9 dokument och 15 raderat för alla är sedda i labbet; 4 kontaktkort, 5 plats, 10 missat samtal, 13 gif, 14 flera kontaktkort, 16 plats i realtid, 20 klistermärke och 42 och 43 bild och video för engångsvisning är vanliga tolkningar som inte är kontrollerade; andra visas som typ N. status: 13 hade de skickade meddelanden som mottagaren läst, 5 de som bara levererats, 6 systemraderna och 0 de mottagna. För mediefiler stämde file_length och file_hash (SHA-256 i base64) med filerna i extraktionen för fem filer; en mottagen video som inte hämtats hade ingen sökväg. Bildtexten står i text_data för bilder och videor och i media_caption för dokument, där text_data i stället hade filens namn. En enskild chatt hör till motpartens lid, och jid_map kopplade den till numrets JID. I labbet fanns också en dold chatt utan meddelanden under telefonens eget lid; att det är telefonens eget syns i self_lid i shared_prefs/com.whatsapp_preferences_light.xml, inte i databasen. receipt_server_timestamp är i hela sekunder och låg inom en sekund från att meddelandet skrevs; för det raderade meddelandet stod där raderingens tid. Svar (message_quoted), redigeringar (message_edit_info), platser (message_location) och kontaktkort (message_vcard) läses efter tabellernas kolumner och fanns inte i labbet.",
      "chatApp": "WhatsApp",
      "queries": [
        {
          "id": "messages",
          "title": "Meddelanden i tidsspann",
          "recommended": true,
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar meddelandena i tidsspannet: när de skrevs, när mottagna kom in på telefonen, riktning, typ, chatt, avsändare, text och mediefilen.",
          "returns": "tid, mottaget, riktning, typ, chatt, från, text, mediefil, status, id, chatt-id, UTC",
          "sql": "SELECT\n  datetime(m.timestamp / 1000, 'unixepoch', 'localtime') AS tid_lokal,\n  CASE WHEN m.from_me = 0 AND m.received_timestamp > 0 THEN datetime(m.received_timestamp / 1000, 'unixepoch', 'localtime') END AS mottaget_lokal,\n  CASE WHEN m.message_type = 7 THEN 'system' WHEN m.from_me = 1 THEN 'skickat' ELSE 'mottaget' END AS riktning,\n  CASE m.message_type WHEN 0 THEN 'text' WHEN 1 THEN 'bild' WHEN 2 THEN CASE WHEN (mm.file_path LIKE '%WhatsApp Voice Notes/%' OR m.origin = 1) THEN 'röstmeddelande' ELSE 'ljud' END\n    WHEN 3 THEN 'video' WHEN 4 THEN 'kontaktkort' WHEN 5 THEN 'plats' WHEN 7 THEN 'systemmeddelande' WHEN 9 THEN 'dokument' WHEN 10 THEN 'missat samtal'\n    WHEN 13 THEN 'gif' WHEN 14 THEN 'flera kontaktkort' WHEN 15 THEN 'raderat för alla' WHEN 16 THEN 'plats i realtid' WHEN 20 THEN 'klistermärke'\n    WHEN 42 THEN 'bild (engångsvisning)' WHEN 43 THEN 'video (engångsvisning)' ELSE 'typ ' || m.message_type END AS typ,\n  COALESCE(NULLIF(c.subject, ''), cp.raw_string, cj.raw_string, '#' || c._id) AS chatt,\n  CASE WHEN m.from_me = 1 AND m.message_type <> 7 THEN 'den här telefonen' ELSE COALESCE(sp.raw_string, sj.raw_string, CASE WHEN cj.server <> 'g.us' AND m.message_type <> 7 THEN COALESCE(cp.raw_string, cj.raw_string) END) END AS fran,\n  COALESCE(NULLIF(mm.media_caption, ''), CASE WHEN m.message_type <> 9 THEN m.text_data END) AS text,\n  mm.file_path AS mediefil,\n  m.status AS status,\n  m._id AS meddelande_id,\n  c._id AS chatt_id,\n  datetime(m.timestamp / 1000, 'unixepoch') AS tid_utc\nFROM message m\nJOIN chat c ON c._id = m.chat_row_id\nLEFT JOIN jid cj ON cj._id = c.jid_row_id\nLEFT JOIN jid_map cm ON cm.lid_row_id = c.jid_row_id\nLEFT JOIN jid cp ON cp._id = cm.jid_row_id\nLEFT JOIN jid sj ON sj._id = m.sender_jid_row_id\nLEFT JOIN jid_map sm ON sm.lid_row_id = m.sender_jid_row_id\nLEFT JOIN jid sp ON sp._id = sm.jid_row_id\nLEFT JOIN message_media mm ON mm.message_row_id = m._id\nWHERE m.timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\n   OR m.received_timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY m.timestamp, m._id;",
          "chat": {
            "thread": "chatt_id",
            "message": "meddelande_id"
          }
        },
        {
          "id": "media",
          "title": "Mediefiler i tidsspann",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar bilder, videor, röstmeddelanden och dokument i tidsspannet med meddelandets tid och riktning, sökvägen under WhatsApps mediamapp, storlek, MIME-typ och SHA-256 (base64).",
          "returns": "tid, riktning, typ, chatt, från, fil, storlek, MIME, SHA-256, längd, mått, filnamn, hämtad, id, UTC",
          "sql": "SELECT\n  datetime(m.timestamp / 1000, 'unixepoch', 'localtime') AS tid_lokal,\n  CASE WHEN m.message_type = 7 THEN 'system' WHEN m.from_me = 1 THEN 'skickad' ELSE 'mottagen' END AS riktning,\n  CASE m.message_type WHEN 0 THEN 'text' WHEN 1 THEN 'bild' WHEN 2 THEN CASE WHEN (mm.file_path LIKE '%WhatsApp Voice Notes/%' OR m.origin = 1) THEN 'röstmeddelande' ELSE 'ljud' END\n    WHEN 3 THEN 'video' WHEN 4 THEN 'kontaktkort' WHEN 5 THEN 'plats' WHEN 7 THEN 'systemmeddelande' WHEN 9 THEN 'dokument' WHEN 10 THEN 'missat samtal'\n    WHEN 13 THEN 'gif' WHEN 14 THEN 'flera kontaktkort' WHEN 15 THEN 'raderat för alla' WHEN 16 THEN 'plats i realtid' WHEN 20 THEN 'klistermärke'\n    WHEN 42 THEN 'bild (engångsvisning)' WHEN 43 THEN 'video (engångsvisning)' ELSE 'typ ' || m.message_type END AS typ,\n  COALESCE(NULLIF(c.subject, ''), cp.raw_string, cj.raw_string, '#' || c._id) AS chatt,\n  CASE WHEN m.from_me = 1 AND m.message_type <> 7 THEN 'den här telefonen' ELSE COALESCE(sp.raw_string, sj.raw_string, CASE WHEN cj.server <> 'g.us' AND m.message_type <> 7 THEN COALESCE(cp.raw_string, cj.raw_string) END) END AS fran,\n  mm.file_path AS fil,\n  mm.file_length AS storlek,\n  NULLIF(mm.mime_type, '') AS mime,\n  mm.file_hash AS sha256_base64,\n  CASE WHEN mm.media_duration > 0 THEN mm.media_duration || ' s' END AS langd,\n  CASE WHEN mm.width > 0 THEN mm.width || ' x ' || mm.height END AS matt,\n  mm.media_name AS filnamn,\n  CASE WHEN mm.transferred = 1 THEN 'ja' ELSE 'nej' END AS hamtad,\n  m._id AS meddelande_id,\n  datetime(m.timestamp / 1000, 'unixepoch') AS tid_utc\nFROM message_media mm\nJOIN message m ON m._id = mm.message_row_id\nJOIN chat c ON c._id = m.chat_row_id\nLEFT JOIN jid cj ON cj._id = c.jid_row_id\nLEFT JOIN jid_map cm ON cm.lid_row_id = c.jid_row_id\nLEFT JOIN jid cp ON cp._id = cm.jid_row_id\nLEFT JOIN jid sj ON sj._id = m.sender_jid_row_id\nLEFT JOIN jid_map sm ON sm.lid_row_id = m.sender_jid_row_id\nLEFT JOIN jid sp ON sp._id = sm.jid_row_id\nWHERE m.timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\n   OR m.received_timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY m.timestamp, m._id;",
          "description": "Sökvägen räknas från /data/media/0/Android/media/com.whatsapp/WhatsApp/. hämtad säger om filen finns på telefonen enligt databasen (transferred)."
        },
        {
          "id": "media-by-sha256",
          "title": "En mediefil efter SHA-256 (base64)",
          "timeEpoch": "unix-ms",
          "params": [
            "sha256b64"
          ],
          "subtitle": "Letar upp mediefilen med en viss SHA-256. WhatsApp sparar summan i base64 (44 tecken) i file_hash.",
          "returns": "tid, riktning, typ, chatt, från, fil, storlek, MIME, SHA-256, längd, mått, filnamn, hämtad, id, UTC",
          "sql": "SELECT\n  datetime(m.timestamp / 1000, 'unixepoch', 'localtime') AS tid_lokal,\n  CASE WHEN m.message_type = 7 THEN 'system' WHEN m.from_me = 1 THEN 'skickad' ELSE 'mottagen' END AS riktning,\n  CASE m.message_type WHEN 0 THEN 'text' WHEN 1 THEN 'bild' WHEN 2 THEN CASE WHEN (mm.file_path LIKE '%WhatsApp Voice Notes/%' OR m.origin = 1) THEN 'röstmeddelande' ELSE 'ljud' END\n    WHEN 3 THEN 'video' WHEN 4 THEN 'kontaktkort' WHEN 5 THEN 'plats' WHEN 7 THEN 'systemmeddelande' WHEN 9 THEN 'dokument' WHEN 10 THEN 'missat samtal'\n    WHEN 13 THEN 'gif' WHEN 14 THEN 'flera kontaktkort' WHEN 15 THEN 'raderat för alla' WHEN 16 THEN 'plats i realtid' WHEN 20 THEN 'klistermärke'\n    WHEN 42 THEN 'bild (engångsvisning)' WHEN 43 THEN 'video (engångsvisning)' ELSE 'typ ' || m.message_type END AS typ,\n  COALESCE(NULLIF(c.subject, ''), cp.raw_string, cj.raw_string, '#' || c._id) AS chatt,\n  CASE WHEN m.from_me = 1 AND m.message_type <> 7 THEN 'den här telefonen' ELSE COALESCE(sp.raw_string, sj.raw_string, CASE WHEN cj.server <> 'g.us' AND m.message_type <> 7 THEN COALESCE(cp.raw_string, cj.raw_string) END) END AS fran,\n  mm.file_path AS fil,\n  mm.file_length AS storlek,\n  NULLIF(mm.mime_type, '') AS mime,\n  mm.file_hash AS sha256_base64,\n  CASE WHEN mm.media_duration > 0 THEN mm.media_duration || ' s' END AS langd,\n  CASE WHEN mm.width > 0 THEN mm.width || ' x ' || mm.height END AS matt,\n  mm.media_name AS filnamn,\n  CASE WHEN mm.transferred = 1 THEN 'ja' ELSE 'nej' END AS hamtad,\n  m._id AS meddelande_id,\n  datetime(m.timestamp / 1000, 'unixepoch') AS tid_utc\nFROM message_media mm\nJOIN message m ON m._id = mm.message_row_id\nJOIN chat c ON c._id = m.chat_row_id\nLEFT JOIN jid cj ON cj._id = c.jid_row_id\nLEFT JOIN jid_map cm ON cm.lid_row_id = c.jid_row_id\nLEFT JOIN jid cp ON cp._id = cm.jid_row_id\nLEFT JOIN jid sj ON sj._id = m.sender_jid_row_id\nLEFT JOIN jid_map sm ON sm.lid_row_id = m.sender_jid_row_id\nLEFT JOIN jid sp ON sp._id = sm.jid_row_id\nWHERE mm.file_hash = '{{sha256b64}}'\nORDER BY m.timestamp, m._id;"
        },
        {
          "id": "receipts",
          "title": "Kvitton: levererat, läst och uppspelat",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar för skickade meddelanden när varje mottagare fick meddelandet, läste det och spelade upp det. En rad per mottagare, så ett meddelande i en grupp ger flera rader.",
          "returns": "skrivet, typ, chatt, mottagare, levererat, läst, uppspelat, id, UTC",
          "sql": "SELECT\n  datetime(m.timestamp / 1000, 'unixepoch', 'localtime') AS skrivet_lokal,\n  CASE m.message_type WHEN 0 THEN 'text' WHEN 1 THEN 'bild' WHEN 2 THEN CASE WHEN (mm.file_path LIKE '%WhatsApp Voice Notes/%' OR m.origin = 1) THEN 'röstmeddelande' ELSE 'ljud' END\n    WHEN 3 THEN 'video' WHEN 4 THEN 'kontaktkort' WHEN 5 THEN 'plats' WHEN 7 THEN 'systemmeddelande' WHEN 9 THEN 'dokument' WHEN 10 THEN 'missat samtal'\n    WHEN 13 THEN 'gif' WHEN 14 THEN 'flera kontaktkort' WHEN 15 THEN 'raderat för alla' WHEN 16 THEN 'plats i realtid' WHEN 20 THEN 'klistermärke'\n    WHEN 42 THEN 'bild (engångsvisning)' WHEN 43 THEN 'video (engångsvisning)' ELSE 'typ ' || m.message_type END AS typ,\n  COALESCE(NULLIF(c.subject, ''), cp.raw_string, cj.raw_string, '#' || c._id) AS chatt,\n  COALESCE(rp.raw_string, rj.raw_string) AS mottagare,\n  CASE WHEN r.receipt_timestamp > 0 THEN datetime(r.receipt_timestamp / 1000, 'unixepoch', 'localtime') END AS levererat_lokal,\n  CASE WHEN r.read_timestamp > 0 THEN datetime(r.read_timestamp / 1000, 'unixepoch', 'localtime') END AS last_lokal,\n  CASE WHEN r.played_timestamp > 0 THEN datetime(r.played_timestamp / 1000, 'unixepoch', 'localtime') END AS uppspelat_lokal,\n  m._id AS meddelande_id,\n  datetime(m.timestamp / 1000, 'unixepoch') AS skrivet_utc\nFROM receipt_user r\nJOIN message m ON m._id = r.message_row_id\nJOIN chat c ON c._id = m.chat_row_id\nLEFT JOIN jid cj ON cj._id = c.jid_row_id\nLEFT JOIN jid_map cm ON cm.lid_row_id = c.jid_row_id\nLEFT JOIN jid cp ON cp._id = cm.jid_row_id\nLEFT JOIN message_media mm ON mm.message_row_id = m._id\nLEFT JOIN jid rj ON rj._id = r.receipt_user_jid_row_id\nLEFT JOIN jid_map rm ON rm.lid_row_id = r.receipt_user_jid_row_id\nLEFT JOIN jid rp ON rp._id = rm.jid_row_id\nWHERE m.timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\n   OR r.receipt_timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\n   OR r.read_timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\n   OR r.played_timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY m.timestamp, m._id, r._id;",
          "description": "Tiderna kommer från mottagarens kvitton. Läst saknas när mottagaren har stängt av läskvitton eller inte har öppnat chatten."
        },
        {
          "id": "deleted",
          "title": "Meddelanden raderade för alla",
          "params": [],
          "subtitle": "Visar meddelandena som raderats för alla i chatten: när meddelandet skrevs och när det raderades. Texten finns inte kvar i databasen.",
          "returns": "skrivet, raderat, riktning, chatt, från, id, chatt-id, UTC",
          "sql": "SELECT\n  datetime(m.timestamp / 1000, 'unixepoch', 'localtime') AS skrivet_lokal,\n  CASE WHEN rv.revoke_timestamp > 0 THEN datetime(rv.revoke_timestamp / 1000, 'unixepoch', 'localtime') END AS raderat_lokal,\n  CASE WHEN m.message_type = 7 THEN 'system' WHEN m.from_me = 1 THEN 'skickat' ELSE 'mottaget' END AS riktning,\n  COALESCE(NULLIF(c.subject, ''), cp.raw_string, cj.raw_string, '#' || c._id) AS chatt,\n  CASE WHEN m.from_me = 1 AND m.message_type <> 7 THEN 'den här telefonen' ELSE COALESCE(sp.raw_string, sj.raw_string, CASE WHEN cj.server <> 'g.us' AND m.message_type <> 7 THEN COALESCE(cp.raw_string, cj.raw_string) END) END AS fran,\n  m._id AS meddelande_id,\n  c._id AS chatt_id,\n  datetime(m.timestamp / 1000, 'unixepoch') AS skrivet_utc,\n  CASE WHEN rv.revoke_timestamp > 0 THEN datetime(rv.revoke_timestamp / 1000, 'unixepoch') END AS raderat_utc\nFROM message_revoked rv\nJOIN message m ON m._id = rv.message_row_id\nJOIN chat c ON c._id = m.chat_row_id\nLEFT JOIN jid cj ON cj._id = c.jid_row_id\nLEFT JOIN jid_map cm ON cm.lid_row_id = c.jid_row_id\nLEFT JOIN jid cp ON cp._id = cm.jid_row_id\nLEFT JOIN jid sj ON sj._id = m.sender_jid_row_id\nLEFT JOIN jid_map sm ON sm.lid_row_id = m.sender_jid_row_id\nLEFT JOIN jid sp ON sp._id = sm.jid_row_id\nORDER BY rv.revoke_timestamp, m._id;"
        },
        {
          "id": "chats",
          "title": "Chattar",
          "params": [],
          "subtitle": "Visar alla chattar: person, grupp eller annat, namn, JID, numrets JID när det är känt, antal meddelanden och det första och senaste meddelandet.",
          "returns": "id, slag, chatt, JID, numrets JID, meddelanden, första, senaste, skapad, arkiverad, dold",
          "sql": "SELECT\n  c._id AS chatt_id,\n  CASE WHEN cj.server = 'g.us' THEN 'grupp' WHEN cj.server = 'newsletter' THEN 'kanal' WHEN cj.server = 'broadcast' THEN 'status eller utskick'\n    WHEN cj.server IN ('lid', 's.whatsapp.net') THEN 'person' ELSE COALESCE(cj.server, 'okänt') END AS slag,\n  COALESCE(NULLIF(c.subject, ''), cp.raw_string, cj.raw_string, '#' || c._id) AS chatt,\n  cj.raw_string AS jid,\n  cp.raw_string AS nummer_jid,\n  (SELECT count(*) FROM message m WHERE m.chat_row_id = c._id) AS meddelanden,\n  (SELECT datetime(min(m.timestamp) / 1000, 'unixepoch', 'localtime') FROM message m WHERE m.chat_row_id = c._id) AS forsta_lokal,\n  (SELECT datetime(max(m.timestamp) / 1000, 'unixepoch', 'localtime') FROM message m WHERE m.chat_row_id = c._id) AS senaste_lokal,\n  CASE WHEN c.created_timestamp > 0 THEN datetime(c.created_timestamp / 1000, 'unixepoch', 'localtime') END AS skapad_lokal,\n  CASE WHEN c.archived = 1 THEN 'ja' END AS arkiverad,\n  CASE WHEN c.hidden = 1 THEN 'ja' END AS dold\nFROM chat c\nLEFT JOIN jid cj ON cj._id = c.jid_row_id\nLEFT JOIN jid_map cm ON cm.lid_row_id = c.jid_row_id\nLEFT JOIN jid cp ON cp._id = cm.jid_row_id\nORDER BY senaste_lokal DESC, c._id;",
          "description": "En grupp har sitt namn i subject. En enskild chatt har inget namn här: namnet står i wa.db, under numrets JID."
        },
        {
          "id": "group-members",
          "title": "Gruppmedlemmar",
          "params": [],
          "subtitle": "Visar medlemmarna i varje grupp med JID, roll och när de lades till. Den här telefonens eget konto står med bland medlemmarna.",
          "returns": "chatt-id, chatt, medlem, medlemmens JID, den här telefonen, roll, tillagd",
          "sql": "SELECT\n  c._id AS chatt_id,\n  COALESCE(NULLIF(c.subject, ''), cj.raw_string) AS chatt,\n  COALESCE(up.raw_string, uj.raw_string) AS medlem,\n  uj.raw_string AS medlem_jid,\n  CASE WHEN uj.server IN ('lid_me', 'status_me') THEN 'ja' END AS den_har_telefonen,\n  CASE gp.rank WHEN 0 THEN 'medlem' WHEN 1 THEN 'administratör' WHEN 2 THEN 'skapare' ELSE 'rang ' || gp.rank END AS roll,\n  CASE WHEN gp.add_timestamp > 0 THEN datetime(gp.add_timestamp / 1000, 'unixepoch', 'localtime') END AS tillagd_lokal\nFROM group_participant_user gp\nJOIN jid uj ON uj._id = gp.user_jid_row_id\nLEFT JOIN jid_map um ON um.lid_row_id = gp.user_jid_row_id\nLEFT JOIN jid up ON up._id = um.jid_row_id\nLEFT JOIN chat c ON c.jid_row_id = gp.group_jid_row_id\nLEFT JOIN jid cj ON cj._id = gp.group_jid_row_id\nORDER BY c._id, gp.rank DESC, gp._id;",
          "description": "rank 2 hade den som skapade gruppen i labbet och 0 en vanlig medlem. 1 för administratör är en vanlig tolkning som inte är kontrollerad."
        },
        {
          "id": "tables",
          "title": "Hjälp: tabeller och antal rader",
          "group": "advanced",
          "params": [],
          "subtitle": "Listar databasens tabeller med antal rader för de viktigaste.",
          "returns": "tabell, rader",
          "sql": "SELECT name AS tabell,\n  CASE name\n    WHEN 'message' THEN (SELECT count(*) FROM message)\n    WHEN 'message_media' THEN (SELECT count(*) FROM message_media)\n    WHEN 'chat' THEN (SELECT count(*) FROM chat)\n    WHEN 'jid' THEN (SELECT count(*) FROM jid)\n    WHEN 'jid_map' THEN (SELECT count(*) FROM jid_map)\n    WHEN 'receipt_user' THEN (SELECT count(*) FROM receipt_user)\n    WHEN 'message_revoked' THEN (SELECT count(*) FROM message_revoked)\n    WHEN 'message_system' THEN (SELECT count(*) FROM message_system)\n    WHEN 'group_participant_user' THEN (SELECT count(*) FROM group_participant_user)\n  END AS rader\nFROM sqlite_master\nWHERE type = 'table'\nORDER BY rader IS NULL, name;"
        },
        {
          "id": "role-media",
          "hidden": true,
          "role": "media",
          "title": "Härkomst: alla mediefiler",
          "description": "Används av Härkomst. Varje mediefil med meddelandets tid, riktning, chatt, avsändare, sökväg, storlek och två SHA-256 i base64: filens (file_hash) och originalets före omkodningen (original_file_hash, när WhatsApp har sparat den). Ingen tidsgräns: filen jämförs med varje rad.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "messageId": "message_id",
            "type": "message_type",
            "fromMe": "from_me",
            "date": "timestamp",
            "received": "received_at",
            "chatId": "chat_id",
            "chatSubject": "chat_subject",
            "chatJid": "chat_jid",
            "group": "is_group",
            "sender": "sender",
            "voice": "voice",
            "mime": "mime",
            "path": "file_path",
            "size": "file_bytes",
            "sha256": "sha256_b64",
            "original": "original_sha256_b64",
            "duration": "duration_s",
            "transferred": "transferred",
            "name": "media_name"
          },
          "sql": "SELECT\n  mm.message_row_id AS message_id,\n  m.message_type, m.from_me, m.timestamp,\n  CASE WHEN m.from_me = 0 AND m.received_timestamp > 0 THEN m.received_timestamp END AS received_at,\n  m.chat_row_id AS chat_id, NULLIF(c.subject, '') AS chat_subject, COALESCE(cp.raw_string, cj.raw_string) AS chat_jid,\n  CASE WHEN cj.server = 'g.us' THEN 1 ELSE 0 END AS is_group,\n  CASE WHEN m.from_me = 1 THEN 'den här telefonen' ELSE COALESCE(sp.raw_string, sj.raw_string, CASE WHEN cj.server <> 'g.us' THEN COALESCE(cp.raw_string, cj.raw_string) END) END AS sender,\n  CASE WHEN m.message_type = 2 AND (mm.file_path LIKE '%WhatsApp Voice Notes/%' OR m.origin = 1) THEN 1 ELSE 0 END AS voice,\n  NULLIF(mm.mime_type, '') AS mime,\n  NULLIF(mm.file_path, '') AS file_path,\n  COALESCE(NULLIF(mm.file_length, 0), NULLIF(mm.file_size, 0)) AS file_bytes,\n  CASE WHEN length(mm.file_hash) = 44 THEN mm.file_hash END AS sha256_b64,\n  CASE WHEN length(mm.original_file_hash) = 44 THEN mm.original_file_hash END AS original_sha256_b64,\n  CASE WHEN mm.media_duration > 0 THEN mm.media_duration END AS duration_s,\n  mm.transferred, mm.media_name\nFROM message_media mm\nJOIN message m ON m._id = mm.message_row_id\nJOIN chat c ON c._id = m.chat_row_id\nLEFT JOIN jid cj ON cj._id = c.jid_row_id\nLEFT JOIN jid_map cm ON cm.lid_row_id = c.jid_row_id\nLEFT JOIN jid cp ON cp._id = cm.jid_row_id\nLEFT JOIN jid sj ON sj._id = m.sender_jid_row_id\nLEFT JOIN jid_map sm ON sm.lid_row_id = m.sender_jid_row_id\nLEFT JOIN jid sp ON sp._id = sm.jid_row_id\nORDER BY m.timestamp, m._id;"
        },
        {
          "id": "role-messages",
          "hidden": true,
          "role": "messages",
          "title": "Härkomst: meddelanden i tidsfönstret",
          "description": "Används av Härkomst. Meddelandena som skrevs eller kom in i fönstret, med tid, riktning, typ, chatt och avsändare. Texten tas inte med.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "unixMs",
          "fields": {
            "id": "message_id",
            "type": "message_type",
            "fromMe": "from_me",
            "date": "timestamp",
            "received": "received_at",
            "chatId": "chat_id",
            "chatSubject": "chat_subject",
            "chatJid": "chat_jid",
            "group": "is_group",
            "sender": "sender",
            "voice": "voice",
            "mime": "mime",
            "mediaId": "media_id",
            "hasText": "has_text"
          },
          "sql": "SELECT\n  m._id AS message_id,\n  m.message_type, m.from_me, m.timestamp,\n  CASE WHEN m.from_me = 0 AND m.received_timestamp > 0 THEN m.received_timestamp END AS received_at,\n  m.chat_row_id AS chat_id, NULLIF(c.subject, '') AS chat_subject, COALESCE(cp.raw_string, cj.raw_string) AS chat_jid,\n  CASE WHEN cj.server = 'g.us' THEN 1 ELSE 0 END AS is_group,\n  CASE WHEN m.from_me = 1 THEN 'den här telefonen' ELSE COALESCE(sp.raw_string, sj.raw_string, CASE WHEN cj.server <> 'g.us' THEN COALESCE(cp.raw_string, cj.raw_string) END) END AS sender,\n  CASE WHEN m.message_type = 2 AND (mm.file_path LIKE '%WhatsApp Voice Notes/%' OR m.origin = 1) THEN 1 ELSE 0 END AS voice,\n  NULLIF(mm.mime_type, '') AS mime,\n  mm.message_row_id AS media_id,\n  CASE WHEN COALESCE(NULLIF(mm.media_caption, ''), m.text_data, '') <> '' THEN 1 ELSE 0 END AS has_text\nFROM message m\nJOIN chat c ON c._id = m.chat_row_id\nLEFT JOIN jid cj ON cj._id = c.jid_row_id\nLEFT JOIN jid_map cm ON cm.lid_row_id = c.jid_row_id\nLEFT JOIN jid cp ON cp._id = cm.jid_row_id\nLEFT JOIN jid sj ON sj._id = m.sender_jid_row_id\nLEFT JOIN jid_map sm ON sm.lid_row_id = m.sender_jid_row_id\nLEFT JOIN jid sp ON sp._id = sm.jid_row_id\nLEFT JOIN message_media mm ON mm.message_row_id = m._id\nWHERE m.timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\n   OR (m.from_me = 0 AND m.received_timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}})\nORDER BY m.timestamp, m._id;"
        },
        {
          "id": "role-coverage",
          "hidden": true,
          "role": "coverage",
          "title": "Härkomst: täckning",
          "description": "Används av Härkomst. Första och sista meddelandets tid och antalet meddelanden som finns kvar.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "first": "first_date",
            "last": "last_date",
            "rows": "n_rows"
          },
          "sql": "SELECT MIN(m.timestamp) AS first_date, MAX(m.timestamp) AS last_date, COUNT(*) AS n_rows\nFROM message m\nJOIN chat c ON c._id = m.chat_row_id\nWHERE m.timestamp > 0;"
        },
        {
          "id": "chat-threads",
          "hidden": true,
          "role": "chat-threads",
          "title": "Chattar: konversationer",
          "description": "Används av Chattar. Chattarna med namn, slag (efter JID:ens domän), antal meddelanden och första och senaste meddelandets råa tid. En enskild chatt får sitt namn ur wa.db genom deltagaren. En dold chatt utan meddelanden tas inte med; den står i queryn Chattar.",
          "params": [],
          "epoch": "unixMs",
          "nameFromMembers": "person",
          "fields": {
            "id": "chat_id",
            "name": "chat_name",
            "kind": "chat_kind",
            "address": "chat_address",
            "kindRaw": "jid_server",
            "messages": "message_count",
            "first": "first_ms",
            "last": "last_ms",
            "archived": "archived",
            "hidden": "hidden"
          },
          "sql": "SELECT\n  c._id AS chat_id,\n  COALESCE(NULLIF(c.subject, ''), cp.raw_string, cj.raw_string, '#' || c._id) AS chat_name,\n  CASE WHEN cj.server = 'g.us' THEN 'group' WHEN cj.server = 'newsletter' THEN 'channel' WHEN cj.server = 'broadcast' THEN 'status'\n    WHEN cj.server IN ('lid', 's.whatsapp.net') THEN 'person' ELSE 'other' END AS chat_kind,\n  COALESCE(cp.raw_string, cj.raw_string) AS chat_address, cj.server AS jid_server,\n  (SELECT count(*) FROM message m WHERE m.chat_row_id = c._id) AS message_count,\n  (SELECT min(m.timestamp) FROM message m WHERE m.chat_row_id = c._id) AS first_ms,\n  (SELECT max(m.timestamp) FROM message m WHERE m.chat_row_id = c._id) AS last_ms,\n  c.archived, c.hidden\nFROM chat c\nLEFT JOIN jid cj ON cj._id = c.jid_row_id\nLEFT JOIN jid_map cm ON cm.lid_row_id = c.jid_row_id\nLEFT JOIN jid cp ON cp._id = cm.jid_row_id\nWHERE COALESCE(c.hidden, 0) = 0 OR EXISTS (SELECT 1 FROM message m WHERE m.chat_row_id = c._id)\nORDER BY last_ms DESC, c._id;"
        },
        {
          "id": "chat-members",
          "hidden": true,
          "role": "chat-members",
          "title": "Chattar: deltagare",
          "description": "Används av Chattar. Gruppmedlemmarna (group_participant_user) utom telefonens eget konto, och motparten i en enskild chatt. Id:t är numrets JID när jid_map har det, annars lid.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "threadId": "chat_id",
            "id": "member_jid",
            "name": "member_name",
            "address": "member_address",
            "admin": "is_admin",
            "note": "member_note"
          },
          "sql": "SELECT\n  c._id AS chat_id,\n  COALESCE(up.raw_string, uj.raw_string) AS member_jid,\n  COALESCE(up.raw_string, uj.raw_string) AS member_name,\n  COALESCE(up.raw_string, uj.raw_string) AS member_address,\n  CASE WHEN gp.rank > 0 THEN 1 ELSE 0 END AS is_admin,\n  CASE WHEN up._id IS NOT NULL THEN uj.raw_string END AS member_note\nFROM group_participant_user gp\nJOIN chat c ON c.jid_row_id = gp.group_jid_row_id\nJOIN jid uj ON uj._id = gp.user_jid_row_id\nLEFT JOIN jid_map um ON um.lid_row_id = gp.user_jid_row_id\nLEFT JOIN jid up ON up._id = um.jid_row_id\nWHERE uj.server NOT IN ('lid_me', 'status_me')\nUNION ALL\nSELECT\n  c._id, COALESCE(cp.raw_string, cj.raw_string), COALESCE(cp.raw_string, cj.raw_string), COALESCE(cp.raw_string, cj.raw_string), NULL,\n  CASE WHEN cp._id IS NOT NULL THEN cj.raw_string END\nFROM chat c\nJOIN jid cj ON cj._id = c.jid_row_id\nLEFT JOIN jid_map cm ON cm.lid_row_id = c.jid_row_id\nLEFT JOIN jid cp ON cp._id = cm.jid_row_id\nWHERE cj.server IN ('lid', 's.whatsapp.net')\nORDER BY 1, 2;"
        },
        {
          "id": "chat-messages",
          "hidden": true,
          "role": "chat-messages",
          "title": "Chattar: meddelandena i en chatt",
          "description": "Används av Chattar. Alla meddelanden i chatten med råa tider, riktning, avsändarens JID, text och typ. Typerna tolkas som i queryn Meddelanden i tidsspann. Namnen kommer ur wa.db.",
          "params": [
            "threadId"
          ],
          "epoch": "unixMs",
          "times": [
            {
              "key": "written",
              "label": "Skrivet",
              "note": "timestamp: telefonens klocka när ett skickat meddelande skrevs. För ett mottaget avsändarens tid, i hela sekunder."
            },
            {
              "key": "arrived",
              "label": "Kom in på telefonen",
              "note": "received_timestamp: när ett mottaget meddelande kom in på den här telefonen."
            },
            {
              "key": "sentOther",
              "label": "Okänd tid på skickat meddelande",
              "note": "received_timestamp på ett skickat meddelande (här received_timestamp_sent). I labbet stod den på skickade mediefiler, upp till två sekunder efter att meddelandet skrevs. Vad den betyder är inte kontrollerat."
            },
            {
              "key": "server",
              "label": "Serverns kvitto",
              "note": "receipt_server_timestamp: när WhatsApps server tog emot ett skickat meddelande, i hela sekunder. För ett meddelande som raderats för alla stod här raderingens tid i labbet."
            },
            {
              "key": "delivered",
              "label": "Levererat",
              "note": "receipt_timestamp i receipt_user: när meddelandet levererades till mottagaren. I en grupp den första mottagaren; alla står i queryn Kvitton."
            },
            {
              "key": "read",
              "label": "Läst",
              "note": "read_timestamp i receipt_user: när mottagaren läste meddelandet. I en grupp den första som läste."
            },
            {
              "key": "played",
              "label": "Uppspelat",
              "note": "played_timestamp i receipt_user: när mottagaren spelade upp ett röstmeddelande. Inte kontrollerad i labbet."
            },
            {
              "key": "revoked",
              "label": "Raderat för alla",
              "note": "revoke_timestamp i message_revoked: när meddelandet raderades för alla."
            },
            {
              "key": "editedAt",
              "label": "Redigerat",
              "note": "edited_timestamp i message_edit_info: när meddelandet redigerades. Inte kontrollerad i labbet."
            }
          ],
          "sortTime": "written",
          "details": [
            {
              "key": "status",
              "label": "Status (status, rått värde)"
            },
            {
              "key": "typeRaw",
              "label": "Typ (message_type)"
            },
            {
              "key": "keyId",
              "label": "Meddelandets id hos WhatsApp (key_id)"
            },
            {
              "key": "starred",
              "label": "Stjärnmärkt (starred)"
            },
            {
              "key": "action",
              "label": "Händelsetyp (action_type i message_system, rått värde)"
            }
          ],
          "fields": {
            "id": "message_id",
            "threadId": "chat_id",
            "fromMe": "from_me",
            "senderId": "sender_jid",
            "text": "body",
            "kind": "kind",
            "kindLabel": "kind_label",
            "typeRaw": "message_type",
            "viewOnce": "view_once",
            "edited": "edited",
            "replyTo": "reply_to",
            "replyText": "reply_text",
            "written": "timestamp",
            "arrived": "received_timestamp",
            "sentOther": "received_timestamp_sent",
            "server": "receipt_server_timestamp",
            "delivered": "receipt_timestamp",
            "read": "read_timestamp",
            "played": "played_timestamp",
            "revoked": "revoke_timestamp",
            "editedAt": "edited_timestamp",
            "status": "status",
            "keyId": "key_id",
            "starred": "starred",
            "action": "action_type"
          },
          "sql": "SELECT\n  m._id AS message_id, m.chat_row_id AS chat_id, m.from_me,\n  CASE WHEN m.from_me = 1 AND m.message_type <> 7 THEN NULL ELSE COALESCE(sp.raw_string, sj.raw_string, CASE WHEN cj.server <> 'g.us' AND m.message_type <> 7 THEN COALESCE(cp.raw_string, cj.raw_string) END) END AS sender_jid,\n  COALESCE(NULLIF(mm.media_caption, ''), CASE WHEN m.message_type <> 9 THEN m.text_data END) AS body,\n  CASE m.message_type WHEN 0 THEN 'text' WHEN 1 THEN 'image' WHEN 2 THEN CASE WHEN (mm.file_path LIKE '%WhatsApp Voice Notes/%' OR m.origin = 1) THEN 'voice' ELSE 'audio' END\n    WHEN 3 THEN 'video' WHEN 4 THEN 'contact' WHEN 5 THEN 'location' WHEN 7 THEN 'system' WHEN 9 THEN 'file' WHEN 10 THEN 'call'\n    WHEN 13 THEN 'gif' WHEN 14 THEN 'contact' WHEN 15 THEN 'deleted' WHEN 16 THEN 'location' WHEN 20 THEN 'sticker'\n    WHEN 42 THEN 'image' WHEN 43 THEN 'video' ELSE 'other' END AS kind,\n  CASE m.message_type WHEN 0 THEN 'text' WHEN 1 THEN 'bild' WHEN 2 THEN CASE WHEN (mm.file_path LIKE '%WhatsApp Voice Notes/%' OR m.origin = 1) THEN 'röstmeddelande' ELSE 'ljud' END\n    WHEN 3 THEN 'video' WHEN 4 THEN 'kontaktkort' WHEN 5 THEN 'plats' WHEN 7 THEN 'systemmeddelande' WHEN 9 THEN 'dokument' WHEN 10 THEN 'missat samtal'\n    WHEN 13 THEN 'gif' WHEN 14 THEN 'flera kontaktkort' WHEN 15 THEN 'raderat för alla' WHEN 16 THEN 'plats i realtid' WHEN 20 THEN 'klistermärke'\n    WHEN 42 THEN 'bild (engångsvisning)' WHEN 43 THEN 'video (engångsvisning)' ELSE 'typ ' || m.message_type END AS kind_label,\n  m.message_type, CASE WHEN m.message_type IN (42, 43) THEN 1 ELSE 0 END AS view_once,\n  CASE WHEN me.message_row_id IS NOT NULL THEN 'redigerat' END AS edited,\n  (SELECT q._id FROM message q WHERE q.key_id = mq.key_id AND q.chat_row_id = m.chat_row_id LIMIT 1) AS reply_to, mq.text_data AS reply_text,\n  m.timestamp,\n  CASE WHEN m.from_me = 0 AND m.received_timestamp > 0 THEN m.received_timestamp END AS received_timestamp,\n  CASE WHEN m.from_me = 1 AND m.received_timestamp > 0 THEN m.received_timestamp END AS received_timestamp_sent,\n  CASE WHEN m.receipt_server_timestamp > 0 THEN m.receipt_server_timestamp END AS receipt_server_timestamp,\n  (SELECT min(r.receipt_timestamp) FROM receipt_user r WHERE r.message_row_id = m._id AND r.receipt_timestamp > 0) AS receipt_timestamp,\n  (SELECT min(r.read_timestamp) FROM receipt_user r WHERE r.message_row_id = m._id AND r.read_timestamp > 0) AS read_timestamp,\n  (SELECT min(r.played_timestamp) FROM receipt_user r WHERE r.message_row_id = m._id AND r.played_timestamp > 0) AS played_timestamp,\n  rv.revoke_timestamp, me.edited_timestamp,\n  m.status, m.key_id, m.starred, ms.action_type\nFROM message m\nJOIN chat c ON c._id = m.chat_row_id\nLEFT JOIN jid cj ON cj._id = c.jid_row_id\nLEFT JOIN jid_map cm ON cm.lid_row_id = c.jid_row_id\nLEFT JOIN jid cp ON cp._id = cm.jid_row_id\nLEFT JOIN jid sj ON sj._id = m.sender_jid_row_id\nLEFT JOIN jid_map sm ON sm.lid_row_id = m.sender_jid_row_id\nLEFT JOIN jid sp ON sp._id = sm.jid_row_id\nLEFT JOIN message_media mm ON mm.message_row_id = m._id\nLEFT JOIN message_revoked rv ON rv.message_row_id = m._id\nLEFT JOIN message_system ms ON ms.message_row_id = m._id\nLEFT JOIN message_edit_info me ON me.message_row_id = m._id\nLEFT JOIN message_quoted mq ON mq.message_row_id = m._id\nWHERE m.chat_row_id = '{{threadId}}'\nORDER BY m.timestamp, m._id;"
        },
        {
          "id": "chat-attachments",
          "hidden": true,
          "role": "chat-attachments",
          "title": "Chattar: mediefilerna i en chatt",
          "description": "Används av Chattar. Mediefilerna i chatten med sökväg, MIME-typ, storlek, längd, mått och SHA-256 (base64), och platser och kontaktkort. Filerna väntas under data/media/0/Android/media/com.whatsapp/WhatsApp/ i extraktionen, fyra mappar upp från databasen. En fil som inte hämtats till telefonen har ingen sökväg.",
          "params": [
            "threadId"
          ],
          "epoch": "unixMs",
          "fileRoot": "../../../..",
          "fields": {
            "messageId": "message_id",
            "id": "media_id",
            "path": "file_path",
            "mime": "mime",
            "size": "file_length",
            "duration": "duration_s",
            "sha256b64": "sha256_b64",
            "width": "width",
            "height": "height",
            "name": "media_name",
            "cardName": "card_name",
            "card": "card_text",
            "lat": "lat",
            "lon": "lon"
          },
          "sql": "SELECT\n  mm.message_row_id AS message_id, 'm' || mm.message_row_id AS media_id,\n  CASE WHEN mm.file_path <> '' THEN 'data/media/0/Android/media/com.whatsapp/WhatsApp/' || mm.file_path END AS file_path,\n  NULLIF(mm.mime_type, '') AS mime, mm.file_length,\n  CASE WHEN mm.media_duration > 0 THEN mm.media_duration END AS duration_s,\n  CASE WHEN length(mm.file_hash) = 44 THEN mm.file_hash END AS sha256_b64,\n  CASE WHEN mm.width > 0 THEN mm.width END AS width, CASE WHEN mm.height > 0 THEN mm.height END AS height,\n  mm.media_name, NULL AS card_name, NULL AS card_text, NULL AS lat, NULL AS lon\nFROM message_media mm\nJOIN message m ON m._id = mm.message_row_id\nWHERE m.chat_row_id = '{{threadId}}'\nUNION ALL\nSELECT ml.message_row_id, 'l' || ml.message_row_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL,\n  NULLIF(ml.place_name, ''), NULL, NULL, ml.latitude, ml.longitude\nFROM message_location ml\nJOIN message m ON m._id = ml.message_row_id\nWHERE m.chat_row_id = '{{threadId}}'\nUNION ALL\nSELECT vc.message_row_id, 'v' || vc._id, NULL, NULL, NULL, NULL, NULL, NULL, NULL,\n  NULL, COALESCE(NULLIF(m.text_data, ''), 'kontaktkort'), vc.vcard, NULL, NULL\nFROM message_vcard vc\nJOIN message m ON m._id = vc.message_row_id\nWHERE m.chat_row_id = '{{threadId}}'\nORDER BY 1, 2;"
        }
      ]
    },
    {
      "id": "whatsapp-android-contacts",
      "label": "Android — wa.db (WhatsApp kontakter)",
      "blurb": "Kontona WhatsApp känner till, med JID, namnet ur telefonens kontakter, namnet kontot själv har valt och numret. Här står namnen till JID:erna i msgstore.db.",
      "dbPathHint": "/data/data/com.whatsapp/databases/wa.db (+ -wal). I labbet låg de senaste raderna bara i -wal.",
      "paths": [
        "data/data/com.whatsapp/databases/wa.db"
      ],
      "source": "Kontrollerad mot en labbtelefon (Samsung med Android 16, WhatsApp 2.26.43, 2026-11-11). wa_contacts har en rad per konto under numrets JID (…@s.whatsapp.net) och en per grupp (…@g.us). I labbet hade motparten sitt eget valda namn i wa_name och gruppen sitt namn i display_name. Att display_name för en person är namnet ur telefonens kontakter är en vanlig tolkning som inte är kontrollerad: labbtelefonen hade inga sparade kontakter. Ett konto som bara är känt som lid står inte här.",
      "chatApp": "WhatsApp",
      "queries": [
        {
          "id": "contacts",
          "title": "Kontakter och namn",
          "recommended": true,
          "params": [],
          "subtitle": "Visar kontona och grupperna WhatsApp känner till: JID, namnet ur telefonens kontakter, namnet kontot själv har valt, numret och kontots statustext.",
          "returns": "JID, namn i kontakterna, namn i WhatsApp, nummer, statustext, har WhatsApp, id",
          "sql": "SELECT\n  jid,\n  NULLIF(display_name, '') AS namn_i_kontakterna,\n  NULLIF(wa_name, '') AS namn_i_whatsapp,\n  number AS nummer,\n  status AS statustext,\n  CASE WHEN is_whatsapp_user = 1 THEN 'ja' ELSE 'nej' END AS har_whatsapp,\n  _id AS kontakt_id\nFROM wa_contacts\nORDER BY (display_name IS NULL AND wa_name IS NULL), jid;"
        },
        {
          "id": "tables",
          "title": "Hjälp: tabeller och antal rader",
          "group": "advanced",
          "params": [],
          "subtitle": "Listar databasens tabeller med antal rader för de viktigaste.",
          "returns": "tabell, rader",
          "sql": "SELECT name AS tabell,\n  CASE name\n    WHEN 'wa_contacts' THEN (SELECT count(*) FROM wa_contacts)\n    WHEN 'wa_group_admin_settings' THEN (SELECT count(*) FROM wa_group_admin_settings)\n  END AS rader\nFROM sqlite_master\nWHERE type = 'table'\nORDER BY rader IS NULL, name;"
        },
        {
          "id": "role-names",
          "hidden": true,
          "role": "names",
          "title": "Härkomst: kontonas namn",
          "description": "Används av Härkomst. Namnet till varje JID i wa_contacts: namnet ur telefonens kontakter, annars namnet kontot själv har valt.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "id": "jid",
            "name": "contact_name"
          },
          "sql": "SELECT jid, COALESCE(NULLIF(display_name, ''), NULLIF(wa_name, '')) AS contact_name\nFROM wa_contacts;"
        },
        {
          "id": "chat-names",
          "hidden": true,
          "role": "chat-names",
          "title": "Chattar: kontonas namn",
          "description": "Används av Chattar. Namnet till varje JID i wa_contacts: namnet ur telefonens kontakter, annars namnet kontot själv har valt.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "id": "jid",
            "name": "contact_name"
          },
          "sql": "SELECT jid, COALESCE(NULLIF(display_name, ''), NULLIF(wa_name, '')) AS contact_name\nFROM wa_contacts;"
        }
      ]
    }
  ]
};
