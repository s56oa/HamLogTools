'use strict';
// Run: node --test edi2adif.test.js
//      node --test --test-reporter=spec edi2adif.test.js

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const vm   = require('node:vm');
const path = require('node:path');

// ─────────────────────────────────────────────────────────────────────────────
//  Sandbox setup
//  The app script runs in a vm context with a minimal DOM mock.
//
//  NOTE: Objects returned by functions running inside a vm context have a
//  different Object.prototype than host objects. This means assert.deepEqual
//  (deepStrictEqual) fails on them even when properties look identical.
//  All comparisons therefore use assert.equal on individual properties.
// ─────────────────────────────────────────────────────────────────────────────

const html = fs.readFileSync(path.join(__dirname, 'edi2adif.html'), 'utf-8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('No <script> block found in edi2adif.html');
const scriptSrc = scriptMatch[1];

function makeEl() {
  return {
    addEventListener : () => {},
    classList        : { add: () => {}, remove: () => {}, toggle: () => {} },
    style            : { display: 'none' },
    textContent      : '',
    innerHTML        : '',
    value            : '',
    checked          : false,
    dataset          : {},
    options          : { length: 1 },
    remove           : () => {},
    add              : () => {},
    click            : () => {},
    href             : '',
    download         : '',
  };
}

const ctx = vm.createContext({
  document: {
    getElementById  : () => makeEl(),
    querySelector   : () => makeEl(),
    querySelectorAll: () => ({ forEach: () => {} }),
    addEventListener: () => {},
    createElement   : () => makeEl(),
  },
  URL        : { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
  Blob       : class Blob       { constructor(parts) { this.parts = parts; } },
  Option     : class Option     { constructor(t, v) { this.text = t; this.value = v; } },
  FileReader : class FileReader { readAsText() {} },
  localStorage: { _store: {}, getItem(k){ return this._store[k]??null; }, setItem(k,v){ this._store[k]=v; } },
  setTimeout : () => {},
  clearTimeout: () => {},
  console,
  Array, Set, Map, Math, Date,
  parseInt, parseFloat, String, Number, Boolean, RegExp, isNaN, isFinite,
});

vm.runInContext(scriptSrc, ctx);

// Function declarations are promoted to the vm context object.
// let/const are lexical and not on ctx, but remain accessible inside closures.
const { normBand, parseEDI, adifField, csvEsc, t, setLang, modeBadge } = ctx;

// ─────────────────────────────────────────────────────────────────────────────
//  Fixtures
// ─────────────────────────────────────────────────────────────────────────────

// Realistic multi-QSO EDI log.
// Expected valid QSOs (ERROR and the short record are skipped):
//   [0] S57Q  – SSB, valid locator JN76EF, not dupe
//   [1] S56M  – CW,  valid locator JN86AO, not dupe
//   [2] S58Z  – FM,  invalid locator JN75 (4 chars) → wwl=''
//   [3] S59DGO – SSB, EDI dupe flag (col 13 = 'D')
//   [4] S57A  – date 980102 → 1998 (YY≥80), invalid locator JN86
//   [5] S57B  – date 000704 → 2000 (YY<80)
const SAMPLE_EDI = `
[REG1TEST;1]
TName=VHF UHF Contest
PCall=S59ABC
PWWLo=JN76AB
PBand=144 MHz
SPowe=100
SAnte=9el Yagi
STXEq=IC-9700
SRXEq=IC-9700
MOpe1=S59ABC
MOpe2=S59XYZ
[QSORecords;8]
230902;1432;s57q;1;59;001;59;001;;JN76EF;100;;;
230902;1445;S56M;2;599;002;599;002;;JN86AO;150;;;
230902;1450;S58Z;3;59;003;59;003;;JN75;80;;;
230902;1455;S59DGO;1;59;004;59;004;;JN86AO;120;;;D
230902;1500;ERROR;1;59;005;59;005;;JN76AB;50;;;
230902;1505;bad
980102;0815;S57A;1;59;006;59;006;;JN86;75;;;
000704;2100;S57B;1;55;007;55;007;;JN76AB;0;;;
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
//  1. normBand — band detection from EDI PBand strings
// ─────────────────────────────────────────────────────────────────────────────

describe('normBand', () => {

  describe('empty / unknown input', () => {
    it('empty string  → band:"", freq:""', () => {
      const r = normBand('');
      assert.equal(r.band, '');
      assert.equal(r.freq, '');
    });
    it('null → band:"", freq:""', () => {
      const r = normBand(null);
      assert.equal(r.band, '');
      assert.equal(r.freq, '');
    });
    it('unrecognised string → passthrough, no freq', () => {
      const r = normBand('UNKNOWN');
      assert.equal(r.band, 'UNKNOWN');
      assert.equal(r.freq, '');
    });
    it('leading/trailing whitespace stripped before match', () => {
      assert.equal(normBand('  2m  ').band, '2m');
    });
  });

  describe('6 m (50 MHz)', () => {
    it('50 MHz', () => { assert.equal(normBand('50 MHz').band, '6m');   assert.equal(normBand('50 MHz').freq, 50.2); });
    it('50MHz',  () => { assert.equal(normBand('50MHz').band, '6m');    assert.equal(normBand('50MHz').freq, 50.2); });
    it('6m',     () => { assert.equal(normBand('6m').band, '6m');       assert.equal(normBand('6m').freq, 50.2); });
  });

  describe('2 m (144 MHz)', () => {
    it('144 MHz', () => { assert.equal(normBand('144 MHz').band, '2m'); assert.equal(normBand('144 MHz').freq, 144.3); });
    it('145',     () => { assert.equal(normBand('145').band, '2m');     assert.equal(normBand('145').freq, 144.3); });
    it('2m',      () => { assert.equal(normBand('2m').band, '2m');      assert.equal(normBand('2m').freq, 144.3); });
  });

  describe('70 cm (432 MHz)', () => {
    it('432 MHz', () => { assert.equal(normBand('432 MHz').band, '70cm'); assert.equal(normBand('432 MHz').freq, 432.2); });
    it('430',     () => { assert.equal(normBand('430').band, '70cm');     assert.equal(normBand('430').freq, 432.2); });
    it('70 cm',   () => { assert.equal(normBand('70 cm').band, '70cm');   assert.equal(normBand('70 cm').freq, 432.2); });
  });

  describe('23 cm (1296 MHz)', () => {
    it('1296',    () => { assert.equal(normBand('1296').band, '23cm');    assert.equal(normBand('1296').freq, 1296.1); });
    it('1.2 GHz', () => { assert.equal(normBand('1.2 GHz').band, '23cm'); assert.equal(normBand('1.2 GHz').freq, 1296.1); });
    it('1,3 GHz', () => { assert.equal(normBand('1,3 GHz').band, '23cm'); assert.equal(normBand('1,3 GHz').freq, 1296.1); });
    it('23 cm',   () => { assert.equal(normBand('23 cm').band, '23cm');   assert.equal(normBand('23 cm').freq, 1296.1); });
  });

  describe('microwave bands (band name only)', () => {
    it('2320  → 13cm',    () => assert.equal(normBand('2320').band,   '13cm'));
    it('3400  → 9cm',     () => assert.equal(normBand('3400').band,   '9cm'));
    it('5760  → 6cm',     () => assert.equal(normBand('5760').band,   '6cm'));
    it('10 GHz → 3cm',    () => assert.equal(normBand('10 GHz').band, '3cm'));
    it('10368 → 3cm',     () => assert.equal(normBand('10368').band,  '3cm'));
    it('24 GHz → 1.25cm', () => assert.equal(normBand('24 GHz').band, '1.25cm'));
    it('24048 → 1.25cm',  () => assert.equal(normBand('24048').band,  '1.25cm'));
    it('47 GHz → 6mm',    () => assert.equal(normBand('47 GHz').band, '6mm'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  2. parseEDI — log parsing
//
//  parseEDI returns { header, band, freq, qsos }.
//  QSOs contain only fields parsed from the record line itself.
//  Header-derived fields (myCall, myLoc, contest, pwr, ant, ops, txeq, rxeq)
//  are added later by handleFiles() which requires async FileReader —
//  not accessible in a vm unit-test context. Those fields are tested via
//  the returned header object.
// ─────────────────────────────────────────────────────────────────────────────

describe('parseEDI', () => {

  let result;
  before(() => {
    result = parseEDI(SAMPLE_EDI, 'test.edi');
  });

  describe('header extraction', () => {
    it('band resolved from PBand=144 MHz',    () => assert.equal(result.band, '2m'));
    it('raw header has pcall (lowercased key)',() => assert.equal(result.header['pcall'], 'S59ABC'));
    it('raw header has pwwlo',                () => assert.equal(result.header['pwwlo'], 'JN76AB'));
    it('raw header has tname',                () => assert.equal(result.header['tname'], 'VHF UHF Contest'));
    it('raw header has spowe',                () => assert.equal(result.header['spowe'], '100'));
    it('raw header has mope1 and mope2',      () => {
      assert.equal(result.header['mope1'], 'S59ABC');
      assert.equal(result.header['mope2'], 'S59XYZ');
    });
  });

  describe('QSO count (skips ERROR + short records)', () => {
    it('parses 6 valid QSOs out of 8 lines', () => assert.equal(result.qsos.length, 6));
  });

  describe('callsign normalisation', () => {
    it('lowercased callsign is uppercased', () => assert.equal(result.qsos[0].call, 'S57Q'));
  });

  describe('mode mapping (EDI numeric → string)', () => {
    it('mode 1 → SSB', () => assert.equal(result.qsos[0].mode, 'SSB'));
    it('mode 2 → CW',  () => assert.equal(result.qsos[1].mode, 'CW'));
    it('mode 3 → CW',  () => assert.equal(result.qsos[2].mode, 'CW'));
  });

  describe('date parsing', () => {
    it('YYYYMMDD stored correctly',            () => assert.equal(result.qsos[0].date,     '20230902'));
    it('display date as DD.MM.YYYY',           () => assert.equal(result.qsos[0].dateDisp, '02.09.2023'));
    it('YY≥80 → 1900+YY  (980102 → 1998)',    () => assert.equal(result.qsos[4].date,     '19980102'));
    it('YY<80 → 2000+YY  (000704 → 2000)',    () => assert.equal(result.qsos[5].date,     '20000704'));
    it('YY=80 → 1980 (cutoff inclusive)',      () => {
      const edi = `[REG1TEST;1]\nPBand=144 MHz\n[QSORecords;1]\n800615;1200;S57X;1;59;001;59;001;;JN76ef;100;;;;\n`;
      assert.equal(parseEDI(edi, 't.edi').qsos[0].date, '19800615');
    });
    it('YY=79 → 2079 (below cutoff)',          () => {
      const edi = `[REG1TEST;1]\nPBand=144 MHz\n[QSORecords;1]\n790615;1200;S57X;1;59;001;59;001;;JN76ef;100;;;;\n`;
      assert.equal(parseEDI(edi, 't.edi').qsos[0].date, '20790615');
    });
  });

  describe('time parsing', () => {
    it('HHMM stored',           () => assert.equal(result.qsos[0].time,     '1432'));
    it('display time as HH:MM', () => assert.equal(result.qsos[0].timeDisp, '14:32'));
  });

  describe('RST and exchange fields', () => {
    it('rstS parsed',  () => assert.equal(result.qsos[0].rstS, '59'));
    it('rstR parsed',  () => assert.equal(result.qsos[0].rstR, '59'));
    it('stx parsed',   () => assert.equal(result.qsos[0].stx,  '001'));
    it('srx parsed',   () => assert.equal(result.qsos[0].srx,  '001'));
  });

  describe('Maidenhead locator validation', () => {
    it('valid 6-char locator kept (mixed case)',  () => assert.equal(result.qsos[0].wwl, 'JN76ef'));
    it('4-char locator rejected → empty',  () => assert.equal(result.qsos[2].wwl, ''));
    it('4-char locator (S57A) rejected',   () => assert.equal(result.qsos[4].wwl, ''));
  });

  describe('distance', () => {
    it('dist parsed as integer',  () => assert.equal(result.qsos[0].dist, 100));
    it('zero distance kept',      () => assert.equal(result.qsos[5].dist, 0));
  });

  describe('duplicate flag', () => {
    it('EDI dupe flag (col 13 = "D") → dupe=true',  () => assert.equal(result.qsos[3].dupe, true));
    it('normal record → dupe=false',                  () => assert.equal(result.qsos[0].dupe, false));
  });

  describe('key generation', () => {
    it('_key is CALL|YYYYMMDD|HHMM',                    () => assert.equal(result.qsos[0]._key, 'S57Q|20230902|1432'));
    it('_key does not contain band (added by handleFiles)', () => assert.ok(!result.qsos[0]._key.includes('2m')));
  });

  describe('source tracking', () => {
    it('src filename attached to every QSO', () => assert.equal(result.qsos[0].src, 'test.edi'));
  });

  describe('edge cases', () => {
    it('empty input → 0 QSOs', () => {
      assert.equal(parseEDI('', 'empty.edi').qsos.length, 0);
    });
    it('record with < 10 fields is skipped', () => {
      const edi = '[REG1TEST;1]\nPBand=2m\n[QSORecords;1]\n230902;1432;S57Q';
      assert.equal(parseEDI(edi, 'short.edi').qsos.length, 0);
    });
    it('CRLF line endings parsed correctly', () => {
      const edi = '[REG1TEST;1]\r\nPBand=144\r\n[QSORecords;1]\r\n230902;1432;S57Q;1;59;001;59;001;;JN76EF;100;;;';
      const r = parseEDI(edi, 'crlf.edi');
      assert.equal(r.qsos.length, 1);
      assert.equal(r.qsos[0].call, 'S57Q');
    });
    it('record with exactly 10 fields (minimum) is accepted', () => {
      const edi = '[REG1TEST;1]\nPBand=144\n[QSORecords;1]\n230902;1432;S57Q;1;59;001;59;001;;JN76EF;100';
      assert.equal(parseEDI(edi, 'min.edi').qsos.length, 1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. adifField — ADIF field serialisation
// ─────────────────────────────────────────────────────────────────────────────

describe('adifField', () => {

  it('formats string value correctly',       () => assert.equal(adifField('CALL',     'S59ABC'),   '<CALL:6>S59ABC '));
  it('formats short string',                 () => assert.equal(adifField('BAND',     '2m'),       '<BAND:2>2m '));
  it('formats 8-char date',                  () => assert.equal(adifField('QSO_DATE', '20230902'), '<QSO_DATE:8>20230902 '));
  it('converts tag name to uppercase',       () => assert.equal(adifField('call',     'S59ABC'),   '<CALL:6>S59ABC '));
  it('accepts numeric value',                () => assert.equal(adifField('DISTANCE', 123),        '<DISTANCE:3>123 '));
  it('zero is serialised (not skipped)',      () => assert.equal(adifField('TX_PWR',   0),          '<TX_PWR:1>0 '));
  it('empty string → returns empty string',  () => assert.equal(adifField('TAG', ''),              ''));
  it('null        → returns empty string',   () => assert.equal(adifField('TAG', null),            ''));
  it('undefined   → returns empty string',   () => assert.equal(adifField('TAG', undefined),       ''));
  it('length field matches actual string length', () => {
    const out = adifField('GRIDSQUARE', 'JN76EF');
    assert.match(out, /^<GRIDSQUARE:6>/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  4. csvEsc — CSV field escaping
// ─────────────────────────────────────────────────────────────────────────────

describe('csvEsc', () => {

  it('plain string returned as-is',                () => assert.equal(csvEsc('S59ABC'),     'S59ABC'));
  it('string with comma wrapped in quotes',         () => assert.equal(csvEsc('a,b'),        '"a,b"'));
  it('string with double-quote has quotes doubled', () => assert.equal(csvEsc('say "hi"'),   '"say ""hi"""'));
  it('comma + quote combined',                      () => assert.equal(csvEsc('a,b"c'),      '"a,b""c"'));
  it('empty string → empty string',                 () => assert.equal(csvEsc(''),           ''));
  it('null      → empty string',                    () => assert.equal(csvEsc(null),         ''));
  it('undefined → empty string',                    () => assert.equal(csvEsc(undefined),    ''));
  it('number coerced to string',                    () => assert.equal(csvEsc(144),          '144'));
  it('string with newline is wrapped in quotes',     () => assert.equal(csvEsc('a\nb'),       '"a\nb"'));
  it('string with carriage return is wrapped',       () => assert.equal(csvEsc('a\rb'),       '"a\rb"'));
  it('newline + comma combined',                     () => assert.equal(csvEsc('a,\nb'),      '"a,\nb"'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  5. modeBadge — mode → CSS class mapping (badge classes for UI rendering)
// ─────────────────────────────────────────────────────────────────────────────

describe('modeBadge', () => {
  it('SSB → badge-ssb',  () => assert.equal(modeBadge('SSB'),  'badge-ssb'));
  it('AM  → badge-ssb',  () => assert.equal(modeBadge('AM'),   'badge-ssb'));
  it('CW  → badge-cw',   () => assert.equal(modeBadge('CW'),   'badge-cw'));
  it('FM  → badge-fm',   () => assert.equal(modeBadge('FM'),   'badge-fm'));
  it('RTTY → badge-digi',() => assert.equal(modeBadge('RTTY'), 'badge-digi'));
  it('SSTV → badge-digi',() => assert.equal(modeBadge('SSTV'), 'badge-digi'));
  it('ATV  → badge-digi',() => assert.equal(modeBadge('ATV'),  'badge-digi'));
  it('unknown mode → badge-digi fallback', () => assert.equal(modeBadge('PSK'), 'badge-digi'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  6. i18n — translation lookup
// ─────────────────────────────────────────────────────────────────────────────

describe('i18n (t / setLang)', () => {

  it('default language is Slovenian',       () => assert.equal(t('dropTitle'), 'Naloži EDI dnevnike'));
  it('known SL key returns SL string',      () => assert.equal(t('dropBtn'),   'Izberi datoteke'));
  it('unknown key returns the key itself',  () => assert.equal(t('__no_such_key__'), '__no_such_key__'));

  it('setLang("en") switches translations', () => {
    setLang('en');
    assert.equal(t('dropTitle'), 'Load EDI Logs');
    assert.equal(t('dropBtn'),   'Choose files');
    setLang('sl'); // restore
  });

  it('restored to SL after setLang("sl")', () => {
    assert.equal(t('dropTitle'), 'Naloži EDI dnevnike');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  7. Duplicate detection algorithm
// ─────────────────────────────────────────────────────────────────────────────

function runDedup(qsos) {
  const seen = new Set();
  qsos.forEach(q => {
    if (seen.has(q._bandKey)) q.dupe = true;
    else seen.add(q._bandKey);
  });
  return qsos;
}

function makeQso(call, date, time, band, dupe = false) {
  const _key     = `${call}|${date}|${time}`;
  const _bandKey = `${_key}|${band}`;
  return { call, date, time, band, dupe, _key, _bandKey };
}

describe('duplicate detection', () => {

  it('no duplicates → all dupe=false', () => {
    const qsos = runDedup([
      makeQso('S57Q', '20230902', '1432', '2m'),
      makeQso('S56M', '20230902', '1445', '2m'),
    ]);
    assert.ok(!qsos[0].dupe);
    assert.ok(!qsos[1].dupe);
  });

  it('same call+date+time+band: second entry marked as dupe', () => {
    const qsos = runDedup([
      makeQso('S57Q', '20230902', '1432', '2m'),
      makeQso('S57Q', '20230902', '1432', '2m'),
    ]);
    assert.ok(!qsos[0].dupe, 'first occurrence kept');
    assert.ok( qsos[1].dupe, 'second occurrence flagged');
  });

  it('three identical entries: first kept, rest marked as dup', () => {
    const qsos = runDedup([
      makeQso('S57Q', '20230902', '1432', '2m'),
      makeQso('S57Q', '20230902', '1432', '2m'),
      makeQso('S57Q', '20230902', '1432', '2m'),
    ]);
    assert.ok(!qsos[0].dupe);
    assert.ok( qsos[1].dupe);
    assert.ok( qsos[2].dupe);
  });

  it('same call+time but different band → not a duplicate', () => {
    const qsos = runDedup([
      makeQso('S57Q', '20230902', '1432', '2m'),
      makeQso('S57Q', '20230902', '1432', '70cm'),
    ]);
    assert.ok(!qsos[0].dupe);
    assert.ok(!qsos[1].dupe);
  });

  it('EDI-pre-flagged dupe is preserved; cross-file second also marked', () => {
    const qsos = runDedup([
      makeQso('S57Q', '20230902', '1432', '2m', false),
      makeQso('S57Q', '20230902', '1432', '2m', true),  // already dupe=true from EDI
    ]);
    assert.ok(!qsos[0].dupe, 'first entry kept even though second had EDI dupe flag');
    assert.ok( qsos[1].dupe);
  });

  it('mix of unique and duplicate entries', () => {
    const qsos = runDedup([
      makeQso('S57Q', '20230902', '1432', '2m'),    // unique
      makeQso('S56M', '20230902', '1445', '2m'),    // unique
      makeQso('S57Q', '20230902', '1432', '2m'),    // dup of [0]
      makeQso('S56M', '20230902', '1445', '70cm'),  // unique – different band
    ]);
    assert.ok(!qsos[0].dupe);
    assert.ok(!qsos[1].dupe);
    assert.ok( qsos[2].dupe);
    assert.ok(!qsos[3].dupe);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  8. CSV export row generation
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors the row-building code inside exportCSV()
function buildCsvRow(q, rowNum) {
  return [
    rowNum, q.dateDisp, q.timeDisp, q.call, q.band, q.mode,
    q.rstS, q.rstR,
    q.stx ? q.stx.replace(/^0+/, '') : '',
    q.srx ? q.srx.replace(/^0+/, '') : '',
    q.exch  || '', q.wwl   || '', q.dist  || '',
    q.myCall|| '', q.myLoc || '', q.pwr   || '',
    q.contest|| '', q.ops  || '', q.src,
  ].map(csvEsc).join(',');
}

const CSV_HEADER = '#,Date,Time,Callsign,Band,Mode,RST Sent,RST Rcvd,Ser Sent,Ser Rcvd,Exchange,Locator,Distance (km),My Callsign,My Locator,Power (W),Contest,Operators,Source File';

describe('CSV export row format', () => {

  const sampleQso = {
    dateDisp: '02.09.2023', timeDisp: '14:32', call: 'S57Q',
    band: '2m', mode: 'SSB', rstS: '59', rstR: '59',
    stx: '001', srx: '001', exch: '', wwl: 'JN76EF', dist: 100,
    myCall: 'S59ABC', myLoc: 'JN76AB', pwr: '100',
    contest: 'VHF Contest', ops: 'S59ABC', src: 'test.edi',
  };

  it('header has 19 comma-separated columns', () => {
    assert.equal(CSV_HEADER.split(',').length, 19);
  });

  it('row has same number of columns as header', () => {
    const row = buildCsvRow(sampleQso, 1);
    assert.equal(row.split(',').length, 19);
  });

  it('row number is first column', () => {
    const row = buildCsvRow(sampleQso, 7);
    assert.ok(row.startsWith('7,'));
  });

  it('serial numbers have leading zeros stripped', () => {
    const q = { ...sampleQso, stx: '007', srx: '042' };
    const row = buildCsvRow(q, 1);
    const cols = row.split(',');
    assert.equal(cols[8], '7');
    assert.equal(cols[9], '42');
  });

  it('serial number "001" → "1"', () => {
    const q = { ...sampleQso, stx: '001', srx: '001' };
    const row = buildCsvRow(q, 1);
    const cols = row.split(',');
    assert.equal(cols[8], '1');
    assert.equal(cols[9], '1');
  });

  it('missing optional fields become empty columns', () => {
    const q = {
      ...sampleQso,
      exch: undefined, wwl: '', dist: 0,
      myCall: '', myLoc: '', pwr: '',
      contest: '', ops: '',
    };
    const row = buildCsvRow(q, 1);
    const cols = row.split(',');
    assert.equal(cols[10], '');   // exchange
    assert.equal(cols[11], '');   // locator
    assert.equal(cols[14], '');   // my locator
    assert.equal(cols[15], '');   // power
  });

  it('callsign with comma in contest name is quoted', () => {
    const q = { ...sampleQso, contest: 'VHF, UHF Contest' };
    const row = buildCsvRow(q, 1);
    assert.ok(row.includes('"VHF, UHF Contest"'));
  });

  it('distance 0 becomes empty (falsy branch)', () => {
    const q = { ...sampleQso, dist: 0 };
    const row = buildCsvRow(q, 1);
    const cols = row.split(',');
    assert.equal(cols[12], '');
  });

  it('distance > 0 kept as-is', () => {
    const q = { ...sampleQso, dist: 100 };
    const row = buildCsvRow(q, 1);
    const cols = row.split(',');
    assert.equal(cols[12], '100');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  9. Inline edit — field validation and mutation
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors the save logic inside commitEdit()
function applyEdit(qso, field, rawValue) {
  const v = rawValue.trim();
  if (field === 'wwl') {
    const uc = v.toUpperCase();
    if (/^[A-R]{2}[0-9]{2}[A-X]{2}$/i.test(uc)) {
      qso.wwl = uc.slice(0, 4) + uc.slice(4).toLowerCase(); // JN76ef convention
    } else { qso.wwl = ''; }
  } else {
    qso[field] = v;
  }
}

describe('inline edit — field mutation', () => {

  it('rstS value is saved as-is (trimmed)', () => {
    const q = { rstS: '59', rstR: '59', mode: 'SSB', wwl: 'JN76EF' };
    applyEdit(q, 'rstS', ' 599 ');
    assert.equal(q.rstS, '599');
  });

  it('rstR value is saved as-is (trimmed)', () => {
    const q = { rstS: '59', rstR: '59', mode: 'SSB', wwl: 'JN76EF' };
    applyEdit(q, 'rstR', '55 ');
    assert.equal(q.rstR, '55');
  });

  it('mode value is saved as-is', () => {
    const q = { rstS: '59', rstR: '59', mode: 'SSB', wwl: 'JN76EF' };
    applyEdit(q, 'mode', 'CW');
    assert.equal(q.mode, 'CW');
  });

  describe('locator validation', () => {
    it('valid 6-char locator saved as mixed case (JN76ef)', () => {
      const q = { wwl: '' };
      applyEdit(q, 'wwl', 'jn76ef');
      assert.equal(q.wwl, 'JN76ef');
    });
    it('valid locator input uppercased then subsquare lowercased', () => {
      const q = { wwl: '' };
      applyEdit(q, 'wwl', 'Jn86Ao');
      assert.equal(q.wwl, 'JN86ao');
    });
    it('4-char locator rejected → wwl cleared', () => {
      const q = { wwl: 'JN76EF' };
      applyEdit(q, 'wwl', 'JN76');
      assert.equal(q.wwl, '');
    });
    it('empty string rejected → wwl cleared', () => {
      const q = { wwl: 'JN76EF' };
      applyEdit(q, 'wwl', '');
      assert.equal(q.wwl, '');
    });
    it('8-char locator rejected → wwl cleared', () => {
      const q = { wwl: 'JN76EF' };
      applyEdit(q, 'wwl', 'JN76EFGH');
      assert.equal(q.wwl, '');
    });
    it('locator with invalid characters rejected', () => {
      const q = { wwl: 'JN76EF' };
      applyEdit(q, 'wwl', 'XX99ZZ');  // Z not valid in subsquare (A-X only)
      assert.equal(q.wwl, '');
    });
    it('locator A..R range: first two chars must be A-R', () => {
      const q = { wwl: '' };
      applyEdit(q, 'wwl', 'SA76EF');  // S is out of A-R range
      assert.equal(q.wwl, '');
    });
    it('digits in positions 3-4 required', () => {
      const q = { wwl: '' };
      applyEdit(q, 'wwl', 'JNABEF');  // non-digits in position 3-4
      assert.equal(q.wwl, '');
    });
  });
});
