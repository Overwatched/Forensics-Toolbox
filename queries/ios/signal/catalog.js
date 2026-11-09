/* Genererad från ios/signal/catalog.json — används när fetch() blockeras (file://). */
window.SIGNAL_IOS_CATALOG = {
  "id": "signal-ios",
  "title": "Signal iOS Queries",
  "sourceNote": "Betafunktion. Signals databas på iOS, grdb/signal.sqlite i appgruppen group.org.whispersystems.signal.group. Databasen är krypterad med SQLCipher 4. Queries och Härkomst dekrypterar den i minnet med nyckeln ur nyckelringen (filen …_keychain.plist bredvid zippen) eller en nyckel du klistrar in. Tiderna är Unix-millisekunder och visas här med datetime(…/1000, 'unixepoch', 'localtime'). Bilagornas SHA-256 står som data i databasen och visas här som hex. Tabeller och kolumner är kontrollerade mot en labbtelefon (iOS 26.4.1, 2026-11-03). Strukturen kan skilja sig mellan Signal-versioner, så kontrollera alltid mot databasen.",
  "paramLabels": {
    "sha256": "SHA-256 (hex, 64 tecken)",
    "threadId": "Trådens id (id i model_TSThread)"
  },
  "databases": [
    {
      "id": "signal-ios-main",
      "label": "iOS — signal.sqlite (Signal)",
      "cipher": "signal-ios",
      "blurb": "Meddelanden, bilagor, samtal, konversationer och kontakter. Krypterad med SQLCipher; dekrypteras i minnet med nyckeln ur nyckelringen. För varje bilaga finns SHA-256 för den lagrade filen (sha256ContentHash) och filnamnet när bilden lades till (sourceFilename).",
      "dbPathHint": "/private/var/mobile/Containers/Shared/AppGroup/<GUID>/grdb/signal.sqlite (+ -wal), i appgruppen group.org.whispersystems.signal.group. Bilagorna ligger krypterade i attachment_files/ i samma appgrupp.",
      "paths": [
        "grdb/signal.sqlite"
      ],
      "source": "Kontrollerad mot en labbtelefon (iOS 26.4.1, 2026-11-03 och 2026-11-04, den andra med loggad ordning). recordType: 21 skickat, 19 mottaget, 20 samtal, 10 info (Signals källkod, SDSRecordType, kontrollerat mot data). wasNotCreatedLocally 1: skickat från en länkad enhet; hasSyncedTranscript 1: skickat från telefonen. expireStartedAt på ett mottaget meddelande med försvinnande tid är när det öppnades. Raderat för mig lämnar bara ett hopp i id-numreringen. CallRecord har när samtalet började, inte när det besvarades. timestamp är avsändarens klocka, receivedAtTimestamp den här telefonens och serverTimestamp serverns. sha256ContentHash är SHA-256 för bilagan som den lagrats och skickats (Signal kodar om bilder). sourceFilename är namnet när bilden lades till; Signals kamera och bilder utan namn får signal-ÅÅÅÅ-MM-DD-TTMMSS.jpeg i telefonens lokala tid. Berättelser ligger i model_StoryMessage, inte bland meddelandena (Signals egen introduktion är fem av dem, med författaren 00000000-0000-0000-0000-000000000001; direction 1 är utgående).",
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
          "subtitle": "Visar meddelandena i tidsspannet: när de skickades (avsändarens klocka), togs emot och nådde servern, riktning, konversation, avsändare, text, antal bilagor, engångsvisning, radering för alla och redigering. Samtal står med som riktning samtal.",
          "returns": "skickad, mottagen, server, riktning, konversation, från, text, bilagor, engångsvisning, raderat, redigerat, försvinner, id, UTC",
          "sql": "SELECT\n  datetime(i.timestamp / 1000, 'unixepoch', 'localtime') AS skickad_lokal,\n  datetime(i.receivedAtTimestamp / 1000, 'unixepoch', 'localtime') AS mottagen_lokal,\n  CASE WHEN i.serverTimestamp > 0 THEN datetime(i.serverTimestamp / 1000, 'unixepoch', 'localtime') END AS server_lokal,\n  CASE i.recordType WHEN 19 THEN 'mottaget' WHEN 21 THEN 'skickat' WHEN 20 THEN 'samtal' WHEN 65 THEN 'gruppsamtal' WHEN 10 THEN 'info' WHEN 9 THEN 'fel' ELSE 'typ ' || i.recordType END AS riktning,\n  CASE WHEN t.groupModel IS NOT NULL THEN COALESCE(NULLIF(t.name, ''), 'grupp #' || t.id)\n    ELSE COALESCE(COALESCE(\n      (SELECT NULLIF(trim(COALESCE(n.givenName, '') || ' ' || COALESCE(n.familyName, '')), '') FROM NicknameRecord n JOIN model_SignalRecipient sr ON sr.id = n.recipientRowID WHERE sr.recipientUUID = t.contactUUID),\n      (SELECT NULLIF(sa.fullName, '') FROM model_SignalAccount sa WHERE sa.recipientUUID = t.contactUUID),\n      (SELECT NULLIF(trim(COALESCE(p.profileName, '') || ' ' || COALESCE(p.familyName, '')), '') FROM model_OWSUserProfile p WHERE p.recipientUUID = t.contactUUID),\n      (SELECT sr.recipientPhoneNumber FROM model_SignalRecipient sr WHERE sr.recipientUUID = t.contactUUID),\n      t.contactUUID), t.contactPhoneNumber, '#' || t.id) END AS konversation,\n  CASE WHEN i.recordType = 21 THEN 'den här telefonen' WHEN i.authorUUID IS NOT NULL THEN COALESCE(\n      (SELECT NULLIF(trim(COALESCE(n.givenName, '') || ' ' || COALESCE(n.familyName, '')), '') FROM NicknameRecord n JOIN model_SignalRecipient sr ON sr.id = n.recipientRowID WHERE sr.recipientUUID = i.authorUUID),\n      (SELECT NULLIF(sa.fullName, '') FROM model_SignalAccount sa WHERE sa.recipientUUID = i.authorUUID),\n      (SELECT NULLIF(trim(COALESCE(p.profileName, '') || ' ' || COALESCE(p.familyName, '')), '') FROM model_OWSUserProfile p WHERE p.recipientUUID = i.authorUUID),\n      (SELECT sr.recipientPhoneNumber FROM model_SignalRecipient sr WHERE sr.recipientUUID = i.authorUUID),\n      i.authorUUID) ELSE i.authorPhoneNumber END AS fran,\n  i.body AS text,\n  (SELECT count(*) FROM MessageAttachmentReference r WHERE r.ownerRowId = i.id AND r.ownerType = 0) AS bilagor,\n  CASE WHEN i.isViewOnceMessage = 1 THEN 'ja' END AS engangsvisning,\n  CASE WHEN i.wasRemotelyDeleted = 1 THEN 'raderat för alla' END AS raderat,\n  CASE WHEN EXISTS (SELECT 1 FROM EditRecord e WHERE e.latestRevisionId = i.id) THEN 'redigerat'\n       WHEN EXISTS (SELECT 1 FROM EditRecord e WHERE e.pastRevisionId = i.id) THEN 'tidigare version' END AS redigerat,\n  CASE WHEN i.expiresInSeconds > 0 THEN i.expiresInSeconds || ' s' END AS forsvinner,\n  CASE WHEN i.recordType = 21 AND i.wasNotCreatedLocally = 1 THEN 'länkad enhet' WHEN i.recordType = 21 THEN 'den här telefonen' END AS skickat_fran,\n  CASE WHEN i.recordType = 19 AND i.expiresInSeconds > 0 AND i.expireStartedAt > 0 THEN datetime(i.expireStartedAt / 1000, 'unixepoch', 'localtime') END AS oppnad_lokal,\n  i.id AS meddelande_id,\n  t.id AS trad_id,\n  datetime(i.timestamp / 1000, 'unixepoch') AS skickad_utc\nFROM model_TSInteraction i\nLEFT JOIN model_TSThread t ON t.uniqueId = i.uniqueThreadId\nWHERE i.timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\n   OR i.receivedAtTimestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY i.receivedAtTimestamp, i.id;",
          "chat": {
            "thread": "trad_id",
            "message": "meddelande_id"
          }
        },
        {
          "id": "attachments",
          "title": "Bilagor i tidsspann",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar bilagorna i tidsspannet med meddelandets tid och riktning, filnamnet när bilden lades till, typ, storlek, mått, SHA-256 i hex och var den krypterade filen ligger.",
          "returns": "skickad, mottagen, riktning, konversation, filnamn, typ, storlek, mått, SHA-256, fil, uppladdad, engångsvisning, del, id, UTC",
          "sql": "SELECT\n  datetime(i.timestamp / 1000, 'unixepoch', 'localtime') AS skickad_lokal,\n  datetime(r.receivedAtTimestamp / 1000, 'unixepoch', 'localtime') AS mottagen_lokal,\n  CASE i.recordType WHEN 19 THEN 'mottagen' WHEN 21 THEN 'skickad' WHEN 20 THEN 'samtal' WHEN 65 THEN 'gruppsamtal' WHEN 10 THEN 'info' WHEN 9 THEN 'fel' ELSE 'typ ' || i.recordType END AS riktning,\n  CASE WHEN t.groupModel IS NOT NULL THEN COALESCE(NULLIF(t.name, ''), 'grupp #' || t.id)\n    ELSE COALESCE(COALESCE(\n      (SELECT NULLIF(trim(COALESCE(n.givenName, '') || ' ' || COALESCE(n.familyName, '')), '') FROM NicknameRecord n JOIN model_SignalRecipient sr ON sr.id = n.recipientRowID WHERE sr.recipientUUID = t.contactUUID),\n      (SELECT NULLIF(sa.fullName, '') FROM model_SignalAccount sa WHERE sa.recipientUUID = t.contactUUID),\n      (SELECT NULLIF(trim(COALESCE(p.profileName, '') || ' ' || COALESCE(p.familyName, '')), '') FROM model_OWSUserProfile p WHERE p.recipientUUID = t.contactUUID),\n      (SELECT sr.recipientPhoneNumber FROM model_SignalRecipient sr WHERE sr.recipientUUID = t.contactUUID),\n      t.contactUUID), t.contactPhoneNumber, '#' || t.id) END AS konversation,\n  r.sourceFilename AS filnamn,\n  a.mimeType AS typ,\n  a.unencryptedByteCount AS storlek,\n  a.cachedMediaWidthPixels || '×' || a.cachedMediaHeightPixels AS matt,\n  lower(hex(a.sha256ContentHash)) AS sha256,\n  CASE WHEN a.localRelativeFilePath IS NOT NULL THEN 'attachment_files/' || a.localRelativeFilePath END AS fil,\n  CASE WHEN a.transitUploadTimestamp > 0 THEN datetime(a.transitUploadTimestamp / 1000, 'unixepoch', 'localtime') END AS uppladdad_lokal,\n  CASE WHEN r.isViewOnce = 1 THEN 'ja' END AS engangsvisning,\n  CASE r.ownerType WHEN 0 THEN 'bilaga' ELSE 'ägartyp ' || r.ownerType END AS del,\n  a.id AS bilaga_id,\n  i.id AS meddelande_id,\n  datetime(i.timestamp / 1000, 'unixepoch') AS skickad_utc\nFROM MessageAttachmentReference r\nJOIN Attachment a ON a.id = r.attachmentRowId\nLEFT JOIN model_TSInteraction i ON i.id = r.ownerRowId\nLEFT JOIN model_TSThread t ON t.id = r.threadRowId\nWHERE i.timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\n   OR r.receivedAtTimestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY r.receivedAtTimestamp, a.id;"
        },
        {
          "id": "attachment-by-sha256",
          "title": "En bilaga efter SHA-256",
          "timeEpoch": "unix-ms",
          "params": [
            "sha256"
          ],
          "subtitle": "Letar upp bilagan med en viss SHA-256 (hex) och visar meddelandet den hör till. Signal kodar om bilder, så en bild ur galleriet har inte samma summa som bilagan; en bilaga som sparats ur Signal har det.",
          "returns": "skickad, mottagen, riktning, konversation, filnamn, typ, storlek, mått, SHA-256, fil, uppladdad, engångsvisning, del, id, UTC",
          "sql": "SELECT\n  datetime(i.timestamp / 1000, 'unixepoch', 'localtime') AS skickad_lokal,\n  datetime(r.receivedAtTimestamp / 1000, 'unixepoch', 'localtime') AS mottagen_lokal,\n  CASE i.recordType WHEN 19 THEN 'mottagen' WHEN 21 THEN 'skickad' WHEN 20 THEN 'samtal' WHEN 65 THEN 'gruppsamtal' WHEN 10 THEN 'info' WHEN 9 THEN 'fel' ELSE 'typ ' || i.recordType END AS riktning,\n  CASE WHEN t.groupModel IS NOT NULL THEN COALESCE(NULLIF(t.name, ''), 'grupp #' || t.id)\n    ELSE COALESCE(COALESCE(\n      (SELECT NULLIF(trim(COALESCE(n.givenName, '') || ' ' || COALESCE(n.familyName, '')), '') FROM NicknameRecord n JOIN model_SignalRecipient sr ON sr.id = n.recipientRowID WHERE sr.recipientUUID = t.contactUUID),\n      (SELECT NULLIF(sa.fullName, '') FROM model_SignalAccount sa WHERE sa.recipientUUID = t.contactUUID),\n      (SELECT NULLIF(trim(COALESCE(p.profileName, '') || ' ' || COALESCE(p.familyName, '')), '') FROM model_OWSUserProfile p WHERE p.recipientUUID = t.contactUUID),\n      (SELECT sr.recipientPhoneNumber FROM model_SignalRecipient sr WHERE sr.recipientUUID = t.contactUUID),\n      t.contactUUID), t.contactPhoneNumber, '#' || t.id) END AS konversation,\n  r.sourceFilename AS filnamn,\n  a.mimeType AS typ,\n  a.unencryptedByteCount AS storlek,\n  a.cachedMediaWidthPixels || '×' || a.cachedMediaHeightPixels AS matt,\n  lower(hex(a.sha256ContentHash)) AS sha256,\n  CASE WHEN a.localRelativeFilePath IS NOT NULL THEN 'attachment_files/' || a.localRelativeFilePath END AS fil,\n  CASE WHEN a.transitUploadTimestamp > 0 THEN datetime(a.transitUploadTimestamp / 1000, 'unixepoch', 'localtime') END AS uppladdad_lokal,\n  CASE WHEN r.isViewOnce = 1 THEN 'ja' END AS engangsvisning,\n  CASE r.ownerType WHEN 0 THEN 'bilaga' ELSE 'ägartyp ' || r.ownerType END AS del,\n  a.id AS bilaga_id,\n  i.id AS meddelande_id,\n  datetime(i.timestamp / 1000, 'unixepoch') AS skickad_utc\nFROM Attachment a\nLEFT JOIN MessageAttachmentReference r ON r.attachmentRowId = a.id\nLEFT JOIN model_TSInteraction i ON i.id = r.ownerRowId\nLEFT JOIN model_TSThread t ON t.id = r.threadRowId\nWHERE lower(hex(a.sha256ContentHash)) = lower('{{sha256}}')\nORDER BY a.id;"
        },
        {
          "id": "calls",
          "title": "Samtal i tidsspann",
          "timeEpoch": "unix-ms",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "subtitle": "Visar samtalen i tidsspannet ur CallRecord: när de började och slutade, riktning, ljud eller video, status och konversation. Statusens värden är Signals egna och är inte översatta.",
          "returns": "började, slutade, riktning, typ, status, konversation, meddelande, id, UTC",
          "sql": "SELECT\n  datetime(c.callBeganTimestamp / 1000, 'unixepoch', 'localtime') AS borjade_lokal,\n  CASE WHEN c.callEndedTimestamp > 0 THEN datetime(c.callEndedTimestamp / 1000, 'unixepoch', 'localtime') END AS slutade_lokal,\n  CASE c.direction WHEN 0 THEN 'inkommande' WHEN 1 THEN 'utgående' ELSE 'riktning ' || c.direction END AS riktning,\n  CASE c.type WHEN 0 THEN 'ljud' WHEN 1 THEN 'video' ELSE 'typ ' || c.type END AS typ,\n  c.status AS status,\n  CASE WHEN t.groupModel IS NOT NULL THEN COALESCE(NULLIF(t.name, ''), 'grupp #' || t.id)\n    ELSE COALESCE(COALESCE(\n      (SELECT NULLIF(trim(COALESCE(n.givenName, '') || ' ' || COALESCE(n.familyName, '')), '') FROM NicknameRecord n JOIN model_SignalRecipient sr ON sr.id = n.recipientRowID WHERE sr.recipientUUID = t.contactUUID),\n      (SELECT NULLIF(sa.fullName, '') FROM model_SignalAccount sa WHERE sa.recipientUUID = t.contactUUID),\n      (SELECT NULLIF(trim(COALESCE(p.profileName, '') || ' ' || COALESCE(p.familyName, '')), '') FROM model_OWSUserProfile p WHERE p.recipientUUID = t.contactUUID),\n      (SELECT sr.recipientPhoneNumber FROM model_SignalRecipient sr WHERE sr.recipientUUID = t.contactUUID),\n      t.contactUUID), t.contactPhoneNumber, '#' || t.id) END AS konversation,\n  c.interactionRowId AS meddelande_id,\n  c.id AS samtal_id,\n  datetime(c.callBeganTimestamp / 1000, 'unixepoch') AS borjade_utc\nFROM CallRecord c\nLEFT JOIN model_TSThread t ON t.id = c.threadRowId\nWHERE c.callBeganTimestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY c.callBeganTimestamp;"
        },
        {
          "id": "stories",
          "title": "Berättelser (stories)",
          "description": "Berättelser som lagts upp eller tagits emot. Vidarebefordran syns inte som en koppling till originalet. Signals egen introduktion är borttagen.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "sql": "SELECT\n  datetime(s.timestamp / 1000, 'unixepoch', 'localtime') AS tid_lokal,\n  CASE s.direction WHEN 1 THEN 'utgående' ELSE 'inkommande' END AS riktning,\n  a.mimeType AS typ,\n  a.unencryptedByteCount AS storlek,\n  lower(hex(a.sha256ContentHash)) AS sha256,\n  s.id AS berattelse_id\nFROM model_StoryMessage s\nLEFT JOIN StoryMessageAttachmentReference r ON r.ownerRowId = s.id\nLEFT JOIN Attachment a ON a.id = r.attachmentRowId\nWHERE s.authorUuid <> '00000000-0000-0000-0000-000000000001'\n  AND s.timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY s.timestamp;",
          "timeEpoch": "unix-ms",
          "subtitle": "Visar samtalen i tidsspannet ur CallRecord: när de började och slutade, riktning, ljud eller video, status och konversation. Statusens värden är Signals egna och är inte översatta.",
          "returns": "började, slutade, riktning, typ, status, konversation, meddelande, id, UTC"
        },
        {
          "id": "threads",
          "title": "Konversationer",
          "params": [],
          "subtitle": "Visar alla konversationer: person eller grupp, namn, telefonnummer och ACI, när konversationen skapades, antal meddelanden och det senaste.",
          "returns": "id, slag, konversation, telefon, ACI, skapad, meddelanden, senaste, arkiverad",
          "sql": "SELECT\n  t.id AS trad_id,\n  CASE WHEN t.groupModel IS NOT NULL THEN 'grupp' WHEN t.contactUUID IS NOT NULL OR t.contactPhoneNumber IS NOT NULL THEN 'person' ELSE 'annan (typ ' || t.recordType || ')' END AS slag,\n  CASE WHEN t.groupModel IS NOT NULL THEN COALESCE(NULLIF(t.name, ''), 'grupp #' || t.id)\n    ELSE COALESCE(COALESCE(\n      (SELECT NULLIF(trim(COALESCE(n.givenName, '') || ' ' || COALESCE(n.familyName, '')), '') FROM NicknameRecord n JOIN model_SignalRecipient sr ON sr.id = n.recipientRowID WHERE sr.recipientUUID = t.contactUUID),\n      (SELECT NULLIF(sa.fullName, '') FROM model_SignalAccount sa WHERE sa.recipientUUID = t.contactUUID),\n      (SELECT NULLIF(trim(COALESCE(p.profileName, '') || ' ' || COALESCE(p.familyName, '')), '') FROM model_OWSUserProfile p WHERE p.recipientUUID = t.contactUUID),\n      (SELECT sr.recipientPhoneNumber FROM model_SignalRecipient sr WHERE sr.recipientUUID = t.contactUUID),\n      t.contactUUID), t.contactPhoneNumber, '#' || t.id) END AS konversation,\n  t.contactPhoneNumber AS telefon,\n  t.contactUUID AS aci,\n  datetime(t.creationDate, 'unixepoch', 'localtime') AS skapad_lokal,\n  (SELECT count(*) FROM model_TSInteraction i WHERE i.uniqueThreadId = t.uniqueId) AS meddelanden,\n  (SELECT datetime(max(i.timestamp) / 1000, 'unixepoch', 'localtime') FROM model_TSInteraction i WHERE i.uniqueThreadId = t.uniqueId) AS senaste_lokal,\n  CASE WHEN t.isArchived = 1 THEN 'ja' END AS arkiverad\nFROM model_TSThread t\nORDER BY senaste_lokal DESC;"
        },
        {
          "id": "recipients",
          "title": "Kontakter",
          "params": [],
          "subtitle": "Visar Signals mottagare med namn (smeknamn, kontaktbokens namn, profilnamn eller telefonnummer), telefonnummer, ACI och profilnamn.",
          "returns": "id, namn, telefon, ACI, profilnamn, avregistrerad",
          "sql": "SELECT\n  sr.id AS mottagare_id,\n  COALESCE(\n      (SELECT NULLIF(trim(COALESCE(n.givenName, '') || ' ' || COALESCE(n.familyName, '')), '') FROM NicknameRecord n JOIN model_SignalRecipient sr ON sr.id = n.recipientRowID WHERE sr.recipientUUID = sr.recipientUUID),\n      (SELECT NULLIF(sa.fullName, '') FROM model_SignalAccount sa WHERE sa.recipientUUID = sr.recipientUUID),\n      (SELECT NULLIF(trim(COALESCE(p.profileName, '') || ' ' || COALESCE(p.familyName, '')), '') FROM model_OWSUserProfile p WHERE p.recipientUUID = sr.recipientUUID),\n      (SELECT sr.recipientPhoneNumber FROM model_SignalRecipient sr WHERE sr.recipientUUID = sr.recipientUUID),\n      sr.recipientUUID) AS namn,\n  sr.recipientPhoneNumber AS telefon,\n  sr.recipientUUID AS aci,\n  (SELECT p.profileName FROM model_OWSUserProfile p WHERE p.recipientUUID = sr.recipientUUID) AS profilnamn,\n  CASE WHEN sr.unregisteredAtTimestamp > 0 THEN datetime(sr.unregisteredAtTimestamp / 1000, 'unixepoch', 'localtime') END AS avregistrerad_lokal\nFROM model_SignalRecipient sr\nORDER BY sr.id;"
        },
        {
          "id": "tables",
          "title": "Hjälp: tabeller och antal rader",
          "group": "advanced",
          "params": [],
          "subtitle": "Listar databasens tabeller med antal rader för de viktigaste. Använd den för att se vilken Signal-version databasen kommer från.",
          "returns": "tabell, rader",
          "sql": "SELECT name AS tabell,\n  CASE name\n    WHEN 'model_TSInteraction' THEN (SELECT count(*) FROM model_TSInteraction)\n    WHEN 'Attachment' THEN (SELECT count(*) FROM Attachment)\n    WHEN 'MessageAttachmentReference' THEN (SELECT count(*) FROM MessageAttachmentReference)\n    WHEN 'model_TSThread' THEN (SELECT count(*) FROM model_TSThread)\n    WHEN 'model_SignalRecipient' THEN (SELECT count(*) FROM model_SignalRecipient)\n    WHEN 'CallRecord' THEN (SELECT count(*) FROM CallRecord)\n    WHEN 'model_StoryMessage' THEN (SELECT count(*) FROM model_StoryMessage)\n  END AS rader\nFROM sqlite_master\nWHERE type = 'table'\nORDER BY rader IS NULL, name;"
        },
        {
          "id": "role-attachments",
          "hidden": true,
          "role": "attachments",
          "title": "Härkomst: alla bilagor",
          "description": "Används av Härkomst. Alla bilagor med SHA-256 i hex, filnamnet när bilden lades till, meddelandets tider och riktning och konversationens namn. Ingen tidsgräns: filen jämförs med varje bilaga.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "id": "id",
            "messageId": "ownerRowId",
            "ownerType": "ownerType",
            "contentType": "mimeType",
            "size": "unencryptedByteCount",
            "width": "cachedMediaWidthPixels",
            "height": "cachedMediaHeightPixels",
            "dataFile": "localRelativeFilePath",
            "sha256": "sha256_hex",
            "upload": "transitUploadTimestamp",
            "fileName": "sourceFilename",
            "sourceSize": "sourceUnencryptedByteCount",
            "sourceWidth": "sourceMediaWidthPixels",
            "sourceHeight": "sourceMediaHeightPixels",
            "refReceived": "ref_received",
            "viewOnce": "ref_view_once",
            "threadId": "threadRowId",
            "sent": "timestamp",
            "received": "receivedAtTimestamp",
            "server": "serverTimestamp",
            "type": "recordType",
            "authorId": "authorUUID",
            "authorPhone": "authorPhoneNumber",
            "deleted": "wasRemotelyDeleted",
            "threadName": "thread_name",
            "isGroup": "is_group",
            "linked": "wasNotCreatedLocally",
            "expireStarted": "expireStartedAt",
            "expiresIn": "expiresInSeconds"
          },
          "sql": "SELECT\n  a.id, a.mimeType, a.unencryptedByteCount, a.cachedMediaWidthPixels, a.cachedMediaHeightPixels, a.localRelativeFilePath,\n  lower(hex(a.sha256ContentHash)) AS sha256_hex, a.transitUploadTimestamp,\n  r.ownerType, r.ownerRowId, r.sourceFilename, r.sourceUnencryptedByteCount, r.sourceMediaWidthPixels, r.sourceMediaHeightPixels,\n  r.receivedAtTimestamp AS ref_received, r.isViewOnce AS ref_view_once, r.threadRowId,\n  i.timestamp, i.receivedAtTimestamp, i.serverTimestamp, i.recordType, i.authorUUID, i.authorPhoneNumber, i.wasRemotelyDeleted, i.wasNotCreatedLocally, i.expireStartedAt, i.expiresInSeconds,\n  CASE WHEN t.groupModel IS NOT NULL THEN COALESCE(NULLIF(t.name, ''), 'grupp #' || t.id)     ELSE COALESCE(COALESCE(       (SELECT NULLIF(trim(COALESCE(n.givenName, '') || ' ' || COALESCE(n.familyName, '')), '') FROM NicknameRecord n JOIN model_SignalRecipient sr ON sr.id = n.recipientRowID WHERE sr.recipientUUID = t.contactUUID),       (SELECT NULLIF(sa.fullName, '') FROM model_SignalAccount sa WHERE sa.recipientUUID = t.contactUUID),       (SELECT NULLIF(trim(COALESCE(p.profileName, '') || ' ' || COALESCE(p.familyName, '')), '') FROM model_OWSUserProfile p WHERE p.recipientUUID = t.contactUUID),       (SELECT sr.recipientPhoneNumber FROM model_SignalRecipient sr WHERE sr.recipientUUID = t.contactUUID),       t.contactUUID), t.contactPhoneNumber, '#' || t.id) END AS thread_name,\n  CASE WHEN t.groupModel IS NOT NULL THEN 1 ELSE 0 END AS is_group\nFROM Attachment a\nLEFT JOIN MessageAttachmentReference r ON r.attachmentRowId = a.id\nLEFT JOIN model_TSInteraction i ON i.id = r.ownerRowId\nLEFT JOIN model_TSThread t ON t.id = r.threadRowId\nORDER BY a.id;"
        },
        {
          "id": "role-messages",
          "hidden": true,
          "role": "messages",
          "title": "Härkomst: meddelanden i tidsfönstret",
          "description": "Används av Härkomst. Meddelandena och samtalen i fönstret med råa tider, riktning, konversation, avsändare, antal bilagor och om de raderats. Texten tas inte med.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "unixMs",
          "fields": {
            "id": "id",
            "sent": "timestamp",
            "received": "receivedAtTimestamp",
            "server": "serverTimestamp",
            "type": "recordType",
            "authorId": "authorUUID",
            "authorPhone": "authorPhoneNumber",
            "viewOnce": "isViewOnceMessage",
            "deleted": "wasRemotelyDeleted",
            "threadId": "thread_id",
            "threadName": "thread_name",
            "isGroup": "is_group",
            "attachments": "n_attachments",
            "hasBody": "has_body",
            "callType": "call_type",
            "callDirection": "call_direction",
            "callStatus": "call_status",
            "linked": "wasNotCreatedLocally",
            "expireStarted": "expireStartedAt",
            "expiresIn": "expiresInSeconds",
            "viewOnceDone": "isViewOnceComplete"
          },
          "sql": "SELECT\n  i.id, i.timestamp, i.receivedAtTimestamp, i.serverTimestamp, i.recordType, i.authorUUID, i.authorPhoneNumber,\n  i.isViewOnceMessage, i.isViewOnceComplete, i.wasRemotelyDeleted, i.wasNotCreatedLocally, i.expireStartedAt, i.expiresInSeconds, t.id AS thread_id,\n  CASE WHEN t.groupModel IS NOT NULL THEN COALESCE(NULLIF(t.name, ''), 'grupp #' || t.id)     ELSE COALESCE(COALESCE(       (SELECT NULLIF(trim(COALESCE(n.givenName, '') || ' ' || COALESCE(n.familyName, '')), '') FROM NicknameRecord n JOIN model_SignalRecipient sr ON sr.id = n.recipientRowID WHERE sr.recipientUUID = t.contactUUID),       (SELECT NULLIF(sa.fullName, '') FROM model_SignalAccount sa WHERE sa.recipientUUID = t.contactUUID),       (SELECT NULLIF(trim(COALESCE(p.profileName, '') || ' ' || COALESCE(p.familyName, '')), '') FROM model_OWSUserProfile p WHERE p.recipientUUID = t.contactUUID),       (SELECT sr.recipientPhoneNumber FROM model_SignalRecipient sr WHERE sr.recipientUUID = t.contactUUID),       t.contactUUID), t.contactPhoneNumber, '#' || t.id) END AS thread_name,\n  CASE WHEN t.groupModel IS NOT NULL THEN 1 ELSE 0 END AS is_group,\n  (SELECT count(*) FROM MessageAttachmentReference r WHERE r.ownerRowId = i.id AND r.ownerType = 0) AS n_attachments,\n  CASE WHEN length(i.body) > 0 THEN 1 ELSE 0 END AS has_body,\n  (SELECT c.type FROM CallRecord c WHERE c.interactionRowId = i.id) AS call_type,\n  (SELECT c.direction FROM CallRecord c WHERE c.interactionRowId = i.id) AS call_direction,\n  (SELECT c.status FROM CallRecord c WHERE c.interactionRowId = i.id) AS call_status\nFROM model_TSInteraction i\nLEFT JOIN model_TSThread t ON t.uniqueId = i.uniqueThreadId\nWHERE i.timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\n   OR i.receivedAtTimestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY i.receivedAtTimestamp, i.id;"
        },
        {
          "id": "role-recipients",
          "hidden": true,
          "role": "recipients",
          "title": "Härkomst: kontakter",
          "description": "Används av Härkomst. Namnet för varje ACI (smeknamn, kontaktbokens namn, profilnamn eller telefonnummer).",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "id": "aci",
            "name": "name",
            "phone": "phone"
          },
          "sql": "SELECT\n  sr.recipientUUID AS aci,\n  COALESCE(     (SELECT NULLIF(trim(COALESCE(n.givenName, '') || ' ' || COALESCE(n.familyName, '')), '') FROM NicknameRecord n JOIN model_SignalRecipient sr ON sr.id = n.recipientRowID WHERE sr.recipientUUID = sr.recipientUUID),     (SELECT NULLIF(sa.fullName, '') FROM model_SignalAccount sa WHERE sa.recipientUUID = sr.recipientUUID),     (SELECT NULLIF(trim(COALESCE(p.profileName, '') || ' ' || COALESCE(p.familyName, '')), '') FROM model_OWSUserProfile p WHERE p.recipientUUID = sr.recipientUUID),     (SELECT sr.recipientPhoneNumber FROM model_SignalRecipient sr WHERE sr.recipientUUID = sr.recipientUUID),     sr.recipientUUID) AS name,\n  sr.recipientPhoneNumber AS phone\nFROM model_SignalRecipient sr\nWHERE sr.recipientUUID IS NOT NULL\nORDER BY sr.id;"
        },
        {
          "id": "role-stories",
          "hidden": true,
          "role": "stories",
          "title": "Härkomst: berättelser i tidsfönstret",
          "description": "Används av Härkomst. Berättelser i fönstret med riktning och bilagans SHA-256.",
          "params": [
            "timeStart",
            "timeEnd"
          ],
          "epoch": "unixMs",
          "fields": {
            "id": "id",
            "sent": "timestamp",
            "direction": "direction",
            "authorId": "authorUuid",
            "contentType": "mimeType",
            "sha256": "sha256_hex"
          },
          "sql": "SELECT\n  s.id, s.timestamp, s.direction, s.authorUuid,\n  a.mimeType, lower(hex(a.sha256ContentHash)) AS sha256_hex\nFROM model_StoryMessage s\nLEFT JOIN StoryMessageAttachmentReference r ON r.ownerRowId = s.id\nLEFT JOIN Attachment a ON a.id = r.attachmentRowId\nWHERE s.authorUuid <> '00000000-0000-0000-0000-000000000001'\n  AND s.timestamp BETWEEN {{unixMsStart}} AND {{unixMsEnd}}\nORDER BY s.timestamp;"
        },
        {
          "id": "role-coverage",
          "hidden": true,
          "role": "coverage",
          "title": "Härkomst: täckning",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "first": "first_received",
            "last": "last_received",
            "rows": "n_rows"
          },
          "sql": "SELECT\n  MIN(receivedAtTimestamp) AS first_received,\n  MAX(receivedAtTimestamp) AS last_received,\n  COUNT(*) AS n_rows\nFROM model_TSInteraction\nWHERE recordType IN (19, 21);"
        },
        {
          "id": "chat-threads",
          "hidden": true,
          "role": "chat-threads",
          "title": "Chattar: konversationer",
          "description": "Används av Chattar. Trådarna med namn som i queryn Konversationer, slag, antal meddelanden och första och senaste meddelandets tid på telefonen.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "id": "thread_id",
            "name": "thread_name",
            "kind": "thread_kind",
            "address": "thread_address",
            "kindRaw": "thread_type",
            "messages": "message_count",
            "first": "first_ms",
            "last": "last_ms",
            "archived": "isArchived"
          },
          "sql": "SELECT\n  t.id AS thread_id,\n  CASE WHEN t.groupModel IS NOT NULL THEN COALESCE(NULLIF(t.name, ''), 'grupp #' || t.id) ELSE COALESCE(COALESCE((SELECT NULLIF(trim(COALESCE(n.givenName, '') || ' ' || COALESCE(n.familyName, '')), '') FROM NicknameRecord n JOIN model_SignalRecipient sr ON sr.id = n.recipientRowID WHERE sr.recipientUUID = t.contactUUID), (SELECT NULLIF(sa.fullName, '') FROM model_SignalAccount sa WHERE sa.recipientUUID = t.contactUUID), (SELECT NULLIF(trim(COALESCE(p.profileName, '') || ' ' || COALESCE(p.familyName, '')), '') FROM model_OWSUserProfile p WHERE p.recipientUUID = t.contactUUID), (SELECT sr.recipientPhoneNumber FROM model_SignalRecipient sr WHERE sr.recipientUUID = t.contactUUID)), t.contactUUID, t.contactPhoneNumber, '#' || t.id) END AS thread_name,\n  CASE WHEN t.groupModel IS NOT NULL THEN 'group' WHEN t.contactUUID IS NOT NULL OR t.contactPhoneNumber IS NOT NULL THEN 'person' ELSE 'other' END AS thread_kind,\n  COALESCE(t.contactPhoneNumber, t.contactUUID) AS thread_address, t.recordType AS thread_type,\n  (SELECT count(*) FROM model_TSInteraction i WHERE i.uniqueThreadId = t.uniqueId) AS message_count,\n  (SELECT min(i.receivedAtTimestamp) FROM model_TSInteraction i WHERE i.uniqueThreadId = t.uniqueId) AS first_ms,\n  (SELECT max(i.receivedAtTimestamp) FROM model_TSInteraction i WHERE i.uniqueThreadId = t.uniqueId) AS last_ms,\n  t.isArchived\nFROM model_TSThread t\nORDER BY last_ms DESC, t.id;"
        },
        {
          "id": "chat-members",
          "hidden": true,
          "role": "chat-members",
          "title": "Chattar: deltagare",
          "description": "Används av Chattar. Gruppmedlemmarna (model_TSGroupMember) och motparten i en enskild chatt, med telefonnummer eller ACI.",
          "params": [],
          "epoch": "unixMs",
          "fields": {
            "threadId": "thread_id",
            "id": "member_id",
            "name": "member_name",
            "address": "member_address"
          },
          "sql": "SELECT t.id AS thread_id, COALESCE(gm.uuidString, gm.phoneNumber) AS member_id,\n  COALESCE(COALESCE((SELECT NULLIF(trim(COALESCE(n.givenName, '') || ' ' || COALESCE(n.familyName, '')), '') FROM NicknameRecord n JOIN model_SignalRecipient sr ON sr.id = n.recipientRowID WHERE sr.recipientUUID = gm.uuidString), (SELECT NULLIF(sa.fullName, '') FROM model_SignalAccount sa WHERE sa.recipientUUID = gm.uuidString), (SELECT NULLIF(trim(COALESCE(p.profileName, '') || ' ' || COALESCE(p.familyName, '')), '') FROM model_OWSUserProfile p WHERE p.recipientUUID = gm.uuidString), (SELECT sr.recipientPhoneNumber FROM model_SignalRecipient sr WHERE sr.recipientUUID = gm.uuidString)), gm.phoneNumber, gm.uuidString) AS member_name,\n  COALESCE(gm.phoneNumber, gm.uuidString) AS member_address\nFROM model_TSGroupMember gm JOIN model_TSThread t ON t.uniqueId = gm.groupThreadId\nUNION ALL\nSELECT t.id, COALESCE(t.contactUUID, t.contactPhoneNumber), COALESCE(COALESCE((SELECT NULLIF(trim(COALESCE(n.givenName, '') || ' ' || COALESCE(n.familyName, '')), '') FROM NicknameRecord n JOIN model_SignalRecipient sr ON sr.id = n.recipientRowID WHERE sr.recipientUUID = t.contactUUID), (SELECT NULLIF(sa.fullName, '') FROM model_SignalAccount sa WHERE sa.recipientUUID = t.contactUUID), (SELECT NULLIF(trim(COALESCE(p.profileName, '') || ' ' || COALESCE(p.familyName, '')), '') FROM model_OWSUserProfile p WHERE p.recipientUUID = t.contactUUID), (SELECT sr.recipientPhoneNumber FROM model_SignalRecipient sr WHERE sr.recipientUUID = t.contactUUID)), t.contactPhoneNumber, t.contactUUID), COALESCE(t.contactPhoneNumber, t.contactUUID)\nFROM model_TSThread t\nWHERE t.groupModel IS NULL AND (t.contactUUID IS NOT NULL OR t.contactPhoneNumber IS NOT NULL)\nORDER BY 1, 3;"
        },
        {
          "id": "chat-messages",
          "hidden": true,
          "role": "chat-messages",
          "title": "Chattar: meddelandena i en tråd",
          "description": "Används av Chattar. Interaktionerna i tråden med avsändarens, serverns och telefonens tid, typ, enhet för skickade meddelanden och redigering.",
          "params": [
            "threadId"
          ],
          "epoch": "unixMs",
          "times": [
            {
              "key": "received",
              "label": "Skapat eller mottaget på telefonen",
              "note": "receivedAtTimestamp: den här telefonens klocka när meddelandet skapades eller togs emot."
            },
            {
              "key": "sent",
              "label": "Skickat (avsändarens klocka)",
              "note": "timestamp: avsändarens klocka när meddelandet skickades."
            },
            {
              "key": "server",
              "label": "Serverns tid",
              "note": "serverTimestamp: när Signals server tog emot meddelandet. Finns för mottagna meddelanden."
            },
            {
              "key": "opened",
              "label": "Öppnat",
              "note": "expireStartedAt: när ett mottaget meddelande med försvinnande tid öppnades och nedräkningen började. Visas bara för mottagna meddelanden."
            }
          ],
          "sortTime": "received",
          "details": [
            {
              "key": "recordType",
              "label": "Posttyp (recordType: 19 mottaget, 21 skickat, 20 samtal, 10 info)"
            },
            {
              "key": "callType",
              "label": "Samtalstyp (callType, rått värde)"
            },
            {
              "key": "sourceDevice",
              "label": "Avsändarens enhet (deprecated_sourceDeviceId, rått värde)"
            },
            {
              "key": "readFlag",
              "label": "Markerat som läst (read)"
            },
            {
              "key": "uniqueId",
              "label": "Meddelandets id hos Signal (uniqueId)"
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
            "viewOnce": "isViewOnceMessage",
            "deleted": "wasRemotelyDeleted",
            "edited": "edited",
            "expiresIn": "expires_s",
            "device": "device",
            "received": "receivedAtTimestamp",
            "sent": "timestamp",
            "server": "serverTimestamp",
            "opened": "expireStartedAt",
            "recordType": "recordType",
            "callType": "callType",
            "sourceDevice": "deprecated_sourceDeviceId",
            "readFlag": "read",
            "uniqueId": "uniqueId"
          },
          "sql": "SELECT\n  i.id AS message_id, t.id AS thread_id,\n  CASE WHEN i.recordType = 21 THEN 1 ELSE 0 END AS from_me,\n  CASE WHEN i.recordType = 21 THEN NULL ELSE COALESCE(i.authorUUID, i.authorPhoneNumber) END AS sender_id,\n  CASE WHEN i.recordType = 21 THEN NULL WHEN i.authorUUID IS NOT NULL THEN COALESCE(COALESCE((SELECT NULLIF(trim(COALESCE(n.givenName, '') || ' ' || COALESCE(n.familyName, '')), '') FROM NicknameRecord n JOIN model_SignalRecipient sr ON sr.id = n.recipientRowID WHERE sr.recipientUUID = i.authorUUID), (SELECT NULLIF(sa.fullName, '') FROM model_SignalAccount sa WHERE sa.recipientUUID = i.authorUUID), (SELECT NULLIF(trim(COALESCE(p.profileName, '') || ' ' || COALESCE(p.familyName, '')), '') FROM model_OWSUserProfile p WHERE p.recipientUUID = i.authorUUID), (SELECT sr.recipientPhoneNumber FROM model_SignalRecipient sr WHERE sr.recipientUUID = i.authorUUID)), i.authorUUID) ELSE i.authorPhoneNumber END AS sender_name,\n  i.body,\n  CASE WHEN i.wasRemotelyDeleted = 1 THEN 'deleted' WHEN i.recordType IN (20, 65) THEN 'call' WHEN i.recordType IN (9, 10) THEN 'system'\n    WHEN i.isVoiceMessage = 1 THEN 'voice' WHEN i.messageSticker IS NOT NULL THEN 'sticker' WHEN i.contactShare IS NOT NULL THEN 'contact'\n    ELSE COALESCE((SELECT CASE WHEN COALESCE(a.mimeType, r.mimeType) LIKE 'image/%' THEN 'image' WHEN COALESCE(a.mimeType, r.mimeType) LIKE 'video/%' THEN 'video' WHEN COALESCE(a.mimeType, r.mimeType) LIKE 'audio/%' THEN 'audio' ELSE 'file' END\n      FROM MessageAttachmentReference r JOIN Attachment a ON a.id = r.attachmentRowId WHERE r.ownerRowId = i.id AND r.ownerType = 0 ORDER BY r.orderInMessage LIMIT 1), 'text') END AS kind,\n  CASE WHEN i.recordType = 20 THEN 'samtal' WHEN i.recordType = 65 THEN 'gruppsamtal' WHEN i.recordType = 10 THEN 'infomeddelande' WHEN i.recordType = 9 THEN 'felmeddelande'\n    WHEN i.wasRemotelyDeleted = 1 THEN 'raderat för alla' WHEN i.contactShare IS NOT NULL THEN 'kontaktkort' WHEN i.messageSticker IS NOT NULL THEN 'klistermärke' END AS kind_label,\n  i.isViewOnceMessage, i.wasRemotelyDeleted,\n  CASE WHEN EXISTS (SELECT 1 FROM EditRecord e WHERE e.latestRevisionId = i.id) THEN 'redigerat' WHEN EXISTS (SELECT 1 FROM EditRecord e WHERE e.pastRevisionId = i.id) THEN 'tidigare version' END AS edited,\n  CASE WHEN i.expiresInSeconds > 0 THEN i.expiresInSeconds END AS expires_s,\n  CASE WHEN i.recordType = 21 AND i.wasNotCreatedLocally = 1 THEN 'skickat från en länkad enhet' WHEN i.recordType = 21 THEN 'skickat från telefonen' END AS device,\n  i.receivedAtTimestamp, i.timestamp, i.serverTimestamp,\n  CASE WHEN i.recordType = 19 AND i.expiresInSeconds > 0 THEN i.expireStartedAt END AS expireStartedAt,\n  i.recordType, i.callType, i.deprecated_sourceDeviceId, i.read, i.uniqueId\nFROM model_TSInteraction i\nJOIN model_TSThread t ON t.uniqueId = i.uniqueThreadId\nWHERE t.id = '{{threadId}}'\nORDER BY i.receivedAtTimestamp, i.id;"
        },
        {
          "id": "chat-attachments",
          "hidden": true,
          "role": "chat-attachments",
          "title": "Chattar: bilagorna i en tråd",
          "description": "Används av Chattar. Bilagorna med filen under attachment_files/, som är krypterad med bilagans egen nyckel (encryptionKey: AES-256-CBC och HMAC-SHA256, kontrollerat mot labbtelefonens elva filer), storlek, SHA-256 och bildtext.",
          "params": [
            "threadId"
          ],
          "epoch": "unixMs",
          "fileRoot": "..",
          "decrypt": "signal-ios",
          "fields": {
            "messageId": "message_id",
            "id": "attachment_id",
            "path": "file_path",
            "mime": "mime",
            "size": "unencryptedByteCount",
            "name": "sourceFilename",
            "title": "caption",
            "sha256": "sha256",
            "width": "cachedMediaWidthPixels",
            "height": "cachedMediaHeightPixels",
            "duration": "duration_s",
            "key": "file_key",
            "uploaded": "transitUploadTimestamp"
          },
          "sql": "SELECT\n  r.ownerRowId AS message_id, a.id AS attachment_id,\n  CASE WHEN a.localRelativeFilePath IS NOT NULL THEN 'attachment_files/' || a.localRelativeFilePath END AS file_path,\n  COALESCE(a.mimeType, r.mimeType) AS mime, a.unencryptedByteCount, r.sourceFilename, r.caption,\n  lower(hex(a.sha256ContentHash)) AS sha256, a.cachedMediaWidthPixels, a.cachedMediaHeightPixels,\n  COALESCE(a.cachedVideoDurationSeconds, a.cachedAudioDurationSeconds) AS duration_s,\n  lower(hex(a.encryptionKey)) AS file_key, a.transitUploadTimestamp\nFROM MessageAttachmentReference r\nJOIN Attachment a ON a.id = r.attachmentRowId\nWHERE r.threadRowId = '{{threadId}}' AND r.ownerType = 0\nORDER BY r.ownerRowId, r.orderInMessage;"
        }
      ],
      "chatApp": "Signal"
    }
  ]
};
