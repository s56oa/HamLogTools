'use strict';
/**
 * adif-merge.test.js
 *
 * Unit tests for ADIF Merge tool.
 * Run: node --test --test-reporter=spec adif-merge.test.js
 */

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const vm   = require('node:vm');

// ─── Extract JS from <script>…</script> ──────────────────────────────────────
const src = fs.readFileSync(path.join(__dirname, 'adif-merge.html'), 'utf-8');
const jsMatch = src.match(/<script>([\s\S]*?)<\/script>/);
if(!jsMatch) throw new Error('No <script> block found in adif-merge.html');
const jsSrc = jsMatch[1];

// ─── DOM mock ────────────────────────────────────────────────────────────────
const mockEl = new Proxy({}, {
  get(t, k) {
    if(k === 'style')     return { display:'', color:'' };
    if(k === 'classList') return { add:()=>{}, remove:()=>{}, contains:()=>false, toggle:()=>{} };
    if(typeof k === 'symbol') return undefined;
    const scalars = ['textContent','innerHTML','disabled','className','value','checked','selectedIndex'];
    if(scalars.includes(k)) return '';
    if(k === 'querySelectorAll' || k === 'querySelector') return ()=>[];
    if(k === 'addEventListener') return ()=>{};
    if(k === 'options') return { length:1 };
    if(k === 'remove') return ()=>{};
    if(k === 'add')    return ()=>{};
    return () => mockEl;
  },
  set() { return true; },
});

const ctx = vm.createContext({
  console: { log:()=>{}, error:()=>{}, warn:()=>{} },
  require, fs, path,
  process: { argv:[], exit:()=>{}, env:{} },
  Buffer, Date, JSON, Math, String, Number, RegExp, Set, Map, Array, Object, Error,
  parseInt, parseFloat, isNaN, isFinite,
  clearTimeout, setTimeout:()=>0,
  fetch: async ()=>({ ok:false }),
  URL: { createObjectURL:()=>'', revokeObjectURL:()=>{} },
  Blob: class Blob{ constructor(parts,opts){ this._parts=parts; this.type=(opts||{}).type||''; } },
  localStorage: { getItem:()=>null, setItem:()=>{} },
  document: {
    getElementById:   ()=> mockEl,
    documentElement:  { dataset:{}, getAttribute:()=>'', setAttribute:()=>{} },
    querySelectorAll: ()=> [],
    querySelector:    ()=> mockEl,
    createElement:    ()=> mockEl,
    addEventListener: ()=>{},
  },
});

vm.runInContext(jsSrc, ctx);

// ─── Inject test helpers ──────────────────────────────────────────────────────
vm.runInContext(`
  function _getAllForTest()          { return _all; }
  function _setAllForTest(arr)       { _all.length=0; _all.push(...arr); }
  function _getFilteredForTest()    { return _filtered; }
  function _setFilteredForTest(arr)  { _filtered.length=0; _filtered.push(...arr); }
  function _getDeselForTest()       { return _desel; }
  function _getSourcesForTest()     { return _sources; }
  function _setSourcesForTest(arr)   { _sources.length=0; _sources.push(...arr); }
  function _getI18nForTest(lang,key){ return (S[lang]||{})[key]; }
  function _getLangKeys(lang)        { return Object.keys(S[lang]||{}); }
`, ctx);

const {
  parseADIF, htmlEsc, csvEsc, modeBadge, adifField, buildFilename,
  recomputeDupes, updateKey,
  _getAllForTest, _setAllForTest,
  _getFilteredForTest, _setFilteredForTest,
  _getDeselForTest,
  _getSourcesForTest, _setSourcesForTest,
  _getI18nForTest, _getLangKeys,
} = ctx;

// ─── Minimal ADIF helpers ─────────────────────────────────────────────────────
function adif(fields, withEoh = true) {
  const hdr = withEoh ? 'test log\n<EOH>\n' : '';
  let rec = '';
  for(const [tag, val] of Object.entries(fields))
    rec += `<${tag}:${String(val).length}>${val} `;
  return hdr + rec + '<EOR>';
}

// ═════════════════════════════════════════════════════════════════════════════
//  parseADIF — basic field extraction
// ═════════════════════════════════════════════════════════════════════════════

describe('parseADIF — basic extraction', () => {
  it('parses a minimal QSO', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB' });
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos.length, 1);
    assert.equal(qsos[0].call, 'DK1A');
    assert.equal(qsos[0].date, '20230610');
    assert.equal(qsos[0].time, '1200');
    assert.equal(qsos[0].band, '2m');
    assert.equal(qsos[0].mode, 'SSB');
  });

  it('normalizes CALL to uppercase', () => {
    const txt = adif({ CALL:'dk1a', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB' });
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos[0].call, 'DK1A');
  });

  it('normalizes BAND to lowercase', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2M', MODE:'SSB' });
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos[0].band, '2m');
  });

  it('normalizes MODE to uppercase', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'ft8' });
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos[0].mode, 'FT8');
  });

  it('extracts RST_SENT and RST_RCVD', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB',
                       RST_SENT:'59', RST_RCVD:'57' });
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos[0].rstS, '59');
    assert.equal(qsos[0].rstR, '57');
  });

  it('extracts GRIDSQUARE', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB',
                       GRIDSQUARE:'JN65ar' });
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos[0].grid, 'JN65ar');
  });

  it('preserves all fields in fields dict', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB',
                       COMMENT:'test comment', TX_PWR:'100' });
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos[0].fields.COMMENT, 'test comment');
    assert.equal(qsos[0].fields.TX_PWR,  '100');
  });

  it('sets src field to filename', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB' });
    const qsos = parseADIF(txt, 'mylog.adi');
    assert.equal(qsos[0].src, 'mylog.adi');
  });

  it('skips records without CALL', () => {
    const noCall = 'test\n<EOH>\n<QSO_DATE:8>20230610 <TIME_ON:4>1200 <EOR>\n'
                 + '<CALL:4>DK1A <QSO_DATE:8>20230610 <TIME_ON:4>1300 <BAND:2>2m <MODE:3>SSB <EOR>';
    const qsos = parseADIF(noCall, 'test.adi');
    assert.equal(qsos.length, 1);
    assert.equal(qsos[0].call, 'DK1A');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  parseADIF — date / time normalization
// ═════════════════════════════════════════════════════════════════════════════

describe('parseADIF — date/time normalization', () => {
  it('YYYYMMDD date stored as-is', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB' });
    assert.equal(parseADIF(txt,'f')[0].date, '20230610');
  });

  it('ISO date YYYY-MM-DD stripped of dashes', () => {
    const raw = 'log\n<EOH>\n<CALL:4>DK1A <QSO_DATE:10>2023-06-10 <TIME_ON:4>1200 <BAND:2>2m <MODE:3>SSB <EOR>';
    assert.equal(parseADIF(raw,'f')[0].date, '20230610');
  });

  it('date stored normalized in fields dict', () => {
    const raw = 'log\n<EOH>\n<CALL:4>DK1A <QSO_DATE:10>2023-06-10 <TIME_ON:4>1200 <BAND:2>2m <MODE:3>SSB <EOR>';
    assert.equal(parseADIF(raw,'f')[0].fields.QSO_DATE, '20230610');
  });

  it('HHMMSS time truncated to HHMM for dedup', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'120030', BAND:'2m', MODE:'SSB' });
    assert.equal(parseADIF(txt,'f')[0].time, '1200');
  });

  it('HH:MM:SS time stripped of colons, truncated to HHMM', () => {
    const raw = 'log\n<EOH>\n<CALL:4>DK1A <QSO_DATE:8>20230610 <TIME_ON:8>12:00:30 <BAND:2>2m <MODE:3>SSB <EOR>';
    assert.equal(parseADIF(raw,'f')[0].time, '1200');
  });

  it('date display formatted as DD.MM.YYYY', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB' });
    assert.equal(parseADIF(txt,'f')[0].dateDisp, '10.06.2023');
  });

  it('time display formatted as HH:MM', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1234', BAND:'2m', MODE:'SSB' });
    assert.equal(parseADIF(txt,'f')[0].timeDisp, '12:34');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  parseADIF — multi-record and edge cases
// ═════════════════════════════════════════════════════════════════════════════

describe('parseADIF — multi-record / edge cases', () => {
  it('parses multiple QSOs in one file', () => {
    const txt = 'log\n<EOH>\n'
      + '<CALL:4>DK1A <QSO_DATE:8>20230610 <TIME_ON:4>1200 <BAND:2>2m <MODE:3>SSB <EOR>\n'
      + '<CALL:4>OE3X <QSO_DATE:8>20230610 <TIME_ON:4>1300 <BAND:2>2m <MODE:2>CW <EOR>';
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos.length, 2);
    assert.equal(qsos[0].call, 'DK1A');
    assert.equal(qsos[1].call, 'OE3X');
    assert.equal(qsos[1].mode, 'CW');
  });

  it('works without <EOH> (headerless file)', () => {
    const txt = '<CALL:4>DK1A <QSO_DATE:8>20230610 <TIME_ON:4>1200 <BAND:2>2m <MODE:3>SSB <EOR>';
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos.length, 1);
    assert.equal(qsos[0].call, 'DK1A');
  });

  it('skips empty records between EORs', () => {
    const txt = 'log\n<EOH>\n<EOR>\n<CALL:4>DK1A <QSO_DATE:8>20230610 <TIME_ON:4>1200 <BAND:2>2m <MODE:3>SSB <EOR>';
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos.length, 1);
  });

  it('case-insensitive tag names', () => {
    const txt = 'log\n<EOH>\n<call:4>DK1A <qso_date:8>20230610 <time_on:4>1200 <band:2>2m <mode:3>SSB <eor>';
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos.length, 1);
    assert.equal(qsos[0].call, 'DK1A');
  });

  it('CRLF line endings handled', () => {
    const txt = 'log\r\n<EOH>\r\n<CALL:4>DK1A <QSO_DATE:8>20230610 <TIME_ON:4>1200 <BAND:2>2m <MODE:3>SSB <EOR>';
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos.length, 1);
  });

  it('fields stored in dict with uppercase keys', () => {
    const txt = adif({ call:'DK1A', qso_date:'20230610', time_on:'1200', band:'2m', mode:'SSB' });
    const qsos = parseADIF(txt, 'test.adi');
    assert.ok('CALL'     in qsos[0].fields);
    assert.ok('QSO_DATE' in qsos[0].fields);
    assert.ok('TIME_ON'  in qsos[0].fields);
  });

  it('APP_ tags preserved in fields', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB',
                       APP_FOO_BAR:'test123' });
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos[0].fields.APP_FOO_BAR, 'test123');
  });

  it('type specifier <TAG:len:type> handled', () => {
    const raw = 'log\n<EOH>\n<CALL:4:S>DK1A <QSO_DATE:8:D>20230610 <TIME_ON:4:T>1200 <BAND:2>2m <MODE:3>SSB <EOR>';
    const qsos = parseADIF(raw, 'test.adi');
    assert.equal(qsos.length, 1);
    assert.equal(qsos[0].call, 'DK1A');
  });

  it('empty string file returns no QSOs', () => {
    assert.equal(parseADIF('', 'empty.adi').length, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  parseADIF — fields dict normalization for export
// ═════════════════════════════════════════════════════════════════════════════

describe('parseADIF — fields dict kept in sync', () => {
  it('CALL in fields dict is uppercase trimmed', () => {
    const txt = adif({ CALL:' dk1a ', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB' });
    const q = parseADIF(txt,'f')[0];
    assert.equal(q.fields.CALL, 'DK1A');
  });

  it('BAND in fields dict is lowercase', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2M', MODE:'SSB' });
    const q = parseADIF(txt,'f')[0];
    assert.equal(q.fields.BAND, '2m');
  });

  it('MODE in fields dict is uppercase', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'ft8' });
    const q = parseADIF(txt,'f')[0];
    assert.equal(q.fields.MODE, 'FT8');
  });

  it('QSO_DATE normalized in fields dict', () => {
    const raw = 'log\n<EOH>\n<CALL:4>DK1A <QSO_DATE:10>2023-06-10 <TIME_ON:4>1200 <BAND:2>2m <MODE:3>SSB <EOR>';
    const q = parseADIF(raw,'f')[0];
    assert.equal(q.fields.QSO_DATE, '20230610');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Deduplication — updateKey + recomputeDupes
// ═════════════════════════════════════════════════════════════════════════════

describe('updateKey', () => {
  it('builds key from CALL|BAND|MODE|DATE|TIME', () => {
    const q = { call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200' };
    updateKey(q);
    assert.equal(q._key, 'DK1A|2m|SSB|20230610|1200');
  });

  it('different mode produces different key', () => {
    const a = { call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200' };
    const b = { call:'DK1A', band:'2m', mode:'CW',  date:'20230610', time:'1200' };
    updateKey(a); updateKey(b);
    assert.notEqual(a._key, b._key);
  });

  it('different band produces different key', () => {
    const a = { call:'DK1A', band:'2m',   mode:'SSB', date:'20230610', time:'1200' };
    const b = { call:'DK1A', band:'70cm', mode:'SSB', date:'20230610', time:'1200' };
    updateKey(a); updateKey(b);
    assert.notEqual(a._key, b._key);
  });
});

describe('recomputeDupes', () => {
  beforeEach(() => { _setAllForTest([]); });

  it('first occurrence not a dupe', () => {
    const q = { call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200', _key:'DK1A|2m|SSB|20230610|1200', dupe:false };
    _setAllForTest([q]);
    recomputeDupes();
    assert.equal(_getAllForTest()[0].dupe, false);
  });

  it('second occurrence with same key is dupe', () => {
    const a = { call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200', _key:'DK1A|2m|SSB|20230610|1200', dupe:false };
    const b = { ...a, dupe:false };
    _setAllForTest([a, b]);
    recomputeDupes();
    assert.equal(_getAllForTest()[0].dupe, false, 'first stays clean');
    assert.equal(_getAllForTest()[1].dupe, true,  'second becomes dupe');
  });

  it('same call different mode is not a dupe', () => {
    const a = { call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200', _key:'DK1A|2m|SSB|20230610|1200', dupe:false };
    const b = { call:'DK1A', band:'2m', mode:'CW',  date:'20230610', time:'1200', _key:'DK1A|2m|CW|20230610|1200',  dupe:false };
    _setAllForTest([a, b]);
    recomputeDupes();
    assert.equal(_getAllForTest()[0].dupe, false);
    assert.equal(_getAllForTest()[1].dupe, false);
  });

  it('same call different band is not a dupe', () => {
    const a = { call:'DK1A', band:'2m',   mode:'SSB', date:'20230610', time:'1200', _key:'DK1A|2m|SSB|20230610|1200',   dupe:false };
    const b = { call:'DK1A', band:'70cm', mode:'SSB', date:'20230610', time:'1200', _key:'DK1A|70cm|SSB|20230610|1200', dupe:false };
    _setAllForTest([a, b]);
    recomputeDupes();
    assert.equal(_getAllForTest()[0].dupe, false);
    assert.equal(_getAllForTest()[1].dupe, false);
  });

  it('same call different time is not a dupe', () => {
    const a = { call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200', _key:'DK1A|2m|SSB|20230610|1200', dupe:false };
    const b = { call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1400', _key:'DK1A|2m|SSB|20230610|1400', dupe:false };
    _setAllForTest([a, b]);
    recomputeDupes();
    assert.equal(_getAllForTest()[0].dupe, false);
    assert.equal(_getAllForTest()[1].dupe, false);
  });

  it('third occurrence of same key also dupe', () => {
    const k = 'DK1A|2m|SSB|20230610|1200';
    const qsos = [
      { call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200', _key:k, dupe:false },
      { call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200', _key:k, dupe:false },
      { call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200', _key:k, dupe:false },
    ];
    _setAllForTest(qsos);
    recomputeDupes();
    const all = _getAllForTest();
    assert.equal(all[0].dupe, false);
    assert.equal(all[1].dupe, true);
    assert.equal(all[2].dupe, true);
  });

  it('clears stale dupe flags before recomputing', () => {
    const k = 'DK1A|2m|SSB|20230610|1200';
    // Start with q[1] wrongly flagged as dupe
    const a = { call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200', _key:k, dupe:false };
    const b = { call:'OE3X', band:'2m', mode:'SSB', date:'20230610', time:'1300', _key:'OE3X|2m|SSB|20230610|1300', dupe:true };
    _setAllForTest([a, b]);
    recomputeDupes();
    assert.equal(_getAllForTest()[1].dupe, false, 'stale flag cleared');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  finishLoad dedup via parseADIF (integration)
// ═════════════════════════════════════════════════════════════════════════════

describe('parseADIF dedup key uniqueness', () => {
  it('same QSO from two files produces identical key', () => {
    const base = { CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB' };
    const a = parseADIF(adif(base), 'a.adi')[0];
    const b = parseADIF(adif(base), 'b.adi')[0];
    updateKey(a); updateKey(b);
    assert.equal(a._key, b._key);
  });

  it('different mode → different key (no dedup)', () => {
    const a = parseADIF(adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB' }), 'a.adi')[0];
    const b = parseADIF(adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'CW'  }), 'b.adi')[0];
    updateKey(a); updateKey(b);
    assert.notEqual(a._key, b._key);
  });

  it('case difference in CALL normalizes to same key', () => {
    const a = parseADIF(adif({ CALL:'dk1a', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB' }), 'a.adi')[0];
    const b = parseADIF(adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB' }), 'b.adi')[0];
    updateKey(a); updateKey(b);
    assert.equal(a._key, b._key);
  });

  it('case difference in BAND normalizes to same key', () => {
    const a = parseADIF(adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2M', MODE:'SSB' }), 'a.adi')[0];
    const b = parseADIF(adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB' }), 'b.adi')[0];
    updateKey(a); updateKey(b);
    assert.equal(a._key, b._key);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  adifField — format
// ═════════════════════════════════════════════════════════════════════════════

describe('adifField', () => {
  it('produces <TAG:len>value format', () => {
    assert.equal(adifField('CALL','DK1A'), '<CALL:4>DK1A ');
  });

  it('uppercases tag', () => {
    assert.equal(adifField('call','DK1A'), '<CALL:4>DK1A ');
  });

  it('correct length for multi-char value', () => {
    const f = adifField('COMMENT','hello world');
    assert.ok(f.includes('<COMMENT:11>'));
  });

  it('empty string → empty output', () => {
    assert.equal(adifField('CALL',''), '');
  });

  it('null → empty output', () => {
    assert.equal(adifField('CALL', null), '');
  });

  it('undefined → empty output', () => {
    assert.equal(adifField('CALL', undefined), '');
  });

  it('number value stringified correctly', () => {
    const f = adifField('TX_PWR', 100);
    assert.equal(f, '<TX_PWR:3>100 ');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  htmlEsc — XSS safety
// ═════════════════════════════════════════════════════════════════════════════

describe('htmlEsc', () => {
  it('ampersand escaped',       () => assert.equal(htmlEsc('A&B'),    'A&amp;B'));
  it('less-than escaped',       () => assert.equal(htmlEsc('<b>'),    '&lt;b&gt;'));
  it('greater-than escaped',    () => assert.equal(htmlEsc('x>y'),    'x&gt;y'));
  it('double-quote escaped',    () => assert.equal(htmlEsc('"hi"'),   '&quot;hi&quot;'));
  it('plain string unchanged',  () => assert.equal(htmlEsc('DK1A'),   'DK1A'));
  it('null → empty string',     () => assert.equal(htmlEsc(null),     ''));
  it('undefined → empty string',() => assert.equal(htmlEsc(undefined),''));
  it('number coerced',          () => assert.equal(htmlEsc(42),       '42'));
  it('XSS payload escaped', () => {
    const out = htmlEsc('<script>alert(1)</script>');
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('&lt;script&gt;'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  csvEsc — CSV escaping
// ═════════════════════════════════════════════════════════════════════════════

describe('csvEsc', () => {
  it('plain string unchanged',        () => assert.equal(csvEsc('DK1A'),     'DK1A'));
  it('comma triggers quoting',        () => assert.equal(csvEsc('a,b'),      '"a,b"'));
  it('double-quote doubled + quoted', () => assert.equal(csvEsc('say "hi"'), '"say ""hi"""'));
  it('newline triggers quoting',      () => assert.equal(csvEsc('a\nb'),     '"a\nb"'));
  it('empty string → empty',         () => assert.equal(csvEsc(''),          ''));
  it('null → empty',                  () => assert.equal(csvEsc(null),       ''));
  it('number coerced',               () => assert.equal(csvEsc(42),          '42'));
});

// ═════════════════════════════════════════════════════════════════════════════
//  modeBadge — CSS class mapping
// ═════════════════════════════════════════════════════════════════════════════

describe('modeBadge', () => {
  it('SSB → badge-ssb', () => assert.equal(modeBadge('SSB'),          'badge-ssb'));
  it('AM  → badge-ssb', () => assert.equal(modeBadge('AM'),           'badge-ssb'));
  it('USB → badge-ssb', () => assert.equal(modeBadge('USB'),          'badge-ssb'));
  it('LSB → badge-ssb', () => assert.equal(modeBadge('LSB'),          'badge-ssb'));
  it('CW  → badge-cw',  () => assert.equal(modeBadge('CW'),           'badge-cw'));
  it('FM  → badge-fm',  () => assert.equal(modeBadge('FM'),           'badge-fm'));
  it('FT8 → badge-digi',() => assert.equal(modeBadge('FT8'),          'badge-digi'));
  it('FT4 → badge-digi',() => assert.equal(modeBadge('FT4'),          'badge-digi'));
  it('RTTY→ badge-digi',() => assert.equal(modeBadge('RTTY'),         'badge-digi'));
  it('JS8 → badge-digi',() => assert.equal(modeBadge('JS8'),          'badge-digi'));
  it('WSPR→ badge-digi',() => assert.equal(modeBadge('WSPR'),         'badge-digi'));
  it('unknown → badge-digi', () => assert.equal(modeBadge('UNKNOWN'), 'badge-digi'));
  it('empty → badge-digi',   () => assert.equal(modeBadge(''),        'badge-digi'));
});

// ═════════════════════════════════════════════════════════════════════════════
//  buildFilename
// ═════════════════════════════════════════════════════════════════════════════

describe('buildFilename', () => {
  beforeEach(() => { _setAllForTest([]); });

  it('uses STATION_CALLSIGN when present', () => {
    _setAllForTest([{
      fields: { STATION_CALLSIGN:'S56OA' },
      call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200',
    }]);
    assert.ok(buildFilename('adi').startsWith('S56OA_'));
  });

  it('uses MY_CALLSIGN as fallback', () => {
    _setAllForTest([{
      fields: { MY_CALLSIGN:'OE3X' },
      call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200',
    }]);
    assert.ok(buildFilename('adi').startsWith('OE3X_'));
  });

  it('falls back to "merged" when no callsign', () => {
    _setAllForTest([{
      fields: {},
      call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200',
    }]);
    assert.ok(buildFilename('adi').startsWith('merged_'));
  });

  it('includes "merged" in filename', () => {
    _setAllForTest([{ fields:{STATION_CALLSIGN:'S56OA'}, call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200' }]);
    assert.ok(buildFilename('adi').includes('merged'));
  });

  it('appends correct extension', () => {
    _setAllForTest([{ fields:{STATION_CALLSIGN:'S56OA'}, call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200' }]);
    assert.ok(buildFilename('csv').endsWith('.csv'));
    assert.ok(buildFilename('adi').endsWith('.adi'));
  });

  it('replaces / in callsign with dash', () => {
    _setAllForTest([{ fields:{STATION_CALLSIGN:'OE/S56OA'}, call:'DK1A', band:'2m', mode:'SSB', date:'20230610', time:'1200' }]);
    const fn = buildFilename('adi');
    assert.ok(!fn.includes('/'), 'slash not replaced');
    assert.ok(fn.includes('OE-S56OA'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ADIF export — field reconstruction
// ═════════════════════════════════════════════════════════════════════════════

describe('ADIF export — field preservation', () => {
  it('parseADIF preserves arbitrary fields for export', () => {
    const txt = adif({
      CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB',
      TX_PWR:'100', ANTENNA:'9el Yagi', NOTES:'contest', MY_GRIDSQUARE:'JN65VP',
    });
    const q = parseADIF(txt, 'test.adi')[0];
    assert.equal(q.fields.TX_PWR,       '100');
    assert.equal(q.fields.ANTENNA,      '9el Yagi');
    assert.equal(q.fields.NOTES,        'contest');
    assert.equal(q.fields.MY_GRIDSQUARE,'JN65VP');
  });

  it('fields dict contains at minimum the key fields', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB' });
    const q = parseADIF(txt, 'test.adi')[0];
    for(const tag of ['CALL','QSO_DATE','TIME_ON','BAND','MODE'])
      assert.ok(tag in q.fields, `missing ${tag}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  I18N — key completeness
// ═════════════════════════════════════════════════════════════════════════════

describe('I18N', () => {
  it('all SL keys present in EN', () => {
    const slKeys = _getLangKeys('sl');
    const enKeys = new Set(_getLangKeys('en'));
    const missing = slKeys.filter(k => !enKeys.has(k));
    assert.deepEqual(missing, [], `EN missing keys: ${missing.join(', ')}`);
  });

  it('all EN keys present in SL', () => {
    const enKeys = _getLangKeys('en');
    const slKeys = new Set(_getLangKeys('sl'));
    const missing = enKeys.filter(k => !slKeys.has(k));
    assert.deepEqual(missing, [], `SL missing keys: ${missing.join(', ')}`);
  });

  it('required UI keys exist in both langs', () => {
    const required = [
      'dropTitle','dropSub','dropBtn','dropNote',
      'statFiles','statDups','statBands','statDates',
      'btnAdd','btnReset','hideDups','exportLabel',
      'btnAdif','btnCsv','onlySel',
      'thNum','thDate','thTime','thCall','thBand','thMode',
      'thRstS','thRstR','thGrid','thSrc',
      'toastAdif','toastCsv','toastNoQso','errAdif',
      'dupLabel','editHint','errDate','errTime','errCall','errBand','errGrid',
    ];
    for(const k of required){
      assert.ok(_getI18nForTest('sl', k), `SL missing key: ${k}`);
      assert.ok(_getI18nForTest('en', k), `EN missing key: ${k}`);
    }
  });

  it('SL and EN values differ for at least dupLabel (sanity)', () => {
    // Both 'DUP' is acceptable if intentional; just check key exists
    const sl = _getI18nForTest('sl', 'dropTitle');
    const en = _getI18nForTest('en', 'dropTitle');
    assert.notEqual(sl, en, 'SL and EN dropTitle should differ');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Real-world ADIF fixtures
// ═════════════════════════════════════════════════════════════════════════════

describe('parseADIF — real-world fixtures', () => {
  it('typical WSJT-X FT8 log entry', () => {
    const txt = [
      'WSJT-X ADIF Export',
      '<adif_ver:5>3.1.0',
      '<programid:6>WSJT-X',
      '<EOH>',
      '<call:6>EA8BFK <gridsquare:6>IL18ri <mode:3>FT8 <rst_sent:3>-07 <rst_rcvd:3>-15',
      '<qso_date:8>20230610 <time_on:6>143000 <qso_date_off:8>20230610 <time_off:6>143115',
      '<band:3>20m <freq:8>14.07525 <station_callsign:5>S56OA <my_gridsquare:6>JN65VP',
      '<eor>',
    ].join('\n');
    const qsos = parseADIF(txt, 'wsjtx.adi');
    assert.equal(qsos.length, 1);
    assert.equal(qsos[0].call, 'EA8BFK');
    assert.equal(qsos[0].mode, 'FT8');
    assert.equal(qsos[0].band, '20m');
    assert.equal(qsos[0].grid, 'IL18ri');
    assert.equal(qsos[0].time, '1430');               // HHMMSS → HHMM
    assert.equal(qsos[0].fields.FREQ, '14.07525');    // arbitrary field preserved
    assert.equal(qsos[0].fields.STATION_CALLSIGN, 'S56OA');
  });

  it('typical contest log entry (Log4OM style)', () => {
    const txt = adif({
      CALL:'OE3XMA', QSO_DATE:'20230611', TIME_ON:'0830', BAND:'2m', MODE:'SSB',
      RST_SENT:'59', RST_RCVD:'57', GRIDSQUARE:'JN88dc', TX_PWR:'400',
      COMMENT:'VHF cont.',
    });
    const qsos = parseADIF(txt, 'contest.adi');
    assert.equal(qsos.length, 1);
    assert.equal(qsos[0].rstS, '59');
    assert.equal(qsos[0].rstR, '57');
    assert.equal(qsos[0].fields.TX_PWR, '400');
    assert.equal(qsos[0].fields.COMMENT, 'VHF cont.');
  });

  it('merge of two files produces combined QSO list', () => {
    const file1 = [
      '<EOH>',
      '<CALL:4>DK1A <QSO_DATE:8>20230610 <TIME_ON:4>1200 <BAND:2>2m <MODE:3>SSB <EOR>',
      '<CALL:4>OE3X <QSO_DATE:8>20230610 <TIME_ON:4>1300 <BAND:2>2m <MODE:2>CW <EOR>',
    ].join('\n');
    const file2 = [
      '<EOH>',
      '<CALL:5>HB9CV <QSO_DATE:8>20230610 <TIME_ON:4>1400 <BAND:4>70cm <MODE:3>SSB <EOR>',
    ].join('\n');
    const all = [
      ...parseADIF(file1, 'file1.adi'),
      ...parseADIF(file2, 'file2.adi'),
    ];
    assert.equal(all.length, 3);
    assert.equal(all[0].call, 'DK1A');
    assert.equal(all[2].call, 'HB9CV');
    assert.equal(all[2].band, '70cm');
  });

  it('duplicate QSO across files detected by recomputeDupes', () => {
    const qso = { CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB' };
    const a = parseADIF(adif(qso), 'a.adi')[0];
    const b = parseADIF(adif(qso), 'b.adi')[0];
    [a, b].forEach((q,i) => { q._idx = i; updateKey(q); q.dupe = false; });
    _setAllForTest([a, b]);
    recomputeDupes();
    assert.equal(_getAllForTest()[0].dupe, false, 'first from file a is unique');
    assert.equal(_getAllForTest()[1].dupe, true,  'second from file b is dup');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Code-review fixes — regression tests
// ═════════════════════════════════════════════════════════════════════════════

describe('parseADIF — missing optional fields', () => {
  it('missing BAND field → band is empty string, not crash', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', MODE:'SSB' });
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos.length, 1);
    assert.equal(qsos[0].band, '');
  });

  it('missing TIME_ON → time and timeDisp are empty string', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', BAND:'2m', MODE:'SSB' });
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos.length, 1);
    assert.equal(qsos[0].time, '');
    assert.equal(qsos[0].timeDisp, '');
  });

  it('missing QSO_DATE → date and dateDisp are empty string', () => {
    const txt = adif({ CALL:'DK1A', TIME_ON:'1200', BAND:'2m', MODE:'SSB' });
    const qsos = parseADIF(txt, 'test.adi');
    assert.equal(qsos.length, 1);
    assert.equal(qsos[0].date, '');
    assert.equal(qsos[0].dateDisp, '');
  });

  it('missing RST_SENT and RST_RCVD → empty strings', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB' });
    const q = parseADIF(txt, 'test.adi')[0];
    assert.equal(q.rstS, '');
    assert.equal(q.rstR, '');
  });

  it('missing GRIDSQUARE → grid is empty string', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB' });
    const q = parseADIF(txt, 'test.adi')[0];
    assert.equal(q.grid, '');
  });
});

describe('parseADIF — no submode property on QSO object', () => {
  it('parsed qso has no submode property (dead weight removed)', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m',
                       MODE:'SSB', SUBMODE:'USB' });
    const q = parseADIF(txt, 'test.adi')[0];
    assert.ok(!('submode' in q), 'submode should not be a top-level qso property');
  });

  it('SUBMODE is still preserved in fields dict for export', () => {
    const txt = adif({ CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m',
                       MODE:'SSB', SUBMODE:'USB' });
    const q = parseADIF(txt, 'test.adi')[0];
    assert.equal(q.fields.SUBMODE, 'USB');
  });
});

describe('adifField — export consistency', () => {
  it('adifField handles tag already uppercase (idempotent)', () => {
    assert.equal(adifField('CALL','DK1A'), '<CALL:4>DK1A ');
    assert.equal(adifField('call','DK1A'), '<CALL:4>DK1A ');
  });

  it('APP_ADIFMERGE_SRC annotation built correctly', () => {
    const src = 'mylog.adi'; // 9 chars
    const f = adifField('APP_ADIFMERGE_SRC', src);
    assert.ok(f.includes('<APP_ADIFMERGE_SRC:9>'), 'wrong length: ' + f);
    assert.ok(f.includes('mylog.adi'));
  });

  it('fields with empty string value produce empty output (skip in export)', () => {
    assert.equal(adifField('GRIDSQUARE', ''), '');
  });
});

describe('updateKey — empty band handling', () => {
  it('empty band produces a key with empty segment (documents current behavior)', () => {
    const q = { call:'DK1A', band:'', mode:'SSB', date:'20230610', time:'1200' };
    updateKey(q);
    assert.equal(q._key, 'DK1A||SSB|20230610|1200');
  });

  it('two QSOs with empty band and same call/mode/date/time share a key', () => {
    const a = { call:'DK1A', band:'', mode:'SSB', date:'20230610', time:'1200' };
    const b = { call:'DK1A', band:'', mode:'SSB', date:'20230610', time:'1200' };
    updateKey(a); updateKey(b);
    assert.equal(a._key, b._key);
  });
});

describe('I18N — errBand key', () => {
  it('errBand key exists in SL', () =>
    assert.ok(_getI18nForTest('sl','errBand'), 'SL errBand missing'));

  it('errBand key exists in EN', () =>
    assert.ok(_getI18nForTest('en','errBand'), 'EN errBand missing'));

  it('SL and EN errBand values differ', () =>
    assert.notEqual(_getI18nForTest('sl','errBand'), _getI18nForTest('en','errBand')));
});

describe('parseADIF — re-merge safety (APP_ADIFMERGE_SRC)', () => {
  it('APP_ADIFMERGE_SRC from previous merge is stored in fields', () => {
    const txt = adif({
      CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB',
      APP_ADIFMERGE_SRC:'original.adi',
    });
    const q = parseADIF(txt, 'merged.adi')[0];
    assert.equal(q.fields.APP_ADIFMERGE_SRC, 'original.adi');
    assert.equal(q.src, 'merged.adi');
  });

  it('src field always reflects the loaded filename, not prior annotation', () => {
    const txt = adif({
      CALL:'DK1A', QSO_DATE:'20230610', TIME_ON:'1200', BAND:'2m', MODE:'SSB',
      APP_ADIFMERGE_SRC:'old.adi',
    });
    const q = parseADIF(txt, 'new.adi')[0];
    assert.equal(q.src, 'new.adi');
  });
});
