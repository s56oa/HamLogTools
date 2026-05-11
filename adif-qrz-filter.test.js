'use strict';
/**
 * adif-qrz-filter.test.js
 *
 * Unit tests for the ADIF QRZ BURO filter tool.
 * Run: node --test --test-reporter=spec adif-qrz-filter.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

// Load the module under test by requiring it like a library.
// The file exports nothing, so we evaluate it in a controlled way.
// We extract the pure functions by running the script in a vm and
// grabbing the declarations we need.
const vm   = require('node:vm');
const src  = fs.readFileSync(path.join(__dirname, 'adif-qrz-filter.js'), 'utf-8');

// Strip the shebang and the final main() invocation so the script
// does not execute when evaluated.
const cleanSrc = src
  .replace(/^#!.*\n/, '')
  .replace(/main\(\)\.catch\(err[^)]*\)\s*;?\s*$/, '');

const ctx = vm.createContext({
  console: { log: () => {}, error: () => {} },
  require, fs, path, process: { argv: [], exit: () => {}, env: {} },
  Buffer, Date, JSON, Math, String, Number, RegExp, Set, Map, Array, Object,
  parseInt, isNaN, encodeURIComponent, decodeURIComponent,
});

vm.runInContext(cleanSrc, ctx);

const { parseAdif, extractField, usesQslBuro, loadCache, saveCache } = ctx;

// ─────────────────────────────────────────────────────────────────────────────
//  ADIF parsing
// ─────────────────────────────────────────────────────────────────────────────

describe('parseAdif', () => {

  it('extracts header and records', () => {
    const adif = `HamLogTools Test\n<ADIF_VER:5>3.1.0\n<EOH>\n<CALL:6>S59ABC <QSO_DATE:8>20260510 <TIME_ON:4>1000 <BAND:2>2m <MODE:3>SSB <EOR>\n<CALL:6>S56DEF <QSO_DATE:8>20260510 <TIME_ON:4>1005 <BAND:2>2m <MODE:3>SSB <EOR>`;
    const { header, records } = parseAdif(adif);
    assert.ok(header.includes('<EOH>'));
    assert.equal(records.length, 2);
    assert.equal(records[0].call, 'S59ABC');
    assert.equal(records[1].call, 'S56DEF');
  });

  it('extracts QSL_VIA when present', () => {
    const adif = `<EOH>\n<CALL:6>S59ABC <QSL_VIA:6>OK1XYZ <QSO_DATE:8>20260510 <TIME_ON:4>1000 <EOR>`;
    const { records } = parseAdif(adif);
    assert.equal(records.length, 1);
    assert.equal(records[0].call, 'S59ABC');
    assert.equal(records[0].qslVia, 'OK1XYZ');
  });

  it('qslVia is empty string when absent', () => {
    const adif = `<EOH>\n<CALL:6>S59ABC <QSO_DATE:8>20260510 <TIME_ON:4>1000 <EOR>`;
    const { records } = parseAdif(adif);
    assert.equal(records[0].qslVia, '');
  });

  it('preserves raw record text', () => {
    const adif = `<EOH>\n<CALL:6>S59ABC <QSO_DATE:8>20260510 <EOR>`;
    const { records } = parseAdif(adif);
    assert.ok(records[0].raw.includes('<CALL:6>S59ABC'));
    assert.ok(records[0].raw.includes('<EOR>'));
  });

  it('handles CRLF line endings', () => {
    const adif = `<EOH>\r\n<CALL:6>S59ABC <QSO_DATE:8>20260510 <EOR>\r\n`;
    const { records } = parseAdif(adif);
    assert.equal(records.length, 1);
    assert.equal(records[0].call, 'S59ABC');
  });

  it('skips records with no CALL field', () => {
    const adif = `<EOH>\n<QSO_DATE:8>20260510 <TIME_ON:4>1000 <EOR>`;
    const { records } = parseAdif(adif);
    assert.equal(records.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Field extraction
// ─────────────────────────────────────────────────────────────────────────────

describe('extractField', () => {
  const chunk = '<CALL:6>S59ABC <QSL_VIA:6>OK1XYZ <QSO_DATE:8>20260510';

  it('extracts CALL', () => {
    assert.equal(extractField(chunk, 'CALL'), 'S59ABC');
  });

  it('extracts QSL_VIA', () => {
    assert.equal(extractField(chunk, 'QSL_VIA'), 'OK1XYZ');
  });

  it('returns empty string for missing field', () => {
    assert.equal(extractField(chunk, 'BAND'), '');
  });

  it('is case-insensitive', () => {
    assert.equal(extractField(chunk, 'call'), 'S59ABC');
    assert.equal(extractField(chunk, 'qsl_via'), 'OK1XYZ');
  });

  it('trims whitespace', () => {
    const c = '<CALL:7> S59ABC ';
    assert.equal(extractField(c, 'CALL'), 'S59ABC');
  });

  it('uppercases result', () => {
    const c = '<CALL:6>s59abc';
    assert.equal(extractField(c, 'CALL'), 'S59ABC');
  });

  it('handles ADIF type specifier (e.g. <CALL:6:S>)', () => {
    const c = '<CALL:6:S>S59ABC <QSO_DATE:8>20260510';
    assert.equal(extractField(c, 'CALL'), 'S59ABC');
  });

  it('handles numeric type specifier (e.g. <FREQ:8:N>)', () => {
    const c = '<FREQ:8:N>144.300';
    assert.equal(extractField(c, 'FREQ'), '144.300');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Fuzzy BURO logic
// ─────────────────────────────────────────────────────────────────────────────

describe('usesQslBuro', () => {

  describe('positive cases (BURO)', () => {
    it('explicit BURO mention', () => {
      assert.ok(usesQslBuro('QSL ok via BURO, LOTW or snail mail'));
    });
    it('lowercase bureau', () => {
      assert.ok(usesQslBuro('via bureau only'));
    });
    it('eQSL + BURO combo', () => {
      assert.ok(usesQslBuro('eQSL + BURO'));
    });
    it('DARC QSL Bureau', () => {
      assert.ok(usesQslBuro('QSL via DARC QSL Bureau'));
    });
    it('buero — German spelling', () => {
      assert.ok(usesQslBuro('Buero'));
    });
    it('büro — German/Austrian', () => {
      assert.ok(usesQslBuro('via Büro'));
    });
    it('buerau — common English typo', () => {
      assert.ok(usesQslBuro('VIA BUERAU, eQSL'));
    });
    it('boureau — French-influenced spelling', () => {
      assert.ok(usesQslBuro('via boureau'));
    });
    it('burea — partial typo', () => {
      assert.ok(usesQslBuro('VIA BUREA OR DIRECT'));
    });
    it('buiro — typo of buro', () => {
      assert.ok(usesQslBuro('QSL BUIRO, DIRECT'));
    });
    it('bureau alongside direct — bureau wins', () => {
      assert.ok(usesQslBuro('Via Direct or Bureau'));
    });
    it('bureau after QSL DIRECT — bureau wins', () => {
      assert.ok(usesQslBuro('QSL DIRECT. LOTW. BUREAU (on request)'));
    });
  });

  describe('negative cases (NO BURO)', () => {
    it('QSL via manager — check manager separately, not BURO confirmation', () => {
      assert.ok(!usesQslBuro('QSL via OK1ABC'));
    });
    it('NO BURO — direct only', () => {
      assert.ok(!usesQslBuro('NO BURO — direct only'));
    });
    it('LOTW only, no bureau', () => {
      assert.ok(!usesQslBuro('LOTW only, no bureau'));
    });
    it('BURO not accepted', () => {
      assert.ok(!usesQslBuro('BURO not accepted'));
    });
    it('direct only', () => {
      assert.ok(!usesQslBuro('direct only'));
    });
    it('only direct', () => {
      assert.ok(!usesQslBuro('only direct'));
    });
    it('no QSL', () => {
      assert.ok(!usesQslBuro('no QSL'));
    });
    it('eQSL only', () => {
      assert.ok(!usesQslBuro('eQSL only'));
    });
    it('LOTW only', () => {
      assert.ok(!usesQslBuro('LOTW only'));
    });
    it('only via LoTW', () => {
      assert.ok(!usesQslBuro('only via LoTW'));
    });
    it('no paper', () => {
      assert.ok(!usesQslBuro('no paper'));
    });
    it('QSL direct', () => {
      assert.ok(!usesQslBuro('QSL direct'));
    });
    it('via direct', () => {
      assert.ok(!usesQslBuro('via direct'));
    });
    it('eqsl only', () => {
      assert.ok(!usesQslBuro('eqsl only'));
    });
    it('not via buro', () => {
      assert.ok(!usesQslBuro('not via buro'));
    });
    it('bureau not', () => {
      assert.ok(!usesQslBuro('bureau not'));
    });
  });

  describe('edge cases', () => {
    it('null / undefined → false', () => {
      assert.ok(!usesQslBuro(null));
      assert.ok(!usesQslBuro(undefined));
    });
    it('empty string → false', () => {
      assert.ok(!usesQslBuro(''));
    });
    it('only direct mail preferred → false', () => {
      assert.ok(!usesQslBuro('Direct mail preferred'));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Cache helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('cache', () => {
  const tmpFile = path.join(__dirname, '.test-cache.json');

  before(() => {
    try { fs.unlinkSync(tmpFile); } catch {}
  });

  it('save and load round-trip', () => {
    const cache = {
      S59ABC: { ts: Date.now(), found: true, buro: true, qslmgr: 'via BURO' },
      S56DEF: { ts: Date.now(), found: true, buro: false, qslmgr: 'direct only' },
    };
    saveCache(tmpFile, cache);
    const loaded = loadCache(tmpFile);
    assert.equal(loaded.S59ABC.found, true);
    assert.equal(loaded.S59ABC.buro, true);
    assert.equal(loaded.S56DEF.found, true);
    assert.equal(loaded.S56DEF.buro, false);
    assert.equal(loaded.S59ABC.qslmgr, 'via BURO');
  });

  it('purges entries older than 7 days', () => {
    const oldTs = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const freshTs = Date.now();
    const cache = {
      OLD: { ts: oldTs, found: true, buro: true, qslmgr: 'old' },
      NEW: { ts: freshTs, found: true, buro: false, qslmgr: 'new' },
    };
    saveCache(tmpFile, cache);
    const loaded = loadCache(tmpFile);
    assert.ok(!loaded.OLD, 'old entry should be purged');
    assert.ok(loaded.NEW, 'new entry should remain');
    assert.equal(loaded.NEW.found, true);
    // cleanup
    try { fs.unlinkSync(tmpFile); } catch {}
  });

  it('returns empty object for missing file', () => {
    const loaded = loadCache('.nonexistent-cache.json');
    assert.equal(Object.keys(loaded).length, 0);
  });
});
