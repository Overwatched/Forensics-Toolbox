# Demo-backup

`sample-backup/` är en **syntetisk, helt påhittad** krypterad iOS-backup för att testa
iOS Keychain-verktyget utan en riktig enhetsbackup. All data är uppfunnen.

Mappen är bara till för manuell test i repo-checkouten och **följer inte med i releaserna**
(exkluderas i `package.json` → `build.files`).

Så här använder du den:

1. Öppna verktyget **iOS Keychain**.
2. **Välj mapp** → markera mappen `sample-backup`.
3. Ange backup-lösenordet från `password.txt` (`demo-pass-123`).
4. Klicka på **Öppna nyckelring**.

Du bör se 3 generiska lösenord och 2 internetlösenord (en demo-e-postinloggning,
ett wifi-lösenord, en app-token, en GitHub-token och en IMAP-inloggning).

## Hur den gjordes

Fixturen genereras med samma krypto som en iPhone använder, så den tränar hela kedjan:
ett PBKDF2/AES-nyckelknippe, en AES-CBC-krypterad `Manifest.db` (SQLite), en
`NSKeyedArchiver`-filpost och de AES-nyckelinslagna, GCM-krypterade keychain-posterna.
Nyckelringsfilen ligger under `xx/<fileID>`-undermappen som nyare backuper använder.
Inget här kommer från ett riktigt konto.
