#!/usr/bin/env python3
"""Fristående facit för tiderna i en iOS-extraktion, till labbtesterna (tests/app/lab-ios.js).

Använder varken programmets kod eller ExifTool. Läser zippens rådata (lokala poster), EXIF ur HEIC, JPEG och
PNG, QuickTime ur MOV och MP4, och Photos.sqlite med -wal. Rör aldrig zippen, och skriver bara till utmappen.

    time-facit.py <zip> <utmapp>      skriver <utmapp>/facit.json
"""
import json
import os
import re
import shutil
import sqlite3
import struct
import sys
import zipfile
from datetime import datetime, timezone

QT_EPOCH = 2082844800  # 1904-01-01 till 1970-01-01
COCOA = 978307200      # 1970-01-01 till 2001-01-01
TYPE_SIZE = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 12: 8}
EXIF_TAGS = {0x9003: 'DateTimeOriginal', 0x9011: 'OffsetTimeOriginal', 0x9291: 'SubSecTimeOriginal'}


def fields(raw):
    i = 0
    while i + 4 <= len(raw):
        tag, n = struct.unpack('<HH', raw[i:i + 4])
        yield tag, raw[i + 4:i + 4 + n]
        i += 4 + n


def zip_times(z, info):
    """UT-fältet i den lokala posten efter flaggorna: ändring, åtkomst, ctime, skapad (Unix-sekunder)."""
    z.fp.seek(info.header_offset)
    head = z.fp.read(30)
    names, extra = struct.unpack('<HH', head[26:30])
    z.fp.seek(info.header_offset + 30 + names)
    ut = dict(fields(z.fp.read(extra))).get(0x5455)
    if not ut or ut[0] != 0xf:
        return None
    m, a, ctime, crtime = struct.unpack('<4i', ut[1:17])
    return {'m': m * 1000, 'a': a * 1000, 'ctime': ctime * 1000, 'crtime': crtime * 1000}


def tiff(b):
    """Taggarna för tiden ur en TIFF-del: IFD0 pekar på ExifIFD."""
    if b[:2] not in (b'MM', b'II'):
        return {}
    e = '>' if b[:2] == b'MM' else '<'
    first = struct.unpack(e + 'I', b[4:8])[0]

    def entries(off):
        n = struct.unpack(e + 'H', b[off:off + 2])[0]
        for i in range(n):
            p = off + 2 + i * 12
            if p + 12 <= len(b):
                tag, typ, cnt = struct.unpack(e + 'HHI', b[p:p + 8])
                yield p, tag, typ, cnt

    out = {}
    for p, tag, typ, cnt in entries(first):
        if tag != 0x8769:
            continue
        for q, t2, ty2, c2 in entries(struct.unpack(e + 'I', b[p + 8:p + 12])[0]):
            if t2 in EXIF_TAGS and ty2 == 2:
                size = TYPE_SIZE[ty2] * c2
                val = b[q + 8:q + 8 + size] if size <= 4 else b[struct.unpack(e + 'I', b[q + 8:q + 12])[0]:][:size]
                out[EXIF_TAGS[t2]] = val.split(b'\0')[0].decode('latin-1').strip()
    return out


def exif_of(b):
    if b[:3] == b'\xff\xd8\xff':
        i = 2
        while i + 4 <= len(b) and b[i] == 0xFF:
            n = struct.unpack('>H', b[i + 2:i + 4])[0]
            if b[i + 1] == 0xE1 and b[i + 4:i + 10] == b'Exif\0\0':
                return tiff(b[i + 10:i + 2 + n])
            if b[i + 1] == 0xDA:
                break
            i += 2 + n
        return {}
    if b[:8] == b'\x89PNG\r\n\x1a\n':
        i = 8
        while i + 8 <= len(b):
            n = struct.unpack('>I', b[i:i + 4])[0]
            if b[i + 4:i + 8] == b'eXIf':
                return tiff(b[i + 8:i + 8 + n])
            i += 12 + n
        return {}
    m = re.search(rb'Exif\x00\x00(MM\x00\*|II\*\x00)', b)
    return tiff(b[m.start() + 6:]) if m else {}


def atoms(b, start, end):
    i = start
    while i + 8 <= end:
        n = struct.unpack('>I', b[i:i + 4])[0]
        head = 8
        if n == 1:
            n = struct.unpack('>Q', b[i + 8:i + 16])[0]
            head = 16
        elif n == 0:
            n = end - i
        if n < head or i + n > end:
            return
        yield b[i + 4:i + 8], i + head, i + n
        i += n


def quicktime_ms(b):
    """com.apple.quicktime.creationdate om den finns, annars filmhuvudets tid, som är UTC."""
    created = None
    keyed = None
    for t, s, e in atoms(b, 0, len(b)):
        if t != b'moov':
            continue
        for t2, s2, e2 in atoms(b, s, e):
            if t2 == b'mvhd':
                c = struct.unpack('>Q', b[s2 + 4:s2 + 12])[0] if b[s2] == 1 else struct.unpack('>I', b[s2 + 4:s2 + 8])[0]
                created = (c - QT_EPOCH) * 1000 if c else None
            elif t2 == b'meta':
                keys = []
                for t3, s3, e3 in atoms(b, s2, e2):
                    if t3 == b'keys':
                        p = s3 + 8
                        for _ in range(struct.unpack('>I', b[s3 + 4:s3 + 8])[0]):
                            n = struct.unpack('>I', b[p:p + 4])[0]
                            keys.append(b[p + 8:p + n].decode('latin-1'))
                            p += n
                    elif t3 == b'ilst':
                        for t4, s4, e4 in atoms(b, s3, e3):
                            idx = struct.unpack('>I', t4)[0]
                            if 0 < idx <= len(keys) and keys[idx - 1] == 'com.apple.quicktime.creationdate':
                                for t5, s5, e5 in atoms(b, s4, e4):
                                    if t5 == b'data':
                                        text = b[s5 + 8:e5].decode('utf-8', 'replace')
                                        keyed = datetime.strptime(text[:24], '%Y-%m-%dT%H:%M:%S%z').timestamp() * 1000
    return keyed if keyed is not None else created


def file_time(b, zone_offset):
    """Tiden inuti filen i UTC-ms, som EXIF eller QuickTime skriver den. Utan zon gäller bibliotekets förskjutning."""
    if b[4:8] == b'ftyp' and b[8:12] not in (b'heic', b'heix', b'mif1', b'msf1', b'hevc', b'heim', b'heis', b'avif') or b[4:8] in (b'moov', b'mdat', b'wide', b'free', b'skip'):
        return quicktime_ms(b)
    tags = exif_of(b)
    m = re.match(r'(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)', tags.get('DateTimeOriginal', ''))
    if not m:
        return None
    wall = datetime(*map(int, m.groups()), tzinfo=timezone.utc).timestamp() * 1000
    sub = tags.get('SubSecTimeOriginal', '')
    if sub.isdigit():
        wall += float('0.' + sub) * 1000
    z = re.match(r'([+-])(\d\d):(\d\d)', tags.get('OffsetTimeOriginal', ''))
    if z:
        return wall - (1 if z.group(1) == '+' else -1) * (int(z.group(2)) * 60 + int(z.group(3))) * 60000
    return wall - (zone_offset or 0) * 1000


def main():
    zpath, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    z = zipfile.ZipFile(zpath)
    entries = {i.filename: i for i in z.infolist()}
    db = [n for n in entries if re.search(r'/Media/PhotoData/Photos\.sqlite(-wal|-shm)?$', n)]
    for n in db:
        with z.open(n) as src, open(os.path.join(out, os.path.basename(n)), 'wb') as dst:
            shutil.copyfileobj(src, dst)
    c = sqlite3.connect(os.path.join(out, 'Photos.sqlite'))
    c.row_factory = sqlite3.Row
    rows = []
    ms = lambda v: None if v is None else round((v + COCOA) * 1000)
    q = ('select a.ZFILENAME n, a.ZDIRECTORY d, a.ZDATECREATED c, a.ZADDEDDATE ad, a.ZMODIFICATIONDATE mo, a.ZTRASHEDDATE tr, a.ZADJUSTMENTTIMESTAMP aj, '
         'b.ZDATECREATEDSOURCE s, b.ZTIMEZONEOFFSET o from ZASSET a left join ZADDITIONALASSETATTRIBUTES b on b.Z_PK = a.ZADDITIONALATTRIBUTES order by a.ZFILENAME')
    for r in c.execute(q):
        info = next((entries[n] for n in entries if n.endswith('/Media/' + (r['d'] or '') + '/' + r['n'])), None)
        rows.append({
            'name': r['n'], 'source': r['s'],
            'library': {'created': ms(r['c']), 'added': ms(r['ad']), 'modified': ms(r['mo']), 'trashed': ms(r['tr']), 'adjusted': ms(r['aj'])},
            'fs': zip_times(z, info) if info else None,
            'fileTime': file_time(z.read(info), r['o']) if info else None,
        })
    c.close()
    with open(os.path.join(out, 'facit.json'), 'w') as f:
        json.dump({'rows': rows}, f)


if __name__ == '__main__':
    main()
