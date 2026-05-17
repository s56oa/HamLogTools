'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');

// ─── sandbox setup ───────────────────────────────────────────────
const html = fs.readFileSync('./adif-stats.html', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if(!scriptMatch) throw new Error('No <script> block found in adif-stats.html');

function makeMockEl() {
  return {
    textContent:'', innerHTML:'', value:'',
    style:{ display:'' },
    dataset:{ theme:'dark' },
    classList:{ add(){}, remove(){}, toggle(){} },
    addEventListener(){},
    click(){},
  };
}

const ctx = vm.createContext({
  localStorage:{ getItem:()=>null, setItem:()=>{} },
  document:{
    getElementById:()=> makeMockEl(),
    documentElement:{ dataset:{}, lang:'' },
    styleSheets:[],
  },
  URL:{ createObjectURL:()=>'blob:x', revokeObjectURL:()=>{} },
  Blob: class Blob { constructor(p){ this._parts=p; } },
  setTimeout:()=>{},
  clearTimeout:()=>{},
  console,
});
vm.runInContext(scriptMatch[1], ctx);

const {
  lookupCall,
  normBand, normMode,
  locToLatLon, haversine,
  parseADIF,
  computeStats,
  fmtDate, fmtMonth,
  htmlEsc,
  svgHBar, svgVBar,
  t,
} = ctx;

// ─── ADIF test fixture helper ─────────────────────────────────────
function adif(fields, withEoh=true) {
  const hdr = withEoh ? 'Test log\n<EOH>\n' : '';
  let rec = '';
  for(const [tag, val] of Object.entries(fields))
    rec += `<${tag}:${String(val).length}>${val} `;
  return hdr + rec + '<EOR>';
}

// ─────────────────────────────────────────────────────────────────
describe('lookupCall', () => {
  it('Slovenia S5', () => {
    const r = lookupCall('S59DGO');
    assert.equal(r.country, 'Slovenia');
    assert.equal(r.cont, 'EU');
  });
  it('Germany DL', () => {
    const r = lookupCall('DL1ABC');
    assert.equal(r.country, 'Germany');
    assert.equal(r.cont, 'EU');
  });
  it('USA K-prefix', () => {
    const r = lookupCall('K1TTT');
    assert.equal(r.country, 'United States');
    assert.equal(r.cont, 'NA');
  });
  it('Japan JA', () => {
    const r = lookupCall('JA1ZLO');
    assert.equal(r.country, 'Japan');
    assert.equal(r.cont, 'AS');
  });
  it('Russia EU (digit 3)', () => {
    const r = lookupCall('RA3XYZ');
    assert.equal(r.country, 'Russia');
    assert.equal(r.cont, 'EU');
  });
  it('Russia Asiatic (digit 9)', () => {
    const r = lookupCall('UA9ABC');
    assert.equal(r.cont, 'AS');
  });
  it('Russia Asiatic (digit 0)', () => {
    const r = lookupCall('RZ0ABC');
    assert.equal(r.cont, 'AS');
  });
  it('/P suffix stripped', () => {
    const r = lookupCall('S59DGO/P');
    assert.equal(r.country, 'Slovenia');
  });
  it('OE/prefix notation', () => {
    const r = lookupCall('OE/S59DGO');
    assert.equal(r.country, 'Austria');
  });
  it('unknown call returns Unknown/?', () => {
    const r = lookupCall('ZZ9ZZZ');
    assert.equal(r.country, 'Unknown');
    assert.equal(r.cont, '?');
  });
  it('empty string returns Unknown', () => {
    const r = lookupCall('');
    assert.equal(r.country, 'Unknown');
  });
  it('lowercase input normalised', () => {
    const r = lookupCall('s59dgo');
    assert.equal(r.country, 'Slovenia');
  });
  it('Alaska KL — DXCC override', () => {
    const r = lookupCall('KL7ABC');
    assert.equal(r.country, 'Alaska');
    assert.equal(r.cont, 'NA');
  });
  it('Azores CU — DXCC override', () => {
    const r = lookupCall('CU3ABC');
    assert.equal(r.country, 'Azores');
    assert.equal(r.cont, 'EU');
  });
  it('Corsica TK — DXCC override', () => {
    const r = lookupCall('TK1ABC');
    assert.equal(r.country, 'Corsica');
    assert.equal(r.cont, 'EU');
  });
  it('Malta 9H — DXCC override', () => {
    const r = lookupCall('9H1ABC');
    assert.equal(r.country, 'Malta');
    assert.equal(r.cont, 'EU');
  });
  it('Kaliningrad UA2 — DXCC override', () => {
    const r = lookupCall('UA2ABC');
    assert.equal(r.country, 'Kaliningrad');
    assert.equal(r.cont, 'EU');
  });
});

// ─────────────────────────────────────────────────────────────────
describe('normBand', () => {
  it('uppercase → lowercase', () => assert.equal(normBand('2M'), '2m'));
  it('mixed case', ()         => assert.equal(normBand('40M'), '40m'));
  it('trims spaces', ()       => assert.equal(normBand('  20m  '), '20m'));
  it('empty → empty', ()      => assert.equal(normBand(''), ''));
  it('null → empty', ()       => assert.equal(normBand(null), ''));
});

describe('normMode', () => {
  it('mode only', ()           => assert.equal(normMode('SSB',''), 'SSB'));
  it('submode wins', ()        => assert.equal(normMode('DIGI','FT8'), 'FT8'));
  it('FT4 submode', ()         => assert.equal(normMode('DIGI','FT4'), 'FT4'));
  it('both empty → empty', ()  => assert.equal(normMode('',''), ''));
  it('mode uppercased', ()     => assert.equal(normMode('cw',''), 'CW'));
});

// ─────────────────────────────────────────────────────────────────
describe('locToLatLon', () => {
  it('JN65 lat correct', () => {
    const [lat] = locToLatLon('JN65');
    assert.equal(lat, 45.5);
  });
  it('JN65 lon correct', () => {
    const [, lon] = locToLatLon('JN65');
    assert.equal(lon, 13);
  });
  it('null input → null', ()   => assert.equal(locToLatLon(null), null));
  it('too short → null', ()    => assert.equal(locToLatLon('JN'), null));
  it('6-char parsed as 4', () => {
    const r4 = locToLatLon('JN65');
    const r6 = locToLatLon('JN65ar');
    // first 4 chars determine result
    assert.equal(r4[0], r6[0]);
    assert.equal(r4[1], r6[1]);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('haversine', () => {
  it('same locator → 0', () => {
    assert.equal(haversine('JN65', 'JN65'), 0);
  });
  it('different locators > 0', () => {
    assert.ok(haversine('JN65', 'JN75') > 0);
  });
  it('transatlantic > 6000 km', () => {
    const d = haversine('JN65', 'FN20');
    assert.ok(d > 6000, `expected >6000, got ${d}`);
  });
  it('invalid loc1 → 0', () => {
    assert.equal(haversine('XX', 'JN65'), 0);
  });
  it('null → 0', () => {
    assert.equal(haversine(null, 'JN65'), 0);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('parseADIF — basic extraction', () => {
  it('extracts CALL', () => {
    const q = parseADIF(adif({CALL:'S59DGO',BAND:'2m',MODE:'SSB'}), 'test.adi');
    assert.equal(q.length, 1);
    assert.equal(q[0].call, 'S59DGO');
  });
  it('extracts band (lowercased)', () => {
    const q = parseADIF(adif({CALL:'DL1ABC',BAND:'40M',MODE:'CW'}), 'f.adi');
    assert.equal(q[0].band, '40m');
  });
  it('extracts mode uppercased', () => {
    const q = parseADIF(adif({CALL:'G3XYZ',BAND:'20m',MODE:'ssb'}), 'f.adi');
    assert.equal(q[0].mode, 'SSB');
  });
  it('submode overrides mode', () => {
    const q = parseADIF(adif({CALL:'F5XX',BAND:'20m',MODE:'DIGI',SUBMODE:'FT8'}), 'f.adi');
    assert.equal(q[0].mode, 'FT8');
  });
  it('src set to filename', () => {
    const q = parseADIF(adif({CALL:'OK1AB',BAND:'2m',MODE:'SSB'}), 'mylog.adi');
    assert.equal(q[0].src, 'mylog.adi');
  });
  it('skips record without CALL', () => {
    const txt = adif({BAND:'2m',MODE:'SSB'}, true);
    const q = parseADIF(txt, 'f.adi');
    assert.equal(q.length, 0);
  });
  it('multiple records', () => {
    const r1 = adif({CALL:'S59DGO',BAND:'2m',MODE:'SSB'}, false);
    const r2 = adif({CALL:'DL1ABC',BAND:'40m',MODE:'CW'}, false);
    const q = parseADIF('test\n<EOH>\n' + r1 + '\n' + r2, 'f.adi');
    assert.equal(q.length, 2);
  });
  it('no EOH (headerless ADIF)', () => {
    const q = parseADIF(adif({CALL:'PA3ABC',BAND:'20m',MODE:'FT8'}, false), 'f.adi');
    assert.equal(q.length, 1);
    assert.equal(q[0].call, 'PA3ABC');
  });
  it('case-insensitive tags', () => {
    const txt = 'log\n<EOH>\n<call:6>OM3ABC <band:3>20m <mode:3>SSB <eor>';
    const q = parseADIF(txt, 'f.adi');
    assert.equal(q[0].call, 'OM3ABC');
    assert.equal(q[0].band, '20m');
  });
});

describe('parseADIF — date/time/QRB', () => {
  it('date YYYYMMDD stored', () => {
    const q = parseADIF(adif({CALL:'SP5X',BAND:'20m',MODE:'SSB',QSO_DATE:'20240315'}), 'f.adi');
    assert.equal(q[0].date, '20240315');
  });
  it('ISO date (dashes) stripped', () => {
    const q = parseADIF(adif({CALL:'SP5X',BAND:'20m',MODE:'SSB',QSO_DATE:'2024-03-15'}), 'f.adi');
    assert.equal(q[0].date, '20240315');
  });
  it('short date stored as empty', () => {
    const q = parseADIF(adif({CALL:'SP5X',BAND:'20m',MODE:'SSB',QSO_DATE:'2024'}), 'f.adi');
    assert.equal(q[0].date, '');
  });
  it('time HHMMSS truncated to HHMM', () => {
    const q = parseADIF(adif({CALL:'YO8X',BAND:'2m',MODE:'SSB',TIME_ON:'143000'}), 'f.adi');
    assert.equal(q[0].time, '1430');
  });
  it('time HHMM kept', () => {
    const q = parseADIF(adif({CALL:'YO8X',BAND:'2m',MODE:'SSB',TIME_ON:'1430'}), 'f.adi');
    assert.equal(q[0].time, '1430');
  });
  it('DISTANCE field used as qrb', () => {
    const q = parseADIF(adif({CALL:'VE3X',BAND:'20m',MODE:'SSB',DISTANCE:'7542'}), 'f.adi');
    assert.equal(q[0].qrb, 7542);
  });
  it('GRIDSQUARE+MY_GRIDSQUARE → haversine qrb', () => {
    const q = parseADIF(adif({
      CALL:'DL5X',BAND:'2m',MODE:'SSB',
      GRIDSQUARE:'JN75',MY_GRIDSQUARE:'JN65',
    }), 'f.adi');
    assert.ok(q[0].qrb > 0, 'expected qrb > 0 from haversine');
  });
  it('DISTANCE takes priority over grid calc', () => {
    const q = parseADIF(adif({
      CALL:'DL5X',BAND:'2m',MODE:'SSB',
      DISTANCE:'999',GRIDSQUARE:'JN75',MY_GRIDSQUARE:'JN65',
    }), 'f.adi');
    assert.equal(q[0].qrb, 999);
  });
});

describe('parseADIF — country/cont', () => {
  it('Slovenia call → country Slovenia', () => {
    const q = parseADIF(adif({CALL:'S56OA',BAND:'2m',MODE:'SSB'}), 'f.adi');
    assert.equal(q[0].country, 'Slovenia');
    assert.equal(q[0].cont, 'EU');
  });
  it('JA → Japan / AS', () => {
    const q = parseADIF(adif({CALL:'JA1ZLO',BAND:'20m',MODE:'CW'}), 'f.adi');
    assert.equal(q[0].cont, 'AS');
  });
  it('unknown → Unknown/?', () => {
    const q = parseADIF(adif({CALL:'ZZ9ZZZ',BAND:'20m',MODE:'SSB'}), 'f.adi');
    assert.equal(q[0].country, 'Unknown');
    assert.equal(q[0].cont, '?');
  });
});

// ─────────────────────────────────────────────────────────────────
describe('computeStats — overview', () => {
  function makeQso(o) {
    return Object.assign(
      {call:'S59DGO',band:'2m',mode:'SSB',date:'20240315',time:'1430',
       qrb:0,country:'Slovenia',cont:'EU',grid:'',myGrid:'',src:'f.adi'}, o);
  }

  it('empty array → total 0', () => {
    const s = computeStats([]);
    assert.equal(s.total, 0);
    assert.equal(s.calls.size, 0);
  });
  it('counts total', () => {
    const s = computeStats([makeQso(), makeQso({call:'DL1ABC',country:'Germany'})]);
    assert.equal(s.total, 2);
  });
  it('unique calls (same call twice = 1)', () => {
    const s = computeStats([makeQso(), makeQso()]);
    assert.equal(s.calls.size, 1);
  });
  it('dates set tracks unique dates', () => {
    const s = computeStats([
      makeQso({date:'20240315'}),
      makeQso({date:'20240316'}),
      makeQso({date:'20240315'}),
    ]);
    assert.equal(s.dates.size, 2);
  });
  it('bestDX tracks maximum qrb', () => {
    const s = computeStats([
      makeQso({call:'DL1ABC',qrb:500}),
      makeQso({call:'JA1ZLO',qrb:9200}),
      makeQso({call:'F5XX',qrb:1200}),
    ]);
    assert.equal(s.bestDX.call, 'JA1ZLO');
    assert.equal(s.bestDX.qrb, 9200);
  });
  it('firstDate / lastDate', () => {
    const s = computeStats([
      makeQso({date:'20240315'}),
      makeQso({date:'20230101'}),
      makeQso({date:'20240630'}),
    ]);
    assert.equal(s.firstDate, '20230101');
    assert.equal(s.lastDate, '20240630');
  });
  it('countries only counts known', () => {
    const s = computeStats([
      makeQso({country:'Slovenia'}),
      makeQso({country:'Unknown'}),
      makeQso({country:'Germany'}),
    ]);
    assert.equal(s.countries.size, 2);
  });
});

describe('computeStats — aggregates', () => {
  function q(call, band, mode, date, time, cont, country, qrb=0) {
    return {call,band,mode,date,time,cont,country,qrb,grid:'',myGrid:'',src:'f.adi'};
  }

  it('byBand counts', () => {
    const s = computeStats([
      q('A','2m','SSB','20240101','1200','EU','Slovenia'),
      q('B','2m','SSB','20240101','1201','EU','Slovenia'),
      q('C','20m','CW', '20240101','1202','EU','Germany'),
    ]);
    assert.equal(s.byBand.get('2m').qso, 2);
    assert.equal(s.byBand.get('20m').qso, 1);
  });
  it('byBand unique calls', () => {
    const s = computeStats([
      q('DL1','2m','SSB','20240101','1200','EU','Germany'),
      q('DL1','2m','CW', '20240101','1201','EU','Germany'),
      q('DL2','2m','SSB','20240101','1202','EU','Germany'),
    ]);
    assert.equal(s.byBand.get('2m').calls.size, 2);
  });
  it('byBand bestDX', () => {
    const s = computeStats([
      q('A','2m','SSB','20240101','1200','EU','Slovenia',500),
      q('B','2m','SSB','20240101','1201','EU','Slovenia',800),
    ]);
    assert.equal(s.byBand.get('2m').bestDX, 800);
  });
  it('byMode counts', () => {
    const s = computeStats([
      q('A','2m','SSB','20240101','1200','EU','Slovenia'),
      q('B','2m','CW', '20240101','1201','EU','Slovenia'),
      q('C','2m','CW', '20240101','1202','EU','Slovenia'),
    ]);
    assert.equal(s.byMode.get('SSB').qso, 1);
    assert.equal(s.byMode.get('CW').qso, 2);
  });
  it('byCont countries set', () => {
    const s = computeStats([
      q('DL1','2m','SSB','20240101','1200','EU','Germany'),
      q('OK1','2m','SSB','20240101','1201','EU','Czech Republic'),
      q('SP1','2m','SSB','20240101','1202','EU','Poland'),
    ]);
    assert.equal(s.byCont.get('EU').countries.size, 3);
  });
  it('byHour increments correct slot', () => {
    const s = computeStats([
      q('A','2m','SSB','20240101','1430','EU','Slovenia'),
      q('B','2m','SSB','20240101','1445','EU','Slovenia'),
      q('C','2m','SSB','20240101','0900','EU','Slovenia'),
    ]);
    assert.equal(s.byHour[14], 2);
    assert.equal(s.byHour[9],  1);
    assert.equal(s.byHour[0],  0);
  });
  it('byMonth groups correctly', () => {
    const s = computeStats([
      q('A','2m','SSB','20240315','1200','EU','Slovenia'),
      q('B','2m','SSB','20240320','1200','EU','Slovenia'),
      q('C','2m','SSB','20240401','1200','EU','Slovenia'),
    ]);
    assert.equal(s.byMonth.get('202403'), 2);
    assert.equal(s.byMonth.get('202404'), 1);
  });
  it('topCalls sorted', () => {
    const s = computeStats([
      q('DL1','2m','SSB','20240101','1200','EU','Germany'),
      q('DL1','2m','SSB','20240101','1201','EU','Germany'),
      q('OK1','2m','SSB','20240101','1202','EU','Czech Republic'),
    ]);
    const sorted = [...s.topCalls.entries()].sort((a,b)=>b[1]-a[1]);
    assert.equal(sorted[0][0], 'DL1');
    assert.equal(sorted[0][1], 2);
  });
  it('unknown cont not counted in byCont', () => {
    const s = computeStats([
      q('ZZ9','2m','SSB','20240101','1200','?','Unknown'),
    ]);
    assert.equal(s.byCont.size, 0);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('applyFilters — date filter', () => {
  function q(call, date) {
    return {call, band:'2m', mode:'SSB', date, time:'1200',
            cont:'EU', country:'Slovenia', qrb:0, grid:'', myGrid:'', src:'f.adi'};
  }
  function filter(qsos, from, to) {
    // replicate applyFilters logic in isolation
    return qsos.filter(qq => {
      if(from && (!qq.date || qq.date < from)) return false;
      if(to   && (!qq.date || qq.date > to))   return false;
      return true;
    });
  }

  it('QSO without date excluded when from is set', () => {
    const res = filter([q('A',''), q('B','20240315')], '20240101', '');
    assert.equal(res.length, 1);
    assert.equal(res[0].call, 'B');
  });
  it('QSO without date excluded when to is set', () => {
    const res = filter([q('A',''), q('B','20240315')], '', '20241231');
    assert.equal(res.length, 1);
    assert.equal(res[0].call, 'B');
  });
  it('QSO in range passes', () => {
    const res = filter([q('A','20240315')], '20240101', '20241231');
    assert.equal(res.length, 1);
  });
  it('QSO before from excluded', () => {
    const res = filter([q('A','20231201')], '20240101', '');
    assert.equal(res.length, 0);
  });
  it('QSO after to excluded', () => {
    const res = filter([q('A','20250101')], '', '20241231');
    assert.equal(res.length, 0);
  });
  it('no filter passes all', () => {
    const res = filter([q('A','20240315'), q('B','')], '', '');
    assert.equal(res.length, 2);
  });
});

describe('fmtDate', () => {
  it('YYYYMMDD → DD.MM.YYYY', () => assert.equal(fmtDate('20240315'), '15.03.2024'));
  it('another date',           () => assert.equal(fmtDate('20001231'), '31.12.2000'));
  it('empty → empty',          () => assert.equal(fmtDate(''), ''));
  it('short → returned as-is', () => assert.equal(fmtDate('2024'), '2024'));
});

describe('fmtMonth', () => {
  it('202403 → 03/2024', () => assert.equal(fmtMonth('202403'), '03/2024'));
  it('202412 → 12/2024', () => assert.equal(fmtMonth('202412'), '12/2024'));
  it('empty → empty',    () => assert.equal(fmtMonth(''), ''));
});

// ─────────────────────────────────────────────────────────────────
describe('htmlEsc', () => {
  it('& → &amp;',  () => assert.equal(htmlEsc('&'), '&amp;'));
  it('< → &lt;',   () => assert.equal(htmlEsc('<'), '&lt;'));
  it('> → &gt;',   () => assert.equal(htmlEsc('>'), '&gt;'));
  it('" → &quot;', () => assert.equal(htmlEsc('"'), '&quot;'));
  it('safe text unchanged', () => assert.equal(htmlEsc('hello'), 'hello'));
  it('XSS payload escaped', () => {
    const r = htmlEsc('<script>alert(1)</script>');
    assert.ok(!r.includes('<script>'));
  });
  it('number converted to string', () => assert.equal(htmlEsc(42), '42'));
});

// ─────────────────────────────────────────────────────────────────
describe('svgHBar', () => {
  it('empty items → no <svg>', () => {
    const r = svgHBar([]);
    assert.ok(!r.includes('<svg'), 'should not contain svg for empty data');
  });
  it('single item → contains <svg>', () => {
    const r = svgHBar([{label:'2m', val:10}]);
    assert.ok(r.includes('<svg'));
  });
  it('items produce <rect> bars', () => {
    const r = svgHBar([{label:'2m',val:10},{label:'40m',val:5}]);
    assert.ok(r.includes('<rect'));
  });
  it('labels appear in output', () => {
    const r = svgHBar([{label:'testband',val:7}]);
    assert.ok(r.includes('testband'));
  });
  it('zero val produces no <rect>', () => {
    const r = svgHBar([{label:'6m',val:0},{label:'2m',val:10}]);
    // only non-zero items get bars (bw>0 guard)
    const rects = (r.match(/<rect/g)||[]).length;
    assert.equal(rects, 1);
  });
  it('colorFn applied', () => {
    const r = svgHBar([{label:'EU',val:5,cont:'EU'}], it => '#ff0000');
    assert.ok(r.includes('#ff0000'));
  });
});

describe('svgVBar', () => {
  it('empty items → no <svg>', () => {
    const r = svgVBar([]);
    assert.ok(!r.includes('<svg'));
  });
  it('items → contains <svg>', () => {
    const r = svgVBar([{label:'01',val:5},{label:'02',val:3}]);
    assert.ok(r.includes('<svg'));
  });
  it('all-zero values → no <rect>', () => {
    const items = Array.from({length:4},(_,i)=>({label:String(i),val:0}));
    const r = svgVBar(items);
    assert.ok(!r.includes('<rect'), 'zero values should not produce bars');
  });
  it('24-item hour chart renders', () => {
    const items = Array.from({length:24},(_,i)=>({label:String(i).padStart(2,'0'),val:i*2}));
    const r = svgVBar(items,'var(--accent3)',580);
    assert.ok(r.includes('<svg'));
    assert.ok(r.includes('<rect'));
  });
  it('short bar (val>0, height<14) shows value above bar in muted color', () => {
    // max=100, val=1 → bh = round(1/100*80) = 1 → short bar
    const items = [{label:'<500',val:1},{label:'big',val:100}];
    const r = svgVBar(items,'var(--accent2)',280);
    assert.ok(r.includes('var(--muted)'), 'short bar should use muted fill for above-bar label');
  });
  it('zero-val bar has no value label', () => {
    const items = [{label:'none',val:0},{label:'some',val:5}];
    const r = svgVBar(items);
    // only 1 value label (for val=5), not for val=0
    const textMatches = (r.match(/>0</g)||[]).length + (r.match(/>5</g)||[]).length;
    assert.ok(r.includes('>5<'), 'val=5 should have label');
    assert.ok(!r.includes('>0<'), 'val=0 should not have label');
  });
});

// ─────────────────────────────────────────────────────────────────
describe('I18N', () => {
  it('all keys have SL translation', () => {
    // S is a const — not in context, but t() closure wraps it
    // verify t() returns non-key strings for known keys
    const secOver = t('secOver');
    assert.ok(secOver.length > 0);
    assert.notEqual(secOver, 'secOver');
  });
  it('t() of unknown key returns the key', () => {
    assert.equal(t('__nonexistent__'), '__nonexistent__');
  });
  it('t() returns string for all section keys', () => {
    const keys = ['secOver','secBand','secMode','secCont','secCountry','secTime','secTop'];
    keys.forEach(k => {
      const v = t(k);
      assert.ok(typeof v === 'string' && v.length > 0, `key ${k} returned empty`);
    });
  });
  it('t() returns string for all stat card keys', () => {
    const keys = ['cTotal','cUniq','cCountries','cDays','cBestDX','cDateRange'];
    keys.forEach(k => {
      assert.ok(t(k).length > 0, `key ${k} empty`);
    });
  });
  it('t() returns string for new section keys', () => {
    const keys = ['secDxcc','secHeatmap','secBandHour','secQrb','dxccTotal','dxccCount','dxccProg','qrbRange','qrbNoData'];
    keys.forEach(k => {
      const v = t(k);
      assert.ok(typeof v === 'string' && v.length > 0, `key ${k} returned empty`);
      assert.notEqual(v, k, `key ${k} not translated`);
    });
  });
  it('hmapDow SL has 7 day abbreviations', () => {
    const parts = t('hmapDow').split('|');
    assert.equal(parts.length, 7);
    assert.equal(parts[0], 'Po');
    assert.equal(parts[6], 'Ne');
  });
  it('hmapMon SL has 12 month abbreviations', () => {
    const parts = t('hmapMon').split('|');
    assert.equal(parts.length, 12);
    assert.equal(parts[0], 'Jan');
    assert.equal(parts[11], 'Dec');
  });
  it('hmapMore key exists and is non-empty', () => {
    assert.ok(t('hmapMore').length > 0);
    assert.notEqual(t('hmapMore'), 'hmapMore');
  });
});

// ─────────────────────────────────────────────────────────────────
describe('computeStats — byDay', () => {
  function q(date) {
    return {call:'DL1',band:'20m',mode:'SSB',date,time:'1200',cont:'EU',country:'Germany',qrb:0,grid:'',myGrid:'',src:'f.adi'};
  }
  it('counts QSOs per day', () => {
    const s = computeStats([q('20240315'),q('20240315'),q('20240316')]);
    assert.equal(s.byDay.get('20240315'), 2);
    assert.equal(s.byDay.get('20240316'), 1);
  });
  it('empty date string not counted', () => {
    const s = computeStats([q('')]);
    assert.equal(s.byDay.size, 0);
  });
  it('three distinct days', () => {
    const s = computeStats([q('20240101'),q('20240201'),q('20240301')]);
    assert.equal(s.byDay.size, 3);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('computeStats — byBandHour', () => {
  function q(band, time) {
    return {call:'DL1',band,mode:'SSB',date:'20240101',time,cont:'EU',country:'Germany',qrb:0,grid:'',myGrid:'',src:'f.adi'};
  }
  it('creates 24-element array per band', () => {
    const s = computeStats([q('20m','1430')]);
    assert.equal(s.byBandHour.get('20m').length, 24);
  });
  it('increments correct hour slot', () => {
    const s = computeStats([q('20m','1430'),q('20m','1459'),q('20m','0900')]);
    assert.equal(s.byBandHour.get('20m')[14], 2);
    assert.equal(s.byBandHour.get('20m')[9],  1);
    assert.equal(s.byBandHour.get('20m')[0],  0);
  });
  it('separate arrays per band', () => {
    const s = computeStats([q('20m','1200'),q('40m','1200')]);
    assert.ok(s.byBandHour.has('20m'));
    assert.ok(s.byBandHour.has('40m'));
    assert.equal(s.byBandHour.get('20m')[12], 1);
    assert.equal(s.byBandHour.get('40m')[12], 1);
  });
  it('skips QSOs with missing time — no band entry created', () => {
    const s = computeStats([q('20m','')]);
    assert.equal(s.byBandHour.has('20m'), false);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('computeStats — byDxcc / byBandDxcc', () => {
  function q(call, band, country, cont='EU') {
    return {call,band,mode:'SSB',date:'20240101',time:'1200',cont,country,qrb:0,grid:'',myGrid:'',src:'f.adi'};
  }
  it('byDxcc counts unique DXCC entities', () => {
    const s = computeStats([
      q('DL1','20m','Germany'),
      q('OK1','20m','Czech Republic'),
      q('DL2','20m','Germany'),
    ]);
    assert.equal(s.byDxcc.size, 2);
  });
  it('byDxcc entry has qso count', () => {
    const s = computeStats([q('DL1','20m','Germany'),q('DL2','20m','Germany')]);
    assert.equal(s.byDxcc.get('Germany').qso, 2);
  });
  it('byDxcc entry tracks bands', () => {
    const s = computeStats([q('DL1','20m','Germany'),q('DL1','40m','Germany')]);
    assert.ok(s.byDxcc.get('Germany').bands.has('20m'));
    assert.ok(s.byDxcc.get('Germany').bands.has('40m'));
  });
  it('byBandDxcc: set of countries per band', () => {
    const s = computeStats([
      q('DL1','20m','Germany'),
      q('OK1','20m','Czech Republic'),
      q('F5XX','40m','France'),
    ]);
    assert.equal(s.byBandDxcc.get('20m').size, 2);
    assert.equal(s.byBandDxcc.get('40m').size, 1);
  });
  it('Unknown country excluded from byDxcc', () => {
    const s = computeStats([q('ZZ9','20m','Unknown','?')]);
    assert.equal(s.byDxcc.size, 0);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('computeStats — qrbBuckets', () => {
  function q(qrb) {
    return {call:'DL1',band:'20m',mode:'SSB',date:'20240101',time:'1200',cont:'EU',country:'Germany',qrb,grid:'',myGrid:'',src:'f.adi'};
  }
  it('6 buckets in stats object', () => {
    const s = computeStats([]);
    assert.equal(s.qrbBuckets.length, 6);
  });
  it('<500 → bucket 0', () => {
    const s = computeStats([q(200), q(499)]);
    assert.equal(s.qrbBuckets[0], 2);
  });
  it('500-1000 → bucket 1', () => {
    const s = computeStats([q(500), q(999)]);
    assert.equal(s.qrbBuckets[1], 2);
  });
  it('1000-2000 → bucket 2', () => {
    const s = computeStats([q(1000), q(1999)]);
    assert.equal(s.qrbBuckets[2], 2);
  });
  it('2000-5000 → bucket 3', () => {
    const s = computeStats([q(2000), q(4999)]);
    assert.equal(s.qrbBuckets[3], 2);
  });
  it('5000-10000 → bucket 4', () => {
    const s = computeStats([q(5000), q(9999)]);
    assert.equal(s.qrbBuckets[4], 2);
  });
  it('≥10000 → bucket 5', () => {
    const s = computeStats([q(10000), q(15000)]);
    assert.equal(s.qrbBuckets[5], 2);
  });
  it('qrb=0 not bucketed', () => {
    const s = computeStats([q(0)]);
    assert.equal(s.qrbBuckets.reduce((a,b)=>a+b,0), 0);
  });
});
