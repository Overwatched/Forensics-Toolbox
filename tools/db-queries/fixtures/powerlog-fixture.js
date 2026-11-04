// Påhittade PowerLog-databaser (CurrentPowerlog.PLSQL) för testerna, med labbtelefonens schema för de
// tabeller som queryerna läser (powerlog-schema.json). Händelserna anges i rätt tid (UTC-sekunder);
// PowerLogs egen tid räknas fram med tidsförskjutningen som gäller då, som PowerLog själv skriver dem.
// Bara för tester, och bara påhittade data.
'use strict';

const schema = require('./powerlog-schema.json')['powerlog-ios26'];

// offsets: [{ at (rätt tid, s), system (s) }] i tidsordning. PowerLogs tid för rätt tid t är t - system
// med förskjutningen som gäller vid t.
function rawOf(offsets, t) {
    let sys = offsets.length ? offsets[0].system : 0;
    offsets.forEach((o) => { if (o.at <= t) sys = o.system; });
    return t - sys;
}

// o: { offsets, camera: [{ t, app, type, state }], backlight: [{ t, active }], blank: [{ t, blanked }],
//      lock: [{ t, locked }], screen: [{ t, role, bundle }], heartbeat: [t, …] }
function powerlogDb(SQL, o) {
    const db = new SQL.Database();
    Object.values(schema).forEach((sql) => db.run(sql));
    const offsets = o.offsets || [{ at: 0, system: 0 }];
    const raw = (t) => rawOf(offsets, t);
    offsets.forEach((x) => db.run('INSERT INTO PLStorageOperator_EventForward_TimeOffset (timestamp, baseband, kernel, system) VALUES (?, 0, 0, ?)', [raw(x.at), x.system]));
    (o.camera || []).forEach((c) => db.run('INSERT INTO PLCameraAgent_EventForward_Camera (timestamp, BundleId, CameraType, State, VideoCaptureWidth, VideoCaptureHeight) VALUES (?, ?, ?, ?, ?, ?)',
        [raw(c.t), c.state ? c.app : null, c.type || 0, c.state ? 1 : 0, c.state ? 1920 : 0, c.state ? 1080 : 0]));
    (o.backlight || []).forEach((b) => db.run("INSERT INTO PLDisplayAgent_EventPoint_Display (timestamp, Block, Active) VALUES (?, 'Backlight', ?)", [raw(b.t), b.active ? 1 : 0]));
    (o.blank || []).forEach((b) => db.run('INSERT INTO PLSpringBoardAgent_EventForward_SBBlank (timestamp, Blanked) VALUES (?, ?)', [raw(b.t), b.blanked ? 1 : 0]));
    (o.lock || []).forEach((l) => db.run('INSERT INTO PLSpringBoardAgent_EventForward_SBLock (timestamp, Locked) VALUES (?, ?)', [raw(l.t), l.locked ? 1 : 0]));
    (o.screen || []).forEach((s) => db.run('INSERT INTO PLScreenStateAgent_EventForward_ScreenState (timestamp, AppRole, Display, Level, Orientation, ScreenWeight, bundleID) VALUES (?, ?, 0, 1.0, 1, 1.0, ?)',
        [raw(s.t), s.role || 1, s.bundle]));
    (o.heartbeat || []).forEach((t, i) => db.run(i % 2
        ? 'INSERT INTO PLApplicationAgent_EventForward_Application (timestamp) VALUES (?)'
        : 'INSERT INTO PLPowerAssertionAgent_EventForward_Assertion (timestamp) VALUES (?)', [raw(t)]));
    const bytes = db.export();
    db.close();
    return bytes;
}

module.exports = { powerlogDb, rawOf };
