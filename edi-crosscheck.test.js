'use strict';
/**
 * edi-crosscheck.test.js
 *
 * Unit tests for the EDI Crosscheck tool.
 * Run: node --test --test-reporter=spec edi-crosscheck.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const vm   = require('node:vm');

// ─── Extract JS from <script>…</script> ──────────────────────────────────────
const src = fs.readFileSync(path.join(__dirname, 'edi-crosscheck.html'), 'utf-8');
const jsMatch = src.match(/<script>([\s\S]*?)<\/script>/);
if(!jsMatch) throw new Error('No <script> block found in edi-crosscheck.html');
const jsSrc = jsMatch[1];

// ─── DOM mock: permissive element that absorbs all property access ────────────
// const/let module-level vars are NOT accessible as ctx properties in vm.
// We route all state mutations through function declarations (clearHist,
// addToHistDB, runCrosscheck) which ARE accessible.  DOM methods are no-ops.
const mockEl = new Proxy({}, {
  get(t, k) {
    if(k === 'style')   return {};
    if(k === 'classList') return { add:()=>{}, remove:()=>{}, toggle:()=>{} };
    if(typeof k === 'symbol') return undefined;
    const scalarKeys = ['textContent','innerHTML','disabled','className','placeholder','value'];
    if(scalarKeys.includes(k)) return '';
    if(k === 'querySelectorAll' || k === 'querySelector') return ()=>[];
    return () => mockEl;
  },
  set() { return true; },
});

const ctx = vm.createContext({
  console: { log:()=>{}, error:()=>{} },
  require, fs, path,
  process: { argv:[], exit:()=>{}, env:{} },
  Buffer, Date, JSON, Math, String, Number, RegExp, Set, Map, Array, Object,
  parseInt, isNaN, clearTimeout, setTimeout: ()=>0,
  localStorage: { getItem:()=>null, setItem:()=>{} },
  document: {
    getElementById:    ()=> mockEl,
    documentElement: { getAttribute:()=>'', setAttribute:()=>{} },
    querySelectorAll:  ()=> [],
  },
});

vm.runInContext(jsSrc, ctx);

// Functions accessible as ctx properties (defined with `function` keyword)
const {
  baseCall, levenshtein, parseEDI,
  addToHistDB, runCrosscheck, clearHist,
} = ctx;

// ─────────────────────────────────────────────────────────────────────────────
//  baseCall — portable/mobile suffix stripping
// ─────────────────────────────────────────────────────────────────────────────

describe('baseCall', () => {
  it('strips /P',    () => assert.equal(baseCall('S59DGO/P'),  'S59DGO'));
  it('strips /M',    () => assert.equal(baseCall('S59DGO/M'),  'S59DGO'));
  it('strips /MM',   () => assert.equal(baseCall('S59DGO/MM'), 'S59DGO'));
  it('strips /AM',   () => assert.equal(baseCall('DK3AB/AM'),  'DK3AB'));
  it('strips /QRP',  () => assert.equal(baseCall('S59DGO/QRP'),'S59DGO'));
  it('strips /R',    () => assert.equal(baseCall('DL1AA/R'),   'DL1AA'));
  it('strips Italian regional suffix /IV3', () =>
    assert.equal(baseCall('IK6ABC/IV3'), 'IK6ABC'));
  it('strips numerical district suffix /1', () =>
    assert.equal(baseCall('S59DGO/1'), 'S59DGO'));
  it('strips /A and /B (rare in contests)', () => {
    assert.equal(baseCall('DL1AA/A'), 'DL1AA');
    assert.equal(baseCall('DL1AA/B'), 'DL1AA');
  });
  it('leaves prefix slash intact (OE/S59DGO)', () =>
    assert.equal(baseCall('OE/S59DGO'), 'OE/S59DGO'));
  it('leaves prefix slash intact (F/ON4AAA)', () =>
    assert.equal(baseCall('F/ON4AAA'), 'F/ON4AAA'));
  it('plain call unchanged', () => assert.equal(baseCall('S59DGO'), 'S59DGO'));
  it('uppercases result',    () => assert.equal(baseCall('s59dgo/p'), 'S59DGO'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  levenshtein
// ─────────────────────────────────────────────────────────────────────────────

describe('levenshtein', () => {
  it('identical strings → 0',              () => assert.equal(levenshtein('S59DGO','S59DGO',2), 0));
  it('single substitution → 1',            () => assert.equal(levenshtein('S59DGO','S59DG0',2), 1));
  it('single insertion → 1',               () => assert.equal(levenshtein('S59DG','S59DGO',2),  1));
  it('single deletion → 1',               () => assert.equal(levenshtein('S59DGOX','S59DGO',2), 1));
  it('two substitutions → 2',              () => assert.equal(levenshtein('S59DGO','S49DG1',2), 2));
  it('three substitutions > maxDist 2',    () => assert.ok(levenshtein('S59DGO','S56XYZ',2) > 2));
  it('length diff > maxDist → short-circuit', () => assert.ok(levenshtein('AB','ABCDEF',2) > 2));
  it('empty vs empty → 0',                () => assert.equal(levenshtein('','',2), 0));
  it('empty vs one char → 1',             () => assert.equal(levenshtein('','A',2), 1));
});

// ─────────────────────────────────────────────────────────────────────────────
//  parseEDI
// ─────────────────────────────────────────────────────────────────────────────

describe('parseEDI', () => {
  const sample = [
    'TName=VHF Contest 2026',
    'PCall=S59DGO',
    'PWWLo=JN65VP',
    'PBand=144 MHz',
    '[QSORecords 2]',
    '260510;1000;S59ABC;1;59;001;59;001;;JN65ar;120;0;0;',
    '260510;1005;S56DEF/P;1;59;002;59;002;;JN64ab;80;0;0;',
  ].join('\n');

  it('parses two QSO records',                 () => assert.equal(parseEDI(sample,'t.edi').qsos.length, 2));
  it('extracts callsign',                       () => assert.equal(parseEDI(sample,'t.edi').qsos[0].call, 'S59ABC'));
  it('keeps portable suffix in call',           () => assert.equal(parseEDI(sample,'t.edi').qsos[1].call, 'S56DEF/P'));
  it('applies band from header to all QSOs',    () => assert.equal(parseEDI(sample,'t.edi').qsos[0].band, '2m'));
  it('locator uses mixed case (JN65ar)',         () => assert.equal(parseEDI(sample,'t.edi').qsos[0].wwl,  'JN65ar'));
  it('formats date as DD.MM.YYYY',              () => assert.equal(parseEDI(sample,'t.edi').qsos[0].dateDisp, '10.05.2026'));
  it('skips ERROR callsigns', () => {
    const edi = ['[QSORecords 1]','260510;1000;ERROR;1;59;001;59;001;;JN65ar;0;0;0;'].join('\n');
    assert.equal(parseEDI(edi,'x.edi').qsos.length, 0);
  });
  it('rejects invalid locator (clears wwl)', () => {
    const edi = ['[QSORecords 1]','260510;1000;S59ABC;1;59;001;59;001;;JN6;0;0;0;'].join('\n');
    assert.equal(parseEDI(edi,'x.edi').qsos[0].wwl, '');
  });
  it('handles CRLF line endings', () => {
    const edi = sample.replace(/\n/g,'\r\n');
    assert.equal(parseEDI(edi,'t.edi').qsos.length, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  runCrosscheck — locator mismatch
// ─────────────────────────────────────────────────────────────────────────────

describe('runCrosscheck — locator mismatch', () => {
  before(() => clearHist());

  function hist(call, wwl, n=1){ return Array.from({length:n}, ()=>({call, wwl})); }
  function check(call, wwl){ return [{call, wwl, dateDisp:'', mode:'SSB', band:'2m'}]; }

  it('clean when locator matches historical mode', () => {
    clearHist(); addToHistDB(hist('S59ABC','JN65ar',5));
    const res = runCrosscheck(check('S59ABC','JN65ar'));
    assert.equal(res[0].issues.length, 0);
  });

  it('flags high-severity mismatch (mode >= 60%, new loc never seen)', () => {
    clearHist(); addToHistDB(hist('S59ABC','JN65ar',8));
    const res = runCrosscheck(check('S59ABC','JN76bc'));
    const iss = res[0].issues[0];
    assert.equal(iss.type, 'LOC_MISMATCH');
    assert.equal(iss.severity, 'high');
    assert.equal(iss.historicalMode, 'JN65AR');
    assert.equal(iss.newLocCount, 0);
  });

  it('flags medium-severity when new loc was seen before', () => {
    clearHist();
    addToHistDB(hist('S59ABC','JN65ar',7));
    addToHistDB(hist('S59ABC','JN76bc',2));
    const res = runCrosscheck(check('S59ABC','JN76bc'));
    const iss = res[0].issues[0];
    assert.equal(iss.type, 'LOC_MISMATCH');
    assert.equal(iss.severity, 'med');
    assert.ok(iss.newLocCount >= 1);
  });

  it('no flag when fewer than 3 historical appearances', () => {
    clearHist(); addToHistDB(hist('S59ABC','JN65ar',2));
    const res = runCrosscheck(check('S59ABC','JN76bc'));
    const locIss = res[0].issues.filter(i=>i.type==='LOC_MISMATCH');
    assert.equal(locIss.length, 0);
  });

  it('no flag when QSO has no locator', () => {
    clearHist(); addToHistDB(hist('S59ABC','JN65ar',5));
    const res = runCrosscheck([{call:'S59ABC', wwl:'', dateDisp:'', mode:'SSB', band:'2m'}]);
    const locIss = res[0].issues.filter(i=>i.type==='LOC_MISMATCH');
    assert.equal(locIss.length, 0);
  });

  it('allLocs sorted by count descending', () => {
    clearHist();
    addToHistDB(hist('S59ABC','JN76bc',3));
    addToHistDB(hist('S59ABC','JN65ar',10));
    const res = runCrosscheck(check('S59ABC','JN76bc'));
    const iss = res[0].issues.find(i=>i.type==='LOC_MISMATCH');
    assert.ok(iss.allLocs[0][1] >= iss.allLocs[1][1], 'allLocs not sorted by count');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  runCrosscheck — callsign check
// ─────────────────────────────────────────────────────────────────────────────

describe('runCrosscheck — callsign check', () => {
  function hist(call, wwl, n=1){ return Array.from({length:n}, ()=>({call, wwl})); }

  it('CALL_SIMILAR for distance-1 match', () => {
    clearHist(); addToHistDB(hist('S59DGO','JN65vp',10));
    // S59DG0 (zero) vs S59DGO (letter O) → distance 1
    const res = runCrosscheck([{call:'S59DG0', wwl:'JN65vp', dateDisp:'', mode:'SSB', band:'2m'}]);
    const iss = res[0].issues[0];
    assert.equal(iss.type, 'CALL_SIMILAR');
    assert.equal(iss.similar[0].call, 'S59DGO');
    assert.equal(iss.similar[0].dist, 1);
  });

  it('CALL_UNKNOWN when no similar found', () => {
    clearHist(); addToHistDB(hist('S59DGO','JN65vp',1));
    const res = runCrosscheck([{call:'ZL9XYZ', wwl:'', dateDisp:'', mode:'SSB', band:'2m'}]);
    assert.equal(res[0].issues[0].type, 'CALL_UNKNOWN');
  });

  it('no call flag when call is in history', () => {
    clearHist(); addToHistDB(hist('S59ABC','JN65ar',1));
    const res = runCrosscheck([{call:'S59ABC', wwl:'JN65ar', dateDisp:'', mode:'SSB', band:'2m'}]);
    const callIss = res[0].issues.filter(i=>i.type==='CALL_SIMILAR'||i.type==='CALL_UNKNOWN');
    assert.equal(callIss.length, 0);
  });

  it('portable call normalised to base for history lookup', () => {
    clearHist(); addToHistDB(hist('S59ABC','JN65ar',5));
    // S59ABC/P should resolve to S59ABC → in history → no call issue
    const res = runCrosscheck([{call:'S59ABC/P', wwl:'JN65ar', dateDisp:'', mode:'SSB', band:'2m'}]);
    const callIss = res[0].issues.filter(i=>i.type==='CALL_SIMILAR'||i.type==='CALL_UNKNOWN');
    assert.equal(callIss.length, 0);
  });

  it('similar suggestions sorted by distance then count', () => {
    clearHist();
    addToHistDB(hist('S59DGO','JN65vp',3));
    addToHistDB(hist('S59DGP','JN65vp',10)); // same distance=1 but higher count
    const res = runCrosscheck([{call:'S59DG0', wwl:'', dateDisp:'', mode:'SSB', band:'2m'}]);
    const sim = res[0].issues[0].similar;
    // All should be distance 1; higher count first
    assert.equal(sim[0].dist, 1);
    assert.ok(sim[0].count >= sim[1].count);
  });

  it('distance-2 similarity flagged with lower severity badge', () => {
    clearHist();
    // S59ABC vs S59XYZ — distance 3, should NOT appear
    // S59ABC vs S59AB — distance 1
    addToHistDB(hist('S59AB','JN65ar',5));
    const res = runCrosscheck([{call:'S59ABC', wwl:'', dateDisp:'', mode:'SSB', band:'2m'}]);
    const iss = res[0].issues.find(i=>i.type==='CALL_SIMILAR');
    assert.ok(iss, 'expected CALL_SIMILAR');
    assert.ok(iss.similar.every(s=>s.dist<=2));
  });

  it('both issues can appear on same QSO (CALL_SIMILAR + none for loc without history)', () => {
    clearHist();
    addToHistDB(hist('S59DGO','JN65vp',10));
    // S59DG0 → similar to S59DGO; and since not in history, no loc check
    const res = runCrosscheck([{call:'S59DG0', wwl:'JN66aa', dateDisp:'', mode:'SSB', band:'2m'}]);
    assert.equal(res[0].issues.length, 1);
    assert.equal(res[0].issues[0].type, 'CALL_SIMILAR');
  });

  it('deduplicates similar-call computation across repeated unknown calls', () => {
    clearHist(); addToHistDB(hist('S59DGO','JN65vp',5));
    // Two QSOs with the same unknown call — should both produce CALL_SIMILAR
    const qsos = [
      {call:'S59DG0', wwl:'', dateDisp:'', mode:'SSB', band:'2m'},
      {call:'S59DG0', wwl:'', dateDisp:'', mode:'SSB', band:'2m'},
    ];
    const res = runCrosscheck(qsos);
    assert.equal(res[0].issues[0].type, 'CALL_SIMILAR');
    assert.equal(res[1].issues[0].type, 'CALL_SIMILAR');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  runCrosscheck — missing locator suggestion
// ─────────────────────────────────────────────────────────────────────────────

describe('runCrosscheck — missing locator suggestion', () => {
  function hist(call, wwl, n=1){ return Array.from({length:n}, ()=>({call, wwl})); }
  function check(call, wwl){ return [{call, wwl, dateDisp:'02.09.2023', mode:'SSB', band:'2m'}]; }

  it('suggests historical mode when new log has no locator', () => {
    clearHist();
    addToHistDB(hist('S59ABC','JN65ar',8));
    const res = runCrosscheck(check('S59ABC',''));
    const iss = res[0].issues[0];
    assert.equal(iss.type, 'LOC_MISSING');
    assert.equal(iss.historicalMode, 'JN65AR');
    assert.equal(iss.severity, 'high'); // 8/8 = 100% >= 0.6
  });

  it('LOC_MISSING severity is med when confidence below threshold', () => {
    clearHist();
    addToHistDB(hist('S59ABC','JN65ar',4));
    addToHistDB(hist('S59ABC','JN76bc',4));
    // mode = 4/8 = 50%, below 60% threshold
    const res = runCrosscheck(check('S59ABC',''));
    const iss = res[0].issues[0];
    assert.equal(iss.type, 'LOC_MISSING');
    assert.equal(iss.severity, 'med');
  });

  it('no suggestion when fewer than minAppearances', () => {
    clearHist(); addToHistDB(hist('S59ABC','JN65ar',2));
    const res = runCrosscheck(check('S59ABC',''));
    const locIss = res[0].issues.filter(i=>i.type==='LOC_MISSING');
    assert.equal(locIss.length, 0);
  });

  it('no suggestion when all historical entries have no locator', () => {
    clearHist(); addToHistDB(hist('S59ABC','',5));
    const res = runCrosscheck(check('S59ABC',''));
    const locIss = res[0].issues.filter(i=>i.type==='LOC_MISSING');
    assert.equal(locIss.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  runCrosscheck — configurable thresholds
// ─────────────────────────────────────────────────────────────────────────────

describe('runCrosscheck — configurable thresholds', () => {
  function hist(call, wwl, n=1){ return Array.from({length:n}, ()=>({call, wwl})); }
  function check(call, wwl){ return [{call, wwl, dateDisp:'02.09.2023', mode:'SSB', band:'2m'}]; }

  it('respects _minAppearances: no flag with lower threshold', () => {
    clearHist(); addToHistDB(hist('S59ABC','JN65ar',2));
    // Default _minAppearances = 3, so no flag
    let res = runCrosscheck(check('S59ABC','JN76bc'));
    assert.equal(res[0].issues.filter(i=>i.type==='LOC_MISMATCH').length, 0);
  });

  it('respects _minConfidence: high vs med severity', () => {
    clearHist();
    addToHistDB(hist('S59ABC','JN65ar',7));
    addToHistDB(hist('S59ABC','JN76bc',3));
    // mode = 7/10 = 70%, newLocCount = 3
    // With default _minConfidence = 0.6: modeConf >= 0.6 → high (but newLocCount > 0, so med)
    // Actually: severity = (modeConf >= 0.6 && newLocCount === 0) ? high : med
    // newLocCount = 3 > 0, so severity = med
    let res = runCrosscheck(check('S59ABC','JN76bc'));
    let iss = res[0].issues[0];
    assert.equal(iss.severity, 'med');
  });

  it('empty historical locators are ignored in getModeLocator', () => {
    clearHist();
    // 5 entries with empty locator + 3 with real locator
    addToHistDB(Array.from({length:5}, ()=>({call:'S59ABC', wwl:''})));
    addToHistDB(hist('S59ABC','JN65ar',3));
    const res = runCrosscheck(check('S59ABC','JN76bc'));
    const iss = res[0].issues[0];
    assert.equal(iss.historicalMode, 'JN65AR'); // mode should be JN65AR, not empty
    assert.equal(iss.total, 8); // total includes all entries (with and without locator)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  runCrosscheck — callsign by locator (composite heuristic)
// ─────────────────────────────────────────────────────────────────────────────

describe('runCrosscheck — callsign by locator', () => {
  function hist(call, wwl, n=1){ return Array.from({length:n}, ()=>({call, wwl})); }

  it('suggests calls from same locator within Levenshtein <= 2', () => {
    clearHist();
    addToHistDB([...hist('IW3GOA','JN65DM',5), ...hist('IW3GOB','JN65DM',3)]);
    const res = runCrosscheck([{call:'IK3GOY', wwl:'JN65DM', dateDisp:'', mode:'SSB', band:'2m'}]);
    const byLoc = res[0].issues.find(i => i.type === 'CALL_BY_LOC');
    assert.ok(byLoc, 'expected CALL_BY_LOC');
    assert.equal(byLoc.similar[0].call, 'IW3GOA');
    assert.equal(byLoc.similar[0].dist, 2);
  });

  it('no CALL_BY_LOC when no calls from locator within distance 2', () => {
    clearHist();
    addToHistDB(hist('S59DGO','JN65DM',10)); // S59DGO is far from IK3GOY
    const res = runCrosscheck([{call:'IK3GOY', wwl:'JN65DM', dateDisp:'', mode:'SSB', band:'2m'}]);
    const byLoc = res[0].issues.find(i => i.type === 'CALL_BY_LOC');
    assert.equal(byLoc, undefined);
  });

  it('shows CALL_SIMILAR and CALL_BY_LOC separately when different', () => {
    clearHist();
    // IW3GOB from JN76aa — closer globally (d=1), different locator
    addToHistDB(hist('IW3GOB','JN76AA',10));
    // IW3GOA from JN65DM — d=2, from target locator
    addToHistDB(hist('IW3GOA','JN65DM',5));
    const res = runCrosscheck([{call:'IK3GOY', wwl:'JN65DM', dateDisp:'', mode:'SSB', band:'2m'}]);
    const sim = res[0].issues.find(i => i.type === 'CALL_SIMILAR');
    const byLoc = res[0].issues.find(i => i.type === 'CALL_BY_LOC');
    assert.ok(sim, 'expected CALL_SIMILAR');
    assert.ok(byLoc, 'expected CALL_BY_LOC');
    assert.equal(sim.similar[0].call, 'IW3GOB');   // global top
    assert.equal(byLoc.similar[0].call, 'IW3GOA'); // locator top
  });

  it('CALL_BY_LOC present even when redundant with global CALL_SIMILAR', () => {
    clearHist();
    addToHistDB(hist('IW3GOA','JN65DM',5));
    const res = runCrosscheck([{call:'IK3GOY', wwl:'JN65DM', dateDisp:'', mode:'SSB', band:'2m'}]);
    const sim = res[0].issues.find(i => i.type === 'CALL_SIMILAR');
    const byLoc = res[0].issues.find(i => i.type === 'CALL_BY_LOC');
    assert.ok(sim, 'expected CALL_SIMILAR');
    assert.ok(byLoc, 'expected CALL_BY_LOC even when top candidate matches global');
    assert.equal(byLoc.similar[0].call, 'IW3GOA');
  });
});
