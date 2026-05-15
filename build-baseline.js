#!/usr/bin/env node
/**
 * build-baseline.js
 *
 * Build crosscheck-baseline.json from OEVSV IARU R1 contest CSV exports
 * (https://iaru.oevsv.at/v_upld/prg_list.php).
 *
 * Input  : directory of CSV files (one per contest section/band)
 * Output : compact JSON with per-call, per-band locator histograms
 *
 * The output is consumed by edi-crosscheck.html and vhf-logger/ as a
 * high-confidence baseline data source (authoritative own-locator declarations
 * from robotically-validated contest logs), layered on top of user-supplied
 * EDI history. The script mirrors the output to vhf-logger/crosscheck-baseline.json
 * so the vhf-logger Service Worker can cache it for offline use.
 *
 * Usage:
 *   node build-baseline.js                              # defaults
 *   node build-baseline.js --in ./iaru_oevsv_csv --out ./crosscheck-baseline.json
 *   node build-baseline.js --min-appearances 1          # keep everything
 *   node build-baseline.js --pretty                     # indent JSON
 *   node build-baseline.js --verbose                    # per-file stats
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════
//  CLI args
// ═══════════════════════════════════════════════════════════
function parseArgs(argv){
  const a = {};
  for(let i=0; i<argv.length; i++){
    if(argv[i].startsWith('--')){
      const k = argv[i];
      const next = argv[i+1];
      if(next === undefined || next.startsWith('--')) a[k] = true;
      else { a[k] = next; i++; }
    }
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
if(args['--help'] || args['-h']){
  console.log(fs.readFileSync(__filename,'utf-8').match(/\/\*\*[\s\S]*?\*\//)[0]);
  process.exit(0);
}
const IN_DIR  = args['--in']  || './iaru_oevsv_csv';
const OUT     = args['--out'] || './crosscheck-baseline.json';
const MIN_APP = parseInt(args['--min-appearances'] || '3', 10);
const VERBOSE = !!args['--verbose'];
const PRETTY  = !!args['--pretty'];

// ═══════════════════════════════════════════════════════════
//  BAND MAPPING  (mirrors edi-crosscheck.html, extended for SHF)
// ═══════════════════════════════════════════════════════════
// Bands below 10 GHz REQUIRE a decimal in GHz form, to disambiguate from
// multi-digit GHz values: "1.3 GHz" → 23cm, but "122 GHz" → 2.5mm
// (not 23cm). Without anchoring on the decimal, a regex like /^1[23]\d*/
// would incorrectly capture both.
const BAND_MAP = [
  [/^50\s*MHz$|^6m$/i,                                      '6m'   ],
  [/^70\s*MHz$|^4m$/i,                                      '4m'   ],
  [/^(144|145)\s*MHz$|^2m$/i,                               '2m'   ],
  [/^(432|430|435)\s*MHz$|^70\s*cm$/i,                      '70cm' ],
  [/^1[.,]\d+\s*GHz$|^1296\s*MHz$|^23\s*cm$/i,              '23cm' ],
  [/^2[.,]\d+\s*GHz$|^2320\s*MHz$|^13\s*cm$/i,              '13cm' ],
  [/^3[.,]\d+\s*GHz$|^3400\s*MHz$|^9\s*cm$/i,               '9cm'  ],
  [/^5[.,]\d+\s*GHz$|^5760\s*MHz$|^6\s*cm$/i,               '6cm'  ],
  [/^10([.,]\d+)?\s*GHz$|^10368\s*MHz$|^3\s*cm$/i,          '3cm'  ],
  [/^24([.,]\d+)?\s*GHz$|^24048\s*MHz$|^1[.,]?25?\s*cm$/i,  '1.25cm'],
  [/^47\s*GHz$|^6\s*mm$/i,                                  '6mm'  ],
  [/^76\s*GHz$|^4\s*mm$/i,                                  '4mm'  ],
  [/^122\s*GHz$/i,                                          '2.5mm'],
  [/^134\s*GHz$/i,                                          '2mm'  ],
  [/^(241|245|248)\s*GHz$/i,                                '1.2mm'],
  [/^300\s*GHz$/i,                                          '1mm'  ],
];
function normBand(s){
  if(!s) return '';
  const t = s.trim();
  for(const [re, b] of BAND_MAP) if(re.test(t)) return b;
  return t;
}

// ═══════════════════════════════════════════════════════════
//  CALLSIGN NORMALIZATION
//  Mirrors baseCall() in edi-crosscheck.html exactly so that the
//  tool's runtime lookup keys match build-time keys.
// ═══════════════════════════════════════════════════════════
function baseCall(call){
  const u = call.toUpperCase();
  const i = u.lastIndexOf('/');
  if(i <= 0) return u;
  // prefix-before-slash contains a digit -> treat as callsign+suffix
  if(/\d/.test(u.slice(0, i))) return u.slice(0, i);
  // otherwise prefix+call (e.g. OE/S59DGO) -> keep full
  return u;
}
function callSuffix(call){
  const u = call.toUpperCase();
  const i = u.lastIndexOf('/');
  if(i <= 0) return '';
  if(/\d/.test(u.slice(0, i))) return u.slice(i+1);
  return '';
}

// ═══════════════════════════════════════════════════════════
//  LOCATOR
//  Maidenhead 6-char: [A-R]{2}[0-9]{2}[A-X]{2}.
//  Stored as first-4-upper + last-2-lower to match tool's
//  parseEDI() convention.
// ═══════════════════════════════════════════════════════════
const LOC_RE = /^[A-R]{2}[0-9]{2}[A-X]{2}$/i;
function normLocator(s){
  if(!s) return '';
  const u = s.trim();
  if(!LOC_RE.test(u)) return '';
  return u.slice(0,4).toUpperCase() + u.slice(4).toLowerCase();
}

// ═══════════════════════════════════════════════════════════
//  CSV PARSING  (RFC 4180-ish, quoted fields with embedded commas)
// ═══════════════════════════════════════════════════════════
function parseCSVLine(line){
  const out = [];
  let cur = '', inQuote = false;
  for(let i=0; i<line.length; i++){
    const ch = line[i];
    if(inQuote){
      if(ch === '"' && line[i+1] === '"'){ cur += '"'; i++; }
      else if(ch === '"') inQuote = false;
      else cur += ch;
    } else {
      if(ch === '"') inQuote = true;
      else if(ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// ═══════════════════════════════════════════════════════════
//  FILE READ + ENCODING DETECTION
//  OEVSV CSVs ship as either pure ASCII or ISO-8859-1 (latin1).
//  We try UTF-8 first; on a U+FFFD replacement char, fall back
//  to latin1, which is a lossless 1:1 byte mapping.
//  Note: Call/WWL columns are ASCII-safe in all observed data,
//  so encoding choice only affects descriptive cols (Ant, RTX, …).
// ═══════════════════════════════════════════════════════════
function readCSV(file){
  const buf = fs.readFileSync(file);
  let text = buf.toString('utf-8');
  if(text.indexOf('�') >= 0) text = buf.toString('latin1');
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if(!lines.length) return { header: [], rows: [] };
  const header = parseCSVLine(lines[0]).map(h => h.trim());
  const rows = [];
  for(let i=1; i<lines.length; i++) rows.push(parseCSVLine(lines[i]));
  return { header, rows };
}

// ═══════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════
function main(){
  if(!fs.existsSync(IN_DIR)){
    console.error(`Input directory not found: ${IN_DIR}`);
    process.exit(1);
  }
  const files = fs.readdirSync(IN_DIR)
    .filter(f => f.toLowerCase().endsWith('.csv'))
    .sort();
  if(!files.length){
    console.error(`No CSV files in ${IN_DIR}`);
    process.exit(1);
  }

  // Aggregator: Map<baseCall, Map<band, Map<locator, {count, portable}>>>
  const agg = new Map();
  const stats = {
    files: 0, rowsRead: 0, rowsAccepted: 0,
    skipNoCall: 0, skipBadLoc: 0, skipBadBand: 0, skipMobile: 0,
    perFile: [],
  };

  for(const f of files){
    const full = path.join(IN_DIR, f);
    const { header, rows } = readCSV(full);
    const colCall = header.findIndex(h => /^call$/i.test(h));
    const colWWL  = header.findIndex(h => /^wwl$/i.test(h));
    const colBand = header.findIndex(h => /^band$/i.test(h));
    if(colCall < 0 || colWWL < 0 || colBand < 0){
      console.warn(`[skip] ${f}: missing Call/WWL/Band (got: ${header.slice(0,8).join(', ')}…)`);
      continue;
    }
    stats.files++;
    let fRead = 0, fAcc = 0;
    for(const r of rows){
      stats.rowsRead++; fRead++;
      const rawCall = (r[colCall]||'').trim();
      const rawWWL  = (r[colWWL] ||'').trim();
      const rawBand = (r[colBand]||'').trim();
      if(!rawCall){ stats.skipNoCall++; continue; }
      const suffix = callSuffix(rawCall);
      if(suffix === 'MM' || suffix === 'AM'){ stats.skipMobile++; continue; }
      const loc  = normLocator(rawWWL);
      if(!loc){ stats.skipBadLoc++; continue; }
      const band = normBand(rawBand);
      if(!band){ stats.skipBadBand++; continue; }

      const base = baseCall(rawCall);
      if(!agg.has(base)) agg.set(base, new Map());
      const byBand = agg.get(base);
      if(!byBand.has(band)) byBand.set(band, new Map());
      const byLoc = byBand.get(band);
      const e = byLoc.get(loc) || { count: 0, portable: 0 };
      e.count++;
      if(suffix === 'P' || suffix === 'M') e.portable++;
      byLoc.set(loc, e);
      stats.rowsAccepted++; fAcc++;
    }
    stats.perFile.push({ name: f, read: fRead, accepted: fAcc });
  }

  // ═══ FILTER: min appearances per call ═══
  const totalPerCall = new Map();
  for(const [call, byBand] of agg){
    let t = 0;
    for(const byLoc of byBand.values())
      for(const e of byLoc.values()) t += e.count;
    totalPerCall.set(call, t);
  }
  const keepCalls = new Set();
  for(const [c, n] of totalPerCall) if(n >= MIN_APP) keepCalls.add(c);

  // ═══ BUILD BAND INDEX (stable order = BAND_MAP order, then unknowns) ═══
  const bandSet = new Set();
  for(const c of keepCalls)
    for(const b of agg.get(c).keys()) bandSet.add(b);
  const knownOrder = BAND_MAP.map(([_, b]) => b);
  const bands = [...bandSet].sort((a, b) => {
    const ia = knownOrder.indexOf(a), ib = knownOrder.indexOf(b);
    if(ia >= 0 && ib >= 0) return ia - ib;
    if(ia >= 0) return -1;
    if(ib >= 0) return 1;
    return a.localeCompare(b);
  });
  const bandIdx = new Map(bands.map((b, i) => [b, i]));

  // ═══ EMIT COMPACT CALL DICT ═══
  // c[call][bandIdx] = [[loc, count] | [loc, count, 1=portable], ...]
  // sorted by count desc, then locator asc.
  const c = {};
  let totalEntries = 0;
  for(const call of [...keepCalls].sort()){
    const byBand = agg.get(call);
    const obj = {};
    for(const [band, byLoc] of byBand){
      const idx = bandIdx.get(band);
      const list = [...byLoc.entries()]
        .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
        .map(([loc, e]) => {
          // Mark as portable only if EVERY observation was /P or /M
          const allPortable = e.portable === e.count && e.portable > 0;
          return allPortable ? [loc, e.count, 1] : [loc, e.count];
        });
      obj[idx] = list;
      totalEntries += list.length;
    }
    c[call] = obj;
  }

  // ═══ OUTPUT ═══
  const out = {
    v: new Date().toISOString().slice(0, 10),
    src: 'iaru.oevsv.at',
    note: 'IARU R1 VHF/UHF/SHF contest baseline. Format: c[call][bandIdx] = [[loc, count, portable?], …].',
    minAppearances: MIN_APP,
    n: {
      calls:   keepCalls.size,
      entries: totalEntries,
      files:   stats.files,
    },
    b: bands,
    c: c,
  };
  const json = PRETTY ? JSON.stringify(out, null, 2) : JSON.stringify(out);
  fs.writeFileSync(OUT, json);
  const sizeKB = (fs.statSync(OUT).size / 1024).toFixed(1);

  // Mirror into vhf-logger/ subfolder so its Service Worker can cache it offline
  const vhfCopy = path.join(path.dirname(path.resolve(OUT)), 'vhf-logger', 'crosscheck-baseline.json');
  try { fs.writeFileSync(vhfCopy, json); } catch(_){}

  // ═══ REPORT ═══
  const skipped = stats.rowsRead - stats.rowsAccepted;
  console.log('━'.repeat(60));
  console.log('build-baseline.js — done');
  console.log('━'.repeat(60));
  console.log(`Input directory   : ${IN_DIR}`);
  console.log(`Output file       : ${OUT}  (${sizeKB} KB)`);
  console.log(`Mirror (vhf-logger): ${vhfCopy}`);
  console.log(`CSV files read    : ${stats.files}`);
  console.log(`Rows read         : ${stats.rowsRead}`);
  console.log(`Rows accepted     : ${stats.rowsAccepted}`);
  console.log(`Rows skipped      : ${skipped}`);
  console.log(`  no Call         :   ${stats.skipNoCall}`);
  console.log(`  bad locator     :   ${stats.skipBadLoc}`);
  console.log(`  bad band        :   ${stats.skipBadBand}`);
  console.log(`  /MM, /AM        :   ${stats.skipMobile}`);
  console.log(`Unique calls (raw): ${agg.size}`);
  console.log(`After filter ≥${MIN_APP}   : ${keepCalls.size}  (${(100*keepCalls.size/agg.size).toFixed(1)}%)`);
  console.log(`Locator entries   : ${totalEntries}`);
  console.log(`Bands             : ${bands.length}  [${bands.join(', ')}]`);
  if(VERBOSE){
    console.log('\nPer-file:');
    for(const p of stats.perFile){
      console.log(`  ${p.name.padEnd(16)}  read=${String(p.read).padStart(5)}  acc=${String(p.accepted).padStart(5)}`);
    }
  }
  console.log('━'.repeat(60));
}

main();
