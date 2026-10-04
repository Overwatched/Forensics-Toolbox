// Orchestration: turn a local iOS backup folder into decrypted keychain records.
// Mirrors the `dumpkeys` path of dunhamsteve/ios irestore, entirely in-browser.
// Användarvända meddelanden är på svenska; de visas i förloppsloggen och i felbanner.
(function (root) {
  'use strict';

  function le32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  // Parse Manifest.plist -> keybag bytes, encryption flag, wrapped manifest key.
  function parseManifest(bytes) {
    var p = root.KC.bplist.parse(bytes);
    var lock = p.Lockdown || {};
    return {
      backupKeyBag: p.BackupKeyBag || null,
      isEncrypted: !!p.IsEncrypted,
      manifestKey: p.ManifestKey || null,
      deviceName: lock.DeviceName || p.DeviceName || '',
      productVersion: lock.ProductVersion || '',
      raw: p
    };
  }

  // group: array of { v_Data, v_PersistentRef }. Returns decoded records.
  function dumpKeyGroup(kb, group) {
    var KC = root.KC;
    var out = [];
    for (var i = 0; i < group.length; i++) {
      var entry = group[i];
      var data = entry['v_Data'];
      if (!data || data.length < 12) continue;
      var rec = { __ref: entry['v_PersistentRef'] || null };
      var version = le32(data, 0);
      var cls = le32(data, 4);
      if (version !== 3) {
        rec.__error = 'Ohanterad version på keychain-blob: ' + version;
        out.push(rec);
        continue;
      }
      var l = le32(data, 8);
      var wkey = data.subarray(12, 12 + l);
      var edata = data.subarray(12 + l);
      var ckey = KC.keybag.getClassKey(kb, cls);
      if (!ckey) { rec.__error = 'Ingen nyckel för skyddsklass ' + cls; out.push(rec); continue; }
      var itemKey = KC.aes.keyUnwrap(ckey, wkey);
      if (!itemKey) { rec.__error = 'Nyckelupplåsning misslyckades (klass ' + cls + ')'; out.push(rec); continue; }
      var plain;
      try { plain = KC.aes.gcmBlankIvOpen(itemKey, edata); }
      catch (e) { rec.__error = 'Dekryptering misslyckades: ' + e.message; out.push(rec); continue; }
      var fields;
      try { fields = KC.asn1.parseRecord(plain); }
      catch (e) { rec.__error = 'ASN.1-tolkning misslyckades: ' + e.message; out.push(rec); continue; }
      for (var k in fields) if (fields.hasOwnProperty(k)) rec[k] = fields[k];
      rec.__class = cls;
      out.push(rec);
    }
    return out;
  }

  // opts: { getBytes(relpath)->Promise<Uint8Array|null>, password, SQL, onProgress }
  async function loadKeychain(opts) {
    var KC = root.KC;
    var log = opts.onProgress || function () {};

    log('Läser Manifest.plist…');
    var manifestBytes = await opts.getBytes('Manifest.plist');
    if (!manifestBytes) throw new Error('Hittade ingen Manifest.plist i den valda mappen. Välj själva backup-mappen (den som innehåller Manifest.plist och Manifest.db).');
    var manifest = parseManifest(manifestBytes);
    if (!manifest.backupKeyBag) throw new Error('Ingen BackupKeyBag i Manifest.plist — ser inte ut som en iOS-backup.');

    log('Tolkar nyckelknippe…');
    var kb = KC.keybag.read(manifest.backupKeyBag);

    if (manifest.isEncrypted) {
      if (!opts.password) { var e = new Error('Den här backupen är krypterad. Ange backup-lösenordet.'); e.needsPassword = true; throw e; }
      log('Härleder nycklar från lösenordet…');
      await KC.keybag.setPassword(kb, opts.password); // kastar 'Fel lösenord'
    } else {
      throw new Error('Den här backupen är inte krypterad. iOS inkluderar bara nyckelringen i krypterade backuper, så det finns inget att visa. Skapa om backupen med ”Kryptera lokal backup” aktiverat.');
    }

    log('Läser Manifest.db…');
    var dbBytes = await opts.getBytes('Manifest.db');
    if (!dbBytes) throw new Error('Hittade ingen Manifest.db i den valda mappen.');

    if (manifest.manifestKey) {
      log('Dekrypterar Manifest.db…');
      var mk = manifest.manifestKey;
      var cls = le32(mk, 0);
      var ckey = KC.keybag.getClassKey(kb, cls);
      if (!ckey) throw new Error('Ingen manifest-nyckel för klass ' + cls + ' (fel lösenord?).');
      var mkey = KC.aes.keyUnwrap(ckey, mk.subarray(4));
      if (!mkey) throw new Error('Kunde inte låsa upp manifest-nyckeln (fel lösenord?).');
      dbBytes = KC.aes.cbcDecrypt(mkey, dbBytes); // rå CBC, ingen borttagning av padding
    }

    log('Öppnar manifest-databasen…');
    var db = new opts.SQL.Database(dbBytes);
    var rows;
    try {
      rows = db.exec("SELECT fileID, file FROM Files WHERE domain='KeychainDomain' AND relativePath='keychain-backup.plist'");
    } catch (err) {
      db.close();
      throw new Error('Kunde inte läsa manifest-databasen (fel lösenord?): ' + err.message);
    }
    if (!rows.length || !rows[0].values.length) {
      // reserv: valfri keychain-backup.plist
      try { rows = db.exec("SELECT fileID, file FROM Files WHERE relativePath LIKE '%keychain-backup.plist'"); } catch (e2) {}
    }
    if (!rows.length || !rows[0].values.length) {
      db.close();
      throw new Error('Hittade ingen post för keychain-backup.plist i den här backupen.');
    }
    var fileID = rows[0].values[0][0];
    var blob = rows[0].values[0][1]; // Uint8Array
    db.close();

    log('Löser upp nyckelringens filnyckel…');
    var fileRec = KC.nskeyed.unarchive(KC.bplist.parse(blob instanceof Uint8Array ? blob : new Uint8Array(blob)));
    var encKey = fileRec.EncryptionKey;
    var protClass = fileRec.ProtectionClass;
    if (!(encKey instanceof Uint8Array)) throw new Error('Nyckelringens filpost saknar EncryptionKey.');
    var classKey = KC.keybag.getClassKey(kb, protClass);
    if (!classKey) throw new Error('Ingen nyckel för nyckelringsfilens skyddsklass ' + protClass + '.');
    var fileKey = KC.aes.keyUnwrap(classKey, encKey.subarray(4));
    if (!fileKey) throw new Error('Kunde inte låsa upp nyckelringens filnyckel.');

    log('Läser keychain-backup.plist…');
    var kcBytes = await readById(opts.getBytes, fileID);
    if (!kcBytes) throw new Error('Nyckelringsfilen (' + fileID + ') finns inte på disk i den valda mappen.');
    var kcPlain = KC.aes.unpadPkcs7(KC.aes.cbcDecrypt(fileKey, kcBytes));
    if (!kcPlain) throw new Error('Dekrypteringen av nyckelringsfilen misslyckades (felaktig padding).');

    log('Avkodar nyckelringsposter…');
    var kc = KC.bplist.parse(kcPlain);
    var result = {
      deviceName: manifest.deviceName,
      productVersion: manifest.productVersion,
      General: dumpKeyGroup(kb, kc.genp || []),
      Internet: dumpKeyGroup(kb, kc.inet || []),
      Certs: dumpKeyGroup(kb, kc.cert || []),
      Keys: dumpKeyGroup(kb, kc.keys || [])
    };
    return result;
  }

  async function readById(getBytes, id) {
    var b = await getBytes(id);
    if (b) return b;
    if (id && id.length >= 2) return await getBytes(id.slice(0, 2) + '/' + id);
    return null;
  }

  root.KC = root.KC || {};
  root.KC.backup = { parseManifest: parseManifest, loadKeychain: loadKeychain, dumpKeyGroup: dumpKeyGroup };
})(typeof globalThis !== 'undefined' ? globalThis : this);
