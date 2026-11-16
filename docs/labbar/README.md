# Labbar som väntar

Flöden till verktyget Laboration. Öppna verktyget, välj **Genomför ny laboration**, och sedan **Öppna flöde, logg eller mallar…** under Fil. Flödet går att ändra innan labben börjar. Spara loggen när labben är klar och lägg den bredvid extraktionerna.

## Snapchat Memories (förberedd 2026-11-16)

Två telefoner, en iPhone och en Samsung, som är vänner i Snapchat. Labben ger data till det programmet ännu inte har prövat för Memories. Den sparade snap som programmet är byggt mot är en enda bild per telefon (labben 2026-11-11, steg L38 och L40).

**Del 1** (`snapchat-memories-del1.json`, 29 steg, koder M01–M29). Gör den på båda telefonerna och extrahera dem efteråt.

| Steg | Vad det prövar |
|---|---|
| Bild med bakre kameran, sparad | Grundfallet, som i labben 2026-11-11 |
| Bild med frontkameran, sparad | Att kameran läses rätt (ZCAMERAFRONTFACING, front_facing) |
| Video, sparad | Vilken typkod en video har på iOS, och om tagningstiden är start eller slut |
| Bild med text, sparad och skickad ur Memories | Överlägg (text), och kopplingen till chatten när bilden skickas ur Memories |
| Video skickad ur Memories | Video i en chatt |
| Två bilder i Min story, storyn sparad | En Memories-post med flera snaps |
| Bild sparad och exporterad genast, och den första bilden exporterad senare | Kopplingen till filen i telefonens bilder, direkt och efter några minuter, på iPhone också |
| Video exporterad | Kopplingen för en video i galleriet |
| Bild i My Eyes Only | Var My Eyes Only lagras och om den går att läsa |

**Del 2** (`snapchat-memories-del2.json`, 13 steg, koder N01–N13). Gör den efter att del 1 är extraherad. Snapchat avinstalleras och installeras igen på båda telefonerna. Då finns de sparade snapsen bara på Snapchats server, utom den som öppnas i steg N06 och N10. Extrahera telefonerna igen efteråt. Jämför med del 1: vad finns kvar i `scdb-27`, `gallery.encrypteddb`, `memories.db` och cachen när filen inte har hämtats.

Skriv lösenkoden till My Eyes Only i labbens anteckningar, inte här.

### En telefon (OnePlus)

`snapchat-memories-oneplus-del1.json` (14 steg, P01–P14) och `snapchat-memories-oneplus-del2.json` (7 steg, Q01–Q07) är samma labb för en enda telefon. Bilden och videon som skickas ur Memories går till en vän i Snapchat, ett annat konto. Skriv vännens användarnamn i anteckningarna. Det som bara går med två telefoner (att den andra öppnar snappen) är borttaget.

### Extraktion med root (inte provad)

Toolbox läser en zip. Ta bara med det labben behöver: en egen telefon har mycket annat i `/data`, och det ska inte med. Gör extraktionen efter steget med flygplansläge, med Snapchat stängt.

1. Kontrollera roten och vilket paket bildbiblioteket (MediaStore) har:
   `adb shell su -c id` och `adb shell su -c 'ls /data/data' | grep providers.media`
2. Hämta delarna som ett tar-arkiv, med filernas tider. Byt paketnamnet mot det som steg 1 visade:
   ```
   adb exec-out "su -c 'tar -cf - -C / data/data/com.snapchat.android data/data/com.google.android.providers.media.module/databases data/system/usagestats data/system/appops/discrete data/media/0/DCIM/Snapchat data/media/0/DCIM/Camera'" > oneplus-del1.tar
   ```
   `DCIM/Camera` behövs för klockbilderna. Den har också telefonens andra bilder; ta bort de andra ur arkivet om de inte ska med.
3. Gör om arkivet till en zip utan att packa upp det. `tar` på macOS och Windows 10 och senare är bsdtar, som skriver filernas ändringstid i zippens UT-fält:
   ```
   tar -cf oneplus-del1.zip --format zip @oneplus-del1.tar
   ```
   Kontrollerat 2026-11-16 med bsdtar 3.5.3 på macOS: tiderna kom med på sekunden.
4. Räkna SHA-256 på tar-arkivet och zippen och skriv dem i anteckningarna. Spara loggen från Laboration bredvid zippen.

Extraktionerna och loggen hör inte hemma i repot.
