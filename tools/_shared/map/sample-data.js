// Testdata för EXIF & karta och Positioner. Bilderna är små JPEG-motiv. EXIF är påhittad
// och skrivs här, så att inget hämtas och inga riktiga filer behövs.
(function (root) {
    'use strict';

    // 1 juni 2024. Anna (iPhone) går till Sergels torg. Erik (Samsung) kommer från
    // Kungsholmen. De möts och tar taxi till Fotografiska. Sedan går Anna på Djurgården.
    // Två bilder dagen efter ligger med flit utanför rutterna. bubble = färdig bubbla.
    var FILES = [
        { name: 'IMG_4101.JPG', time: '2024:06:01 14:00:12', place: 'Centralstationen', lat: 59.33030, lon: 18.05860, accuracy: 8, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00', note: 'Anna lämnar Centralstationen', bubble: true, shift: { x: -120, y: -30 } },
        { name: 'IMG_4102.JPG', time: '2024:06:01 14:12:40', place: 'Klarabergsgatan', lat: 59.33140, lon: 18.06120, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4103.JPG', time: '2024:06:01 14:24:05', place: 'Hötorget', lat: 59.33490, lon: 18.06270, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4104.JPG', time: '2024:06:01 14:36:30', place: 'Sergels torg', lat: 59.33260, lon: 18.06490, accuracy: 12, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4105.JPG', time: '2024:06:01 15:05:02', place: 'Sergels torg', lat: 59.33255, lon: 18.06505, accuracy: 15, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00', note: 'Anna väntar vid Sergels torg', bubble: true, ring: true, shift: { x: -30, y: -80 } },
        { name: '20240601_151012.jpg', time: '2024:06:01 15:10:12', place: 'Fridhemsplan', lat: 59.33240, lon: 18.02950, accuracy: 25, make: 'samsung', model: 'SM-S918B', offset: '', note: 'Erik lämnar Fridhemsplan', bubble: true },
        { name: '20240601_152230.jpg', time: '2024:06:01 15:22:30', place: 'Kronobergsparken', lat: 59.33110, lon: 18.03820, make: 'samsung', model: 'SM-S918B', offset: '' },
        { name: '20240601_153548.jpg', time: '2024:06:01 15:35:48', place: 'Stadshuset', lat: 59.32740, lon: 18.05500, accuracy: 120, make: 'samsung', model: 'SM-S918B', offset: '', note: 'Svag GPS vid Stadshuset', bubble: true, ring: true },
        { name: '20240601_154820.jpg', time: '2024:06:01 15:48:20', place: 'T-Centralen', lat: 59.33080, lon: 18.05800, make: 'samsung', model: 'SM-S918B', offset: '' },
        { name: '20240601_160510.jpg', time: '2024:06:01 16:05:10', place: 'Sergels torg', lat: 59.33262, lon: 18.06485, accuracy: 20, make: 'samsung', model: 'SM-S918B', offset: '', note: 'Möte med Anna', bubble: true, ring: true, shift: { x: 110, y: -70 } },
        { name: 'IMG_4106.JPG', time: '2024:06:01 16:12:18', place: 'Hamngatan', lat: 59.32950, lon: 18.07100, accuracy: 20, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00', note: 'Taxi, båda åker mot Södermalm', bubble: true, shift: { x: 80, y: 16 } },
        { name: 'IMG_4107.JPG', time: '2024:06:01 16:18:40', place: 'Slottsbacken', lat: 59.32680, lon: 18.07170, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4108.JPG', time: '2024:06:01 16:26:05', place: 'Slussen', lat: 59.31950, lon: 18.07220, accuracy: 40, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4109.JPG', time: '2024:06:01 16:34:22', place: 'Katarinavägen', lat: 59.31820, lon: 18.07850, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4110.JPG', time: '2024:06:01 16:42:30', place: 'Fotografiska', lat: 59.31770, lon: 18.08560, accuracy: 12, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00', note: 'Framme vid Fotografiska', bubble: true },
        { name: 'IMG_4121.JPG', time: '2024:06:01 17:30:10', place: 'Vasamuseet', lat: 59.32800, lon: 18.09140, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4122.JPG', time: '2024:06:01 18:05:33', place: 'Skansen', lat: 59.32630, lon: 18.10360, accuracy: 180, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00', note: 'Osäker position på Skansen', bubble: true, ring: true },
        { name: 'IMG_4123.JPG', time: '2024:06:01 18:40:04', place: 'Gröna Lund', lat: 59.32330, lon: 18.09630, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4131.JPG', time: '2024:06:02 09:32:47', place: 'Monteliusvägen', lat: 59.32160, lon: 18.05970, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00', note: 'Dagen efter, inte med i rutten', bubble: true },
        { name: 'IMG_4132.JPG', time: '2024:06:02 10:05:19', place: 'Hornstull', lat: 59.31570, lon: 18.03390, accuracy: 80, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4140.JPG', time: '2024:06:01 16:10:00', place: 'Ingen GPS', lat: null, lon: null, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4141.JPG', time: '2024:06:01 16:20:00', place: 'Position 0, 0', lat: 0, lon: 0, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
    ];

    function u16(n) { return [n & 255, (n >> 8) & 255]; }
    function u32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]; }

    function ascii(s) {
        var out = [];
        for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255);
        out.push(0);
        return out;
    }

    function dms(value) {
        var v = Math.abs(value);
        var d = Math.floor(v);
        var minutes = (v - d) * 60;
        var m = Math.floor(minutes);
        var s = Math.round((minutes - m) * 60 * 1000);
        if (s >= 60000) { s -= 60000; m += 1; }
        if (m >= 60) { m -= 60; d += 1; }
        return [[d, 1], [m, 1], [s, 1000]];
    }

    function concat(parts) {
        var n = 0;
        parts.forEach(function (p) { n += p.length; });
        var out = new Uint8Array(n);
        var o = 0;
        parts.forEach(function (p) { out.set(p, o); o += p.length; });
        return out;
    }

    // Minimal EXIF (little endian): Make, Model, DateTime, DateTimeOriginal, offset och GPS.
    function exifApp1(file) {
        var strings = [];
        function putStr(s) {
            var bytes = ascii(s);
            var at = strings.reduce(function (n, b) { return n + b.length; }, 0);
            strings.push(bytes);
            return { at: at, len: bytes.length };
        }
        var make = putStr(file.make);
        var model = putStr(file.model);
        var when = putStr(file.time);
        var offset = file.offset ? putStr(file.offset) : null;
        var gps = file.lat !== null && file.lon !== null;
        var latRef = gps ? putStr(file.lat < 0 ? 'S' : 'N') : null;
        var lonRef = gps ? putStr(file.lon < 0 ? 'W' : 'E') : null;
        var rationals = gps ? dms(file.lat).concat(dms(file.lon)) : [];
        var hasAcc = gps && file.accuracy > 0;
        if (hasAcc) rationals.push([Math.round(file.accuracy * 100), 100]);

        var ifd0Count = 4 + (gps ? 1 : 0);
        var exifCount = 1 + (offset ? 1 : 0);
        var gpsCount = gps ? (hasAcc ? 5 : 4) : 0;
        var header = 8;
        var ifd0Size = 2 + ifd0Count * 12 + 4;
        var exifSize = 2 + exifCount * 12 + 4;
        var gpsSize = gps ? 2 + gpsCount * 12 + 4 : 0;
        var dataStart = header + ifd0Size + exifSize + gpsSize;
        var rationalStart = dataStart + strings.reduce(function (n, b) { return n + b.length; }, 0);

        function entry(tag, type, count, value) {
            return u16(tag).concat(u16(type), u32(count), u32(value));
        }
        function strEntry(tag, info) {
            var value = info.len <= 4 ? inlineBytes(strings, info) : dataStart + info.at;
            return entry(tag, 2, info.len, value);
        }
        function inlineBytes(all, info) {
            var raw = [];
            all.forEach(function (b) { raw = raw.concat(b); });
            var slice = raw.slice(info.at, info.at + 4);
            while (slice.length < 4) slice.push(0);
            return slice[0] | (slice[1] << 8) | (slice[2] << 16) | (slice[3] << 24);
        }

        var exifPtr = header + ifd0Size;
        var gpsPtr = exifPtr + exifSize;
        var ifd0 = u16(ifd0Count).concat(
            strEntry(0x010F, make),
            strEntry(0x0110, model),
            strEntry(0x0132, when),
            entry(0x8769, 4, 1, exifPtr)
        );
        if (gps) ifd0 = ifd0.concat(entry(0x8825, 4, 1, gpsPtr));
        ifd0 = ifd0.concat(u32(0));

        var exif = u16(exifCount).concat(strEntry(0x9003, when));
        if (offset) exif = exif.concat(strEntry(0x9011, offset));
        exif = exif.concat(u32(0));

        var gpsIfd = [];
        if (gps) {
            gpsIfd = u16(gpsCount).concat(
                strEntry(0x0001, latRef),
                entry(0x0002, 5, 3, rationalStart),
                strEntry(0x0003, lonRef),
                entry(0x0004, 5, 3, rationalStart + 24)
            );
            if (hasAcc) gpsIfd = gpsIfd.concat(entry(0x001F, 5, 1, rationalStart + 48));
            gpsIfd = gpsIfd.concat(u32(0));
        }

        var rationalBytes = [];
        rationals.forEach(function (r) { rationalBytes = rationalBytes.concat(u32(r[0]), u32(r[1])); });
        var stringBytes = [];
        strings.forEach(function (b) { stringBytes = stringBytes.concat(b); });

        var tiff = [0x49, 0x49, 0x2A, 0x00].concat(u32(8), ifd0, exif, gpsIfd, stringBytes, rationalBytes);
        var payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00].concat(tiff);
        var length = payload.length + 2;
        return concat([new Uint8Array([0xFF, 0xE1, (length >> 8) & 255, length & 255]), new Uint8Array(payload)]);
    }

    function decodeJpeg(b64) {
        var bin = atob(b64);
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function withExif(jpeg, file) {
        var app1 = exifApp1(file);
        var out = new Uint8Array(2 + app1.length + jpeg.length - 2);
        out.set(jpeg.subarray(0, 2), 0);
        out.set(app1, 2);
        out.set(jpeg.subarray(2), 2 + app1.length);
        return out;
    }

    function exifFiles(jpegs) {
        jpegs = jpegs || root.SampleJpegs;
        return FILES.map(function (file) {
            return { name: 'Testdata/' + file.name, bytes: withExif(decodeJpeg(jpegs[file.name]), file) };
        });
    }

    function taken(file) {
        var sort = file.time.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3 ');
        return {
            sort: sort, zone: file.offset || '', text: sort + (file.offset ? ' ' + file.offset : ''),
            kind: 'Tagen', source: 'testdata',
        };
    }

    function jpegFile(meta) {
        var jpegs = root.SampleJpegs;
        if (!jpegs || !jpegs[meta.name] || typeof File === 'undefined') return null;
        var bin = atob(jpegs[meta.name]);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new File([bytes], meta.name, { type: 'image/jpeg' });
    }

    function positionPoint(file) {
        return {
            name: file.name,
            path: 'Testdata/' + file.name,
            lat: file.lat,
            lon: file.lon,
            accuracy: file.accuracy || null,
            source: 'testdata',
            taken: taken(file),
            device: file.make + ' ' + file.model,
            mime: 'image/jpeg',
            note: file.note || '',
            file: jpegFile(file),
        };
    }

    function positionPoints() {
        return FILES.filter(function (file) { return file.lat && file.lon; }).map(positionPoint);
    }

    // Två källor och färdiga rutter i tidsordning, så att Positioner kan visa exemplet direkt.
    function positionScenario() {
        var iphone = [];
        var samsung = [];
        FILES.forEach(function (file) {
            if (!(file.lat && file.lon)) return;
            (file.make === 'Apple' ? iphone : samsung).push(positionPoint(file));
        });
        return {
            summary: 'Anna med iPhone och Erik med Samsung möts vid Sergels torg och tar taxi till Fotografiska.',
            layers: [
                { name: 'iPhone 15 Pro', color: '#0a84ff', points: iphone },
                { name: 'Samsung S23', color: '#30d158', points: samsung },
            ],
            routes: [
                { name: 'Till mötet, Anna', files: ['IMG_4101.JPG', 'IMG_4102.JPG', 'IMG_4103.JPG', 'IMG_4104.JPG', 'IMG_4105.JPG'] },
                { name: 'Till mötet, Erik', files: ['20240601_151012.jpg', '20240601_152230.jpg', '20240601_153548.jpg', '20240601_154820.jpg', '20240601_160510.jpg'] },
                { name: 'Taxi till Fotografiska', files: ['IMG_4106.JPG', 'IMG_4107.JPG', 'IMG_4108.JPG', 'IMG_4109.JPG', 'IMG_4110.JPG'] },
                { name: 'Djurgården', files: ['IMG_4121.JPG', 'IMG_4122.JPG', 'IMG_4123.JPG'] },
            ],
            bubbles: FILES.filter(function (file) { return file.bubble; }).map(function (file) {
                return { file: file.name, ring: !!file.ring, shift: file.shift || null };
            }),
        };
    }

    var api = { files: FILES, exifFiles: exifFiles, positionPoints: positionPoints, positionScenario: positionScenario, withExif: withExif };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.SampleData = api;
})(typeof window !== 'undefined' ? window : globalThis);
