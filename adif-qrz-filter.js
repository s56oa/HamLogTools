#!/usr/bin/env node
'use strict';
/**
 * adif-qrz-filter.js
 *
 * Node.js CLI tool for filtering an ADIF log to keep only QSOs with stations
 * that accept QSL cards via the QSL Bureau (BURO).
 *
 * Usage:
 *   node adif-qrz-filter.js input.adi --username=XXX --password=YYY
 *   node adif-qrz-filter.js input.adi --key=QRZ_SESSION_KEY
 *   node adif-qrz-filter.js input.adi --key=XXX --output=buro.adi --delay=800
 *
 * The tool queries QRZ.com XML API for each unique callsign, caches results
 * locally (7 days), and produces a new ADIF file containing only BURO-positive
 * QSOs. A terminal summary shows how many QSOs were kept/discarded.
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

/* ─────────────────────────────────────────────────────────────────────────── */
//  CLI argument parser
/* ─────────────────────────────────────────────────────────────────────────── */
function parseArgs(argv) {
  const args = { positional: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > -1 ? a.slice(2, eq) : a.slice(2);
      const val = eq > -1 ? a.slice(eq + 1) : true;
      args[key] = val;
    } else if (a.startsWith('-')) {
      args[a.slice(1)] = argv[++i];
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
ADIF QRZ BURO Filter  —  v1.0 (HamLogTools)

Usage:
  node adif-qrz-filter.js <input.adi> [options]

Options:
  --username=USER     QRZ.com username (requires --password)
  --password=PASS     QRZ.com password
  --key=SESSION       Existing QRZ session key (skip login)
  --output=FILE       Output ADIF filename (default: input-buro.adi)
  --delay=MS          Delay between QRZ API calls in ms (default: 1200)
  --cache=FILE        Cache JSON path (default: .qrz-cache.json)
  --include-unknown   Keep callsigns not found in QRZ database
  --help              Show this help

Examples:
  node adif-qrz-filter.js vhf-contest.adi --username=S59ABC --password=secret
  node adif-qrz-filter.js vhf-contest.adi --key=a1b2c3d4 --delay=800
`);
}

/* ─────────────────────────────────────────────────────────────────────────── */
//  ADIF parser — extract header and records
/* ─────────────────────────────────────────────────────────────────────────── */
function parseAdif(text) {
  // Normalise line endings
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Find end-of-header
  const eohMatch = src.match(/<EOH>/i);
  const headerEnd = eohMatch ? eohMatch.index + eohMatch[0].length : 0;
  const header = src.slice(0, headerEnd);
  const body   = src.slice(headerEnd);

  // Extract records by splitting on <EOR>
  const records = [];
  const eorRe = /<EOR>/gi;
  let m, lastIdx = 0;
  while ((m = eorRe.exec(body)) !== null) {
    const raw = body.slice(lastIdx, m.index + m[0].length).trim();
    lastIdx = m.index + m[0].length;
    if (!raw) continue;
    const call = extractField(raw, 'CALL');
    if (call) {
      const qslVia = extractField(raw, 'QSL_VIA');
      records.push({ call, qslVia, raw });
    }
  }

  return { header, records };
}

function extractField(chunk, tag) {
  // ADIF 3.1.7 allows optional type specifier: <TAG:len:TYPE>value
  const match = chunk.match(new RegExp(`<${tag}:(\\d+)(?::[A-Z])?>`, 'i'));
  if (!match) return '';
  const len = parseInt(match[1], 10);
  const start = match.index + match[0].length;
  return chunk.slice(start, start + len).trim().toUpperCase();
}

/* ─────────────────────────────────────────────────────────────────────────── */
//  QRZ.com XML API client
/* ─────────────────────────────────────────────────────────────────────────── */
function httpsGet(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.on('error', reject);
  });
}

function xmlTag(xml, tag) {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

async function qrzLogin(username, password) {
  const url = `https://xmldata.qrz.com/xml/current/?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const xml = await httpsGet(url);
  const key = xmlTag(xml, 'Key');
  if (!key) {
    throw new Error(xmlTag(xml, 'Error') || 'QRZ login failed');
  }
  return key;
}

async function qrzLookup(sessionKey, callsign) {
  const url = `https://xmldata.qrz.com/xml/current/?s=${encodeURIComponent(sessionKey)};callsign=${encodeURIComponent(callsign)}`;
  const xml = await httpsGet(url);
  const error = xmlTag(xml, 'Error');
  if (error) {
    if (/not found|no dx/i.test(error)) {
      return { found: false, call: callsign };
    }
    throw new Error(error);
  }
  return {
    found: true,
    call: callsign,
    qslmgr: xmlTag(xml, 'qslmgr'),
    fname: xmlTag(xml, 'fname'),
    name:  xmlTag(xml, 'name'),
    country: xmlTag(xml, 'country'),
    grid: xmlTag(xml, 'grid'),
  };
}

/* ─────────────────────────────────────────────────────────────────────────── */
//  Fuzzy logic: does the QSL manager text indicate BURO usage?
/* ─────────────────────────────────────────────────────────────────────────── */
function usesQslBuro(qslmgrText) {
  if (!qslmgrText) return false;
  const t = qslmgrText.toLowerCase();

  // Hard negations — explicit denial of bureau; checked first and override any bureau keyword
  const hardNegations = [
    /\bno\s+buro\b/,
    /\bno\s+bureau\b/,
    /\bnot?\s+(via\s+)?buro\b/,
    /\bnot?\s+(via\s+)?bureau\b/,
    /\bburo\s+not?\b/,
    /\bbureau\s+not?\b/,
    /\bno\s+qsl\b/,
    /\be[-\s]?qsl\s+only\b/,
    /\b(eqsl|e-qsl)\s+only\b/,
    /\blotw\s+only\b/,
    /\bonly\s+via\s+lotw\b/,
    /\bno\s+paper\b/,
    /\bdirect\s+only\b/,
    /\bonly\s+direct\b/,
  ];
  for (const re of hardNegations) {
    if (re.test(t)) return false;
  }

  // Bureau keyword — includes common European variants and misspellings
  // Note: /\bvia\s+direct\b/ and /\bqsl\s+(via\s+)?direct\b/ were removed as exclusions:
  // without a bureau keyword they already fall through to false; with a bureau keyword
  // (e.g. "Via Direct or Bureau") the bureau mention should take precedence.
  const inclusions = [
    /\bburo\b/,
    /\bbureau\b/,
    /\bb[uü]e?ro\b/,  // buero, büro (German/Austrian)
    /\bbuerau\b/,      // common typo of bureau
    /\bboureau\b/,     // French-influenced spelling
    /\bburea\b/,       // partial typo (burea)
    /\bbuiro\b/,       // typo of buro
  ];
  for (const re of inclusions) {
    if (re.test(t)) return true;
  }

  return false;
}

/* ─────────────────────────────────────────────────────────────────────────── */
//  Cache helpers
/* ─────────────────────────────────────────────────────────────────────────── */
function loadCache(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    // Purge entries older than 7 days
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const fresh = {};
    for (const [call, entry] of Object.entries(data)) {
      if (entry.ts > cutoff) fresh[call] = entry;
    }
    return fresh;
  } catch {
    return {};
  }
}

function saveCache(file, cache) {
  fs.writeFileSync(file, JSON.stringify(cache, null, 2));
}

/* ─────────────────────────────────────────────────────────────────────────── */
//  Main
/* ─────────────────────────────────────────────────────────────────────────── */
async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const inputFile = args.positional[0];
  if (!inputFile) {
    console.error('Error: input ADIF file required.');
    printHelp();
    process.exit(1);
  }

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: file not found: ${inputFile}`);
    process.exit(1);
  }

  // Resolve output path
  const defaultOut = inputFile.replace(/\.adi[f]?$/i, '') + '-buro.adi';
  const outputFile = args.output || defaultOut;
  const delayMs    = parseInt(args.delay, 10) || 1200;
  const cacheFile  = args.cache || '.qrz-cache.json';
  const includeUnknown = args['include-unknown'] === true;

  // QRZ session key
  let sessionKey = args.key;
  if (!sessionKey) {
    if (!args.username || !args.password) {
      console.error('Error: provide --key or both --username and --password for QRZ.com');
      printHelp();
      process.exit(1);
    }
    console.log('Logging into QRZ.com…');
    sessionKey = await qrzLogin(args.username, args.password);
    console.log('Session established.\n');
  }

  // Parse ADIF
  console.log(`Parsing ${path.basename(inputFile)}…`);
  const srcText = fs.readFileSync(inputFile, 'utf-8');
  const { header, records } = parseAdif(srcText);
  const totalQsos = records.length;
  const uniqueCalls = [...new Set(records.map(r => r.call))];
  const managerCalls = [...new Set(records.map(r => r.qslVia).filter(Boolean))];
  const allCallsToQuery = [...new Set([...uniqueCalls, ...managerCalls])];
  console.log(`  Total QSOs : ${totalQsos}`);
  console.log(`  Unique calls: ${uniqueCalls.length}`);
  if (managerCalls.length) {
    console.log(`  QSL managers: ${managerCalls.length}`);
  }
  console.log(`  Total to query: ${allCallsToQuery.length}\n`);

  if (totalQsos === 0) {
    console.log('No records found. Exiting.');
    process.exit(0);
  }

  // Load cache
  const cache = loadCache(cacheFile);

  // Query QRZ (primary calls + any QSL manager calls)
  const buroMap = new Map(); // call -> boolean
  const total = allCallsToQuery.length;
  let processed = 0;
  let cachedHits = 0;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  for (const call of allCallsToQuery) {
    const cached = cache[call];
    if (cached) {
      buroMap.set(call, cached.buro);
      cachedHits++;
      processed++;
      console.log(`[${processed}/${total}] ${call.padEnd(12)} — cached (${cached.buro ? 'BURO' : 'NO-BURO'})`);
      continue;
    }

    try {
      const info = await qrzLookup(sessionKey, call);
      const buro = info.found ? usesQslBuro(info.qslmgr) : false;
      const qslmgrShort = (info.qslmgr || '').replace(/\s+/g, ' ').slice(0, 40);

      cache[call] = {
        ts: Date.now(),
        found: info.found,
        buro,
        qslmgr: info.qslmgr || '',
      };

      buroMap.set(call, info.found ? buro : includeUnknown);
      processed++;
      const status = info.found
        ? (buro ? 'BURO' : 'NO-BURO')
        : (includeUnknown ? 'NOT-FOUND (kept)' : 'NOT-FOUND (skipped)');
      console.log(`[${processed}/${total}] ${call.padEnd(12)} — ${status}  ${qslmgrShort}`);
    } catch (err) {
      console.error(`[${processed + 1}/${total}] ${call.padEnd(12)} — ERROR: ${err.message}`);
      buroMap.set(call, includeUnknown);
      processed++;
    }

    // Rate limit pause (skip after last item)
    if (processed < total) await sleep(delayMs);
  }

  // Save cache
  try {
    saveCache(cacheFile, cache);
    console.log(`\nCache saved to ${cacheFile}\n`);
  } catch (err) {
    console.error(`Warning: could not save cache to ${cacheFile}: ${err.message}\n`);
  }

  // Filter records: keep if the station itself OR its QSL manager accepts BURO
  const kept = [];
  const discarded = [];
  let viaManagerCount = 0;

  for (const r of records) {
    const callBuro = buroMap.get(r.call);
    const mgrBuro = r.qslVia ? buroMap.get(r.qslVia) : false;
    if (callBuro || mgrBuro) {
      kept.push(r);
      if (!callBuro && mgrBuro) viaManagerCount++;
    } else {
      discarded.push(r);
    }
  }

  // Build output ADIF
  const outText = header + '\n' + kept.map(r => r.raw).join('\n') + (kept.length ? '\n' : '');
  fs.writeFileSync(outputFile, outText);

  // Summary
  const buroCount = kept.length;
  const nonBuroCount = discarded.length;
  const notFound = uniqueCalls.filter(c => cache[c] && !cache[c].found).length;

  console.log('═══════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════');
  console.log(`  Total QSOs          : ${totalQsos}`);
  console.log(`  Unique calls queried: ${total}`);
  console.log(`  Cache hits          : ${cachedHits}`);
  console.log(`  BURO QSOs kept      : ${buroCount}`);
  console.log(`    Direct BURO       : ${buroCount - viaManagerCount}`);
  if (viaManagerCount > 0) {
    console.log(`    Via QSL manager   : ${viaManagerCount}`);
  }
  console.log(`  Non-BURO discarded  : ${nonBuroCount}`);
  if (notFound > 0) {
    console.log(`  Not found in QRZ    : ${notFound} (${includeUnknown ? 'kept' : 'discarded'})`);
  }
  console.log(`\n  Output written to   : ${outputFile}`);
  console.log('═══════════════════════════════════════\n');
}

main().catch(err => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});
