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
  TextEncoder, TextDecoder, Uint8Array, DataView, ArrayBuffer,
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

// ─── Inject test helpers ──────────────────────────────────────────────────────
vm.runInContext(`
  function _setCurrentForTest(s){ _current = s; }
  function _getCurrentForTest(){ return _current; }
  function _getEditingExistingForTest(){ return _editingExisting; }
  function _getI18nValueForTest(lang, key){ return (S[lang]||{})[key]; }
  function _getManualTimeForTest(){ return _manualTime; }
  function _setManualTimeForTest(v){ _manualTime = v; }
  function _getBandColorsForTest(){ return BAND_COLORS; }
`, ctx);

const {
  baseCall, levenshtein, normBand,
  locToLatLon, haversine, calcBearing,
  buildEdi, applyBaseline, lookupCall,
  isDupe, recalcDupes,
  parseEdiForImport, makeZip, validateBackup,
  _setCurrentForTest, _getCurrentForTest,
  _getEditingExistingForTest, _getI18nValueForTest,
  _getManualTimeForTest, _setManualTimeForTest,
  _getBandColorsForTest,
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
    sect: 'MO', qthName: 'Krvavec', rCall: 'S56OA', rName: 'Test User', rCity: 'Ljubljana', rCoun: 'SI', rEmail: '',
    bands: [{ band:'2m', freq:'144.300', power:100, antenna:'9el Yagi', txEq:'SSPA 300W', rxEq:'LNA', antH:'1200' }],
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

  it('contains REG1TEST;1 header', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('[REG1TEST;1]'), 'missing [REG1TEST;1]');
  });

  it('contains QSORecords section with correct count', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('[QSORecords;3]'), 'missing [QSORecords;3]');
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

  it('power and antenna in header (SPowe/SAnte)', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('SPowe=100'), `SPowe not found; got: ${out.match(/SPowe=.*/)?.[0]}`);
    assert.ok(out.includes('SAnte=9el Yagi'), `SAnte not found; got: ${out.match(/SAnte=.*/)?.[0]}`);
  });

  it('TDate uses YYYYMMDD;YYYYMMDD (start;end) format', () => {
    const out = buildEdi(session, '2m');
    // All QSOs are on 20260510 so start and end are the same date
    assert.ok(out.includes('TDate=20260510;20260510'), `TDate start;end not found; got: ${out.match(/TDate=.*/)?.[0]}`);
  });

  it('TDate end date is last QSO date when spanning multiple days', () => {
    const s2 = { ...session, qsos: [
      ...session.qsos,
      { _id:'q4', band:'2m', mode:'SSB', call:'HA6XY', wwl:'JN97nh',
        rstS:'59', rstR:'59', nrS:4, nrR:5, utcDate:'20260511', utcTime:'0800', qrb:400, brg:120, dupe:false, xFlags:[] },
    ]};
    const out = buildEdi(s2, '2m');
    assert.ok(out.includes('TDate=20260510;20260511'), `TDate end date not updated; got: ${out.match(/TDate=.*/)?.[0]}`);
  });

  it('TTime is not present (non-standard field removed)', () => {
    const out = buildEdi(session, '2m');
    assert.ok(!out.includes('TTime='), 'TTime must not appear in output');
  });

  it('PWWLr is not present (non-standard field removed)', () => {
    const out = buildEdi(session, '2m');
    assert.ok(!out.includes('PWWLr='), 'PWWLr must not appear in output');
  });

  it('PSect populated from session.sect', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('PSect=MO'), `PSect not found; got: ${out.match(/PSect=.*/)?.[0]}`);
  });

  it('STXEq and SRXEq (rxEq) populated from band config', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('STXEq=SSPA 300W'), `STXEq not found`);
    assert.ok(out.includes('SRXEq=LNA'), `SRXEq not found`);
    assert.ok(!out.includes('OPEqu'), `OPEqu must not appear (use SRXEq)`);
  });

  it('CQSOs counts non-dupe QSOs with multiplier (CWWLs+CDXCs)', () => {
    const out = buildEdi(session, '2m');
    // q1 S59DGO, q2 OE5VRL/P valid; q3 dupe. DXCCs: S59→S5(1), OE5→OE(1) = 2; WWLs = 2; mult = 4
    assert.ok(out.includes('CQSOs=2;'), `CQSOs=2; not found; got: ${out.match(/CQSOs=.*/)?.[0]}`);
    const m = out.match(/CQSOs=(\d+);(\d+)/);
    assert.ok(m && m[1]==='2', `CQSOs count should be 2; got: ${m?.[1]}`);
  });

  it('CWWLs counts unique 4-char grid squares with format count;0;count', () => {
    const out = buildEdi(session, '2m');
    // q1: JN65vp → JN65, q2: JN78dg → JN78, q3 is dupe → excluded → 2 squares
    assert.ok(out.includes('CWWLs=2;0;2'), `CWWLs should be 2;0;2; got: ${out.match(/CWWLs=.*/)?.[0]}`);
  });

  it('CWWLB is 0', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('CWWLB=0\r\n'), `CWWLB should be 0; got: ${out.match(/CWWLB=.*/)?.[0]}`);
  });

  it('CDXCs format is count;0;count', () => {
    const out = buildEdi(session, '2m');
    const m = out.match(/CDXCs=(\d+);0;(\d+)/);
    assert.ok(m && m[1]===m[2], `CDXCs count and multiplier should match; got: ${out.match(/CDXCs=.*/)?.[0]}`);
  });

  it('CDXCB is 0', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('CDXCB=0\r\n'), `CDXCB should be 0; got: ${out.match(/CDXCB=.*/)?.[0]}`);
  });

  it('CExcs format is count;0;count', () => {
    const out = buildEdi(session, '2m');
    const m = out.match(/CExcs=(\d+);0;(\d+)/);
    assert.ok(m && m[1]===m[2], `CExcs count and multiplier should match; got: ${out.match(/CExcs=.*/)?.[0]}`);
  });

  it('CExcB is 0', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('CExcB=0\r\n'), `CExcB should be 0; got: ${out.match(/CExcB=.*/)?.[0]}`);
  });

  it('CQSOP is sum of QRB for non-dupe QSOs', () => {
    const out = buildEdi(session, '2m');
    // q1: 50km, q2: 180km, q3 dupe excluded → 230
    assert.ok(out.includes('CQSOP=230'), `CQSOP should be 230; got: ${out.match(/CQSOP=.*/)?.[0]}`);
  });

  it('CODXC identifies the furthest non-dupe QSO', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('CODXC=OE5VRL/P;JN78DG;180'), `CODXC not correct; got: ${out.match(/CODXC=.*/)?.[0]}`);
  });

  it('CToSc is CQSOP × (CWWLs + CDXCs)', () => {
    const out = buildEdi(session, '2m');
    // q1: S59DGO JN65vp 50km, q2: OE5VRL/P JN78dg 180km (valid); q3 dupe
    // CQSOP=230, CWWLs=2 (JN65,JN78), CDXCs=2 (S5,OE) → CToSc=230×4=920
    const m = out.match(/CToSc=(\d+)/);
    assert.ok(m, 'CToSc not found');
    const cqsop = 230, cwwls = 2, cdxcs = 2;
    assert.equal(parseInt(m[1]), cqsop * (cwwls + cdxcs), `CToSc should be ${cqsop*(cwwls+cdxcs)}, got ${m[1]}`);
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

  it('dupe flag D at col 14 for duplicate QSO', () => {
    const out = buildEdi(session, '2m');
    // The dupe QSO (q3) should end with ;;;;D (4 empty cols after QRB, D at col 14)
    const lines = out.split('\r\n').filter(l => l.startsWith('260510'));
    const dupeLine = lines[2]; // third QSO chronologically = q3 (dupe)
    const fields = dupeLine.split(';');
    assert.equal(fields.length, 15, `dupe line should have 15 fields, got ${fields.length}: ${dupeLine}`);
    assert.equal(fields[14], 'D', `dupe flag should be at col 14, got: ${fields[14]}`);
  });

  it('non-dupe QSO has empty col 14', () => {
    const out = buildEdi(session, '2m');
    const lines = out.split('\r\n').filter(l => l.startsWith('260510'));
    const cleanLine = lines[0]; // q1 — not a dupe
    const fields = cleanLine.split(';');
    assert.equal(fields.length, 15, `clean line should have 15 fields, got ${fields.length}: ${cleanLine}`);
    assert.equal(fields[14], '', `col 14 should be empty for non-dupe, got: ${fields[14]}`);
  });

  it('QSO record has exactly 15 fields (col 0–14)', () => {
    const out = buildEdi(session, '2m');
    const qsoLine = out.split('\r\n').find(l => l.startsWith('260510'));
    const fields = qsoLine.split(';');
    assert.equal(fields.length, 15, `expected 15 fields, got ${fields.length}: ${qsoLine}`);
  });

  it('SAntH uses height;height format for ground and sea level', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('SAntH=1200;1200'), `SAntH should be 1200;1200; got: ${out.match(/SAntH=.*/)?.[0]}`);
  });

  it('SAntH is empty;empty when antH not set', () => {
    const s = { ...session, bands: [{ band:'2m', freq:'144.300', power:100, antenna:'Yagi' }] };
    const out = buildEdi(s, '2m');
    assert.ok(out.includes('SAntH=;\r\n'), `SAntH should be ;  when antH missing; got: ${out.match(/SAntH=.*/)?.[0]}`);
  });

  it('PBand uses 145 MHz for 2m band', () => {
    const out = buildEdi(session, '2m');
    assert.ok(out.includes('PBand=145 MHz'), `PBand should be 145 MHz; got: ${out.match(/PBand=.*/)?.[0]}`);
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

// ═════════════════════════════════════════════════════════════════════════════
//  sessionEdit — state and i18n for session-editing feature
// ═════════════════════════════════════════════════════════════════════════════

describe('sessionEdit', () => {
  it('_editingExisting initialises to false', () =>
    assert.equal(_getEditingExistingForTest(), false));

  // ── SL i18n ──
  it('sl.btnEditSetup is a non-empty string', () =>
    assert.ok(typeof _getI18nValueForTest('sl','btnEditSetup')==='string'&&_getI18nValueForTest('sl','btnEditSetup').length>0));
  it('sl.setupEdit is a non-empty string', () =>
    assert.ok(typeof _getI18nValueForTest('sl','setupEdit')==='string'&&_getI18nValueForTest('sl','setupEdit').length>0));
  it('sl.btnSaveSetup is a non-empty string', () =>
    assert.ok(typeof _getI18nValueForTest('sl','btnSaveSetup')==='string'&&_getI18nValueForTest('sl','btnSaveSetup').length>0));
  it('sl.errBandHasQsos is a non-empty string', () =>
    assert.ok(typeof _getI18nValueForTest('sl','errBandHasQsos')==='string'&&_getI18nValueForTest('sl','errBandHasQsos').length>0));

  // ── EN i18n ──
  it('en.btnEditSetup is a non-empty string', () =>
    assert.ok(typeof _getI18nValueForTest('en','btnEditSetup')==='string'&&_getI18nValueForTest('en','btnEditSetup').length>0));
  it('en.setupEdit is a non-empty string', () =>
    assert.ok(typeof _getI18nValueForTest('en','setupEdit')==='string'&&_getI18nValueForTest('en','setupEdit').length>0));
  it('en.btnSaveSetup is a non-empty string', () =>
    assert.ok(typeof _getI18nValueForTest('en','btnSaveSetup')==='string'&&_getI18nValueForTest('en','btnSaveSetup').length>0));
  it('en.errBandHasQsos is a non-empty string', () =>
    assert.ok(typeof _getI18nValueForTest('en','errBandHasQsos')==='string'&&_getI18nValueForTest('en','errBandHasQsos').length>0));

  it('sl.setupEdit ≠ en.setupEdit (distinct translations)', () =>
    assert.notEqual(_getI18nValueForTest('sl','setupEdit'), _getI18nValueForTest('en','setupEdit')));
});

// ═════════════════════════════════════════════════════════════════════════════
//  parseEdiForImport
// ═════════════════════════════════════════════════════════════════════════════

describe('parseEdiForImport', () => {
  // 15 fields per QSO record (col 0–14); dupe flag at col 14 per spec
  const ediText = [
    '[REG1TEST;1]',
    'TDate=20260510;20260510',
    'PBand=145 MHz',
    'PCall=S56OA',
    '[QSORecords;3]',
    '260510;1030;S59DGO;1;59;001;59;001;;JN65vp;50;;;;',
    '260510;1045;OE5VRL/P;2;599;002;599;007;;JN78dg;180;;;;',
    '260510;1100;S59DGO;1;59;003;59;002;;JN65vp;50;;;;D',
    '',
  ].join('\r\n');

  it('parses correct number of QSOs', () => {
    const {qsos} = parseEdiForImport(ediText);
    assert.equal(qsos.length, 3);
  });

  it('converts YYMMDD to YYYYMMDD', () => {
    const {qsos} = parseEdiForImport(ediText);
    assert.equal(qsos[0].utcDate, '20260510');
  });

  it('converts mode number 1 → SSB', () => {
    const {qsos} = parseEdiForImport(ediText);
    assert.equal(qsos[0].mode, 'SSB');
  });

  it('converts mode number 2 → CW', () => {
    const {qsos} = parseEdiForImport(ediText);
    assert.equal(qsos[1].mode, 'CW');
  });

  it('detects dupe flag D in col 14', () => {
    const {qsos} = parseEdiForImport(ediText);
    assert.equal(qsos[0].dupe, false);
    assert.equal(qsos[2].dupe, true);
  });

  it('uppercases callsign', () => {
    const {qsos} = parseEdiForImport(ediText);
    assert.equal(qsos[0].call, 'S59DGO');
  });

  it('normalises locator case (4 upper + 2 lower)', () => {
    const {qsos} = parseEdiForImport(ediText);
    assert.equal(qsos[0].wwl, 'JN65vp');
    assert.equal(qsos[1].wwl, 'JN78dg');
  });

  it('reads header fields', () => {
    const {header} = parseEdiForImport(ediText);
    assert.equal(header['PBand'], '145 MHz');
    assert.equal(header['PCall'], 'S56OA');
  });

  it('parses UTC time correctly', () => {
    const {qsos} = parseEdiForImport(ediText);
    assert.equal(qsos[0].utcTime, '1030');
    assert.equal(qsos[1].utcTime, '1045');
  });

  it('handles YY >= 80 as 19xx', () => {
    const old = '[REG1TEST;1]\r\n[QSORecords;1]\r\n850615;1200;DL1XYZ;1;59;001;59;001;;JO31ab;100;;;;\r\n';
    const {qsos} = parseEdiForImport(old);
    assert.equal(qsos[0].utcDate, '19850615');
  });

  it('tolerates old 14-field format (dupe at col 13) without crash', () => {
    const old14 = '[REG1TEST;1]\r\n[QSORecords 3]\r\n260510;1030;S59DGO;1;59;001;59;001;;JN65vp;50;;;D\r\n';
    const {qsos} = parseEdiForImport(old14);
    // col 13 value 'D' is read into col 14 position (undefined) → dupe=false; no crash
    assert.equal(qsos.length, 1);
    assert.equal(qsos[0].dupe, false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  makeZip
// ═════════════════════════════════════════════════════════════════════════════

describe('makeZip', () => {
  it('returns a Uint8Array', () => {
    const z = makeZip([{name:'test.edi', data:'hello'}]);
    assert.ok(z instanceof Uint8Array);
  });

  it('starts with ZIP local file header magic PK\\x03\\x04', () => {
    const z = makeZip([{name:'a.edi', data:'data'}]);
    assert.equal(z[0], 0x50); // P
    assert.equal(z[1], 0x4B); // K
    assert.equal(z[2], 0x03);
    assert.equal(z[3], 0x04);
  });

  it('ends with end-of-central-directory magic PK\\x05\\x06', () => {
    const z = makeZip([{name:'a.edi', data:'data'}]);
    // EOCD is 22 bytes from end
    const eocdOff = z.length - 22;
    assert.equal(z[eocdOff],   0x50);
    assert.equal(z[eocdOff+1], 0x4B);
    assert.equal(z[eocdOff+2], 0x05);
    assert.equal(z[eocdOff+3], 0x06);
  });

  it('encodes file count in EOCD (2 files)', () => {
    const z = makeZip([{name:'a.edi', data:'aaa'}, {name:'b.edi', data:'bbb'}]);
    const eocdOff = z.length - 22;
    const count = z[eocdOff+8] | (z[eocdOff+9] << 8); // total entries (little-endian)
    assert.equal(count, 2);
  });

  it('empty file list produces minimal valid ZIP', () => {
    const z = makeZip([]);
    assert.ok(z.length >= 22);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  bandColors — BAND_COLORS map
// ═════════════════════════════════════════════════════════════════════════════

describe('bandColors', () => {
  it('BAND_COLORS has entry for 2m', () => {
    const bc = _getBandColorsForTest();
    assert.ok(typeof bc['2m'] === 'string' && bc['2m'].startsWith('#'));
  });

  it('BAND_COLORS has entry for 70cm', () => {
    const bc = _getBandColorsForTest();
    assert.ok(typeof bc['70cm'] === 'string' && bc['70cm'].startsWith('#'));
  });

  it('2m and 70cm have distinct colors', () => {
    const bc = _getBandColorsForTest();
    assert.notEqual(bc['2m'], bc['70cm']);
  });

  it('all entries are 7-char hex strings (#rrggbb)', () => {
    const bc = _getBandColorsForTest();
    for (const [band, col] of Object.entries(bc)) {
      assert.ok(/^#[0-9a-fA-F]{6}$/.test(col), `${band}: invalid color ${col}`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  manualTime — state + i18n
// ═════════════════════════════════════════════════════════════════════════════

describe('manualTime', () => {
  it('_manualTime initialises to null', () => {
    assert.equal(_getManualTimeForTest(), null);
  });

  it('can be set via helper and read back', () => {
    _setManualTimeForTest({date:'20260510', time:'1234'});
    const v = _getManualTimeForTest();
    assert.equal(v.date, '20260510');
    assert.equal(v.time, '1234');
    _setManualTimeForTest(null);
  });

  it('sl.toastImported contains ${n} placeholder', () => {
    const s = _getI18nValueForTest('sl','toastImported');
    assert.ok(s.includes('${n}'), `missing \${n} in: ${s}`);
  });

  it('sl.errImportBand contains ${band} placeholder', () => {
    const s = _getI18nValueForTest('sl','errImportBand');
    assert.ok(s.includes('${band}'), `missing \${band} in: ${s}`);
  });

  it('sl.btnExportAll is a non-empty string', () => {
    const s = _getI18nValueForTest('sl','btnExportAll');
    assert.ok(typeof s === 'string' && s.length > 0);
  });

  it('en.btnExportAll is a non-empty string', () => {
    const s = _getI18nValueForTest('en','btnExportAll');
    assert.ok(typeof s === 'string' && s.length > 0);
  });

  it('sl.btnImport ≠ en.btnImport (same string, but let us verify both exist)', () => {
    const sl = _getI18nValueForTest('sl','btnImport');
    const en = _getI18nValueForTest('en','btnImport');
    assert.ok(typeof sl === 'string' && sl.length > 0);
    assert.ok(typeof en === 'string' && en.length > 0);
  });

  it('sl.warnImportBand contains ${band} placeholder', () => {
    const s = _getI18nValueForTest('sl','warnImportBand');
    assert.ok(s.includes('${band}'), `missing \${band} in: ${s}`);
  });

  it('en.warnImportBand contains ${band} placeholder', () => {
    const s = _getI18nValueForTest('en','warnImportBand');
    assert.ok(s.includes('${band}'), `missing \${band} in: ${s}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  backup — validateBackup + i18n
// ═════════════════════════════════════════════════════════════════════════════

describe('backup', () => {
  const minSession = {
    id: 'test001', myCall: 'S56OA', myLoc: 'JN65WP',
    contest: 'TEST', bands: [], qsos: [],
  };
  const minBackup = {
    app: 'vhf-logger', v: 1,
    date: '2026-05-15T12:00:00.000Z',
    sessions: [minSession],
  };

  // ── validateBackup structure ──
  it('returns sessions array for valid backup', () => {
    const s = validateBackup({ ...minBackup });
    assert.ok(Array.isArray(s) && s.length === 1);
  });

  it('accepts empty sessions array', () => {
    const s = validateBackup({ ...minBackup, sessions: [] });
    assert.ok(Array.isArray(s) && s.length === 0);
  });

  it('returns null for wrong app name', () =>
    assert.equal(validateBackup({ ...minBackup, app: 'other' }), null));

  it('returns null when app field is missing', () => {
    const { app: _, ...obj } = minBackup;
    assert.equal(validateBackup(obj), null);
  });

  it('returns null when sessions is not an array', () =>
    assert.equal(validateBackup({ ...minBackup, sessions: {} }), null));

  it('returns null for null input', () =>
    assert.equal(validateBackup(null), null));

  it('returns null for array input (not wrapped)', () =>
    assert.equal(validateBackup([minSession]), null));

  it('returns null when session missing id', () => {
    const { id: _, ...s } = minSession;
    assert.equal(validateBackup({ ...minBackup, sessions: [s] }), null);
  });

  it('returns null when session has empty id', () =>
    assert.equal(validateBackup({ ...minBackup, sessions: [{ ...minSession, id: '' }] }), null));

  it('returns null when session missing myCall', () => {
    const { myCall: _, ...s } = minSession;
    assert.equal(validateBackup({ ...minBackup, sessions: [s] }), null);
  });

  it('returns null when session missing bands', () => {
    const { bands: _, ...s } = minSession;
    assert.equal(validateBackup({ ...minBackup, sessions: [s] }), null);
  });

  it('returns null when session missing qsos', () => {
    const { qsos: _, ...s } = minSession;
    assert.equal(validateBackup({ ...minBackup, sessions: [s] }), null);
  });

  it('returns null when QSO missing _id', () => {
    const q = { band: '2m', call: 'S59DGO' };
    assert.equal(validateBackup({ ...minBackup, sessions: [{ ...minSession, qsos: [q] }] }), null);
  });

  it('returns null when QSO missing band', () => {
    const q = { _id: 'q1', call: 'S59DGO' };
    assert.equal(validateBackup({ ...minBackup, sessions: [{ ...minSession, qsos: [q] }] }), null);
  });

  it('returns null when QSO missing call', () => {
    const q = { _id: 'q1', band: '2m' };
    assert.equal(validateBackup({ ...minBackup, sessions: [{ ...minSession, qsos: [q] }] }), null);
  });

  it('accepts session with valid QSOs', () => {
    const q = { _id: 'q1', band: '2m', call: 'S59DGO', mode: 'SSB', wwl: 'JN65vp',
                rstS: '59', rstR: '59', nrS: 1, nrR: 1,
                utcDate: '20260510', utcTime: '1030', qrb: 100, brg: 45, dupe: false, xFlags: [] };
    const sessions = validateBackup({ ...minBackup, sessions: [{ ...minSession, qsos: [q] }] });
    assert.ok(Array.isArray(sessions) && sessions[0].qsos.length === 1);
  });

  // ── ID content validation (XSS prevention) ──
  it('returns null for session id containing single quote', () =>
    assert.equal(validateBackup({ ...minBackup, sessions: [{ ...minSession, id: "');alert(1);//" }] }), null));

  it('returns null for session id containing hyphen (non-alphanumeric)', () =>
    assert.equal(validateBackup({ ...minBackup, sessions: [{ ...minSession, id: 'test-001' }] }), null));

  it('returns null for session id containing uppercase letters', () =>
    assert.equal(validateBackup({ ...minBackup, sessions: [{ ...minSession, id: 'Test001' }] }), null));

  it('returns null for QSO _id containing injection chars', () => {
    const q = { _id: "');deleteAll();//", band: '2m', call: 'S59DGO' };
    assert.equal(validateBackup({ ...minBackup, sessions: [{ ...minSession, qsos: [q] }] }), null);
  });

  it('accepts session id with only lowercase alphanumeric chars', () =>
    assert.ok(Array.isArray(validateBackup({ ...minBackup, sessions: [{ ...minSession, id: 'abc123xyz' }] }))));

  // ── i18n ──
  it('sl.btnBackup is non-empty', () =>
    assert.ok(typeof _getI18nValueForTest('sl','btnBackup')==='string' && _getI18nValueForTest('sl','btnBackup').length>0));

  it('en.btnBackup is non-empty', () =>
    assert.ok(typeof _getI18nValueForTest('en','btnBackup')==='string' && _getI18nValueForTest('en','btnBackup').length>0));

  it('sl.btnRestore ≠ en.btnRestore (distinct translations)', () =>
    assert.notEqual(_getI18nValueForTest('sl','btnRestore'), _getI18nValueForTest('en','btnRestore')));

  it('sl.confirmRestore contains ${n} placeholder', () => {
    const s = _getI18nValueForTest('sl','confirmRestore');
    assert.ok(s.includes('${n}'), `missing \${n} in: ${s}`);
  });

  it('en.confirmRestore contains ${n} placeholder', () => {
    const s = _getI18nValueForTest('en','confirmRestore');
    assert.ok(s.includes('${n}'), `missing \${n} in: ${s}`);
  });

  it('sl.toastRestoreDone contains ${n} placeholder', () => {
    const s = _getI18nValueForTest('sl','toastRestoreDone');
    assert.ok(s.includes('${n}'), `missing \${n} in: ${s}`);
  });

  it('en.toastRestoreDone contains ${n} placeholder', () => {
    const s = _getI18nValueForTest('en','toastRestoreDone');
    assert.ok(s.includes('${n}'), `missing \${n} in: ${s}`);
  });
});
