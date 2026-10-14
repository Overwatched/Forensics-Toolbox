// Testdata för EXIF & karta och Positioner. Bilderna är små JPEG-motiv. EXIF är påhittad
// och skrivs här, så att inget hämtas och inga riktiga filer behövs.
(function (root) {
    'use strict';

    var FILES = [
        { name: 'IMG_4101.JPG', time: '2024:06:01 14:00:12', place: 'Centralstationen', lat: 59.33030, lon: 18.05860, accuracy: 8, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4102.JPG', time: '2024:06:01 14:04:40', place: 'Sergels torg', lat: 59.33260, lon: 18.06490, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4103.JPG', time: '2024:06:01 14:09:05', place: 'Kungsträdgården', lat: 59.33130, lon: 18.07160, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4104.JPG', time: '2024:06:01 14:14:30', place: 'Riksdagshuset', lat: 59.32750, lon: 18.06810, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4105.JPG', time: '2024:06:01 14:19:02', place: 'Kungliga slottet', lat: 59.32680, lon: 18.07170, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4106.JPG', time: '2024:06:01 14:25:48', place: 'Stortorget', lat: 59.32510, lon: 18.07070, accuracy: 25, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4107.JPG', time: '2024:06:01 14:31:15', place: 'Västerlånggatan', lat: 59.32380, lon: 18.07000, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4108.JPG', time: '2024:06:01 14:37:20', place: 'Riddarholmskyrkan', lat: 59.32470, lon: 18.06470, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4109.JPG', time: '2024:06:01 14:46:55', place: 'Slussen', lat: 59.31950, lon: 18.07220, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4110.JPG', time: '2024:06:01 15:02:30', place: 'Fotografiska', lat: 59.31770, lon: 18.08560, accuracy: 60, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: '20240601_151012.jpg', time: '2024:06:01 15:10:12', place: 'Fridhemsplan', lat: 59.33240, lon: 18.02950, make: 'samsung', model: 'SM-S918B', offset: '' },
        { name: '20240601_152230.jpg', time: '2024:06:01 15:22:30', place: 'Kronobergsparken', lat: 59.33110, lon: 18.03820, make: 'samsung', model: 'SM-S918B', offset: '' },
        { name: '20240601_153548.jpg', time: '2024:06:01 15:35:48', place: 'Stadshuset', lat: 59.32740, lon: 18.05500, accuracy: 150, make: 'samsung', model: 'SM-S918B', offset: '' },
        { name: '20240601_154820.jpg', time: '2024:06:01 15:48:20', place: 'Rålambshovsparken', lat: 59.32890, lon: 18.02580, make: 'samsung', model: 'SM-S918B', offset: '' },
        { name: '20240601_160510.jpg', time: '2024:06:01 16:05:10', place: 'Kristineberg', lat: 59.33360, lon: 18.00420, make: 'samsung', model: 'SM-S918B', offset: '' },
        { name: 'IMG_4121.JPG', time: '2024:06:01 18:05:10', place: 'Vasamuseet', lat: 59.32800, lon: 18.09140, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4122.JPG', time: '2024:06:01 18:41:33', place: 'Skansen', lat: 59.32630, lon: 18.10360, accuracy: 400, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4123.JPG', time: '2024:06:01 19:20:04', place: 'Gröna Lund', lat: 59.32330, lon: 18.09630, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4131.JPG', time: '2024:06:02 09:32:47', place: 'Monteliusvägen', lat: 59.32160, lon: 18.05970, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
        { name: 'IMG_4132.JPG', time: '2024:06:02 10:05:19', place: 'Hornstull', lat: 59.31570, lon: 18.03390, accuracy: 900, make: 'Apple', model: 'iPhone 15 Pro', offset: '+02:00' },
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

    function positionPoints() {
        return FILES.filter(function (file) { return file.lat && file.lon; }).map(function (file) {
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
                file: jpegFile(file),
                layer: 'Testdata · Stockholm',
            };
        });
    }

    var api = { files: FILES, exifFiles: exifFiles, positionPoints: positionPoints, withExif: withExif };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.SampleData = api;
})(typeof window !== 'undefined' ? window : globalThis);
