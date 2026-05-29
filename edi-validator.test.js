'use strict';
/**
 * edi-validator.test.js
 * Run: node --test --test-reporter=spec edi-validator.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const vm   = require('node:vm');

// ─── Load tool ───────────────────────────────────────────────────────────────
const src = fs.readFileSync(path.join(__dirname, 'edi-validator.html'), 'utf-8');
const jsMatch = src.match(/<script>([\s\S]*?)<\/script>/);
if (!jsMatch) throw new Error('No <script> block found in edi-validator.html');
const jsSrc = jsMatch[1];

const mockEl = new Proxy({}, {
  get(t, k) {
    if (k === 'style')     return { display: '' };
    if (k === 'classList') return { add:()=>{}, remove:()=>{}, contains:()=>false, toggle:()=>{} };
    if (k === 'dataset')   return {};
    if (typeof k === 'symbol') return undefined;
    if (['textContent','innerHTML','className','value'].includes(k)) return '';
    if (k === 'querySelectorAll' || k === 'querySelector') return () => [];
    if (k === 'addEventListener') return () => {};
    return () => mockEl;
  },
  set() { return true; },
});

const ctx = vm.createContext({
  console: { log:()=>{}, error:()=>{}, warn:()=>{} },
  require, fs, path,
  Date, JSON, Math, String, Number, RegExp, Set, Map, Array, Object,
  parseInt, parseFloat, isNaN, isFinite,
  clearTimeout, setTimeout: () => 0,
  URL: { createObjectURL:()=>'', revokeObjectURL:()=>{} },
  Blob: class Blob { constructor(p) { this._p = p; } },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: {
    getElementById:   () => mockEl,
    documentElement:  { getAttribute:()=>'', setAttribute:()=>{}, dataset:{} },
    querySelectorAll: () => [],
    querySelector:    () => mockEl,
    createElement:    () => mockEl,
    addEventListener: () => {},
  },
});

vm.runInContext(jsSrc, ctx);
vm.runInContext('globalThis._S = S;', ctx);
const { validate, locToLatLon, haversine } = ctx;
const S = ctx._S;

// ─── Helper builders ──────────────────────────────────────────────────────────
function makeEdi(qsos = [], overrides = {}) {
  const hdr = {
    TName:  'IARU R1 VHF Contest',
    TDate:  '20260510;20260510',
    PCall:  'S56OA',
    PWWLo:  'JN65VP',
    PExch:  '',
    PAdr1:  'Krvavec',
    PAdr2:  '',
    PSect:  'MO',
    PBand:  '145 MHz',
    PClub:  'S59DGO',
    RName:  'Janez Novak',
    RCall:  'S56OA',
    RAdr1:  '',
    RAdr2:  '',
    RPoCo:  '',
    RCity:  'Ljubljana',
    RCoun:  'SI',
    RPhon:  '',
    RHBBS:  'j@s56oa.si',
    MOpe1:  'S56OA',
    MOpe2:  '',
    STXEq:  'SSPA',
    SPowe:  '100',
    SRXEq:  'LNA',
    SAnte:  '9el Yagi',
    SAntH:  '1200;1200',
    CQSOs:  '1;2',
    CQSOP:  '50',
    CWWLs:  '1;0;1',
    CWWLB:  '0',
    CExcs:  '1;0;1',
    CExcB:  '0',
    CDXCs:  '1;0;1',
    CDXCB:  '0',
    CToSc:  '100',
    CODXC:  'S59DGO;JN65VP;50',
    ...overrides,
  };
  const lines = ['[REG1TEST;1]'];
  for (const [k, v] of Object.entries(hdr)) lines.push(`${k}=${v}`);
  lines.push('[Remarks]', `[QSORecords;${qsos.length}]`, ...qsos,
             '[END;S56OA HamLogTools VHF Logger]');
  return lines.join('\r\n');
}

const GOOD_QSO = '260510;1030;S59DGO;1;59;001;59;001;;JN65VP;50;;;;';
const errs  = iss => iss.filter(i => i.severity === 'error');
const warns = iss => iss.filter(i => i.severity === 'warn');
const infos = iss => iss.filter(i => i.severity === 'info');
const hasCode = (iss, code) => iss.some(i => i.code === code);

// ═══════════════════════════════════════════════════════════════════════════════
//  locToLatLon
// ═══════════════════════════════════════════════════════════════════════════════
describe('locToLatLon', () => {
  it('JN65VP returns approximate lat/lon', () => {
    const r = locToLatLon('JN65VP');
    assert.ok(r && r.length === 2, 'should return [lat,lon]');
    assert.ok(r[0] > 45 && r[0] < 47, `lat ${r[0]} not in expected range`);
    assert.ok(r[1] > 13 && r[1] < 16, `lon ${r[1]} not in expected range`);
  });
  it('4-char locator accepted', () => {
    const r = locToLatLon('JN65');
    assert.ok(r !== null, '4-char should be accepted');
  });
  it('invalid locator returns null', () => {
    assert.equal(locToLatLon('ZZ99XX'), null);
    assert.equal(locToLatLon('TOO_LONG_LOCATOR'), null);
    assert.equal(locToLatLon(''), null);
  });
  it('lowercase accepted', () => {
    assert.ok(locToLatLon('jn65vp') !== null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  haversine
// ═══════════════════════════════════════════════════════════════════════════════
describe('haversine', () => {
  it('same point returns 0', () => {
    const p = locToLatLon('JN65VP');
    assert.ok(haversine(p, p) < 1);
  });
  it('JN65VP→JN78DG approx 294 km', () => {
    const a = locToLatLon('JN65VP'), b = locToLatLon('JN78DG');
    const d = haversine(a, b);
    assert.ok(d > 270 && d < 320, `expected ~294 km, got ${d.toFixed(1)}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  validate — clean EDI
// ═══════════════════════════════════════════════════════════════════════════════
describe('validate — clean EDI', () => {
  it('returns no errors for well-formed EDI', () => {
    const {issues} = validate(makeEdi([GOOD_QSO]));
    assert.equal(errs(issues).length, 0, `unexpected errors: ${errs(issues).map(i=>i.msg).join('; ')}`);
  });
  it('returns no warnings for complete EDI', () => {
    const {issues} = validate(makeEdi([GOOD_QSO]));
    assert.equal(warns(issues).length, 0, `unexpected warnings: ${warns(issues).map(i=>i.msg).join('; ')}`);
  });
  it('qsoCount matches QSO lines', () => {
    const {qsoCount} = validate(makeEdi([GOOD_QSO, GOOD_QSO]));
    assert.equal(qsoCount, 2);
  });
  it('no [END;...] → info iNoEnd', () => {
    const text = makeEdi([GOOD_QSO]).replace(/\[END;.*\]\r?\n?/, '');
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'iNoEnd'), 'iNoEnd expected');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  validate — structure
// ═══════════════════════════════════════════════════════════════════════════════
describe('validate — structure', () => {
  it('missing [REG1TEST;1] → eNoReg1test', () => {
    const text = makeEdi([GOOD_QSO]).replace('[REG1TEST;1]\r\n', '');
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'eNoReg1test'));
  });
  it('missing [Remarks] → eNoRemarks', () => {
    const text = makeEdi([GOOD_QSO]).replace('[Remarks]\r\n', '');
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'eNoRemarks'));
  });
  it('missing [QSORecords;N] → eNoQsoSection', () => {
    const text = makeEdi([GOOD_QSO]).replace(/\[QSORecords;\d+\]\r\n/, '');
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'eNoQsoSection'));
  });
  it('blank line in header → eBlankInHeader', () => {
    const text = makeEdi([GOOD_QSO]).replace('TName=', '\r\nTName=');
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'eBlankInHeader'));
  });
  it('blank line in [Remarks] section → iBlankInRemarks (not error)', () => {
    const text = makeEdi([GOOD_QSO]).replace('[Remarks]\r\n[QSORecords', '[Remarks]\r\n\r\n[QSORecords');
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'iBlankInRemarks'));
    assert.ok(!hasCode(errs(issues), 'iBlankInRemarks'), 'should be info, not error');
  });
  it('CRLF and LF both accepted', () => {
    const lf = makeEdi([GOOD_QSO]).replace(/\r\n/g, '\n');
    const {issues} = validate(lf);
    assert.equal(errs(issues).length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  validate — non-spec keywords
// ═══════════════════════════════════════════════════════════════════════════════
describe('validate — non-spec keywords', () => {
  it('TCall → eNonSpecKw', () => {
    const text = makeEdi([GOOD_QSO]).replace('PCall=', 'TCall=');
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'eNonSpecKw'));
  });
  it('TLocator → eNonSpecKw', () => {
    const text = makeEdi([GOOD_QSO]).replace('PWWLo=', 'TLocator=');
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'eNonSpecKw'));
  });
  it('RAZ=28 → eNonSpecKw', () => {
    const text = makeEdi([GOOD_QSO]).replace('[Remarks]', 'RAZ=28\r\n[Remarks]');
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'eNonSpecKw'));
  });
  it('RClub → eNonSpecKw', () => {
    const text = makeEdi([GOOD_QSO]).replace('[Remarks]', 'RClub=S59DGO\r\n[Remarks]');
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'eNonSpecKw'));
  });
  it('RBand → eNonSpecKw', () => {
    const text = makeEdi([GOOD_QSO]).replace('PBand=', 'RBand=');
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'eNonSpecKw'));
  });
  it('completely unknown keyword → eNonSpecKw', () => {
    const text = makeEdi([GOOD_QSO]).replace('[Remarks]', 'XYZUNK=foo\r\n[Remarks]');
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'eNonSpecKw'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  validate — header formats
// ═══════════════════════════════════════════════════════════════════════════════
describe('validate — header formats', () => {
  it('TDate YYYYMMDD;YYYYMMDD valid', () => {
    const {issues} = validate(makeEdi([GOOD_QSO]));
    assert.ok(!hasCode(issues, 'eTDateFormat'));
  });
  it('TDate wrong format → eTDateFormat', () => {
    const text = makeEdi([GOOD_QSO], {TDate: '2026-05-10;2026-05-10'});
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'eTDateFormat'));
  });
  it('TDate single date → eTDateFormat', () => {
    const text = makeEdi([GOOD_QSO], {TDate: '20260510'});
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'eTDateFormat'));
  });
  it('PWWLo 4-char → wPwwloFormat', () => {
    const text = makeEdi([GOOD_QSO], {PWWLo: 'JN65'});
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'wPwwloFormat'));
  });
  it('PWWLo invalid chars → wPwwloFormat', () => {
    const text = makeEdi([GOOD_QSO], {PWWLo: 'XX65VP'});
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'wPwwloFormat'));
  });
  it('PBand unknown value → wPBandUnknown', () => {
    const text = makeEdi([GOOD_QSO], {PBand: '2m'});
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'wPBandUnknown'));
  });
  it('PBand 145 MHz → no wPBandUnknown', () => {
    const {issues} = validate(makeEdi([GOOD_QSO]));
    assert.ok(!hasCode(issues, 'wPBandUnknown'));
  });
  it('keyword out of order → iKwOrder', () => {
    // Put CODXC before CToSc by swapping them in the template
    const text = makeEdi([GOOD_QSO])
      .replace('CToSc=100\r\nCODXC=', 'CODXC=S59DGO;JN65VP;50\r\nCToSc=')
      .replace('CODXC=S59DGO;JN65VP;50\r\nCToSc=100\r\nCODXC=S59DGO;JN65VP;50', 'CToSc=100\r\nCODXC=S59DGO;JN65VP;50');
    // simpler: just build raw text with one keyword deliberately before its predecessor
    const raw = '[REG1TEST;1]\r\nTName=Test\r\nCODXC=S59DGO;JN65VP;50\r\nTDate=20260510;20260510\r\n' +
                'PCall=S56OA\r\nPWWLo=JN65VP\r\nPExch=\r\nPAdr1=x\r\nPAdr2=\r\nPSect=MO\r\nPBand=145 MHz\r\nPClub=S59DGO\r\n' +
                'RName=J N\r\nRCall=\r\nRAdr1=\r\nRAdr2=\r\nRPoCo=\r\nRCity=\r\nRCoun=\r\nRPhon=\r\nRHBBS=a@b.si\r\n' +
                'MOpe1=S56OA\r\nMOpe2=\r\nSTXEq=x\r\nSPowe=100\r\nSRXEq=x\r\nSAnte=x\r\nSAntH=\r\n' +
                'CQSOs=1;1\r\nCQSOP=50\r\nCWWLs=1;0;1\r\nCWWLB=0\r\nCExcs=1;0;1\r\nCExcB=0\r\nCDXCs=1;0;1\r\nCDXCB=0\r\nCToSc=50\r\n' +
                '[Remarks]\r\n[QSORecords;1]\r\n' + GOOD_QSO + '\r\n[END;x]';
    const {issues} = validate(raw);
    assert.ok(hasCode(issues, 'iKwOrder'), 'iKwOrder expected when CODXC appears before TDate');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  validate — ZRS mandatory fields
// ═══════════════════════════════════════════════════════════════════════════════
describe('validate — ZRS mandatory fields', () => {
  it('empty PSect → wFieldEmpty', () => {
    const text = makeEdi([GOOD_QSO], {PSect:''});
    const {issues} = validate(text);
    assert.ok(warns(issues).some(i => i.code === 'wFieldEmpty' && i.msg.includes('PSect')));
  });
  it('empty PClub → wFieldEmpty', () => {
    const text = makeEdi([GOOD_QSO], {PClub:''});
    const {issues} = validate(text);
    assert.ok(warns(issues).some(i => i.code === 'wFieldEmpty' && i.msg.includes('PClub')));
  });
  it('empty RName → wFieldEmpty', () => {
    const text = makeEdi([GOOD_QSO], {RName:''});
    const {issues} = validate(text);
    assert.ok(warns(issues).some(i => i.code === 'wFieldEmpty' && i.msg.includes('RName')));
  });
  it('empty RHBBS → wFieldEmpty', () => {
    const text = makeEdi([GOOD_QSO], {RHBBS:''});
    const {issues} = validate(text);
    assert.ok(warns(issues).some(i => i.code === 'wFieldEmpty' && i.msg.includes('RHBBS')));
  });
  it('empty SPowe → wFieldEmpty', () => {
    const text = makeEdi([GOOD_QSO], {SPowe:''});
    const {issues} = validate(text);
    assert.ok(warns(issues).some(i => i.code === 'wFieldEmpty' && i.msg.includes('SPowe')));
  });
  it('all mandatory fields present → no wFieldEmpty', () => {
    const {issues} = validate(makeEdi([GOOD_QSO]));
    assert.equal(warns(issues).filter(i => i.code === 'wFieldEmpty').length, 0,
      `unexpected wFieldEmpty: ${warns(issues).filter(i=>i.code==='wFieldEmpty').map(i=>i.msg).join(', ')}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  validate — QSO count
// ═══════════════════════════════════════════════════════════════════════════════
describe('validate — QSO count', () => {
  it('correct count → no eQsoCountMismatch', () => {
    const {issues} = validate(makeEdi([GOOD_QSO]));
    assert.ok(!hasCode(issues, 'eQsoCountMismatch'));
  });
  it('declared 2, found 1 → eQsoCountMismatch', () => {
    const text = makeEdi([GOOD_QSO]).replace('[QSORecords;1]', '[QSORecords;2]');
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'eQsoCountMismatch'));
  });
  it('declared 0, found 1 → eQsoCountMismatch', () => {
    const text = makeEdi([GOOD_QSO]).replace('[QSORecords;1]', '[QSORecords;0]');
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'eQsoCountMismatch'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  validate — QSO records
// ═══════════════════════════════════════════════════════════════════════════════
describe('validate — QSO field count', () => {
  it('14 fields → eQsoFieldCount', () => {
    const bad = GOOD_QSO.split(';').slice(0, 14).join(';');
    const {issues} = validate(makeEdi([bad]));
    assert.ok(hasCode(issues, 'eQsoFieldCount'));
  });
  it('16 fields → eQsoFieldCount', () => {
    const bad = GOOD_QSO + ';extra';
    const {issues} = validate(makeEdi([bad]));
    assert.ok(hasCode(issues, 'eQsoFieldCount'));
  });
  it('15 fields → no eQsoFieldCount', () => {
    const {issues} = validate(makeEdi([GOOD_QSO]));
    assert.ok(!hasCode(issues, 'eQsoFieldCount'));
  });
});

describe('validate — QSO date', () => {
  const qsoWith = (date) => `${date};1030;S59DGO;1;59;001;59;001;;JN65VP;50;;;;`;
  it('valid date → no eQsoDate', () => {
    const {issues} = validate(makeEdi([GOOD_QSO]));
    assert.ok(!hasCode(issues, 'eQsoDate'));
  });
  it('5-digit date → eQsoDate', () => {
    assert.ok(hasCode(validate(makeEdi([qsoWith('26051')])).issues, 'eQsoDate'));
  });
  it('month 00 → eQsoDate', () => {
    assert.ok(hasCode(validate(makeEdi([qsoWith('260009')])).issues, 'eQsoDate'));
  });
  it('month 13 → eQsoDate', () => {
    assert.ok(hasCode(validate(makeEdi([qsoWith('261310')])).issues, 'eQsoDate'));
  });
  it('day 00 → eQsoDate', () => {
    assert.ok(hasCode(validate(makeEdi([qsoWith('260500')])).issues, 'eQsoDate'));
  });
});

describe('validate — QSO time', () => {
  const qsoWith = (time) => `260510;${time};S59DGO;1;59;001;59;001;;JN65VP;50;;;;`;
  it('valid time → no eQsoTime', () => {
    const {issues} = validate(makeEdi([GOOD_QSO]));
    assert.ok(!hasCode(issues, 'eQsoTime'));
  });
  it('5-digit time → eQsoTime', () => {
    assert.ok(hasCode(validate(makeEdi([qsoWith('10300')])).issues, 'eQsoTime'));
  });
  it('hour 24 → eQsoTime', () => {
    assert.ok(hasCode(validate(makeEdi([qsoWith('2400')])).issues, 'eQsoTime'));
  });
  it('minute 60 → eQsoTime', () => {
    assert.ok(hasCode(validate(makeEdi([qsoWith('1060')])).issues, 'eQsoTime'));
  });
});

describe('validate — QSO mode', () => {
  const qsoMode = (m) => `260510;1030;S59DGO;${m};59;001;59;001;;JN65VP;50;;;;`;
  it('mode 1 valid', () => assert.ok(!hasCode(validate(makeEdi([qsoMode('1')])).issues, 'eQsoMode')));
  it('mode 9 valid', () => assert.ok(!hasCode(validate(makeEdi([qsoMode('9')])).issues, 'eQsoMode')));
  it('mode A → eQsoMode', () => assert.ok(hasCode(validate(makeEdi([qsoMode('A')])).issues, 'eQsoMode')));
  it('mode 10 → eQsoMode', () => assert.ok(hasCode(validate(makeEdi([qsoMode('10')])).issues, 'eQsoMode')));
});

describe('validate — QSO dupe flag', () => {
  const qsoEnd = (d) => `260510;1030;S59DGO;1;59;001;59;001;;JN65VP;50;;;;${d}`;
  it('empty dupe field → no error', () => assert.ok(!hasCode(validate(makeEdi([qsoEnd('')])).issues, 'eQsoDupe')));
  it('D → no error', () => assert.ok(!hasCode(validate(makeEdi([qsoEnd('D')])).issues, 'eQsoDupe')));
  it('X → eQsoDupe', () => assert.ok(hasCode(validate(makeEdi([qsoEnd('X')])).issues, 'eQsoDupe')));
  it('d (lowercase) → eQsoDupe', () => assert.ok(hasCode(validate(makeEdi([qsoEnd('d')])).issues, 'eQsoDupe')));
  it('D with non-zero QRB → iDupeNonZeroQrb', () => {
    const {issues} = validate(makeEdi([qsoEnd('D')]));
    assert.ok(hasCode(issues, 'iDupeNonZeroQrb'));
  });
  it('D with zero QRB → no iDupeNonZeroQrb', () => {
    const q = '260510;1030;S59DGO;1;59;001;59;001;;JN65VP;0;;;;D';
    const {issues} = validate(makeEdi([q]));
    assert.ok(!hasCode(issues, 'iDupeNonZeroQrb'));
  });
});

describe('validate — QSO WWL format', () => {
  const qsoWwl = (w) => `260510;1030;S59DGO;1;59;001;59;001;;${w};50;;;;`;
  it('valid 6-char WWL → no warning', () => assert.ok(!hasCode(validate(makeEdi([qsoWwl('JN65VP')])).issues, 'wQsoWwlFormat')));
  it('valid 4-char WWL → no warning', () => assert.ok(!hasCode(validate(makeEdi([qsoWwl('JN65')])).issues, 'wQsoWwlFormat')));
  it('empty WWL → no warning', () => assert.ok(!hasCode(validate(makeEdi([qsoWwl('')])).issues, 'wQsoWwlFormat')));
  it('invalid WWL → wQsoWwlFormat', () => assert.ok(hasCode(validate(makeEdi([qsoWwl('ZZ99ZZ')])).issues, 'wQsoWwlFormat')));
});

// ═══════════════════════════════════════════════════════════════════════════════
//  validate — QRB deviation
// ═══════════════════════════════════════════════════════════════════════════════
describe('validate — QRB deviation', () => {
  it('correct QRB → no wQrbDeviation', () => {
    // JN65VP → JN78DG ≈ 294 km
    const q = '260510;1030;OE5VRL;2;599;001;599;001;;JN78DG;294;;;;';
    const {issues} = validate(makeEdi([q]));
    assert.ok(!hasCode(issues, 'wQrbDeviation'));
  });
  it('QRB off by >10% → wQrbDeviation', () => {
    // JN65VP → JN78DG ≈ 294 km, declare 50 km → huge deviation
    const q = '260510;1030;OE5VRL;2;599;001;599;001;;JN78DG;50;;;;';
    const {issues} = validate(makeEdi([q]));
    assert.ok(hasCode(issues, 'wQrbDeviation'));
  });
  it('no QRB check when PWWLo is 4-char (locator insufficient)', () => {
    const text = makeEdi(['260510;1030;OE5VRL;2;599;001;599;001;;JN78DG;50;;;;'], {PWWLo:'JN65'});
    const {issues} = validate(text);
    // wPwwloFormat fires, but wQrbDeviation should not (myLatLon is null or 4-char)
    assert.ok(!hasCode(issues, 'wQrbDeviation'));
  });
  it('dupe QSO skipped for QRB deviation check', () => {
    const q = '260510;1030;OE5VRL;2;599;001;599;001;;JN78DG;50;;;;D';
    const {issues} = validate(makeEdi([q]));
    assert.ok(!hasCode(issues, 'wQrbDeviation'));
  });
  it('non-numeric QRB → wQsoQrbNum, no wQrbDeviation', () => {
    const q = '260510;1030;OE5VRL;2;599;001;599;001;;JN78DG;abc;;;;';
    const {issues} = validate(makeEdi([q]));
    assert.ok(hasCode(issues, 'wQsoQrbNum'));
    assert.ok(!hasCode(issues, 'wQrbDeviation'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  validate — line length
// ═══════════════════════════════════════════════════════════════════════════════
describe('validate — line length', () => {
  it('line ≤75 chars → no wLineTooLong', () => {
    const {issues} = validate(makeEdi([GOOD_QSO]));
    assert.ok(!hasCode(issues, 'wLineTooLong'));
  });
  it('line 76 chars → wLineTooLong', () => {
    const long = 'SAnte=' + 'A'.repeat(70); // 76 chars
    const text = makeEdi([GOOD_QSO]).replace('SAnte=9el Yagi', long);
    const {issues} = validate(text);
    assert.ok(hasCode(issues, 'wLineTooLong'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  I18N
// ═══════════════════════════════════════════════════════════════════════════════
describe('I18N', () => {
  it('sl.sevError is non-empty', () => assert.ok(S.sl.sevError.length > 0));
  it('en.sevError is non-empty', () => assert.ok(S.en.sevError.length > 0));
  it('sl and en sevError are different', () => assert.notEqual(S.sl.sevError, S.en.sevError));
  it('all sl keys also present in en', () => {
    for (const k of Object.keys(S.sl)) assert.ok(k in S.en, `en missing key: ${k}`);
  });
  it('all en keys also present in sl', () => {
    for (const k of Object.keys(S.en)) assert.ok(k in S.sl, `sl missing key: ${k}`);
  });
});
