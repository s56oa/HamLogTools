'use strict';
/**
 * adif2cab.test.js
 *
 * Unit tests for ADIF → Cabrillo converter.
 * Run: node --test --test-reporter=spec adif2cab.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const vm   = require('node:vm');

// ─── Extract JS from <script>…</script> ──────────────────────────────────────
const src = fs.readFileSync(path.join(__dirname, 'adif2cab.html'), 'utf-8');
const jsMatch = src.match(/<script>([\s\S]*?)<\/script>/);
if(!jsMatch) throw new Error('No <script> block found in adif2cab.html');
const jsSrc = jsMatch[1];

// ─── DOM mock ────────────────────────────────────────────────────────────────
const mockEl = new Proxy({}, {
  get(t, k) {
    if(k === 'style')     return { display:'', color:'' };
    if(k === 'classList') return { add:()=>{}, remove:()=>{}, contains:()=>false, toggle:()=>{} };
    if(k === 'dataset')   return {};
    if(typeof k === 'symbol') return undefined;
    const scalars = ['textContent','innerHTML','disabled','className','checked','selectedIndex'];
    if(scalars.includes(k)) return '';
    if(k === 'value') return '';
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
  URL: { createObjectURL:()=>'', revokeObjectURL:()=>{} },
  Blob: class Blob{ constructor(parts, opts){ this._parts=parts; this.type=(opts||{}).type||''; } },
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

// ─── Inject test helpers (const/let not exposed as ctx props) ─────────────────
vm.runInContext(`
  function _getContests()      { return CONTESTS; }
  function _getLangKeys(lang)  { return Object.keys(S[lang]||{}); }
  function _getI18n(lang, key) { return (S[lang]||{})[key]; }
`, ctx);

const {
  modeToCAB, dfltRST, freqToKHz,
  parseADIF, extractExchR, formatCabDate, buildQSOLine,
  htmlEsc, cabModeBadge, modeBadge,
  _getContests, _getLangKeys, _getI18n,
} = ctx;

// ─── Test data helpers ────────────────────────────────────────────────────────
function adif(fields, withEoh = true){
  const hdr = withEoh ? 'test log\n<EOH>\n' : '';
  let rec = '';
  for(const [tag, val] of Object.entries(fields))
    rec += `<${tag}:${String(val).length}>${val} `;
  return hdr + rec + '<EOR>';
}

function makeQso(overrides = {}){
  return {
    freqKHz: 14200,
    cabMode: 'PH',
    date:    '20241026',
    time:    '1200',
    exchS:   '',
    rstS:    '59',
    call:    'G3ABC',
    rstR:    '57',
    exchR:   '14',
    ...overrides,
  };
}

const CQ_WW_CONTEST = { id:'CQ-WW-SSB', exchW:4 };
const IARU_CONTEST  = { id:'IARU-HF',   exchW:6 };

// ═════════════════════════════════════════════════════════════════════════════
//  modeToCAB — Cabrillo v3 spec: PH / CW / FM / RY / DG
// ═════════════════════════════════════════════════════════════════════════════

describe('modeToCAB — phone modes → PH', () => {
  it('"SSB"  → "PH"', () => assert.equal(modeToCAB('SSB'),  'PH'));
  it('"USB"  → "PH"', () => assert.equal(modeToCAB('USB'),  'PH'));
  it('"LSB"  → "PH"', () => assert.equal(modeToCAB('LSB'),  'PH'));
  it('"AM"   → "PH"', () => assert.equal(modeToCAB('AM'),   'PH'));
  it('lowercase "ssb" → "PH"', () => assert.equal(modeToCAB('ssb'), 'PH'));
});

describe('modeToCAB — CW → CW', () => {
  it('"CW"  → "CW"', () => assert.equal(modeToCAB('CW'),  'CW'));
  it('"cw"  → "CW"', () => assert.equal(modeToCAB('cw'),  'CW'));
});

describe('modeToCAB — FM-based voice → FM (Cabrillo v3 spec)', () => {
  it('"FM"          → "FM"', () => assert.equal(modeToCAB('FM'),          'FM'));
  it('"C4FM"        → "FM"', () => assert.equal(modeToCAB('C4FM'),        'FM'));
  it('"DSTAR"       → "FM"', () => assert.equal(modeToCAB('DSTAR'),       'FM'));
  it('"DMR"         → "FM"', () => assert.equal(modeToCAB('DMR'),         'FM'));
  it('"DIGITALVOICE"→ "FM"', () => assert.equal(modeToCAB('DIGITALVOICE'),'FM'));
});

describe('modeToCAB — RTTY → RY (Cabrillo v3 spec)', () => {
  it('"RTTY" → "RY"', () => assert.equal(modeToCAB('RTTY'), 'RY'));
  it('"rtty" → "RY"', () => assert.equal(modeToCAB('rtty'), 'RY'));
});

describe('modeToCAB — digital modes → DG', () => {
  it('"FT8"   → "DG"', () => assert.equal(modeToCAB('FT8'),   'DG'));
  it('"FT4"   → "DG"', () => assert.equal(modeToCAB('FT4'),   'DG'));
  it('"PSK31" → "DG"', () => assert.equal(modeToCAB('PSK31'), 'DG'));
  it('"JT65"  → "DG"', () => assert.equal(modeToCAB('JT65'),  'DG'));
  it('"JS8"   → "DG"', () => assert.equal(modeToCAB('JS8'),   'DG'));
  it('"WSPR"  → "DG"', () => assert.equal(modeToCAB('WSPR'),  'DG'));
  it('""     → "DG"',  () => assert.equal(modeToCAB(''),      'DG'));
  it('null   → "DG"',  () => assert.equal(modeToCAB(null),    'DG'));
});

// ═════════════════════════════════════════════════════════════════════════════
//  dfltRST — default RST per CAB mode
// ═════════════════════════════════════════════════════════════════════════════

describe('dfltRST', () => {
  it('PH → "59"',  () => assert.equal(dfltRST('PH'), '59'));
  it('FM → "59"',  () => assert.equal(dfltRST('FM'), '59'));
  it('CW → "599"', () => assert.equal(dfltRST('CW'), '599'));
  it('DG → "599"', () => assert.equal(dfltRST('DG'), '599'));
  it('RY → "599" (RTTY uses 3-digit RST)', () => assert.equal(dfltRST('RY'), '599'));
  it('unknown → "59" (phone default)',       () => assert.equal(dfltRST('XX'), '59'));
  it('"" → "59"',  () => assert.equal(dfltRST(''),   '59'));
});

// ═════════════════════════════════════════════════════════════════════════════
//  freqToKHz — FREQ field (MHz) → kHz; BAND_KHZ fallback
// ═════════════════════════════════════════════════════════════════════════════

describe('freqToKHz — FREQ field conversion', () => {
  it('14.210 MHz → 14210 kHz', () =>
    assert.equal(freqToKHz({ fields:{ FREQ:'14.210' }, band:'20m' }), 14210));

  it('144.300 MHz → 144300 kHz', () =>
    assert.equal(freqToKHz({ fields:{ FREQ:'144.300' }, band:'2m' }), 144300));

  it('432.200 MHz → 432200 kHz', () =>
    assert.equal(freqToKHz({ fields:{ FREQ:'432.200' }, band:'70cm' }), 432200));

  it('rounds half-kHz correctly', () =>
    assert.equal(freqToKHz({ fields:{ FREQ:'14.0005' }, band:'20m' }), 14001));

  it('FREQ "0" (not > 0) falls back to BAND_KHZ', () =>
    assert.equal(freqToKHz({ fields:{ FREQ:'0' }, band:'20m' }), 14200));

  it('FREQ "" falls back to BAND_KHZ', () =>
    assert.equal(freqToKHz({ fields:{ FREQ:'' }, band:'2m' }), 144300));
});

describe('freqToKHz — BAND_KHZ fallback', () => {
  it('band "20m" → 14200',   () => assert.equal(freqToKHz({ fields:{}, band:'20m'  }), 14200));
  it('band "2m"  → 144300',  () => assert.equal(freqToKHz({ fields:{}, band:'2m'   }), 144300));
  it('band "40m" → 7100',    () => assert.equal(freqToKHz({ fields:{}, band:'40m'  }), 7100));
  it('band "70cm"→ 432200',  () => assert.equal(freqToKHz({ fields:{}, band:'70cm' }), 432200));
  it('band "23cm"→ 1296100', () => assert.equal(freqToKHz({ fields:{}, band:'23cm' }), 1296100));
  it('unknown band → 0',     () => assert.equal(freqToKHz({ fields:{}, band:'999m' }), 0));
  it('no fields → 0',        () => assert.equal(freqToKHz({ band:'20m' }),              14200));
  it('no fields, no band → 0', () => assert.equal(freqToKHz({ band:'' }), 0));
});

// ═════════════════════════════════════════════════════════════════════════════
//  parseADIF — basic extraction
// ═════════════════════════════════════════════════════════════════════════════

describe('parseADIF — basic extraction', () => {
  it('parses minimal QSO', () => {
    const q = parseADIF(adif({ CALL:'G3ABC', QSO_DATE:'20241026', TIME_ON:'1200', BAND:'20m', MODE:'SSB' }), 'f.adi')[0];
    assert.equal(q.call, 'G3ABC');
    assert.equal(q.date, '20241026');
    assert.equal(q.time, '1200');
    assert.equal(q.band, '20m');
    assert.equal(q.mode, 'SSB');
  });

  it('normalizes CALL to uppercase', () => {
    const q = parseADIF(adif({ CALL:'g3abc', QSO_DATE:'20241026', TIME_ON:'1200', BAND:'20m', MODE:'SSB' }), 'f.adi')[0];
    assert.equal(q.call, 'G3ABC');
  });

  it('normalizes BAND to lowercase', () => {
    const q = parseADIF(adif({ CALL:'G3ABC', QSO_DATE:'20241026', TIME_ON:'1200', BAND:'20M', MODE:'SSB' }), 'f.adi')[0];
    assert.equal(q.band, '20m');
  });

  it('normalizes MODE to uppercase', () => {
    const q = parseADIF(adif({ CALL:'G3ABC', QSO_DATE:'20241026', TIME_ON:'1200', BAND:'20m', MODE:'ft8' }), 'f.adi')[0];
    assert.equal(q.mode, 'FT8');
  });

  it('extracts RST_SENT and RST_RCVD', () => {
    const q = parseADIF(adif({ CALL:'G3ABC', QSO_DATE:'20241026', TIME_ON:'1200', BAND:'20m', MODE:'SSB', RST_SENT:'59', RST_RCVD:'57' }), 'f.adi')[0];
    assert.equal(q.rstS, '59');
    assert.equal(q.rstR, '57');
  });

  it('sets src to filename', () => {
    const q = parseADIF(adif({ CALL:'G3ABC', QSO_DATE:'20241026', TIME_ON:'1200', BAND:'20m', MODE:'SSB' }), 'mylog.adi')[0];
    assert.equal(q.src, 'mylog.adi');
  });

  it('skips records without CALL', () => {
    const txt = 'log\n<EOH>\n<QSO_DATE:8>20241026 <TIME_ON:4>1200 <EOR>\n' +
                '<CALL:5>G3ABC <QSO_DATE:8>20241026 <TIME_ON:4>1300 <BAND:3>20m <MODE:3>SSB <EOR>';
    assert.equal(parseADIF(txt, 'f.adi').length, 1);
  });

  it('preserves arbitrary fields in fields dict', () => {
    const q = parseADIF(adif({ CALL:'G3ABC', QSO_DATE:'20241026', TIME_ON:'1200', BAND:'20m', MODE:'SSB', CQZONE:'14', TX_PWR:'100' }), 'f.adi')[0];
    assert.equal(q.fields.CQZONE, '14');
    assert.equal(q.fields.TX_PWR, '100');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  parseADIF — date / time normalization
// ═════════════════════════════════════════════════════════════════════════════

describe('parseADIF — date/time normalization', () => {
  it('YYYYMMDD stored as-is', () => {
    assert.equal(parseADIF(adif({ CALL:'G3ABC', QSO_DATE:'20241026', TIME_ON:'1200', BAND:'20m', MODE:'SSB' }), 'f')[0].date, '20241026');
  });

  it('ISO date YYYY-MM-DD stripped of dashes', () => {
    const txt = 'log\n<EOH>\n<CALL:5>G3ABC <QSO_DATE:10>2024-10-26 <TIME_ON:4>1200 <BAND:3>20m <MODE:3>SSB <EOR>';
    assert.equal(parseADIF(txt,'f')[0].date, '20241026');
  });

  it('date display formatted as DD.MM.YYYY', () => {
    assert.equal(parseADIF(adif({ CALL:'G3ABC', QSO_DATE:'20241026', TIME_ON:'1200', BAND:'20m', MODE:'SSB' }), 'f')[0].dateDisp, '26.10.2024');
  });

  it('HHMMSS time truncated to HHMM', () => {
    assert.equal(parseADIF(adif({ CALL:'G3ABC', QSO_DATE:'20241026', TIME_ON:'120030', BAND:'20m', MODE:'SSB' }), 'f')[0].time, '1200');
  });

  it('time display formatted as HH:MM', () => {
    assert.equal(parseADIF(adif({ CALL:'G3ABC', QSO_DATE:'20241026', TIME_ON:'1234', BAND:'20m', MODE:'SSB' }), 'f')[0].timeDisp, '12:34');
  });

  it('missing QSO_DATE → date empty string', () => {
    assert.equal(parseADIF(adif({ CALL:'G3ABC', TIME_ON:'1200', BAND:'20m', MODE:'SSB' }), 'f')[0].date, '');
  });

  it('missing TIME_ON → time empty string', () => {
    assert.equal(parseADIF(adif({ CALL:'G3ABC', QSO_DATE:'20241026', BAND:'20m', MODE:'SSB' }), 'f')[0].time, '');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  parseADIF — multi-record / edge cases
// ═════════════════════════════════════════════════════════════════════════════

describe('parseADIF — multi-record / edge cases', () => {
  it('parses two QSOs', () => {
    const txt = 'log\n<EOH>\n' +
      '<CALL:5>G3ABC <QSO_DATE:8>20241026 <TIME_ON:4>1200 <BAND:3>20m <MODE:3>SSB <EOR>\n' +
      '<CALL:5>OE3XY <QSO_DATE:8>20241026 <TIME_ON:4>1300 <BAND:2>2m <MODE:2>CW <EOR>';
    const qsos = parseADIF(txt, 'f.adi');
    assert.equal(qsos.length, 2);
    assert.equal(qsos[0].call, 'G3ABC');
    assert.equal(qsos[1].call, 'OE3XY');
  });

  it('works without <EOH> (headerless)', () => {
    const txt = '<CALL:5>G3ABC <QSO_DATE:8>20241026 <TIME_ON:4>1200 <BAND:3>20m <MODE:3>SSB <EOR>';
    assert.equal(parseADIF(txt, 'f.adi').length, 1);
  });

  it('case-insensitive tags', () => {
    const txt = 'log\n<EOH>\n<call:5>G3ABC <qso_date:8>20241026 <time_on:4>1200 <band:3>20m <mode:3>SSB <eor>';
    assert.equal(parseADIF(txt, 'f.adi')[0].call, 'G3ABC');
  });

  it('CRLF line endings handled', () => {
    const txt = 'log\r\n<EOH>\r\n<CALL:5>G3ABC <QSO_DATE:8>20241026 <TIME_ON:4>1200 <BAND:3>20m <MODE:3>SSB <EOR>';
    assert.equal(parseADIF(txt, 'f.adi').length, 1);
  });

  it('type specifier <TAG:len:type> handled', () => {
    const txt = 'log\n<EOH>\n<CALL:5:S>G3ABC <QSO_DATE:8:D>20241026 <TIME_ON:4:T>1200 <BAND:3>20m <MODE:3>SSB <EOR>';
    assert.equal(parseADIF(txt, 'f.adi')[0].call, 'G3ABC');
  });

  it('STATION_CALLSIGN preserved in fields for auto-populate', () => {
    const q = parseADIF(adif({ CALL:'G3ABC', QSO_DATE:'20241026', TIME_ON:'1200', BAND:'20m', MODE:'SSB', STATION_CALLSIGN:'S56OA' }), 'f.adi')[0];
    assert.equal(q.fields.STATION_CALLSIGN, 'S56OA');
  });

  it('empty file → no QSOs', () => {
    assert.equal(parseADIF('', 'empty.adi').length, 0);
  });

  it('fields dict has uppercase keys', () => {
    const q = parseADIF(adif({ call:'G3ABC', qso_date:'20241026', time_on:'1200', band:'20m', mode:'SSB' }), 'f.adi')[0];
    assert.ok('CALL' in q.fields);
    assert.ok('QSO_DATE' in q.fields);
    assert.ok('TIME_ON'  in q.fields);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  extractExchR — CQ WW (CQZONE field)
// ═════════════════════════════════════════════════════════════════════════════

describe('extractExchR — CQ-WW-SSB', () => {
  it('CQZONE present → returns CQZONE', () =>
    assert.equal(extractExchR({ CQZONE:'14' }, 'CQ-WW-SSB'), '14'));

  it('CQZONE with whitespace → trimmed', () =>
    assert.equal(extractExchR({ CQZONE:' 14 ' }, 'CQ-WW-SSB'), '14'));

  it('no CQZONE → falls back to SRX_STRING', () =>
    assert.equal(extractExchR({ SRX_STRING:'14' }, 'CQ-WW-SSB'), '14'));

  it('no CQZONE or SRX_STRING → falls back to SRX', () =>
    assert.equal(extractExchR({ SRX:'14' }, 'CQ-WW-SSB'), '14'));

  it('CQZONE takes priority over SRX_STRING', () =>
    assert.equal(extractExchR({ CQZONE:'14', SRX_STRING:'99' }, 'CQ-WW-SSB'), '14'));

  it('all empty → empty string', () =>
    assert.equal(extractExchR({}, 'CQ-WW-SSB'), ''));
});

describe('extractExchR — CQ-WW-CW', () => {
  it('CQZONE present → returns CQZONE', () =>
    assert.equal(extractExchR({ CQZONE:'5' }, 'CQ-WW-CW'), '5'));

  it('SRX_STRING fallback', () =>
    assert.equal(extractExchR({ SRX_STRING:'5' }, 'CQ-WW-CW'), '5'));

  it('all empty → empty string', () =>
    assert.equal(extractExchR({}, 'CQ-WW-CW'), ''));
});

// ═════════════════════════════════════════════════════════════════════════════
//  extractExchR — IARU HF (ITUZ field)
// ═════════════════════════════════════════════════════════════════════════════

describe('extractExchR — IARU-HF', () => {
  it('ITUZ present → returns ITUZ', () =>
    assert.equal(extractExchR({ ITUZ:'28' }, 'IARU-HF'), '28'));

  it('ITUZ with whitespace → trimmed', () =>
    assert.equal(extractExchR({ ITUZ:' 28 ' }, 'IARU-HF'), '28'));

  it('HQ abbreviation via SRX_STRING fallback', () =>
    assert.equal(extractExchR({ SRX_STRING:'DARC' }, 'IARU-HF'), 'DARC'));

  it('ITUZ takes priority over SRX_STRING', () =>
    assert.equal(extractExchR({ ITUZ:'28', SRX_STRING:'DARC' }, 'IARU-HF'), '28'));

  it('SRX fallback', () =>
    assert.equal(extractExchR({ SRX:'28' }, 'IARU-HF'), '28'));

  it('all empty → empty string', () =>
    assert.equal(extractExchR({}, 'IARU-HF'), ''));
});

// ═════════════════════════════════════════════════════════════════════════════
//  extractExchR — ARRL DX (STATE field)
// ═════════════════════════════════════════════════════════════════════════════

describe('extractExchR — ARRL-DX', () => {
  it('STATE present → returns STATE', () =>
    assert.equal(extractExchR({ STATE:'CT' }, 'ARRL-DX'), 'CT'));

  it('STATE with whitespace → trimmed', () =>
    assert.equal(extractExchR({ STATE:' CT ' }, 'ARRL-DX'), 'CT'));

  it('STATE takes priority over SRX_STRING', () =>
    assert.equal(extractExchR({ STATE:'CT', SRX_STRING:'MA' }, 'ARRL-DX'), 'CT'));

  it('SRX_STRING fallback', () =>
    assert.equal(extractExchR({ SRX_STRING:'CT' }, 'ARRL-DX'), 'CT'));

  it('SRX fallback', () =>
    assert.equal(extractExchR({ SRX:'599' }, 'ARRL-DX'), '599'));

  it('all empty → empty string', () =>
    assert.equal(extractExchR({}, 'ARRL-DX'), ''));
});

// ═════════════════════════════════════════════════════════════════════════════
//  extractExchR — GENERIC (SRX_STRING / SRX)
// ═════════════════════════════════════════════════════════════════════════════

describe('extractExchR — GENERIC', () => {
  it('SRX_STRING → returned', () =>
    assert.equal(extractExchR({ SRX_STRING:'001' }, 'GENERIC'), '001'));

  it('SRX fallback when SRX_STRING absent', () =>
    assert.equal(extractExchR({ SRX:'001' }, 'GENERIC'), '001'));

  it('SRX_STRING takes priority over SRX', () =>
    assert.equal(extractExchR({ SRX_STRING:'A', SRX:'B' }, 'GENERIC'), 'A'));

  it('all empty → empty string', () =>
    assert.equal(extractExchR({}, 'GENERIC'), ''));

  it('unknown contestId behaves as GENERIC', () =>
    assert.equal(extractExchR({ SRX_STRING:'XYZ' }, 'MY-CONTEST'), 'XYZ'));
});

// ═════════════════════════════════════════════════════════════════════════════
//  formatCabDate — YYYYMMDD → YYYY-MM-DD
// ═════════════════════════════════════════════════════════════════════════════

describe('formatCabDate', () => {
  it('20241026 → "2024-10-26"', () => assert.equal(formatCabDate('20241026'), '2024-10-26'));
  it('20000101 → "2000-01-01"', () => assert.equal(formatCabDate('20000101'), '2000-01-01'));
  it('19991231 → "1999-12-31"', () => assert.equal(formatCabDate('19991231'), '1999-12-31'));
  it('empty string → "0000-00-00"', () => assert.equal(formatCabDate(''), '0000-00-00'));
  it('undefined → "0000-00-00"', () => assert.equal(formatCabDate(undefined), '0000-00-00'));
  it('null → "0000-00-00"', () => assert.equal(formatCabDate(null), '0000-00-00'));
  it('non-8-digit string returned as-is', () => assert.equal(formatCabDate('bad'), 'bad'));
});

// ═════════════════════════════════════════════════════════════════════════════
//  buildQSOLine — Cabrillo v3 QSO line format
// ═════════════════════════════════════════════════════════════════════════════

describe('buildQSOLine — structure', () => {
  it('starts with "QSO: "', () => {
    const line = buildQSOLine(makeQso(), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.startsWith('QSO: '), `got: ${line}`);
  });

  it('ends with " 0" (transmitter ID)', () => {
    const line = buildQSOLine(makeQso(), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.endsWith(' 0'), `got: ${line}`);
  });

  it('contains CAB mode', () => {
    const line = buildQSOLine(makeQso({ cabMode:'CW' }), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.includes(' CW '), `got: ${line}`);
  });

  it('contains date in YYYY-MM-DD format', () => {
    const line = buildQSOLine(makeQso({ date:'20241026' }), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.includes('2024-10-26'), `got: ${line}`);
  });

  it('contains time HHMM', () => {
    const line = buildQSOLine(makeQso({ time:'1234' }), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.includes('1234'), `got: ${line}`);
  });

  it('contains my callsign', () => {
    const line = buildQSOLine(makeQso(), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.includes('S56OA'), `got: ${line}`);
  });

  it('contains their callsign', () => {
    const line = buildQSOLine(makeQso({ call:'DK1A' }), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.includes('DK1A'), `got: ${line}`);
  });

  it('HF freq 7100 padded to 5 chars', () => {
    const line = buildQSOLine(makeQso({ freqKHz:7100 }), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.includes(' 7100 '), `got: ${line}`);
  });

  it('zero freq → "    0" (5 chars)', () => {
    const line = buildQSOLine(makeQso({ freqKHz:0 }), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.startsWith('QSO:     0 '), `got: ${line}`);
  });

  it('VHF freq 144300 padded to 7 chars', () => {
    const line = buildQSOLine(makeQso({ freqKHz:144300 }), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.startsWith('QSO:  144300 '), `got: ${line}`);
  });

  it('UHF freq 432200 padded to 7 chars', () => {
    const line = buildQSOLine(makeQso({ freqKHz:432200 }), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.startsWith('QSO:  432200 '), `got: ${line}`);
  });

  it('SHF freq 1296100 — 7-char field exactly', () => {
    const line = buildQSOLine(makeQso({ freqKHz:1296100 }), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.startsWith('QSO: 1296100 '), `got: ${line}`);
  });
});

describe('buildQSOLine — exchange handling', () => {
  it('per-row exchS used when set', () => {
    const line = buildQSOLine(makeQso({ exchS:'99' }), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.includes('99'), `got: ${line}`);
    assert.ok(!line.includes(' 15 '), `default leaks in: ${line}`);
  });

  it('default exchS used when per-row exchS is empty', () => {
    const line = buildQSOLine(makeQso({ exchS:'' }), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.includes('15'), `got: ${line}`);
  });

  it('exchR included in line', () => {
    const line = buildQSOLine(makeQso({ exchR:'28' }), IARU_CONTEST, 'S56OA', '15');
    assert.ok(line.includes('28'), `got: ${line}`);
  });

  it('empty exchR → empty padded field (no crash)', () => {
    const line = buildQSOLine(makeQso({ exchR:'' }), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.endsWith(' 0'), `got: ${line}`);
  });

  it('exchange padded to contest.exchW (4) for CQ WW', () => {
    const line = buildQSOLine(makeQso({ exchS:'', exchR:'5' }), CQ_WW_CONTEST, 'S56OA', '15');
    // exchR '5' padEnd(4) = '5   '
    assert.ok(line.includes('5   '), `exchR not padded to 4: ${line}`);
  });

  it('exchange padded to contest.exchW (6) for IARU', () => {
    const line = buildQSOLine(makeQso({ exchS:'', exchR:'28' }), IARU_CONTEST, 'S56OA', '15');
    // exchR '28' padEnd(6) = '28    '
    assert.ok(line.includes('28    '), `exchR not padded to 6: ${line}`);
  });
});

describe('buildQSOLine — RST defaults', () => {
  it('empty rstS → dfltRST(cabMode) applied', () => {
    const line = buildQSOLine(makeQso({ rstS:'', cabMode:'PH' }), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.includes('59'), `got: ${line}`);
  });

  it('empty rstS for CW → 599 applied', () => {
    const line = buildQSOLine(makeQso({ rstS:'', cabMode:'CW' }), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.includes('599'), `got: ${line}`);
  });

  it('explicit rstS overrides default', () => {
    const line = buildQSOLine(makeQso({ rstS:'58', cabMode:'PH' }), CQ_WW_CONTEST, 'S56OA', '15');
    assert.ok(line.includes('58'), `got: ${line}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  htmlEsc — XSS safety
// ═════════════════════════════════════════════════════════════════════════════

describe('htmlEsc', () => {
  it('ampersand escaped',        () => assert.equal(htmlEsc('A&B'),    'A&amp;B'));
  it('< escaped',                () => assert.equal(htmlEsc('<b>'),    '&lt;b&gt;'));
  it('> escaped',                () => assert.equal(htmlEsc('x>y'),    'x&gt;y'));
  it('" escaped',                () => assert.equal(htmlEsc('"hi"'),   '&quot;hi&quot;'));
  it('plain string unchanged',   () => assert.equal(htmlEsc('G3ABC'),  'G3ABC'));
  it('null → empty string',      () => assert.equal(htmlEsc(null),     ''));
  it('undefined → empty string', () => assert.equal(htmlEsc(undefined),''));
  it('number coerced',           () => assert.equal(htmlEsc(42),       '42'));
  it('XSS payload neutralized',  () => {
    const out = htmlEsc('<script>alert(1)</script>');
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('&lt;script&gt;'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  cabModeBadge — CSS class for Cabrillo mode
// ═════════════════════════════════════════════════════════════════════════════

describe('cabModeBadge', () => {
  it('"PH" → "badge-ssb"',  () => assert.equal(cabModeBadge('PH'),  'badge-ssb'));
  it('"CW" → "badge-cw"',   () => assert.equal(cabModeBadge('CW'),  'badge-cw'));
  it('"FM" → "badge-digi"', () => assert.equal(cabModeBadge('FM'),  'badge-digi'));
  it('"DG" → "badge-digi"', () => assert.equal(cabModeBadge('DG'),  'badge-digi'));
  it('"RY" → "badge-digi"', () => assert.equal(cabModeBadge('RY'),  'badge-digi'));
  it('"" → "badge-digi"',   () => assert.equal(cabModeBadge(''),    'badge-digi'));
});

// ═════════════════════════════════════════════════════════════════════════════
//  modeBadge — CSS class for ADIF mode display
// ═════════════════════════════════════════════════════════════════════════════

describe('modeBadge', () => {
  it('SSB → badge-ssb', () => assert.equal(modeBadge('SSB'), 'badge-ssb'));
  it('USB → badge-ssb', () => assert.equal(modeBadge('USB'), 'badge-ssb'));
  it('LSB → badge-ssb', () => assert.equal(modeBadge('LSB'), 'badge-ssb'));
  it('AM  → badge-ssb', () => assert.equal(modeBadge('AM'),  'badge-ssb'));
  it('CW  → badge-cw',  () => assert.equal(modeBadge('CW'),  'badge-cw'));
  it('FM  → badge-fm',  () => assert.equal(modeBadge('FM'),  'badge-fm'));
  it('FT8 → badge-digi',() => assert.equal(modeBadge('FT8'), 'badge-digi'));
  it('RTTY→ badge-digi',() => assert.equal(modeBadge('RTTY'),'badge-digi'));
  it('"" → badge-digi', () => assert.equal(modeBadge(''),    'badge-digi'));
});

// ═════════════════════════════════════════════════════════════════════════════
//  CONTESTS array — structure validation
// ═════════════════════════════════════════════════════════════════════════════

describe('CONTESTS — structure', () => {
  it('has exactly 5 entries', () => {
    assert.equal(_getContests().length, 5);
  });

  it('each entry has required fields', () => {
    for(const c of _getContests()){
      assert.ok(c.id,             `missing id in ${c.name}`);
      assert.ok(c.name,           `missing name in ${c.id}`);
      assert.ok(c.exchSentLbl,    `missing exchSentLbl in ${c.id}`);
      assert.ok(c.exchRcvdLbl,    `missing exchRcvdLbl in ${c.id}`);
      assert.ok(c.exchRcvdField,  `missing exchRcvdField in ${c.id}`);
      assert.ok(c.exchW > 0,      `exchW not positive in ${c.id}`);
    }
  });

  it('CQ-WW-SSB uses CQZONE field', () => {
    const c = _getContests().find(x => x.id==='CQ-WW-SSB');
    assert.equal(c.exchRcvdField, 'CQZONE');
  });

  it('CQ-WW-CW uses CQZONE field', () => {
    const c = _getContests().find(x => x.id==='CQ-WW-CW');
    assert.equal(c.exchRcvdField, 'CQZONE');
  });

  it('IARU-HF uses ITUZ field', () => {
    const c = _getContests().find(x => x.id==='IARU-HF');
    assert.equal(c.exchRcvdField, 'ITUZ');
  });

  it('ARRL-DX uses STATE field', () => {
    const c = _getContests().find(x => x.id==='ARRL-DX');
    assert.equal(c.exchRcvdField, 'STATE');
  });

  it('GENERIC uses SRX_STRING field', () => {
    const c = _getContests().find(x => x.id==='GENERIC');
    assert.equal(c.exchRcvdField, 'SRX_STRING');
  });

  it('each entry has sl and en labels', () => {
    for(const c of _getContests()){
      assert.ok(c.exchSentLbl.sl, `missing sl in exchSentLbl of ${c.id}`);
      assert.ok(c.exchSentLbl.en, `missing en in exchSentLbl of ${c.id}`);
      assert.ok(c.exchRcvdLbl.sl, `missing sl in exchRcvdLbl of ${c.id}`);
      assert.ok(c.exchRcvdLbl.en, `missing en in exchRcvdLbl of ${c.id}`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  I18N — key completeness (SL ↔ EN parity)
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

  it('required UI keys exist in both languages', () => {
    const required = [
      'dropTitle','dropSub','dropBtn','dropNote',
      'statFiles','statBands','statDates','statMiss',
      'panelHdr','panelHint','hfContestLbl','hfCustomName',
      'btnAdd','btnReset','filterMiss','exportLbl',
      'btnCab','onlySel',
      'thNum','thDate','thTime','thCall','thBand','thMode',
      'thCabMode','thFreq','thRstS','thExchS','thRstR','thExchR','thSrc',
      'toastCab','toastNoQso','errNoCall','errAdif',
      'warnMissExch','editHint','errCall',
    ];
    for(const k of required){
      assert.ok(_getI18n('sl', k), `SL missing key: ${k}`);
      assert.ok(_getI18n('en', k), `EN missing key: ${k}`);
    }
  });

  it('SL and EN dropTitle values differ', () => {
    assert.notEqual(_getI18n('sl','dropTitle'), _getI18n('en','dropTitle'));
  });
});
