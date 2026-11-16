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
