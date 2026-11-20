/* Genererad från comms/catalog.json — används när fetch() blockeras (file://). */
window.COMMS_CATALOG = {
  "id": "comms",
  "title": "Meddelanden, samtal och kontakter",
  "sourceNote": "Telefonens egna appar för SMS, samtal och kontakter. Meddelandena visas också i Chattar och Telefonen, samtalen och kontakterna i Telefonen, och kontakternas namn sätts på numren i samtal och meddelanden. Tiderna visas i datorns zon (_lokal) och i UTC.",
  "paramLabels": {},
  "databases": [
    {
      "id": "ios-sms",
      "os": "iOS",
      "chatApp": "Meddelanden",
      "label": "iOS — sms.db (Meddelanden)",
      "blurb": "SMS, MMS, iMessage och RCS i appen Meddelanden: konversationer, deltagare, text, bilagor, läst och levererat, redigerat, ångrat och meddelanden i Nyligen raderade.",
      "dbPathHint": "/private/var/mobile/Library/SMS/sms.db (+ -wal). Bilagorna i Library/SMS/Attachments/.",
      "paths": [
        "Library/SMS/sms.db"
      ],
      "source": "Kontrollerad mot en labbiPhone (iOS 26.4.1, 2026-11-03) och en verklig extraktion (iOS 18.7) med iMessage och bilagor. Tiderna är nanosekunder sedan 2001-01-01 (äldre databaser: sekunder). Texten står i text eller, ofta från iOS 16, bara i attributedBody; den läses ut i SQL:en. Ett meddelande i Nyligen raderade ligger kvar i message men kopplas till chatten genom chat_recoverable_message_join med tiden det raderades (iOS 16 och senare). date_retracted: avsändaren ångrade meddelandet; date_edited: det redigerades. Chattar och Telefonen kräver iOS 16 eller senare.",
      "queries": [
        {
          "id": "sms-messages",
          "title": "Meddelanden i tidsspann",
          "recommended": true,
          "timeEpoch": "cocoa",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Alla meddelanden i tidsspannet: tid, riktning, tjänst (SMS, iMessage, RCS), konversation, motpart, text, bilagor, läst och levererat, redigerat, ångrat och om det ligger i Nyligen raderade.",
          "returns": "tid, riktning, tjänst, konversation, motpart, text, bilagor, läst, levererat, redigerat, ångrat, raderat, id, UTC",
          "sql": "WITH body AS (\n  SELECT id, trim(replace(CAST(CASE WHEN hex(substr(b, lp, 1)) = '81' THEN substr(b, lp + 3, ((instr('0123456789ABCDEF', substr(hex(substr(b, lp + 1, 1)), 1, 1)) - 1) * 16 + instr('0123456789ABCDEF', substr(hex(substr(b, lp + 1, 1)), 2, 1)) - 1) + 256 * ((instr('0123456789ABCDEF', substr(hex(substr(b, lp + 2, 1)), 1, 1)) - 1) * 16 + instr('0123456789ABCDEF', substr(hex(substr(b, lp + 2, 1)), 2, 1)) - 1))\n    ELSE substr(b, lp + 1, ((instr('0123456789ABCDEF', substr(hex(substr(b, lp, 1)), 1, 1)) - 1) * 16 + instr('0123456789ABCDEF', substr(hex(substr(b, lp, 1)), 2, 1)) - 1)) END AS TEXT), char(65532), '')) AS text\n  FROM (SELECT id, b, p + 7 + instr(substr(b, p + 8, 12), X'2B') + 1 AS lp\n    FROM (SELECT m.ROWID AS id, m.attributedBody AS b, instr(m.attributedBody, CAST('NSString' AS BLOB)) AS p\n      FROM message m WHERE m.attributedBody IS NOT NULL AND (m.text IS NULL OR replace(m.text, char(65532), '') = ''))\n    WHERE p > 0)\n)\nSELECT\n  CASE WHEN m.date > 0 THEN datetime((CASE WHEN m.date > 100000000000 THEN m.date / 1000000000.0 ELSE m.date END) + 978307200, 'unixepoch', 'localtime') END AS tid_lokal,\n  CASE WHEN m.is_from_me = 1 THEN 'skickat' ELSE 'mottaget' END AS riktning,\n  m.service AS tjanst,\n  (SELECT COALESCE(NULLIF(c.display_name, ''), (SELECT group_concat(h.id, ', ') FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = c.ROWID), c.chat_identifier) FROM chat c WHERE c.ROWID = COALESCE(cmj.chat_id, crj.chat_id)) AS konversation,\n  (SELECT h.id FROM handle h WHERE h.ROWID = m.handle_id) AS motpart,\n  COALESCE(NULLIF(trim(replace(m.text, char(65532), '')), ''), body.text) AS text,\n  (SELECT count(*) FROM message_attachment_join j WHERE j.message_id = m.ROWID) AS bilagor,\n  CASE WHEN m.date_read > 0 THEN datetime((CASE WHEN m.date_read > 100000000000 THEN m.date_read / 1000000000.0 ELSE m.date_read END) + 978307200, 'unixepoch', 'localtime') END AS last_lokal,\n  CASE WHEN m.date_delivered > 0 THEN datetime((CASE WHEN m.date_delivered > 100000000000 THEN m.date_delivered / 1000000000.0 ELSE m.date_delivered END) + 978307200, 'unixepoch', 'localtime') END AS levererat_lokal,\n  CASE WHEN m.date_edited > 0 THEN datetime((CASE WHEN m.date_edited > 100000000000 THEN m.date_edited / 1000000000.0 ELSE m.date_edited END) + 978307200, 'unixepoch', 'localtime') END AS redigerat_lokal,\n  CASE WHEN m.date_retracted > 0 THEN datetime((CASE WHEN m.date_retracted > 100000000000 THEN m.date_retracted / 1000000000.0 ELSE m.date_retracted END) + 978307200, 'unixepoch', 'localtime') END AS angrat_lokal,\n  CASE WHEN crj.delete_date > 0 THEN datetime((CASE WHEN crj.delete_date > 100000000000 THEN crj.delete_date / 1000000000.0 ELSE crj.delete_date END) + 978307200, 'unixepoch', 'localtime') END AS raderat_lokal,\n  m.ROWID AS meddelande_id,\n  COALESCE(cmj.chat_id, crj.chat_id) AS chatt_id,\n  CASE WHEN m.date > 0 THEN datetime((CASE WHEN m.date > 100000000000 THEN m.date / 1000000000.0 ELSE m.date END) + 978307200, 'unixepoch') END AS tid_utc\nFROM message m\nLEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID\nLEFT JOIN chat_recoverable_message_join crj ON crj.message_id = m.ROWID\nLEFT JOIN body ON body.id = m.ROWID\nWHERE (CASE WHEN m.date > 100000000000 THEN m.date / 1000000000.0 ELSE m.date END) BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY m.date;",
          "chat": {
            "thread": "chatt_id",
            "message": "meddelande_id"
          }
        },
        {
          "id": "sms-chats",
          "title": "Konversationer",
          "subtitle": "En rad per konversation: namn eller nummer, enskild eller grupp, tjänst, antal meddelanden, antal i Nyligen raderade och första och senaste meddelandet.",
          "returns": "konversation, slag, tjänst, identifierare, meddelanden, i Nyligen raderade, första, senaste, id",
          "sql": "SELECT\n  COALESCE(NULLIF(c.display_name, ''), (SELECT group_concat(h.id, ', ') FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = c.ROWID), c.chat_identifier) AS konversation,\n  CASE WHEN c.style = 43 THEN 'grupp' ELSE 'enskild' END AS slag,\n  c.service_name AS tjanst,\n  c.chat_identifier AS identifierare,\n  (SELECT count(*) FROM chat_message_join j WHERE j.chat_id = c.ROWID) AS meddelanden,\n  (SELECT count(*) FROM chat_recoverable_message_join r WHERE r.chat_id = c.ROWID) AS i_nyligen_raderade,\n  (SELECT CASE WHEN min(m.date) > 0 THEN datetime((CASE WHEN min(m.date) > 100000000000 THEN min(m.date) / 1000000000.0 ELSE min(m.date) END) + 978307200, 'unixepoch', 'localtime') END FROM chat_message_join j JOIN message m ON m.ROWID = j.message_id WHERE j.chat_id = c.ROWID) AS forsta_lokal,\n  (SELECT CASE WHEN max(m.date) > 0 THEN datetime((CASE WHEN max(m.date) > 100000000000 THEN max(m.date) / 1000000000.0 ELSE max(m.date) END) + 978307200, 'unixepoch', 'localtime') END FROM chat_message_join j JOIN message m ON m.ROWID = j.message_id WHERE j.chat_id = c.ROWID) AS senaste_lokal,\n  c.ROWID AS chatt_id\nFROM chat c\nORDER BY senaste_lokal DESC;"
        },
        {
          "id": "sms-deleted",
          "title": "Raderade, ångrade och redigerade",
          "subtitle": "Meddelanden i Nyligen raderade (med tiden de raderades och chatten), meddelanden som avsändaren ångrade eller redigerade, och id:n för meddelanden som raderats helt (deleted_messages, sync_deleted_messages).",
          "returns": "händelse, tid, konversation, riktning, motpart, text, meddelandets tid, id",
          "sql": "WITH body AS (\n  SELECT id, trim(replace(CAST(CASE WHEN hex(substr(b, lp, 1)) = '81' THEN substr(b, lp + 3, ((instr('0123456789ABCDEF', substr(hex(substr(b, lp + 1, 1)), 1, 1)) - 1) * 16 + instr('0123456789ABCDEF', substr(hex(substr(b, lp + 1, 1)), 2, 1)) - 1) + 256 * ((instr('0123456789ABCDEF', substr(hex(substr(b, lp + 2, 1)), 1, 1)) - 1) * 16 + instr('0123456789ABCDEF', substr(hex(substr(b, lp + 2, 1)), 2, 1)) - 1))\n    ELSE substr(b, lp + 1, ((instr('0123456789ABCDEF', substr(hex(substr(b, lp, 1)), 1, 1)) - 1) * 16 + instr('0123456789ABCDEF', substr(hex(substr(b, lp, 1)), 2, 1)) - 1)) END AS TEXT), char(65532), '')) AS text\n  FROM (SELECT id, b, p + 7 + instr(substr(b, p + 8, 12), X'2B') + 1 AS lp\n    FROM (SELECT m.ROWID AS id, m.attributedBody AS b, instr(m.attributedBody, CAST('NSString' AS BLOB)) AS p\n      FROM message m WHERE m.attributedBody IS NOT NULL AND (m.text IS NULL OR replace(m.text, char(65532), '') = ''))\n    WHERE p > 0)\n)\nSELECT 'i Nyligen raderade' AS handelse, CASE WHEN crj.delete_date > 0 THEN datetime((CASE WHEN crj.delete_date > 100000000000 THEN crj.delete_date / 1000000000.0 ELSE crj.delete_date END) + 978307200, 'unixepoch', 'localtime') END AS tid_lokal,\n  (SELECT COALESCE(NULLIF(c.display_name, ''), (SELECT group_concat(h.id, ', ') FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = c.ROWID), c.chat_identifier) FROM chat c WHERE c.ROWID = crj.chat_id) AS konversation,\n  CASE WHEN m.is_from_me = 1 THEN 'skickat' ELSE 'mottaget' END AS riktning, (SELECT h.id FROM handle h WHERE h.ROWID = m.handle_id) AS motpart, COALESCE(NULLIF(trim(replace(m.text, char(65532), '')), ''), body.text) AS text,\n  CASE WHEN m.date > 0 THEN datetime((CASE WHEN m.date > 100000000000 THEN m.date / 1000000000.0 ELSE m.date END) + 978307200, 'unixepoch', 'localtime') END AS meddelandets_tid_lokal, CAST(m.ROWID AS TEXT) AS id\nFROM chat_recoverable_message_join crj JOIN message m ON m.ROWID = crj.message_id LEFT JOIN body ON body.id = m.ROWID\nUNION ALL\nSELECT CASE WHEN m.date_retracted > 0 THEN 'ångrat av avsändaren' ELSE 'redigerat' END, CASE WHEN CASE WHEN m.date_retracted > 0 THEN m.date_retracted ELSE m.date_edited END > 0 THEN datetime((CASE WHEN CASE WHEN m.date_retracted > 0 THEN m.date_retracted ELSE m.date_edited END > 100000000000 THEN CASE WHEN m.date_retracted > 0 THEN m.date_retracted ELSE m.date_edited END / 1000000000.0 ELSE CASE WHEN m.date_retracted > 0 THEN m.date_retracted ELSE m.date_edited END END) + 978307200, 'unixepoch', 'localtime') END,\n  (SELECT COALESCE(NULLIF(c.display_name, ''), (SELECT group_concat(h.id, ', ') FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = c.ROWID), c.chat_identifier) FROM chat c JOIN chat_message_join j ON j.chat_id = c.ROWID WHERE j.message_id = m.ROWID),\n  CASE WHEN m.is_from_me = 1 THEN 'skickat' ELSE 'mottaget' END, (SELECT h.id FROM handle h WHERE h.ROWID = m.handle_id), COALESCE(NULLIF(trim(replace(m.text, char(65532), '')), ''), body.text), CASE WHEN m.date > 0 THEN datetime((CASE WHEN m.date > 100000000000 THEN m.date / 1000000000.0 ELSE m.date END) + 978307200, 'unixepoch', 'localtime') END, CAST(m.ROWID AS TEXT)\nFROM message m LEFT JOIN body ON body.id = m.ROWID WHERE m.date_retracted > 0 OR m.date_edited > 0\nUNION ALL\nSELECT 'raderat helt (deleted_messages)', NULL, NULL, NULL, NULL, NULL, NULL, d.guid FROM deleted_messages d\nUNION ALL\nSELECT 'raderat, väntar på iCloud (sync_deleted_messages)', NULL, NULL, NULL, NULL, NULL, NULL, s.guid FROM sync_deleted_messages s\nORDER BY tid_lokal DESC;"
        },
        {
          "id": "sms-attachments",
          "title": "Bilagor",
          "subtitle": "Bilagorna med meddelandets tid och riktning, konversation, filnamn, typ, storlek och var filen ligger i extraktionen.",
          "returns": "tid, riktning, konversation, namn, typ, storlek, fil, skapad, id",
          "sql": "SELECT\n  CASE WHEN m.date > 0 THEN datetime((CASE WHEN m.date > 100000000000 THEN m.date / 1000000000.0 ELSE m.date END) + 978307200, 'unixepoch', 'localtime') END AS tid_lokal,\n  CASE WHEN m.is_from_me = 1 THEN 'skickat' ELSE 'mottaget' END AS riktning,\n  (SELECT COALESCE(NULLIF(c.display_name, ''), (SELECT group_concat(h.id, ', ') FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = c.ROWID), c.chat_identifier) FROM chat c JOIN chat_message_join cj ON cj.chat_id = c.ROWID WHERE cj.message_id = m.ROWID) AS konversation,\n  a.transfer_name AS namn, a.mime_type AS typ, a.total_bytes AS storlek, a.filename AS fil,\n  CASE WHEN a.created_date > 0 THEN datetime((CASE WHEN a.created_date > 100000000000 THEN a.created_date / 1000000000.0 ELSE a.created_date END) + 978307200, 'unixepoch', 'localtime') END AS skapad_lokal,\n  a.ROWID AS bilaga_id, m.ROWID AS meddelande_id\nFROM attachment a\nJOIN message_attachment_join j ON j.attachment_id = a.ROWID\nJOIN message m ON m.ROWID = j.message_id\nORDER BY m.date;"
        },
        {
          "id": "sms-handles",
          "title": "Nummer och adresser",
          "subtitle": "Varje motpart (handle) med tjänst och land, antal meddelanden och det senaste.",
          "returns": "nummer eller adress, tjänst, land, meddelanden, senaste",
          "sql": "SELECT h.id AS nummer_eller_adress, h.service AS tjanst, h.country AS land,\n  (SELECT count(*) FROM message m WHERE m.handle_id = h.ROWID) AS meddelanden,\n  (SELECT CASE WHEN max(m.date) > 0 THEN datetime((CASE WHEN max(m.date) > 100000000000 THEN max(m.date) / 1000000000.0 ELSE max(m.date) END) + 978307200, 'unixepoch', 'localtime') END FROM message m WHERE m.handle_id = h.ROWID) AS senaste_lokal\nFROM handle h ORDER BY senaste_lokal DESC;"
        },
        {
          "id": "sms-tables",
          "group": "Avancerat",
          "title": "Tabeller i databasen",
          "subtitle": "Tabellerna i sms.db.",
          "returns": "namn",
          "sql": "SELECT name AS tabell FROM sqlite_master WHERE type = 'table' ORDER BY name;"
        },
        {
          "id": "chat-threads",
          "hidden": true,
          "role": "chat-threads",
          "title": "Chattar: konversationer",
          "description": "Används av Chattar. En tråd per chat, med meddelanden i Nyligen raderade medräknade.",
          "params": [],
          "epoch": "cocoaAuto",
          "fields": {
            "id": "thread_id",
            "name": "thread_name",
            "kind": "thread_kind",
            "address": "thread_address",
            "kindRaw": "style",
            "messages": "message_count",
            "first": "first_date",
            "last": "last_date"
          },
          "sql": "SELECT c.ROWID AS thread_id,\n  COALESCE(NULLIF(c.display_name, ''), (SELECT group_concat(h.id, ', ') FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = c.ROWID), c.chat_identifier) AS thread_name,\n  CASE WHEN c.style = 43 THEN 'group' ELSE 'person' END AS thread_kind,\n  CASE WHEN c.style = 43 THEN NULL ELSE c.chat_identifier END AS thread_address, c.style,\n  (SELECT count(*) FROM chat_message_join j WHERE j.chat_id = c.ROWID) + (SELECT count(*) FROM chat_recoverable_message_join r WHERE r.chat_id = c.ROWID) AS message_count,\n  (SELECT min(m.date) FROM chat_message_join j JOIN message m ON m.ROWID = j.message_id WHERE j.chat_id = c.ROWID) AS first_date,\n  (SELECT max(m.date) FROM chat_message_join j JOIN message m ON m.ROWID = j.message_id WHERE j.chat_id = c.ROWID) AS last_date\nFROM chat c\nORDER BY last_date DESC, c.ROWID;"
        },
        {
          "id": "chat-members",
          "hidden": true,
          "role": "chat-members",
          "title": "Chattar: deltagare",
          "description": "Används av Chattar. Motparterna i varje chat (chat_handle_join).",
          "params": [],
          "epoch": "cocoaAuto",
          "fields": {
            "threadId": "thread_id",
            "id": "member_id",
            "name": "member_name",
            "address": "member_address",
            "note": "member_note"
          },
          "sql": "SELECT chj.chat_id AS thread_id, h.id AS member_id, h.id AS member_name, h.id AS member_address, h.service AS member_note\nFROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id\nORDER BY 1, 2;"
        },
        {
          "id": "chat-messages",
          "hidden": true,
          "role": "chat-messages",
          "title": "Chattar: meddelandena i en tråd",
          "description": "Används av Chattar. Meddelandena i chatten, också de i Nyligen raderade, med texten ur attributedBody när text är tom.",
          "params": [
            "threadId"
          ],
          "epoch": "cocoaAuto",
          "times": [
            {
              "key": "date",
              "label": "Skickat eller mottaget",
              "note": "message.date: den här telefonens tid när meddelandet skickades eller togs emot (nanosekunder sedan 2001)."
            },
            {
              "key": "delivered",
              "label": "Levererat",
              "note": "date_delivered: när mottagarens telefon tog emot det (iMessage och RCS)."
            },
            {
              "key": "read",
              "label": "Läst",
              "note": "date_read: när det lästes, av mottagaren för skickade meddelanden (om läskvitton är på)."
            },
            {
              "key": "editedAt",
              "label": "Redigerat",
              "note": "date_edited: senaste redigeringen."
            },
            {
              "key": "retracted",
              "label": "Ångrat",
              "note": "date_retracted: avsändaren ångrade meddelandet."
            },
            {
              "key": "deletedAt",
              "label": "Raderat (Nyligen raderade)",
              "note": "chat_recoverable_message_join.delete_date: när meddelandet raderades på den här telefonen. Det ligger kvar i 30 dagar."
            }
          ],
          "sortTime": "date",
          "details": [
            {
              "key": "service",
              "label": "Tjänst (message.service)"
            },
            {
              "key": "guid",
              "label": "guid"
            },
            {
              "key": "itemType",
              "label": "item_type"
            },
            {
              "key": "reaction",
              "label": "associated_message_type"
            }
          ],
          "fields": {
            "id": "message_id",
            "threadId": "thread_id",
            "fromMe": "is_from_me",
            "senderId": "sender_id",
            "senderName": "sender_id",
            "text": "body_text",
            "kind": "kind",
            "kindLabel": "kind_label",
            "deleted": "deleted_flag",
            "edited": "edited_text",
            "replyTo": "reply_to",
            "date": "date",
            "delivered": "date_delivered",
            "read": "date_read",
            "retracted": "date_retracted",
            "deletedAt": "delete_date",
            "service": "service",
            "guid": "guid",
            "itemType": "item_type",
            "reaction": "associated_message_type",
            "editedAt": "date_edited"
          },
          "sql": "WITH ids AS (\n  SELECT message_id AS id, NULL AS delete_date FROM chat_message_join WHERE chat_id = '{{threadId}}'\n  UNION ALL SELECT message_id, delete_date FROM chat_recoverable_message_join WHERE chat_id = '{{threadId}}'\n), body AS (\n  SELECT id, trim(replace(CAST(CASE WHEN hex(substr(b, lp, 1)) = '81' THEN substr(b, lp + 3, ((instr('0123456789ABCDEF', substr(hex(substr(b, lp + 1, 1)), 1, 1)) - 1) * 16 + instr('0123456789ABCDEF', substr(hex(substr(b, lp + 1, 1)), 2, 1)) - 1) + 256 * ((instr('0123456789ABCDEF', substr(hex(substr(b, lp + 2, 1)), 1, 1)) - 1) * 16 + instr('0123456789ABCDEF', substr(hex(substr(b, lp + 2, 1)), 2, 1)) - 1))\n    ELSE substr(b, lp + 1, ((instr('0123456789ABCDEF', substr(hex(substr(b, lp, 1)), 1, 1)) - 1) * 16 + instr('0123456789ABCDEF', substr(hex(substr(b, lp, 1)), 2, 1)) - 1)) END AS TEXT), char(65532), '')) AS text\n  FROM (SELECT id, b, p + 7 + instr(substr(b, p + 8, 12), X'2B') + 1 AS lp\n    FROM (SELECT m.ROWID AS id, m.attributedBody AS b, instr(m.attributedBody, CAST('NSString' AS BLOB)) AS p\n      FROM message m WHERE m.attributedBody IS NOT NULL AND (m.text IS NULL OR replace(m.text, char(65532), '') = '') AND m.ROWID IN (SELECT id FROM ids))\n    WHERE p > 0)\n)\nSELECT m.ROWID AS message_id, '{{threadId}}' AS thread_id, m.is_from_me,\n  CASE WHEN m.is_from_me = 0 THEN (SELECT h.id FROM handle h WHERE h.ROWID = m.handle_id) END AS sender_id,\n  COALESCE(NULLIF(trim(replace(m.text, char(65532), '')), ''), body.text) AS body_text,\n  CASE\n    WHEN m.date_retracted > 0 THEN 'deleted'\n    WHEN m.item_type <> 0 OR m.is_system_message = 1 OR m.associated_message_type BETWEEN 2000 AND 3999 THEN 'system'\n    ELSE COALESCE((SELECT CASE WHEN a.mime_type LIKE 'image/%' THEN 'image' WHEN a.mime_type LIKE 'video/%' THEN 'video'\n      WHEN a.mime_type LIKE 'audio/%' THEN CASE WHEN m.is_audio_message = 1 THEN 'voice' ELSE 'audio' END\n      WHEN a.mime_type = 'text/vcard' OR a.mime_type = 'text/x-vcard' THEN 'contact' ELSE 'file' END\n      FROM message_attachment_join j JOIN attachment a ON a.ROWID = j.attachment_id WHERE j.message_id = m.ROWID ORDER BY a.ROWID LIMIT 1), 'text')\n  END AS kind,\n  CASE\n    WHEN m.date_retracted > 0 THEN 'Ångrat av avsändaren'\n    WHEN m.associated_message_type BETWEEN 2000 AND 2999 THEN 'Reaktion'\n    WHEN m.associated_message_type BETWEEN 3000 AND 3999 THEN 'Reaktion borttagen'\n    WHEN m.item_type = 1 THEN 'Deltagare tillagd eller borttagen'\n    WHEN m.item_type = 2 THEN 'Gruppens namn ändrades'\n    WHEN m.item_type = 3 THEN 'Lämnade gruppen eller annan händelse'\n    WHEN m.item_type <> 0 THEN 'Händelse (item_type ' || m.item_type || ')'\n    WHEN m.error <> 0 THEN 'Misslyckades (error ' || m.error || ')'\n  END AS kind_label,\n  CASE WHEN ids.delete_date IS NOT NULL THEN 1 ELSE 0 END AS deleted_flag,\n  CASE WHEN m.date_edited > 0 THEN 'redigerat' END AS edited_text,\n  (SELECT r.ROWID FROM message r WHERE r.guid = m.thread_originator_guid) AS reply_to,\n  m.date, m.date_delivered, m.date_read, m.date_edited, m.date_retracted, ids.delete_date,\n  m.service, m.guid, m.item_type, m.associated_message_type\nFROM ids JOIN message m ON m.ROWID = ids.id\nLEFT JOIN body ON body.id = m.ROWID\nORDER BY m.date, m.ROWID;"
        },
        {
          "id": "chat-attachments",
          "hidden": true,
          "role": "chat-attachments",
          "title": "Chattar: bilagorna i en tråd",
          "description": "Används av Chattar. Bilagorna med filen under Library/SMS/Attachments (~/ i databasen är /private/var/mobile/).",
          "params": [
            "threadId"
          ],
          "epoch": "cocoaAuto",
          "fileRoot": "../..",
          "fields": {
            "messageId": "message_id",
            "id": "attachment_id",
            "path": "file_path",
            "mime": "mime_type",
            "size": "total_bytes",
            "name": "transfer_name"
          },
          "sql": "SELECT j.message_id, a.ROWID AS attachment_id,\n  CASE WHEN a.filename LIKE '~/%' THEN substr(a.filename, 3)\n    WHEN a.filename LIKE '/private/var/mobile/%' THEN substr(a.filename, 21)\n    WHEN a.filename LIKE '/var/mobile/%' THEN substr(a.filename, 13) END AS file_path,\n  a.mime_type, a.total_bytes, a.transfer_name\nFROM message_attachment_join j JOIN attachment a ON a.ROWID = j.attachment_id\nWHERE j.message_id IN (SELECT message_id FROM chat_message_join WHERE chat_id = '{{threadId}}' UNION SELECT message_id FROM chat_recoverable_message_join WHERE chat_id = '{{threadId}}')\nORDER BY j.message_id, a.ROWID;"
        },
        {
          "id": "role-events",
          "hidden": true,
          "role": "events-messages",
          "title": "Kartan: meddelanden i tidsfönstret",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "cocoaAuto",
          "fields": {
            "id": "message_id",
            "time": "date",
            "fromMe": "is_from_me",
            "who": "address",
            "service": "service",
            "chatName": "chat_name"
          },
          "sql": "SELECT m.ROWID AS message_id, m.date, m.is_from_me, h.id AS address, m.service, c.display_name AS chat_name\nFROM message m\nLEFT JOIN handle h ON h.ROWID = m.handle_id\nLEFT JOIN chat_message_join j ON j.message_id = m.ROWID\nLEFT JOIN chat c ON c.ROWID = j.chat_id\nWHERE (CASE WHEN m.date > 100000000000 THEN m.date / 1000000000 ELSE m.date END) BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY m.date;"
        }
      ]
    },
    {
      "id": "android-sms",
      "os": "Android",
      "chatApp": "Meddelanden",
      "label": "Android — mmssms.db (SMS och MMS)",
      "blurb": "Androids gemensamma databas för SMS och MMS (telefonens SMS-leverantör), som alla SMS-appar läser: trådar, nummer, text, MMS-delar och bilagor.",
      "dbPathHint": "/data/user_de/0/com.android.providers.telephony/databases/mmssms.db (äldre: /data/data/…). Bilagorna i app_parts/.",
      "paths": [
        "com.android.providers.telephony/databases/mmssms.db"
      ],
      "source": "Tabellerna är kontrollerade mot Android 16 (Pixel och Samsung), men databaserna i de extraktionerna var tomma, så frågorna är inte provade mot riktiga meddelanden. sms.date och date_sent är millisekunder, pdu.date sekunder. sms.type och pdu.msg_box: 1 mottaget, 2 skickat, 3 utkast, 4 utkorgen, 5 misslyckades. addr.type 137 är avsändaren, 151 mottagarna. Google Meddelanden har en egen kopia i bugle_db, som kan ha meddelanden som saknas här.",
      "queries": [
        {
          "id": "mmssms-messages",
          "title": "Meddelanden i tidsspann",
          "recommended": true,
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "SMS och MMS i tidsspannet: tid, riktning, nummer, text, MMS-ämne och antal bilagor, läst och tråd.",
          "returns": "tid, skickat, slag, riktning, nummer, text, ämne, bilagor, läst, tråd, id, UTC",
          "sql": "SELECT tid_lokal, skickat_lokal, slag, riktning, nummer, text, amne, bilagor, last, trad_id, meddelande_id, tid_utc FROM (\n  SELECT datetime(s.date / 1000, 'unixepoch', 'localtime') AS tid_lokal,\n    CASE WHEN s.date_sent > 0 THEN datetime(s.date_sent / 1000, 'unixepoch', 'localtime') END AS skickat_lokal,\n    'SMS' AS slag, CASE s.type WHEN 1 THEN 'mottaget' WHEN 2 THEN 'skickat' WHEN 3 THEN 'utkast' WHEN 4 THEN 'utkorgen' WHEN 5 THEN 'misslyckades' WHEN 6 THEN 'i kö' ELSE 'typ ' || s.type END AS riktning, s.address AS nummer, s.body AS text, s.subject AS amne, 0 AS bilagor, s.read AS last,\n    s.thread_id AS trad_id, 's' || s._id AS meddelande_id, datetime(s.date / 1000, 'unixepoch') AS tid_utc, s.date AS sort\n  FROM sms s WHERE s.date BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\n  UNION ALL\n  SELECT datetime(p.date, 'unixepoch', 'localtime'), CASE WHEN p.date_sent > 0 THEN datetime(p.date_sent, 'unixepoch', 'localtime') END,\n    'MMS', CASE p.msg_box WHEN 1 THEN 'mottaget' WHEN 2 THEN 'skickat' WHEN 3 THEN 'utkast' WHEN 4 THEN 'utkorgen' WHEN 5 THEN 'misslyckades' ELSE 'låda ' || p.msg_box END, CASE WHEN p.msg_box = 1 THEN (SELECT ad.address FROM addr ad WHERE ad.msg_id = p._id AND ad.type = 137) ELSE (SELECT group_concat(ad.address, ', ') FROM addr ad WHERE ad.msg_id = p._id AND ad.type IN (151, 130, 129)) END, (SELECT group_concat(pt.text, char(10)) FROM part pt WHERE pt.mid = p._id AND pt.ct = 'text/plain'), p.sub,\n    (SELECT count(*) FROM part pt WHERE pt.mid = p._id AND pt.ct NOT IN ('text/plain', 'application/smil')), p.read,\n    p.thread_id, 'm' || p._id, datetime(p.date, 'unixepoch'), p.date * 1000\n  FROM pdu p WHERE p.date * 1000 BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\n) ORDER BY sort;",
          "chat": {
            "thread": "trad_id",
            "message": "meddelande_id"
          }
        },
        {
          "id": "mmssms-threads",
          "title": "Trådar",
          "subtitle": "En rad per tråd: numren, antal meddelanden, senaste tiden, utdraget och om tråden är arkiverad.",
          "returns": "nummer, meddelanden, senaste, utdrag, arkiverad, läst, id",
          "sql": "SELECT (SELECT group_concat(ca.address, ', ') FROM canonical_addresses ca WHERE (' ' || t.recipient_ids || ' ') LIKE ('% ' || ca._id || ' %')) AS nummer, t.message_count AS meddelanden,\n  datetime(t.date / 1000, 'unixepoch', 'localtime') AS senaste_lokal, t.snippet AS utdrag, t.archived AS arkiverad, t.read AS last, t._id AS trad_id\nFROM threads t ORDER BY t.date DESC;"
        },
        {
          "id": "mmssms-parts",
          "title": "MMS-delar och bilagor",
          "subtitle": "Varje del i ett MMS: typ, namn, text och filen i app_parts, med meddelandets tid och riktning.",
          "returns": "tid, riktning, typ, namn, text, fil, meddelande",
          "sql": "SELECT datetime(p.date, 'unixepoch', 'localtime') AS tid_lokal, CASE p.msg_box WHEN 1 THEN 'mottaget' WHEN 2 THEN 'skickat' WHEN 3 THEN 'utkast' WHEN 4 THEN 'utkorgen' WHEN 5 THEN 'misslyckades' ELSE 'låda ' || p.msg_box END AS riktning,\n  pt.ct AS typ, COALESCE(pt.fn, pt.name, pt.cl) AS namn, pt.text, pt._data AS fil, 'm' || p._id AS meddelande_id\nFROM part pt JOIN pdu p ON p._id = pt.mid\nWHERE pt.ct <> 'application/smil'\nORDER BY p.date, pt.seq;"
        },
        {
          "id": "mmssms-tables",
          "group": "Avancerat",
          "title": "Tabeller i databasen",
          "subtitle": "Tabellerna i mmssms.db.",
          "returns": "namn",
          "sql": "SELECT name AS tabell FROM sqlite_master WHERE type = 'table' ORDER BY name;"
        },
        {
          "id": "chat-threads",
          "hidden": true,
          "role": "chat-threads",
          "title": "Chattar: trådar",
          "description": "Används av Chattar. Trådarna med numren ur canonical_addresses.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "id": "thread_id",
            "name": "thread_name",
            "kind": "thread_kind",
            "address": "thread_address",
            "messages": "message_count",
            "first": "first_ms",
            "last": "last_ms",
            "archived": "archived"
          },
          "sql": "SELECT t._id AS thread_id, (SELECT group_concat(ca.address, ', ') FROM canonical_addresses ca WHERE (' ' || t.recipient_ids || ' ') LIKE ('% ' || ca._id || ' %')) AS thread_name,\n  CASE WHEN instr(trim(t.recipient_ids), ' ') > 0 THEN 'group' ELSE 'person' END AS thread_kind,\n  CASE WHEN instr(trim(t.recipient_ids), ' ') > 0 THEN NULL ELSE (SELECT group_concat(ca.address, ', ') FROM canonical_addresses ca WHERE (' ' || t.recipient_ids || ' ') LIKE ('% ' || ca._id || ' %')) END AS thread_address,\n  (SELECT count(*) FROM sms s WHERE s.thread_id = t._id) + (SELECT count(*) FROM pdu p WHERE p.thread_id = t._id) AS message_count,\n  NULLIF(min(COALESCE((SELECT min(s.date) FROM sms s WHERE s.thread_id = t._id), 9e15), COALESCE((SELECT min(p.date) * 1000 FROM pdu p WHERE p.thread_id = t._id), 9e15)), 9e15) AS first_ms,\n  max(COALESCE((SELECT max(s.date) FROM sms s WHERE s.thread_id = t._id), 0), COALESCE((SELECT max(p.date) * 1000 FROM pdu p WHERE p.thread_id = t._id), 0)) AS last_ms,\n  t.archived\nFROM threads t ORDER BY last_ms DESC, t._id;"
        },
        {
          "id": "chat-members",
          "hidden": true,
          "role": "chat-members",
          "title": "Chattar: deltagare",
          "description": "Används av Chattar. Numren i trådens recipient_ids.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "threadId": "thread_id",
            "id": "member_id",
            "name": "member_name",
            "address": "member_address"
          },
          "sql": "SELECT t._id AS thread_id, ca.address AS member_id, ca.address AS member_name, ca.address AS member_address\nFROM threads t JOIN canonical_addresses ca ON (' ' || t.recipient_ids || ' ') LIKE ('% ' || ca._id || ' %')\nORDER BY 1, 2;"
        },
        {
          "id": "chat-messages",
          "hidden": true,
          "role": "chat-messages",
          "title": "Chattar: meddelandena i en tråd",
          "description": "Används av Chattar. SMS och MMS i tråden; MMS-texten ur part, avsändaren ur addr.",
          "params": [
            "threadId"
          ],
          "epoch": "unixMs",
          "times": [
            {
              "key": "date",
              "label": "Mottaget eller skapat på telefonen",
              "note": "sms.date (millisekunder) eller pdu.date (sekunder): den här telefonens tid."
            },
            {
              "key": "sent",
              "label": "Skickat (enligt nätet eller avsändaren)",
              "note": "sms.date_sent eller pdu.date_sent: för ett mottaget SMS tiden i meddelandet från nätet."
            }
          ],
          "sortTime": "date",
          "details": [
            {
              "key": "proto",
              "label": "Slag"
            },
            {
              "key": "typeRaw",
              "label": "sms.type eller pdu.msg_box"
            },
            {
              "key": "readFlag",
              "label": "Läst (read)"
            }
          ],
          "fields": {
            "id": "message_id",
            "threadId": "thread_id",
            "fromMe": "from_me",
            "senderId": "sender",
            "senderName": "sender",
            "text": "body",
            "kind": "kind",
            "kindLabel": "kind_label",
            "date": "date_ms",
            "sent": "sent_ms",
            "proto": "proto",
            "typeRaw": "type_raw",
            "readFlag": "read"
          },
          "sql": "SELECT * FROM (\n  SELECT 's' || s._id AS message_id, s.thread_id, CASE WHEN s.type = 1 THEN 0 ELSE 1 END AS from_me, CASE WHEN s.type = 1 THEN s.address END AS sender,\n    s.body, 'text' AS kind, CASE s.type WHEN 3 THEN 'Utkast' WHEN 4 THEN 'I utkorgen' WHEN 5 THEN 'Misslyckades' WHEN 6 THEN 'I kö' END AS kind_label,\n    s.date AS date_ms, NULLIF(s.date_sent, 0) AS sent_ms, 'SMS' AS proto, s.type AS type_raw, s.read\n  FROM sms s WHERE s.thread_id = '{{threadId}}'\n  UNION ALL\n  SELECT 'm' || p._id, p.thread_id, CASE WHEN p.msg_box = 1 THEN 0 ELSE 1 END, CASE WHEN p.msg_box = 1 THEN (SELECT ad.address FROM addr ad WHERE ad.msg_id = p._id AND ad.type = 137) END,\n    (SELECT group_concat(pt.text, char(10)) FROM part pt WHERE pt.mid = p._id AND pt.ct = 'text/plain'),\n    COALESCE((SELECT CASE WHEN pt.ct LIKE 'image/%' THEN 'image' WHEN pt.ct LIKE 'video/%' THEN 'video' WHEN pt.ct LIKE 'audio/%' THEN 'audio' WHEN pt.ct LIKE 'text/%vcard' THEN 'contact' ELSE 'file' END\n      FROM part pt WHERE pt.mid = p._id AND pt.ct NOT IN ('text/plain', 'application/smil') ORDER BY pt.seq LIMIT 1), 'text'),\n    CASE p.msg_box WHEN 3 THEN 'Utkast' WHEN 4 THEN 'I utkorgen' WHEN 5 THEN 'Misslyckades' END,\n    p.date * 1000, NULLIF(p.date_sent, 0) * 1000, 'MMS', p.msg_box, p.read\n  FROM pdu p WHERE p.thread_id = '{{threadId}}'\n) ORDER BY date_ms, message_id;"
        },
        {
          "id": "chat-attachments",
          "hidden": true,
          "role": "chat-attachments",
          "title": "Chattar: bilagorna i en tråd",
          "description": "Används av Chattar. MMS-delarna som inte är text, med filen i app_parts bredvid databases/.",
          "params": [
            "threadId"
          ],
          "epoch": "unixMs",
          "fileRoot": "..",
          "fields": {
            "messageId": "message_id",
            "id": "part_id",
            "path": "file_path",
            "mime": "ct",
            "name": "name"
          },
          "sql": "SELECT 'm' || pt.mid AS message_id, pt._id AS part_id,\n  CASE WHEN pt._data IS NOT NULL THEN 'app_parts/' || replace(pt._data, rtrim(pt._data, replace(pt._data, '/', '')), '') END AS file_path,\n  pt.ct, COALESCE(pt.fn, pt.name, pt.cl) AS name\nFROM part pt JOIN pdu p ON p._id = pt.mid\nWHERE p.thread_id = '{{threadId}}' AND pt.ct NOT IN ('text/plain', 'application/smil')\nORDER BY pt.mid, pt.seq;"
        },
        {
          "id": "role-events",
          "hidden": true,
          "role": "events-messages",
          "title": "Kartan: meddelanden i tidsfönstret",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "unixMs",
          "fields": {
            "id": "message_id",
            "time": "date_ms",
            "fromMe": "from_me",
            "who": "address",
            "service": "proto"
          },
          "sql": "SELECT 's' || s._id AS message_id, s.date AS date_ms, CASE WHEN s.type = 1 THEN 0 ELSE 1 END AS from_me, s.address, 'SMS' AS proto\nFROM sms s WHERE s.date BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nUNION ALL\nSELECT 'm' || p._id, p.date * 1000, CASE WHEN p.msg_box = 1 THEN 0 ELSE 1 END,\n  (SELECT ad.address FROM addr ad WHERE ad.msg_id = p._id AND ad.type = CASE WHEN p.msg_box = 1 THEN 137 ELSE 151 END LIMIT 1), 'MMS'\nFROM pdu p WHERE p.date * 1000 BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY 2;"
        }
      ]
    },
    {
      "id": "android-bugle",
      "os": "Android",
      "chatApp": "Meddelanden",
      "label": "Android — bugle_db (Google Meddelanden)",
      "blurb": "Google Meddelandens egen databas: konversationer, deltagare, SMS, MMS och RCS (chatt), med tider, status och delar. Har ofta meddelanden som inte finns i mmssms.db.",
      "dbPathHint": "/data/data/com.google.android.apps.messaging/databases/bugle_db (+ -wal)",
      "paths": [
        "com.google.android.apps.messaging/databases/bugle_db"
      ],
      "source": "Kontrollerad mot en Samsung (Android 16, Google Meddelanden, 2026-11-06) med SMS och händelser i appen; MMS, RCS och bilagor är inte provade. Tiderna är millisekunder. message_status under 100 är utgående, 100–199 inkommande och 200 och högre händelser i appen (ingen text). message_protocol: 0 SMS, 1 MMS, 2 och högre RCS och andra. sms_message_uri pekar på raden i mmssms.db (content://sms/N): i labbet fanns raderna kvar här fast mmssms.db var tom. Deltagare med sub_id -2 är motparter; övriga är telefonens egna nummer (SIM).",
      "queries": [
        {
          "id": "bugle-messages",
          "title": "Meddelanden i tidsspann",
          "recommended": true,
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Meddelandena i tidsspannet: mottaget och skickat, riktning, protokoll, konversation, avsändare, text, antal bilagor, status och raden i mmssms.db.",
          "returns": "mottaget, skickat, riktning, protokoll, konversation, avsändare, text, bilagor, läst, status, sms-rad, id, UTC",
          "sql": "SELECT datetime(m.received_timestamp / 1000, 'unixepoch', 'localtime') AS mottaget_lokal,\n  CASE WHEN m.sent_timestamp > 0 THEN datetime(m.sent_timestamp / 1000, 'unixepoch', 'localtime') END AS skickat_lokal,\n  CASE WHEN m.message_status < 100 THEN 'skickat' WHEN m.message_status < 200 THEN 'mottaget' ELSE 'händelse' END AS riktning, CASE m.message_protocol WHEN 0 THEN 'SMS' WHEN 1 THEN 'MMS' ELSE 'RCS eller annat (' || m.message_protocol || ')' END AS protokoll,\n  c.name AS konversation, COALESCE(NULLIF(pa.full_name, ''), NULLIF(pa.display_destination, ''), pa.normalized_destination) AS avsandare, (SELECT group_concat(pt.text, char(10)) FROM parts pt WHERE pt.message_id = m._id AND pt.content_type LIKE 'text/%' AND pt.text IS NOT NULL) AS text,\n  (SELECT count(*) FROM parts pt WHERE pt.message_id = m._id AND pt.content_type NOT LIKE 'text/%') AS bilagor,\n  m.read AS last, m.message_status AS status, m.sms_message_uri AS sms_rad,\n  m._id AS meddelande_id, m.conversation_id AS konversation_id, datetime(m.received_timestamp / 1000, 'unixepoch') AS mottaget_utc\nFROM messages m\nLEFT JOIN conversations c ON c._id = m.conversation_id\nLEFT JOIN participants pa ON pa._id = m.sender_id\nWHERE m.received_timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}} OR m.sent_timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY m.received_timestamp;",
          "chat": {
            "thread": "konversation_id",
            "message": "meddelande_id"
          }
        },
        {
          "id": "bugle-conversations",
          "title": "Konversationer",
          "subtitle": "En rad per konversation: namn, nummer, antal deltagare och meddelanden, senaste, utdrag, arkiverad och tråden i mmssms.db.",
          "returns": "konversation, nummer, deltagare, meddelanden, senaste, utdrag, arkiverad, tråd i mmssms, id",
          "sql": "SELECT c.name AS konversation, c.participant_normalized_destination AS nummer, c.participant_count AS deltagare,\n  (SELECT count(*) FROM messages m WHERE m.conversation_id = c._id) AS meddelanden,\n  datetime(c.sort_timestamp / 1000, 'unixepoch', 'localtime') AS senaste_lokal, c.snippet_text AS utdrag, c.archive_status AS arkiverad,\n  c.sms_thread_id AS trad_i_mmssms, c._id AS konversation_id\nFROM conversations c ORDER BY c.sort_timestamp DESC;"
        },
        {
          "id": "bugle-sms-rows",
          "title": "Meddelanden som pekar på mmssms.db",
          "subtitle": "SMS och MMS med raden i mmssms.db (sms_message_uri). Jämför med mmssms.db: saknas raden där kan meddelandet ha raderats ur telefonens SMS-databas men ligga kvar här.",
          "returns": "mottaget, riktning, konversation, text, sms-rad, id",
          "sql": "SELECT datetime(m.received_timestamp / 1000, 'unixepoch', 'localtime') AS mottaget_lokal, CASE WHEN m.message_status < 100 THEN 'skickat' WHEN m.message_status < 200 THEN 'mottaget' ELSE 'händelse' END AS riktning, c.name AS konversation,\n  (SELECT group_concat(pt.text, char(10)) FROM parts pt WHERE pt.message_id = m._id AND pt.content_type LIKE 'text/%' AND pt.text IS NOT NULL) AS text, m.sms_message_uri AS sms_rad, m._id AS meddelande_id\nFROM messages m LEFT JOIN conversations c ON c._id = m.conversation_id\nWHERE m.sms_message_uri IS NOT NULL AND m.sms_message_uri <> ''\nORDER BY m.received_timestamp;"
        },
        {
          "id": "bugle-participants",
          "title": "Deltagare och egna nummer",
          "subtitle": "Alla deltagare: nummer, namn och om det är en motpart eller ett av telefonens egna nummer (SIM).",
          "returns": "nummer, namn, slag, SIM, blockerad, kontakt",
          "sql": "SELECT p.normalized_destination AS nummer, NULLIF(p.full_name, '') AS namn, CASE WHEN p.sub_id = -2 THEN 'motpart' ELSE 'eget nummer' END AS slag,\n  CASE WHEN p.sub_id >= 0 THEN p.sub_id END AS sim, NULLIF(p.subscription_name, '') AS sim_namn, p.blocked AS blockerad, NULLIF(p.contact_id, -2) AS kontakt_id\nFROM participants p ORDER BY slag, nummer;"
        },
        {
          "id": "bugle-tables",
          "group": "Avancerat",
          "title": "Tabeller i databasen",
          "subtitle": "Tabellerna i bugle_db.",
          "returns": "namn",
          "sql": "SELECT name AS tabell FROM sqlite_master WHERE type = 'table' ORDER BY name;"
        },
        {
          "id": "chat-threads",
          "hidden": true,
          "role": "chat-threads",
          "title": "Chattar: konversationer",
          "description": "Används av Chattar. Konversationerna i Google Meddelanden.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "id": "thread_id",
            "name": "thread_name",
            "kind": "thread_kind",
            "address": "thread_address",
            "messages": "message_count",
            "first": "first_ms",
            "last": "last_ms",
            "archived": "archived"
          },
          "sql": "SELECT c._id AS thread_id, COALESCE(NULLIF(c.name, ''), c.participant_normalized_destination, '#' || c._id) AS thread_name,\n  CASE WHEN c.participant_count > 1 THEN 'group' ELSE 'person' END AS thread_kind,\n  CASE WHEN c.participant_count > 1 THEN NULL ELSE c.participant_normalized_destination END AS thread_address,\n  (SELECT count(*) FROM messages m WHERE m.conversation_id = c._id) AS message_count,\n  (SELECT min(m.received_timestamp) FROM messages m WHERE m.conversation_id = c._id) AS first_ms,\n  (SELECT max(m.received_timestamp) FROM messages m WHERE m.conversation_id = c._id) AS last_ms,\n  CASE WHEN c.archive_status > 0 THEN 1 ELSE 0 END AS archived\nFROM conversations c ORDER BY last_ms DESC, c._id;"
        },
        {
          "id": "chat-members",
          "hidden": true,
          "role": "chat-members",
          "title": "Chattar: deltagare",
          "description": "Används av Chattar. Motparterna i konversationen (sub_id -2).",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "threadId": "thread_id",
            "id": "member_id",
            "name": "member_name",
            "address": "member_address"
          },
          "sql": "SELECT cp.conversation_id AS thread_id, p.normalized_destination AS member_id, COALESCE(NULLIF(p.full_name, ''), NULLIF(p.display_destination, ''), p.normalized_destination) AS member_name, p.normalized_destination AS member_address\nFROM conversation_participants cp JOIN participants p ON p._id = cp.participant_id\nWHERE p.sub_id = -2 ORDER BY 1, 2;"
        },
        {
          "id": "chat-messages",
          "hidden": true,
          "role": "chat-messages",
          "title": "Chattar: meddelandena i en konversation",
          "description": "Används av Chattar. Meddelandena med texten ur parts; status 200 och högre är händelser i appen.",
          "params": [
            "threadId"
          ],
          "epoch": "unixMs",
          "times": [
            {
              "key": "received",
              "label": "Mottaget eller skapat på telefonen",
              "note": "received_timestamp: den här telefonens tid."
            },
            {
              "key": "sent",
              "label": "Skickat",
              "note": "sent_timestamp: för ett mottaget SMS tiden från nätet."
            }
          ],
          "sortTime": "received",
          "details": [
            {
              "key": "proto",
              "label": "Protokoll (message_protocol)"
            },
            {
              "key": "status",
              "label": "message_status"
            },
            {
              "key": "smsUri",
              "label": "Raden i mmssms.db (sms_message_uri)"
            }
          ],
          "fields": {
            "id": "message_id",
            "threadId": "thread_id",
            "fromMe": "from_me",
            "senderId": "sender_id",
            "senderName": "sender_name",
            "text": "body",
            "kind": "kind",
            "kindLabel": "kind_label",
            "received": "received_timestamp",
            "sent": "sent_timestamp",
            "proto": "proto",
            "status": "message_status",
            "smsUri": "sms_message_uri"
          },
          "sql": "SELECT m._id AS message_id, m.conversation_id AS thread_id, CASE WHEN m.message_status < 100 THEN 1 ELSE 0 END AS from_me,\n  CASE WHEN m.message_status BETWEEN 100 AND 199 THEN pa.normalized_destination END AS sender_id,\n  CASE WHEN m.message_status BETWEEN 100 AND 199 THEN COALESCE(NULLIF(pa.full_name, ''), NULLIF(pa.display_destination, ''), pa.normalized_destination) END AS sender_name,\n  (SELECT group_concat(pt.text, char(10)) FROM parts pt WHERE pt.message_id = m._id AND pt.content_type LIKE 'text/%' AND pt.text IS NOT NULL) AS body,\n  CASE WHEN m.message_status >= 200 THEN 'system' ELSE COALESCE((SELECT CASE WHEN pt.content_type LIKE 'image/%' THEN 'image' WHEN pt.content_type LIKE 'video/%' THEN 'video' WHEN pt.content_type LIKE 'audio/%' THEN 'audio' WHEN pt.content_type LIKE 'text/%vcard' THEN 'contact' ELSE 'file' END\n    FROM parts pt WHERE pt.message_id = m._id AND pt.content_type NOT LIKE 'text/plain%' ORDER BY pt._id LIMIT 1), 'text') END AS kind,\n  CASE WHEN m.message_status >= 200 THEN 'Händelse i appen (status ' || m.message_status || ')' WHEN m.message_status IN (8, 9) THEN 'Misslyckades' WHEN m.message_status = 3 THEN 'Utkast' END AS kind_label,\n  m.received_timestamp, NULLIF(m.sent_timestamp, 0) AS sent_timestamp, CASE m.message_protocol WHEN 0 THEN 'SMS' WHEN 1 THEN 'MMS' ELSE 'RCS eller annat (' || m.message_protocol || ')' END AS proto, m.message_status, m.sms_message_uri\nFROM messages m LEFT JOIN participants pa ON pa._id = m.sender_id\nWHERE m.conversation_id = '{{threadId}}'\nORDER BY m.received_timestamp, m._id;"
        },
        {
          "id": "chat-attachments",
          "hidden": true,
          "role": "chat-attachments",
          "title": "Chattar: bilagorna i en konversation",
          "description": "Används av Chattar. Delarna som inte är text, med typ, namn, storlek och mått. Var filen ligger är inte kontrollerat; utan sökväg visas bilagan som saknad.",
          "params": [
            "threadId"
          ],
          "epoch": "unixMs",
          "fileRoot": "..",
          "fields": {
            "messageId": "message_id",
            "id": "part_id",
            "path": "file_path",
            "mime": "content_type",
            "name": "file_name",
            "size": "file_size_bytes",
            "width": "width",
            "height": "height"
          },
          "sql": "SELECT pt.message_id, pt._id AS part_id, NULL AS file_path, pt.content_type, pt.file_name, pt.file_size_bytes, pt.width, pt.height\nFROM parts pt JOIN messages m ON m._id = pt.message_id\nWHERE m.conversation_id = '{{threadId}}' AND pt.content_type NOT LIKE 'text/plain%'\nORDER BY pt.message_id, pt._id;"
        }
      ]
    },
    {
      "id": "ios-calls",
      "os": "iOS",
      "label": "iOS — CallHistory.storedata (Telefon)",
      "blurb": "Samtalshistoriken: telefonsamtal, FaceTime och samtal i appar som använder iPhones samtalsvy (CallKit), till exempel Signal, WhatsApp och Telegram.",
      "dbPathHint": "/private/var/mobile/Library/CallHistoryDB/CallHistory.storedata (+ -wal)",
      "paths": [
        "Library/CallHistoryDB/CallHistory.storedata"
      ],
      "source": "Kontrollerad mot en labbiPhone (iOS 26.4.1, 2026-11-03) med samtal i Signal, WhatsApp och Telegram; tabellerna också mot iOS 18.7. ZDATE är Cocoa-sekunder (sedan 2001) när samtalet började, ZDURATION sekunder. ZORIGINATED 1 = utgående; ZANSWERED 1 = besvarat. ZCALLTYPE 1 telefon, 8 FaceTime video, 16 FaceTime ljud, 0 app. ZSERVICE_PROVIDER är appen (med utvecklarens prefix). För appar är ZADDRESS appens id för motparten, inte ett nummer, och ZNAME det namn appen gav (Signal kan dölja det). Ett raderat samtal tas bort ur tabellen.",
      "queries": [
        {
          "id": "calls-all",
          "title": "Samtal i tidsspann",
          "recommended": true,
          "timeEpoch": "cocoa",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Varje samtal: när det började, riktning, besvarat, längd, slag och app, nummer eller id, namn, land och plats.",
          "returns": "tid, riktning, längd, slag, app, nummer, namn, fler deltagare, land, plats, läst, id, UTC",
          "sql": "SELECT datetime(r.ZDATE + 978307200, 'unixepoch', 'localtime') AS tid_lokal,\n  CASE WHEN r.ZORIGINATED = 1 THEN 'utgående' WHEN r.ZANSWERED = 1 THEN 'inkommande' ELSE 'missat eller avvisat' END AS riktning, round(r.ZDURATION) AS langd_s, CASE r.ZCALLTYPE WHEN 1 THEN 'telefon' WHEN 8 THEN 'FaceTime video' WHEN 16 THEN 'FaceTime ljud' WHEN 0 THEN 'app' ELSE 'typ ' || r.ZCALLTYPE END AS slag, CASE WHEN length(r.ZSERVICE_PROVIDER) > 11 AND substr(r.ZSERVICE_PROVIDER, 11, 1) = '.' AND upper(substr(r.ZSERVICE_PROVIDER, 1, 10)) = substr(r.ZSERVICE_PROVIDER, 1, 10) THEN substr(r.ZSERVICE_PROVIDER, 12) ELSE r.ZSERVICE_PROVIDER END AS app,\n  CAST(r.ZADDRESS AS TEXT) AS nummer, r.ZNAME AS namn, (SELECT group_concat(h.ZVALUE, ', ') FROM Z_2REMOTEPARTICIPANTHANDLES x JOIN ZHANDLE h ON h.Z_PK = x.Z_4REMOTEPARTICIPANTHANDLES WHERE x.Z_2REMOTEPARTICIPANTCALLS = r.Z_PK) AS fler_deltagare,\n  r.ZISO_COUNTRY_CODE AS land, r.ZLOCATION AS plats, r.ZREAD AS last, r.ZDISCONNECTED_CAUSE AS orsak, r.ZUNIQUE_ID AS identifierare,\n  datetime(r.ZDATE + 978307200, 'unixepoch') AS tid_utc\nFROM ZCALLRECORD r\nWHERE r.ZDATE BETWEEN {{cocoaStart}} AND {{cocoaEnd}}\nORDER BY r.ZDATE;"
        },
        {
          "id": "calls-by-number",
          "title": "Per nummer eller kontakt",
          "subtitle": "Antal samtal per nummer och app, med total längd, missade och första och senaste.",
          "returns": "nummer, namn, app, samtal, utgående, besvarade, missade, längd, första, senaste",
          "sql": "SELECT CAST(r.ZADDRESS AS TEXT) AS nummer, max(r.ZNAME) AS namn, CASE WHEN length(r.ZSERVICE_PROVIDER) > 11 AND substr(r.ZSERVICE_PROVIDER, 11, 1) = '.' AND upper(substr(r.ZSERVICE_PROVIDER, 1, 10)) = substr(r.ZSERVICE_PROVIDER, 1, 10) THEN substr(r.ZSERVICE_PROVIDER, 12) ELSE r.ZSERVICE_PROVIDER END AS app, count(*) AS samtal,\n  sum(r.ZORIGINATED = 1) AS utgaende, sum(r.ZORIGINATED = 0 AND r.ZANSWERED = 1) AS besvarade, sum(r.ZORIGINATED = 0 AND r.ZANSWERED = 0) AS missade,\n  round(sum(r.ZDURATION)) AS langd_s, datetime(min(r.ZDATE) + 978307200, 'unixepoch', 'localtime') AS forsta_lokal, datetime(max(r.ZDATE) + 978307200, 'unixepoch', 'localtime') AS senaste_lokal\nFROM ZCALLRECORD r GROUP BY 1, 3 ORDER BY samtal DESC;"
        },
        {
          "id": "calls-tables",
          "group": "Avancerat",
          "title": "Tabeller i databasen",
          "subtitle": "Tabellerna i CallHistory.storedata.",
          "returns": "namn",
          "sql": "SELECT name AS tabell FROM sqlite_master WHERE type = 'table' ORDER BY name;"
        },
        {
          "id": "role-calls",
          "hidden": true,
          "role": "calls",
          "title": "Telefonen: samtalen",
          "description": "Används av Telefonen. Ett samtal per rad.",
          "params": [],
          "epoch": "cocoa",
          "fields": {
            "id": "call_id",
            "time": "ZDATE",
            "duration": "duration_s",
            "number": "address",
            "name": "ZNAME",
            "direction": "direction",
            "answered": "ZANSWERED",
            "type": "call_type",
            "app": "app_id",
            "others": "others",
            "country": "ZISO_COUNTRY_CODE",
            "place": "ZLOCATION",
            "read": "ZREAD",
            "cause": "ZDISCONNECTED_CAUSE",
            "uid": "ZUNIQUE_ID"
          },
          "sql": "SELECT r.Z_PK AS call_id, r.ZDATE, r.ZDURATION AS duration_s, CAST(r.ZADDRESS AS TEXT) AS address, r.ZNAME,\n  CASE WHEN r.ZORIGINATED = 1 THEN 'out' WHEN r.ZANSWERED = 1 THEN 'in' ELSE 'missed' END AS direction, r.ZANSWERED,\n  CASE r.ZCALLTYPE WHEN 1 THEN 'telefon' WHEN 8 THEN 'FaceTime video' WHEN 16 THEN 'FaceTime ljud' WHEN 0 THEN 'app' ELSE 'typ ' || r.ZCALLTYPE END AS call_type, CASE WHEN length(r.ZSERVICE_PROVIDER) > 11 AND substr(r.ZSERVICE_PROVIDER, 11, 1) = '.' AND upper(substr(r.ZSERVICE_PROVIDER, 1, 10)) = substr(r.ZSERVICE_PROVIDER, 1, 10) THEN substr(r.ZSERVICE_PROVIDER, 12) ELSE r.ZSERVICE_PROVIDER END AS app_id, (SELECT group_concat(h.ZVALUE, ', ') FROM Z_2REMOTEPARTICIPANTHANDLES x JOIN ZHANDLE h ON h.Z_PK = x.Z_4REMOTEPARTICIPANTHANDLES WHERE x.Z_2REMOTEPARTICIPANTCALLS = r.Z_PK) AS others,\n  r.ZISO_COUNTRY_CODE, r.ZLOCATION, r.ZREAD, r.ZDISCONNECTED_CAUSE, r.ZUNIQUE_ID\nFROM ZCALLRECORD r ORDER BY r.ZDATE DESC;"
        }
      ]
    },
    {
      "id": "android-calls",
      "os": "Android",
      "label": "Android — calllog.db (Telefon)",
      "blurb": "Samtalsloggen: telefonsamtal och samtal i appar som använder Androids samtalsvy, med riktning, längd, nummer, namnet när samtalet loggades, land och SIM.",
      "dbPathHint": "/data/data/com.android.providers.contacts/databases/calllog.db (Samsung: com.samsung.android.providers.contacts)",
      "paths": [
        "providers.contacts/databases/calllog.db"
      ],
      "source": "Tabellen är kontrollerad mot Android 16 (Pixel och Samsung), men loggarna i de extraktionerna var tomma, så frågorna är inte provade mot riktiga samtal. date är millisekunder när samtalet började, duration sekunder. type: 1 inkommande, 2 utgående, 3 missat, 4 röstbrevlåda, 5 avvisat, 6 blockerat, 7 besvarat på annan enhet. name är kontaktens namn när samtalet loggades. presentation 2 är dolt nummer. subscription_component_name visar appen (com.android.phone för vanliga samtal). Före Android 7 låg tabellen calls i contacts2.db.",
      "queries": [
        {
          "id": "calllog-all",
          "title": "Samtal i tidsspann",
          "recommended": true,
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Varje samtal: när det började, riktning, längd, nummer, namn, dolt nummer, land och ort, app, SIM och om det är läst.",
          "returns": "tid, riktning, längd, nummer, namn, visning, land, ort, app, SIM-konto, video, ny, id, UTC",
          "sql": "SELECT datetime(c.date / 1000, 'unixepoch', 'localtime') AS tid_lokal, CASE c.type WHEN 1 THEN 'inkommande' WHEN 2 THEN 'utgående' WHEN 3 THEN 'missat' WHEN 4 THEN 'röstbrevlåda' WHEN 5 THEN 'avvisat' WHEN 6 THEN 'blockerat' WHEN 7 THEN 'besvarat på annan enhet' ELSE 'typ ' || c.type END AS riktning, c.duration AS langd_s,\n  c.number AS nummer, c.name AS namn, CASE c.presentation WHEN 2 THEN 'dolt nummer' WHEN 3 THEN 'okänt nummer' WHEN 4 THEN 'telefonautomat' END AS visning, c.countryiso AS land, c.geocoded_location AS ort,\n  CASE WHEN instr(c.subscription_component_name, '/') > 0 THEN substr(c.subscription_component_name, 1, instr(c.subscription_component_name, '/') - 1) ELSE c.subscription_component_name END AS app, c.phone_account_address AS konto, CASE WHEN c.features & 1 THEN 'video' END AS video, c.new AS ny,\n  c._id AS samtal_id, datetime(c.date / 1000, 'unixepoch') AS tid_utc\nFROM calls c WHERE c.date BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY c.date;"
        },
        {
          "id": "calllog-by-number",
          "title": "Per nummer",
          "subtitle": "Antal samtal per nummer, med utgående, inkommande, missade, total längd och första och senaste.",
          "returns": "nummer, namn, samtal, utgående, inkommande, missade, längd, första, senaste",
          "sql": "SELECT c.number AS nummer, max(c.name) AS namn, count(*) AS samtal, sum(c.type = 2) AS utgaende, sum(c.type = 1) AS inkommande, sum(c.type IN (3, 5, 6)) AS missade_avvisade,\n  sum(c.duration) AS langd_s, datetime(min(c.date) / 1000, 'unixepoch', 'localtime') AS forsta_lokal, datetime(max(c.date) / 1000, 'unixepoch', 'localtime') AS senaste_lokal\nFROM calls c GROUP BY c.number ORDER BY samtal DESC;"
        },
        {
          "id": "calllog-tables",
          "group": "Avancerat",
          "title": "Tabeller i databasen",
          "subtitle": "Tabellerna i calllog.db.",
          "returns": "namn",
          "sql": "SELECT name AS tabell FROM sqlite_master WHERE type = 'table' ORDER BY name;"
        },
        {
          "id": "role-calls",
          "hidden": true,
          "role": "calls",
          "title": "Telefonen: samtalen",
          "description": "Används av Telefonen. Ett samtal per rad.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "id": "_id",
            "time": "date",
            "duration": "duration",
            "number": "number",
            "name": "name",
            "direction": "direction",
            "type": "call_type",
            "app": "app_id",
            "country": "countryiso",
            "place": "geocoded_location",
            "read": "is_read",
            "hidden": "presentation_text",
            "account": "phone_account_address",
            "typeRaw": "type"
          },
          "sql": "SELECT c._id, c.date, c.duration, c.number, c.name,\n  CASE c.type WHEN 1 THEN 'in' WHEN 2 THEN 'out' WHEN 3 THEN 'missed' WHEN 4 THEN 'voicemail' WHEN 5 THEN 'rejected' WHEN 6 THEN 'blocked' WHEN 7 THEN 'elsewhere' ELSE 'other' END AS direction,\n  CASE WHEN c.features & 1 THEN 'video' ELSE 'telefon' END AS call_type, CASE WHEN instr(c.subscription_component_name, '/') > 0 THEN substr(c.subscription_component_name, 1, instr(c.subscription_component_name, '/') - 1) ELSE c.subscription_component_name END AS app_id,\n  c.countryiso, c.geocoded_location, c.is_read, CASE c.presentation WHEN 2 THEN 'dolt nummer' WHEN 3 THEN 'okänt nummer' WHEN 4 THEN 'telefonautomat' END AS presentation_text, c.phone_account_address, c.type\nFROM calls c ORDER BY c.date DESC;"
        }
      ]
    },
    {
      "id": "ios-contacts",
      "os": "iOS",
      "label": "iOS — AddressBook.sqlitedb (Kontakter)",
      "blurb": "Kontakterna: namn, företag, nummer, e-post, anteckning, födelsedag, när de skapades och ändrades, och vilket konto (iCloud eller telefonen) de hör till. Ändringsloggen kan visa raderade kontakter.",
      "dbPathHint": "/private/var/mobile/Library/AddressBook/AddressBook.sqlitedb (+ -wal)",
      "paths": [
        "Library/AddressBook/AddressBook.sqlitedb"
      ],
      "source": "Kontrollerad mot en labbiPhone (iOS 26.4.1, 2026-11-03); tabellerna också mot iOS 18.7. CreationDate och ModificationDate är Cocoa-sekunder. ABMultiValue.property 3 är telefonnummer, 4 e-post; etiketten ur ABMultiValueLabel (_$!<Mobile>!$_ är Mobil). ABStore visar kontot. ABPersonChanges är en ändringslogg för synkningen; type 2 tolkas som raderad, vilket inte är kontrollerat i ett labb. Sökindexet (ABPersonFullTextSearch_content) kan ha kvar text från raderade kontakter.",
      "queries": [
        {
          "id": "contacts-all",
          "title": "Alla kontakter",
          "recommended": true,
          "subtitle": "En rad per kontakt: namn, företag, nummer och e-post med etikett, anteckning, födelsedag, skapad och ändrad, och kontot.",
          "returns": "namn, företag, nummer, e-post, anteckning, födelsedag, skapad, ändrad, konto, id",
          "sql": "SELECT trim(COALESCE(p.First, '') || ' ' || COALESCE(p.Middle, '') || ' ' || COALESCE(p.Last, '')) AS namn, p.Nickname AS smeknamn, p.Organization AS foretag, p.JobTitle AS titel,\n  (SELECT group_concat(replace(replace(COALESCE(l.value, ''), '_$!<', ''), '>!$_', '') || ': ' || v.value, char(10)) FROM ABMultiValue v LEFT JOIN ABMultiValueLabel l ON l.ROWID = v.label WHERE v.record_id = p.ROWID AND v.property = 3) AS nummer,\n  (SELECT group_concat(replace(replace(COALESCE(l.value, ''), '_$!<', ''), '>!$_', '') || ': ' || v.value, char(10)) FROM ABMultiValue v LEFT JOIN ABMultiValueLabel l ON l.ROWID = v.label WHERE v.record_id = p.ROWID AND v.property = 4) AS epost,\n  p.Note AS anteckning, CASE WHEN p.Birthday IS NOT NULL THEN date(p.Birthday + 978307200, 'unixepoch') END AS fodelsedag,\n  datetime(p.CreationDate + 978307200, 'unixepoch', 'localtime') AS skapad_lokal, datetime(p.ModificationDate + 978307200, 'unixepoch', 'localtime') AS andrad_lokal,\n  (SELECT COALESCE(NULLIF(s.Name, ''), CASE WHEN s.Type = 0 THEN 'På telefonen' END) FROM ABStore s WHERE s.ROWID = p.StoreID) AS konto, p.ROWID AS kontakt_id\nFROM ABPerson p ORDER BY namn;"
        },
        {
          "id": "contacts-numbers",
          "title": "Nummer och adresser",
          "subtitle": "Varje nummer och e-postadress för sig, med etikett och kontakt. Används för att slå upp ett nummer.",
          "returns": "kontakt, slag, etikett, värde, kontakt-id",
          "sql": "SELECT trim(COALESCE(p.First, '') || ' ' || COALESCE(p.Middle, '') || ' ' || COALESCE(p.Last, '')) AS kontakt, CASE v.property WHEN 3 THEN 'telefon' WHEN 4 THEN 'e-post' ELSE 'property ' || v.property END AS slag,\n  replace(replace(COALESCE(l.value, ''), '_$!<', ''), '>!$_', '') AS etikett, v.value AS varde, p.ROWID AS kontakt_id\nFROM ABMultiValue v JOIN ABPerson p ON p.ROWID = v.record_id LEFT JOIN ABMultiValueLabel l ON l.ROWID = v.label\nWHERE v.property IN (3, 4) ORDER BY kontakt;"
        },
        {
          "id": "contacts-changes",
          "title": "Ändrade och raderade kontakter",
          "subtitle": "Ändringsloggen för synkningen (ABPersonChanges) med om kontakten finns kvar, och sökindexets rader för kontakter som inte längre finns.",
          "returns": "källa, kontakt-id, typ, finns kvar, namn, nummer, e-post",
          "sql": "SELECT 'ABPersonChanges' AS kalla, c.record AS kontakt_id,\n  CASE c.type WHEN 0 THEN 'tillagd' WHEN 1 THEN 'ändrad' WHEN 2 THEN 'raderad' ELSE 'typ ' || c.type END AS typ, c.sequence_number AS lopnummer,\n  CASE WHEN EXISTS (SELECT 1 FROM ABPerson p WHERE p.ROWID = c.record) THEN 'ja' ELSE 'nej' END AS finns_kvar,\n  (SELECT trim(COALESCE(p.First, '') || ' ' || COALESCE(p.Middle, '') || ' ' || COALESCE(p.Last, '')) FROM ABPerson p WHERE p.ROWID = c.record) AS namn, NULL AS nummer, NULL AS epost\nFROM ABPersonChanges c\nUNION ALL\nSELECT 'sökindex', f.docid, 'finns bara i sökindexet', NULL, 'nej', trim(COALESCE(f.c0First, '') || ' ' || COALESCE(f.c1Last, '') || ' ' || COALESCE(f.c6Organization, '')), f.c16Phone, f.c17Email\nFROM ABPersonFullTextSearch_content f WHERE f.docid NOT IN (SELECT ROWID FROM ABPerson)\nORDER BY kalla, kontakt_id;"
        },
        {
          "id": "contacts-tables",
          "group": "Avancerat",
          "title": "Tabeller i databasen",
          "subtitle": "Tabellerna i AddressBook.sqlitedb.",
          "returns": "namn",
          "sql": "SELECT name AS tabell FROM sqlite_master WHERE type = 'table' ORDER BY name;"
        },
        {
          "id": "role-contacts",
          "hidden": true,
          "role": "contacts",
          "title": "Telefonen: kontakterna",
          "description": "Används av Telefonen, Chattar och samtalen. En rad per kontakt.",
          "params": [],
          "epoch": "cocoa",
          "fields": {
            "id": "ROWID",
            "name": "full_name",
            "first": "First",
            "last": "Last",
            "nick": "Nickname",
            "org": "Organization",
            "title": "JobTitle",
            "note": "Note",
            "birthday": "birthday",
            "created": "CreationDate",
            "modified": "ModificationDate",
            "account": "account"
          },
          "sql": "SELECT p.ROWID, trim(COALESCE(p.First, '') || ' ' || COALESCE(p.Middle, '') || ' ' || COALESCE(p.Last, '')) AS full_name, p.First, p.Last, p.Nickname, p.Organization, p.JobTitle, p.Note,\n  CASE WHEN p.Birthday IS NOT NULL THEN date(p.Birthday + 978307200, 'unixepoch') END AS birthday, p.CreationDate, p.ModificationDate,\n  (SELECT COALESCE(NULLIF(s.Name, ''), CASE WHEN s.Type = 0 THEN 'På telefonen' END) FROM ABStore s WHERE s.ROWID = p.StoreID) AS account\nFROM ABPerson p;"
        },
        {
          "id": "role-contact-points",
          "hidden": true,
          "role": "contact-points",
          "title": "Telefonen: kontakternas nummer och e-post",
          "description": "Används av Telefonen och Chattar för att slå upp namnet till ett nummer.",
          "params": [],
          "epoch": "cocoa",
          "fields": {
            "contactId": "record_id",
            "kind": "kind",
            "label": "label",
            "value": "value"
          },
          "sql": "SELECT v.record_id, CASE v.property WHEN 3 THEN 'phone' ELSE 'email' END AS kind, replace(replace(COALESCE(l.value, ''), '_$!<', ''), '>!$_', '') AS label, v.value\nFROM ABMultiValue v LEFT JOIN ABMultiValueLabel l ON l.ROWID = v.label WHERE v.property IN (3, 4);"
        }
      ]
    },
    {
      "id": "android-contacts",
      "os": "Android",
      "label": "Android — contacts2.db (Kontakter)",
      "blurb": "Kontakterna i Androids kontaktleverantör: namn, nummer, e-post, företag och anteckning per konto (Google, telefonen, SIM, och appar som WhatsApp och Signal som lägger in sina egna), hur ofta de kontaktats och raderade kontakter.",
      "dbPathHint": "/data/data/com.android.providers.contacts/databases/contacts2.db (Samsung: com.samsung.android.providers.contacts)",
      "paths": [
        "providers.contacts/databases/contacts2.db"
      ],
      "source": "Tabellerna är kontrollerade mot Android 16 (Pixel och Samsung), men databaserna i de extraktionerna var tomma, så frågorna är inte provade mot riktiga kontakter. En kontakt (contact_id) består av en rå kontakt per konto (raw_contacts); uppgifterna står i data med typen i mimetypes. raw_contacts.deleted 1: raderad men inte synkad ännu. deleted_contacts: kontakter som raderats, med tiden i millisekunder. last_time_contacted är millisekunder (från Android 10 avrundat eller tomt).",
      "queries": [
        {
          "id": "contacts2-all",
          "title": "Alla kontakter",
          "recommended": true,
          "subtitle": "En rad per kontakt: namn, nummer, e-post, företag, anteckning, konton, favorit, antal kontakter och senast, och om den är markerad som raderad.",
          "returns": "namn, nummer, e-post, företag, anteckning, konton, favorit, kontaktad, senast, raderad, id",
          "sql": "SELECT max(r.display_name) AS namn,\n  (SELECT group_concat(DISTINCT d.data1) FROM data d JOIN raw_contacts r2 ON r2._id = d.raw_contact_id WHERE r2.contact_id = r.contact_id AND d.mimetype_id = (SELECT _id FROM mimetypes WHERE mimetype = 'vnd.android.cursor.item/phone_v2')) AS nummer,\n  (SELECT group_concat(DISTINCT d.data1) FROM data d JOIN raw_contacts r2 ON r2._id = d.raw_contact_id WHERE r2.contact_id = r.contact_id AND d.mimetype_id = (SELECT _id FROM mimetypes WHERE mimetype = 'vnd.android.cursor.item/email_v2')) AS epost,\n  (SELECT group_concat(DISTINCT d.data1) FROM data d JOIN raw_contacts r2 ON r2._id = d.raw_contact_id WHERE r2.contact_id = r.contact_id AND d.mimetype_id = (SELECT _id FROM mimetypes WHERE mimetype = 'vnd.android.cursor.item/organization')) AS foretag,\n  (SELECT group_concat(DISTINCT d.data1) FROM data d JOIN raw_contacts r2 ON r2._id = d.raw_contact_id WHERE r2.contact_id = r.contact_id AND d.mimetype_id = (SELECT _id FROM mimetypes WHERE mimetype = 'vnd.android.cursor.item/note') AND d.data1 <> '') AS anteckning,\n  group_concat(DISTINCT COALESCE(a.account_type, 'på telefonen')) AS konton, max(r.starred) AS favorit, max(r.times_contacted) AS kontaktad,\n  CASE WHEN max(r.last_time_contacted) > 0 THEN datetime(max(r.last_time_contacted) / 1000, 'unixepoch', 'localtime') END AS senast_lokal,\n  max(r.deleted) AS raderad, r.contact_id AS kontakt_id\nFROM raw_contacts r LEFT JOIN accounts a ON a._id = r.account_id\nGROUP BY r.contact_id ORDER BY namn;"
        },
        {
          "id": "contacts2-data",
          "title": "Alla uppgifter per konto",
          "subtitle": "Varje uppgift för sig (nummer, e-post, namn, företag, anteckning och annat) med typen, kontot och den råa kontakten. Visar till exempel vilka nummer som WhatsApp eller Signal lagt in.",
          "returns": "namn, konto, slag, värde, etikett, rå kontakt, kontakt",
          "sql": "SELECT r.display_name AS namn, COALESCE(a.account_type, 'på telefonen') AS konto, a.account_name AS kontonamn,\n  replace(replace((SELECT mimetype FROM mimetypes WHERE _id = d.mimetype_id), 'vnd.android.cursor.item/', ''), 'vnd.com.google.cursor.item/', '') AS slag, d.data1 AS varde,\n  CASE WHEN (SELECT mimetype FROM mimetypes WHERE _id = d.mimetype_id) = 'vnd.android.cursor.item/phone_v2' THEN CASE d.data2 WHEN 0 THEN COALESCE(d.data3, 'Egen') WHEN 1 THEN 'Hem' WHEN 2 THEN 'Mobil' WHEN 3 THEN 'Arbete' WHEN 4 THEN 'Fax arbete' WHEN 5 THEN 'Fax hem' WHEN 7 THEN 'Annat' WHEN 12 THEN 'Huvudnummer' ELSE 'Typ ' || d.data2 END END AS etikett, r._id AS ra_kontakt, r.contact_id AS kontakt_id, r.deleted AS raderad\nFROM data d JOIN raw_contacts r ON r._id = d.raw_contact_id LEFT JOIN accounts a ON a._id = r.account_id\nORDER BY namn, konto;"
        },
        {
          "id": "contacts2-deleted",
          "title": "Raderade kontakter",
          "subtitle": "Kontakter i deleted_contacts med tiden de raderades, och råa kontakter som är markerade som raderade men inte synkade.",
          "returns": "källa, kontakt, tid, namn, konto",
          "sql": "SELECT 'deleted_contacts' AS kalla, dc.contact_id AS kontakt_id, datetime(dc.contact_deleted_timestamp / 1000, 'unixepoch', 'localtime') AS raderad_lokal,\n  (SELECT max(r.display_name) FROM raw_contacts r WHERE r.contact_id = dc.contact_id) AS namn, NULL AS konto\nFROM deleted_contacts dc\nUNION ALL\nSELECT 'raw_contacts.deleted', r.contact_id, NULL, r.display_name, (SELECT a.account_type FROM accounts a WHERE a._id = r.account_id)\nFROM raw_contacts r WHERE r.deleted = 1\nORDER BY raderad_lokal DESC;"
        },
        {
          "id": "contacts2-tables",
          "group": "Avancerat",
          "title": "Tabeller i databasen",
          "subtitle": "Tabellerna i contacts2.db.",
          "returns": "namn",
          "sql": "SELECT name AS tabell FROM sqlite_master WHERE type = 'table' ORDER BY name;"
        },
        {
          "id": "role-contacts",
          "hidden": true,
          "role": "contacts",
          "title": "Telefonen: kontakterna",
          "description": "Används av Telefonen, Chattar och samtalen. En rad per kontakt (contact_id).",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "id": "contact_id",
            "name": "name",
            "org": "org",
            "note": "note",
            "account": "accounts",
            "starred": "starred",
            "contacted": "times_contacted",
            "lastContacted": "last_contacted",
            "deleted": "deleted"
          },
          "sql": "SELECT r.contact_id, max(r.display_name) AS name,\n  (SELECT max(d.data1) FROM data d JOIN raw_contacts r2 ON r2._id = d.raw_contact_id WHERE r2.contact_id = r.contact_id AND d.mimetype_id = (SELECT _id FROM mimetypes WHERE mimetype = 'vnd.android.cursor.item/organization')) AS org,\n  (SELECT max(d.data1) FROM data d JOIN raw_contacts r2 ON r2._id = d.raw_contact_id WHERE r2.contact_id = r.contact_id AND d.mimetype_id = (SELECT _id FROM mimetypes WHERE mimetype = 'vnd.android.cursor.item/note') AND d.data1 <> '') AS note,\n  group_concat(DISTINCT COALESCE(a.account_type, 'på telefonen')) AS accounts, max(r.starred) AS starred, max(r.times_contacted) AS times_contacted,\n  NULLIF(max(r.last_time_contacted), 0) AS last_contacted, min(r.deleted) AS deleted\nFROM raw_contacts r LEFT JOIN accounts a ON a._id = r.account_id\nWHERE r.contact_id IS NOT NULL GROUP BY r.contact_id;"
        },
        {
          "id": "role-contact-points",
          "hidden": true,
          "role": "contact-points",
          "title": "Telefonen: kontakternas nummer och e-post",
          "description": "Används av Telefonen och Chattar för att slå upp namnet till ett nummer.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "contactId": "contact_id",
            "kind": "kind",
            "label": "label",
            "value": "data1",
            "account": "account_type"
          },
          "sql": "SELECT r.contact_id, CASE WHEN m.mimetype = 'vnd.android.cursor.item/phone_v2' THEN 'phone' ELSE 'email' END AS kind,\n  CASE WHEN m.mimetype = 'vnd.android.cursor.item/phone_v2' THEN CASE d.data2 WHEN 0 THEN COALESCE(d.data3, 'Egen') WHEN 1 THEN 'Hem' WHEN 2 THEN 'Mobil' WHEN 3 THEN 'Arbete' WHEN 4 THEN 'Fax arbete' WHEN 5 THEN 'Fax hem' WHEN 7 THEN 'Annat' WHEN 12 THEN 'Huvudnummer' ELSE 'Typ ' || d.data2 END END AS label, d.data1, a.account_type\nFROM data d JOIN mimetypes m ON m._id = d.mimetype_id JOIN raw_contacts r ON r._id = d.raw_contact_id LEFT JOIN accounts a ON a._id = r.account_id\nWHERE m.mimetype IN ('vnd.android.cursor.item/phone_v2', 'vnd.android.cursor.item/email_v2') AND r.contact_id IS NOT NULL AND d.data1 IS NOT NULL;"
        }
      ]
    }
  ]
};
