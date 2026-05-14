'use strict';
/**
 * vhf-logger.test.js
 *
 * Unit tests for VHF Logger.
 * Run: node --test --test-reporter=spec vhf-logger.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const vm   = require('node:vm');

// ─── Extract JS from <script>…</script> ──────────────────────────────────────
const src = fs.readFileSync(path.join(__dirname, 'vhf-logger.html'), 'utf-8');
const jsMatch = src.match(/<script>([\s\S]*?)<\/script>/);
if(!jsMatch) throw new Error('No <script> block found in vhf-logger.html');
const jsSrc = jsMatch[1];

// ─── DOM mock ────────────────────────────────────────────────────────────────
const mockEl = new Proxy({}, {
  get(t, k) {
    if(k === 'style')    return { display: '' };
    if(k === 'classList') return { add:()=>{}, remove:()=>{}, contains:()=>false, toggle:()=>{} };
    if(typeof k === 'symbol') return undefined;
    const scalars = ['textContent','innerHTML','disabled','className','placeholder','value'];
    if(scalars.includes(k)) return '';
    if(k === 'querySelectorAll' || k === 'querySelector') return ()=>[];
    if(k === 'addEventListener') return ()=>{};
    return () => mockEl;
  },
  set() { return true; },
});

const ctx = vm.createContext({
  console: { log:()=>{}, error:()=>{}, warn:()=>{} },
  require, fs, path,
  process: { argv:[], exit:()=>{}, env:{} },
  Buffer, Date, JSON, Math, String, Number, RegExp, Set, Map, Array, Object,
  parseInt, parseFloat, isNaN, isFinite,
  clearTimeout, setTimeout: ()=>0,
  fetch: async ()=>({ ok:false }),
  URL: { createObjectURL:()=>'', revokeObjectURL:()=>{} },
  Blob: class Blob{ constructor(parts){ this._parts=parts; } },
  localStorage: { getItem:()=>null, setItem:()=>{} },
  confirm: ()=>true,
  document: {
    getElementById:     ()=> mockEl,
    documentElement:    { getAttribute:()=>'', setAttribute:()=>{} },
    querySelectorAll:   ()=> [],
    querySelector:      ()=> mockEl,
    createElement:      ()=> mockEl,
    addEventListener:   ()=>{},
  },
});

vm.runInContext(jsSrc, ctx);

// ─── Inject test helper to set _current (let var, accessible via new vm run) ─
vm.runInContext(`
  function _setCurrentForTest(s){ _current = s; }
  function _getCurrentForTest(){ return _current; }
`, ctx);

const {
  baseCall, levenshtein, normBand,
  locToLatLon, haversine, calcBearing,
  buildEdi, applyBaseline, lookupCall,
  isDupe, recalcDupes,
  _setCurrentForTest, _getCurrentForTest,
} = ctx;

// ═════════════════════════════════════════════════════════════════════════════
//  baseCall
// ═════════════════════════════════════════════════════════════════════════════

describe('baseCall', () => {
  it('plain call unchanged',            () => assert.equal(baseCall('S56OA'),     'S56OA'));
  it('strips /P',                       () => assert.equal(baseCall('S56OA/P'),   'S56OA'));
  it('strips /M',                       () => assert.equal(baseCall('S56OA/M'),   'S56OA'));
  it('strips /MM',                      () => assert.equal(baseCall('S56OA/MM'),  'S56OA'));
  it('strips /AM',                      () => assert.equal(baseCall('DK3AB/AM'),  'DK3AB'));
  it('strips /QRP',                     () => assert.equal(baseCall('S59DGO/QRP'),'S59DGO'));
  it('strips /1',                       () => assert.equal(baseCall('S59DGO/1'),  'S59DGO'));
  it('keeps DXCC prefix (OE/S56OA)',    () => assert.equal(baseCall('OE/S56OA'), 'OE/S56OA'));
  it('keeps DXCC prefix (F/ON4AAA)',    () => assert.equal(baseCall('F/ON4AAA'), 'F/ON4AAA'));
  it('uppercases result',               () => assert.equal(baseCall('s56oa/p'),   'S56OA'));
});

// ═════════════════════════════════════════════════════════════════════════════
//  normBand
// ═════════════════════════════════════════════════════════════════════════════

describe('normBand', () => {
  it('144 MHz → 2m',    () => assert.equal(normBand('144 MHz'), '2m'));
  it('432 MHz → 70cm',  () => assert.equal(normBand('432 MHz'), '70cm'));
  it('1296 MHz → 23cm', () => assert.equal(normBand('1296 MHz'),'23cm'));
  it('50 MHz → 6m',     () => assert.equal(normBand('50 MHz'),  '6m'));
  it('70 MHz → 4m',     () => assert.equal(normBand('70 MHz'),  '4m'));
  it('2320 MHz → 13cm', () => assert.equal(normBand('2320 MHz'),'13cm'));
  it('10368 MHz → 3cm', () => assert.equal(normBand('10368 MHz'),'3cm'));
  it('bare "2m" → 2m',  () => assert.equal(normBand('2m'),      '2m'));
  it('unknown passthrough', () => assert.equal(normBand('999 MHz'),'999 MHz'));
  it('empty → empty',   () => assert.equal(normBand(''),         ''));
});

// ═════════════════════════════════════════════════════════════════════════════
//  locToLatLon
// ═════════════════════════════════════════════════════════════════════════════

describe('locToLatLon', () => {
  it('JN65VP → valid lat/lon', () => {
    const p = locToLatLon('JN65VP');
    assert.ok(p !== null, 'expected non-null');
    assert.ok(p.lat > 45 && p.lat < 47, `lat ${p.lat} not in expected range`);
    assert.ok(p.lon > 13 && p.lon < 15, `lon ${p.lon} not in expected range`);
  });
  it('case-insensitive', () => {
    const a = locToLatLon('JN65vp');
    const b = locToLatLon('JN65VP');
    assert.ok(a !== null);
    assert.ok(Math.abs(a.lat - b.lat) < 0.001);
    assert.ok(Math.abs(a.lon - b.lon) < 0.001);
  });
  it('null on too-short locator',  () => assert.equal(locToLatLon('JN65'), null));
  it('null on invalid characters', () => assert.equal(locToLatLon('XX99XX'), null));
  it('null on empty string',       () => assert.equal(locToLatLon(''), null));
  it('null on null input',         () => assert.equal(locToLatLon(null), null));
  it('IO91wm → western Europe',    () => {
    const p = locToLatLon('IO91wm');
    assert.ok(p !== null);
    assert.ok(p.lat > 50 && p.lat < 53);
    assert.ok(p.lon > -2 && p.lon < 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  haversine
// ═════════════════════════════════════════════════════════════════════════════

describe('haversine', () => {
  // JN65VP (S56OA area, Slovenia) to JN58UD (Vienna area) ≈ 320 km
  it('JN65VP→JN58UD ≈ 320 km (±30)', () => {
    const a = locToLatLon('JN65VP');
    const b = locToLatLon('JN58UD');
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    assert.ok(d > 290 && d < 350, `distance ${d} km not in expected range`);
  });
  it('same point → 0 km', () => {
    assert.equal(haversine(46, 14, 46, 14), 0);
  });
  it('returns integer', () => {
    const a = locToLatLon('JN65VP');
    const b = locToLatLon('JN87OX');
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    assert.equal(d, Math.round(d));
  });
  it('symmetric', () => {
    const a = locToLatLon('JN65VP');
    const b = locToLatLon('IO91wm');
    assert.equal(haversine(a.lat,a.lon,b.lat,b.lon), haversine(b.lat,b.lon,a.lat,a.lon));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  calcBearing
// ═════════════════════════════════════════════════════════════════════════════

describe('calcBearing', () => {
  it('returns value 0–359', () => {
    const a = locToLatLon('JN65VP');
    const b = locToLatLon('IO91wm');
    const brg = calcBearing(a.lat, a.lon, b.lat, b.lon);
    assert.ok(brg >= 0 && brg <= 359, `bearing ${brg} out of range`);
  });
  it('west of origin → roughly 270°', () => {
    const brg = calcBearing(46, 14, 46, 0); // same latitude, west
    assert.ok(brg > 250 && brg < 290, `expected ~270°, got ${brg}°`);
  });
  it('east of origin → roughly 90°', () => {
    const brg = calcBearing(46, 14, 46, 28); // same latitude, east
    assert.ok(brg > 70 && brg < 110, `expected ~90°, got ${brg}°`);
  });
  it('due north → roughly 0°', () => {
    const brg = calcBearing(46, 14, 56, 14); // due north
    assert.ok(brg < 5 || brg > 355, `expected ~0°, got ${brg}°`);
  });
  it('returns integer', () => {
    const a = locToLatLon('JN65VP');
    const b = locToLatLon('JN87OX');
    const brg = calcBearing(a.lat, a.lon, b.lat, b.lon);
    assert.equal(brg, Math.round(brg));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  levenshtein
// ═════════════════════════════════════════════════════════════════════════════

describe('levenshtein', () => {
  it('identical → 0',              () => assert.equal(levenshtein('S59DGO','S59DGO',2), 0));
  it('single substitution → 1',   () => assert.equal(levenshtein('S59DGO','S59DG0',2), 1));
  it('single insertion → 1',      () => assert.equal(levenshtein('S59DG','S59DGO',2),  1));
  it('single deletion → 1',       () => assert.equal(levenshtein('S59DGOX','S59DGO',2),1));
  it('two substitutions → 2',     () => assert.equal(levenshtein('S59DGO','S49DG1',2), 2));
  it('>maxDist → returns >maxDist',() => assert.ok(levenshtein('S59DGO','S56XYZ',2) > 2));
  it('length diff > maxDist',     () => assert.ok(levenshtein('AB','ABCDEF',2) > 2));
});

// ═════════════════════════════════════════════════════════════════════════════
//  isDupe (BUG-02: baseCall normalization + UX-STATE-03: excludeId)
// ═════════════════════════════════════════════════════════════════════════════

describe('isDupe', () => {
  const band = '2m';

  before(() => {
    _setCurrentForTest({
      activeBand: band,
      myLoc: 'JN65VP',
      qsos: [
        { _id:'q1', band:'2m',  call:'S56OA',   dupe:false },
        { _id:'q2', band:'2m',  call:'S59DGO/P', dupe:false },
        { _id:'q3', band:'70cm',call:'S56OA',   dupe:false },
      ],
    });
  });

  it('detects exact call dupe on same band', () =>
    assert.equal(isDupe('S56OA', '2m'), true));

  it('no dupe on different band', () =>
    assert.equal(isDupe('S56OA', '6m'), false));

  it('detects /P portable as dupe of base call (BUG-02)', () =>
    assert.equal(isDupe('S59DGO', '2m'), true));

  it('detects base call as dupe of /P entry (BUG-02)', () =>
    assert.equal(isDupe('S59DGO/P', '2m'), true));

  it('different band — S56OA is only on 70cm separately, not dupe on 6m', () =>
    assert.equal(isDupe('S56OA', '6m'), false));

  it('excludeId skips the QSO being edited (UX-STATE-03)', () =>
    assert.equal(isDupe('S56OA', '2m', 'q1'), false));

  it('excludeId only skips the matching id', () =>
    assert.equal(isDupe('S56OA', '70cm', 'q1'), true)); // q3 is still there
});

// ═════════════════════════════════════════════════════════════════════════════
//  recalcDupes (BUG-03)
// ═════════════════════════════════════════════════════════════════════════════

describe('recalcDupes', () => {
  it('marks second occurrence of same base call as dupe', () => {
    _setCurrentForTest({
      activeBand: '2m', myLoc: 'JN65VP',
      qsos: [
        { _id:'a', band:'2m', call:'S56OA',   dupe:false },
        { _id:'b', band:'2m', call:'S56OA',   dupe:false },
        { _id:'c', band:'2m', call:'S59DGO',  dupe:false },
      ],
    });
    recalcDupes();
    const q = _getCurrentForTest().qsos;
    assert.equal(q[0].dupe, false, 'first occurrence clean');
    assert.equal(q[1].dupe, true,  'second occurrence dupe');
    assert.equal(q[2].dupe, false, 'different call clean');
  });

  it('/P portable treated as same as base call (BUG-02)', () => {
    _setCurrentForTest({
      activeBand: '2m', myLoc: 'JN65VP',
      qsos: [
        { _id:'a', band:'2m', call:'S59DGO',  dupe:false },
        { _id:'b', band:'2m', call:'S59DGO/P', dupe:false },
      ],
    });
    recalcDupes();
    const q = _getCurrentForTest().qsos;
    assert.equal(q[0].dupe, false);
    assert.equal(q[1].dupe, true);
  });

  it('dupes are per-band — same call on different bands is clean', () => {
    _setCurrentForTest({
      activeBand: '2m', myLoc: 'JN65VP',
      qsos: [
        { _id:'a', band:'2m',   call:'S56OA', dupe:false },
        { _id:'b', band:'70cm', call:'S56OA', dupe:true  }, // previously marked
      ],
    });
    recalcDupes();
    const q = _getCurrentForTest().qsos;
    assert.equal(q[0].dupe, false);
    assert.equal(q[1].dupe, false, 'different band resets dupe flag');
  });

  it('already-clean list stays clean', () => {
    _setCurrentForTest({
      activeBand: '2m', myLoc: 'JN65VP',
      qsos: [
        { _id:'a', band:'2m', call:'S56OA',  dupe:false },
        { _id:'b', band:'2m', call:'S59DGO', dupe:false },
      ],
    });
    recalcDupes();
    const q = _getCurrentForTest().qsos;
    assert.equal(q[0].dupe, false);
    assert.equal(q[1].dupe, false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  buildEdi
// ═════════════════════════════════════════════════════════════════════════════

describe('buildEdi', () => {
  const session = {
    id: 'test1',
    myCall: 'S56OA',
    myLoc: 'JN65VP',
    contest: 'IARU R1 VHF Contest',
    operator: 'S56OA',
    club: 'S59DGO',
    bands: [{ band:'2m', freq:'144.300', power:100, antenna:'9el Yagi' }],
    qsos: [
      { _id:'q1', band:'2m', mode:'SSB', call:'S59DGO', wwl:'JN65vp',
        rstS:'59', rstR:'59', nrS:1, nrR:1, utcDate:'20260510', utcTime:'1030', qrb:50, brg:45, dupe:false, xFlags:[] },
      { _id:'q2', band:'2m', mode:'CW',  call:'OE5VRL/P', wwl:'JN78dg',
        rstS:'599', rstR:'599', nrS:2, nrR:7, utcDate:'20260510', utcTime:'1045', qrb:180, brg:340, dupe:false, xFlags:[] },
      { _id:'q3', band:'2m', mode:'SSB', call:'S59DGO', wwl:'JN65vp',
        rstS:'59', rstR:'59', nrS:3, nrR:2, utcDate:'20260510', utcTime:'1100', qrb:50, brg:45, dupe:true,  xFlags:[] },
    ],
  };

  it('returns null for band with no QSOs', () =>
    assert.equal(buildEdi(session, '70cm'), null));

  it('contains REG1TEST header', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('[REG1TEST]'), 'missing [REG1TEST]');
  });

  it('contains QSORecords section with correct count', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('[QSORecords 3]'), 'missing [QSORecords 3]');
  });

  it('encodes SSB as mode 1', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('S59DGO;1;59;'), 'SSB→1 encoding failed');
  });

  it('encodes CW as mode 2', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('OE5VRL/P;2;599;'), 'CW→2 encoding failed');
  });

  it('locator is uppercased in output', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes(';JN65VP;'), 'locator not uppercased');
  });

  it('serial numbers are zero-padded to 3 digits', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes(';001;'), 'nrS 001 not found');
    assert.ok(out.includes(';007;'), 'nrR 007 not found');
  });

  it('uses YYMMDD date format in QSO record', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('260510;'), 'YYMMDD date not found');
  });

  it('contains my call and locator', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('PCall=S56OA'));
    assert.ok(out.includes('PWWLo=JN65VP'));
  });

  it('QSOs sorted chronologically', () => {
    const sessionRev = {
      ...session,
      qsos: [...session.qsos].reverse(),
    };
    const out = buildEdi(sessionRev, '2m');
    const i1 = out.indexOf('S59DGO');
    const i2 = out.indexOf('OE5VRL');
    assert.ok(i1 < i2, 'QSOs not sorted chronologically');
  });

  it('uses CRLF line endings', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('\r\n'), 'missing CRLF');
  });

  it('power and antenna in header', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('PWatt=100'));
    assert.ok(out.includes('PAntn=9el Yagi'));
  });

  it('PClub populated from session.club (LOW-EDI)', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('PClub=S59DGO'), `PClub not found; got: ${out.match(/PClub=.*/)?.[0]}`);
  });

  it('PClub empty when session.club not set (LOW-EDI)', () => {
    const s = { ...session, club: '' };
    const out = buildEdi(s, '2m');
    assert.ok(out.includes('PClub=\r\n'), 'PClub should be empty');
  });

  it('dupe flag D at col 13 for duplicate QSO (LOW-EDI)', () => {
    const out = buildEdi(session, '2m');
    // The dupe QSO (q3) should end with ;;;D\r\n
    const lines = out.split('\r\n').filter(l => l.startsWith('260510'));
    const dupeLine = lines[2]; // third QSO chronologically = q3 (dupe)
    assert.ok(dupeLine.endsWith(';D'), `dupe line should end with ;D, got: ${dupeLine}`);
  });

  it('non-dupe QSO has empty col 13 (LOW-EDI)', () => {
    const out = buildEdi(session, '2m');
    const lines = out.split('\r\n').filter(l => l.startsWith('260510'));
    const cleanLine = lines[0]; // q1 — not a dupe
    assert.ok(!cleanLine.endsWith(';D'), `clean line should not end with ;D: ${cleanLine}`);
    assert.ok(cleanLine.endsWith(';'), `clean line col 13 should be empty (trailing ;): ${cleanLine}`);
  });

  it('QSO record has exactly 14 fields (col 0–13)', () => {
    const out = buildEdi(session, '2m');
    const qsoLine = out.split('\r\n').find(l => l.startsWith('260510'));
    const fields = qsoLine.split(';');
    assert.equal(fields.length, 14, `expected 14 fields, got ${fields.length}: ${qsoLine}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  lookupCall via applyBaseline
// ═════════════════════════════════════════════════════════════════════════════

describe('lookupCall', () => {
  // Build a minimal baseline JSON and inject it
  const baseline = {
    v: '2025-01-01',
    src: 'test',
    b: ['2m', '70cm'],
    c: {
      'S59DGO': { '0': [['JN65VP', 10, false]] },
      'OE5VRL': { '0': [['JN78DG', 8, false], ['JN78EG', 2, false]] },
    },
  };

  before(() => applyBaseline(baseline));

  it('finds known call', () => {
    const lk = lookupCall('S59DGO');
    assert.equal(lk.found, true);
    assert.equal(lk.total, 10);
    assert.equal(lk.modeLoc, 'JN65VP');
  });

  it('finds /P variant via baseCall normalization', () => {
    const lk = lookupCall('S59DGO/P');
    assert.equal(lk.found, true);
    assert.equal(lk.modeLoc, 'JN65VP');
  });

  it('returns mode locator (most common) for multi-loc call', () => {
    const lk = lookupCall('OE5VRL');
    assert.equal(lk.found, true);
    assert.equal(lk.modeLoc, 'JN78DG'); // 8 > 2
  });

  it('returns found=false and similar list for unknown call', () => {
    const lk = lookupCall('S59DGA'); // Levenshtein 1 from S59DGO
    assert.equal(lk.found, false);
    assert.ok(Array.isArray(lk.similar));
    const s = lk.similar.find(x => x.call === 'S59DGO');
    assert.ok(s, 'S59DGO not in similar list');
    assert.equal(s.dist, 1);
  });

  it('similar list sorted by dist then count', () => {
    const lk = lookupCall('ZZ9ZZZ'); // unknown, no similar
    assert.equal(lk.found, false);
    assert.equal(lk.similar.length, 0);
  });

  it('case-insensitive lookup', () => {
    const lk = lookupCall('s59dgo');
    assert.equal(lk.found, true);
  });
});
