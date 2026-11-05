// Bygger UFDR-rapporter i tester: en zip med files/ och en report.xml i samma form som Physical Analyzer
// 10.11 skriver den, med samma avsnitt och i samma ordning. Innehåller inga verkliga data. Ingår inte i bygget.

const crypto = require('node:crypto');
const { buildZip } = require('./zip-builder');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
const hash = (algo, data) => crypto.createHash(algo).update(data).digest('hex');
const iso = (ms) => new Date(ms).toISOString().replace('Z', '+00:00');
const NS = 'http://pa.cellebrite.com/report/2.0';

// En rad: { path, data, tag, member (posten under files/, null: ingen post), c, m, a, d (tider i ms), deleted, embedded,
// fs, origin, originReason, service, adjustedTime, adjustedLocation, sha256, metaData: [[namn, värde]], related: [rader],
// x (ChangeTime i accessInfo), metaChange (ctime i avsnittet MetaData, som text) }.
function fileXml(r, ctx, related, indent) {
    const data = Buffer.from(r.data === undefined ? '' : r.data);
    const name = baseName(r.path);
    let local = r.local || r.member || ('files\\' + (r.tag || 'Uncategorized') + '\\' + name);
    // Två olika filer med samma namn: Physical Analyzer sätter ett löpnummer på den andra.
    if (!r.local && !r.member && r.member !== null) {
        const free = (l) => { const m = ctx.members.get(l.replace(/\\/g, '/')); return !m || m.data.equals(data); };
        for (let n = 2; !free(local); n++) local = 'files\\' + (r.tag || 'Uncategorized') + '\\' + name.replace(/(\.[^.]*)?$/, '_' + n + '$1');
    }
    const md5 = hash('md5', data);
    if (r.member !== null) ctx.members.set(local.replace(/\\/g, '/'), { data, deflate: !!r.deflate });
    const stamp = (key, ms) => (ms === undefined || ms === null ? '' : `${indent}    <timestamp name="${key}" format="TimeStampKnown" formattedTimestamp="${iso(ms).replace('.000', '')}">${iso(ms)}</timestamp>\n`);
    const item = (n, v) => (v === undefined || v === '' ? '' : `${indent}    <item name="${n}" systemtype="System.String"><![CDATA[${v}]]></item>\n`);
    ctx.count++;
    return `${indent}<file fs="${esc(r.fs || 'extraktion_fs.zip')}" fsid="a4f64444-5603-41be-a338-adb4fef97fa1" path="${esc(r.path)}" name="${esc(name)}" size="${r.size === undefined ? data.length : r.size}" id="id-${ctx.count}" extractionId="0" deleted="${r.deleted || 'Intact'}" embedded="${r.embedded ? 'true' : 'false'}" isrelated="${related ? 'True' : 'False'}" source_index="${ctx.count}" dedup_hash="${md5}">\n` +
        `${indent}  <accessInfo>\n${stamp('CreationTime', r.c)}${stamp('ModifyTime', r.m)}${stamp('AccessTime', r.a)}${stamp('DeletedTime', r.d)}${stamp('ChangeTime', r.x)}${indent}  </accessInfo>\n` +
        `${indent}  <metadata section="File">\n${item('Local Path', local)}${item('SHA256', r.sha256 || (data.length ? hash('sha256', data) : 'N/A'))}${item('MD5', data.length ? md5 : 'N/A')}${item('Tags', r.tag || 'Uncategorized')}` +
        item('ServiceIdentifier', r.service) + item('MediaOrigin', r.origin) + item('MediaOriginReasoning', r.originReason) + item('AdjustedTimestamp', r.adjustedTime) + item('AdjustedLocation', r.adjustedLocation) + item('IsResourceFile', r.resource) + `${indent}  </metadata>\n` +
        `${indent}  <metadata section="MetaData">\n${indent}    <item name="CoreFileSystemFileSystemNodeChangeTime" group="CoreFileSystemFileSystemNodeDateTime" systemtype="System.String"><![CDATA[${r.metaChange || ''}]]></item>\n` +
        (r.metaData || []).map(([n, v]) => item(n, v)).join('') + `${indent}  </metadata>\n` +
        (r.related && r.related.length ? `${indent}  <RelatedNodes>\n${r.related.map((x) => fileXml(x, ctx, true, indent + '    ')).join('')}${indent}  </RelatedNodes>\n` : '') +
        `${indent}</file>\n`;
}

function buildReport(rows, opts) {
    opts = opts || {};
    const ctx = { members: new Map(), count: 0 };
    const files = rows.map((r) => fileXml(r, ctx, false, '    ')).join('');
    const nodeCount = opts.nodeCount === undefined ? ctx.count : opts.nodeCount;
    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<project id="p" name="Testfallet" reportVersion="8.5" licenseID="1" containsGarbage="True" extractionType="FileSystem" NodeCount="${nodeCount}" ModelCount="1" xmlns="${NS}">\n` +
        `  <sourceExtractions>\n    <extractionInfo id="0" name="File System" isCustomName="False" type="FileSystem" deviceName="APPLE_IOS" fullName="Apple iOS Full File system" index="0" IsPartialData="${opts.partial ? 'True' : 'False'}" IsStoppedByUser="False" IsTriageExtraction="False" IsSelectiveExtraction="False" />\n  </sourceExtractions>\n` +
        `  <caseInformation>\n    <field name="Examiner name" isSystem="False" isRequired="True" fieldType="None" multipleLines="False">Test</field>\n  </caseInformation>\n` +
        `  <metadata section="Additional Fields">\n    <item name="DeviceInfoCreationTime" systemtype="System.String"><![CDATA[05-11-2026 15:53:55]]></item>\n    <item name="UFED_PA_Version" systemtype="System.String"><![CDATA[10.11.0.3022]]></item>\n  </metadata>\n` +
        `  <metadata section="Extraction Data">\n    <item name="Time zone settings (ID)" systemtype="System.String"><![CDATA[_Europe/Stockholm]]></item>\n  </metadata>\n` +
        `  <images>\n    <image key="Archive File (Zip, Tar)" path="extraktion_fs.zip" size="123" type="File" verify="Verified" extractionId="0" />\n  </images>\n  <HashSetsInfo />\n  <MalwareScanner ScanPerformed="False" />\n` +
        (opts.noFiles ? '' : `  <taggedFiles>\n${files}  </taggedFiles>\n`) +
        `  <decodedData>\n    <modelType type="Chat">\n      <file path="/ska/inte/lasas" size="1" />\n    </modelType>\n  </decodedData>\n  <carvedFiles />\n</project>\n`;
    return { xml, members: ctx.members };
}

// Rapporten som zip. opts.report: { deflate } för report.xml. opts.zip64 som i buildZip. opts.noReport: utan report.xml.
function buildUfdr(rows, opts) {
    opts = opts || {};
    const { xml, members } = buildReport(rows, opts);
    const files = [];
    // Posterna har tider för rapportens egen fil, i båda förteckningarna. De ska inte läsas.
    members.forEach((m, name) => files.push({ name, data: m.data, deflate: m.deflate, ntfs: { m: 1000000000, a: 1000000001, c: 1000000002 }, utLocal: { m: 1000000000, a: 1000000001, c: 1000000002, b: 1000000003 } }));
    files.push({ name: 'settings.json', data: '{"Version":"1.0"}' });
    files.push({ name: 'DbData/database.json', data: '{}' });
    if (!opts.noReport) files.push({ name: 'report.xml', data: xml, deflate: !!opts.deflateReport });
    return { buf: buildZip(files, { zip64: !!opts.zip64 }), xml };
}

module.exports = { buildReport, buildUfdr };
