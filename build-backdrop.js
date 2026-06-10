#!/usr/bin/env node
/**
 * build-backdrop.js
 *
 * Generates high-resolution country backdrop data for adif-stats.html.
 *
 * Source : world-atlas 10m TopoJSON (Natural Earth / Mike Bostock)
 *          https://cdn.jsdelivr.net/npm/world-atlas@2/countries-10m.json
 *          ~220 KB download, public domain.
 *
 * Pipeline:
 *   1. Download TopoJSON (~220 KB)
 *   2. Decode delta-encoded arcs → [lon, lat] coordinate arrays
 *   3. Reconstruct country polygon outer rings
 *   4. Filter to configured bounding box
 *   5. Clip vertices to padded bbox
 *   6. Iterative Ramer-Douglas-Peucker simplification
 *   7. Quantise to 2 decimal places (≈ 1 km)
 *   8. Inject _EU_POLYS constant into adif-stats.html (or write --out file)
 *
 * Usage:
 *   node build-backdrop.js                   # inject into adif-stats.html
 *   node build-backdrop.js --out FILE        # write JS constant to FILE
 *   node build-backdrop.js --tolerance 0.05  # coarser (default 0.02°)
 *   node build-backdrop.js --tolerance 0.01  # finer (larger output)
 *   node build-backdrop.js --dry-run         # download + process, no writes
 *
 * Run whenever you want to refresh the map backdrop (e.g. after adjusting
 * the bounding box or tolerance).  The script is idempotent — re-running it
 * replaces the previous generated block in adif-stats.html.
 */

'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ─── Configuration ────────────────────────────────────────────────────────

const SOURCE_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-10m.json';
const HTML_FILE  = path.join(__dirname, 'adif-stats.html');

// Bounding box: [minLon, maxLon, minLat, maxLat]
// Default covers Europe + NW Africa + Turkey + W.Russia + Middle East fringe
const DEFAULT_BBOX = [-32, 67, 18, 82];
// Vertices further than this many degrees outside the bbox are dropped before
// simplification (keeps peninsulas and near-border features intact).
const CLIP_PAD = 5;

// RDP tolerance in degrees.  0.02° ≈ 2 km at European latitudes.
// Increase to reduce output size; decrease for more detail.
const DEFAULT_TOL = 0.02;

// ─── CLI argument parsing ─────────────────────────────────────────────────

const argv = process.argv.slice(2);

function flagVal(name, fallback) {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : fallback;
}

const tolerance = parseFloat(flagVal('tolerance', DEFAULT_TOL));
const outFile   = flagVal('out', null);
const dryRun    = argv.includes('--dry-run');

const bboxArg = flagVal('bbox', null);
const [minLon, maxLon, minLat, maxLat] = bboxArg
  ? bboxArg.split(',').map(Number)
  : DEFAULT_BBOX;

// ─── HTTP fetch with redirect following ───────────────────────────────────

function fetchJson(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'build-backdrop.js/1.0' } }, res => {
      if(res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if(redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        fetchJson(res.headers.location, redirectsLeft - 1).then(resolve).catch(reject);
        return;
      }
      if(res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks))); }
        catch(e) { reject(new Error('JSON parse failed: ' + e.message)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── TopoJSON decoder ─────────────────────────────────────────────────────

// Converts quantised delta-encoded arcs to geographic [lon, lat] arrays.
function decodeArcs(topo) {
  const [sx, sy] = topo.transform.scale;
  const [tx, ty] = topo.transform.translate;
  return topo.arcs.map(arc => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [+(x * sx + tx).toFixed(5), +(y * sy + ty).toFixed(5)];
    });
  });
}

// Reconstructs a ring from an array of arc indices.
// Negative index n means reverse arc at ~n (bitwise NOT).
function ringFromIndices(arcs, indices) {
  const pts = [];
  for(const idx of indices) {
    const arc = idx >= 0 ? arcs[idx] : [...arcs[~idx]].reverse();
    if(pts.length > 0) pts.push(...arc.slice(1));
    else               pts.push(...arc);
  }
  return pts;
}

// Extracts all outer rings from a TopoJSON geometry (Polygon or MultiPolygon).
function outerRings(arcs, geom) {
  const rings = [];
  if(!geom) return rings;
  if(geom.type === 'Polygon') {
    if(geom.arcs.length > 0) rings.push(ringFromIndices(arcs, geom.arcs[0]));
  } else if(geom.type === 'MultiPolygon') {
    for(const poly of geom.arcs)
      if(poly.length > 0) rings.push(ringFromIndices(arcs, poly[0]));
  } else if(geom.type === 'GeometryCollection') {
    for(const g of geom.geometries) rings.push(...outerRings(arcs, g));
  }
  return rings;
}

// ─── Iterative Ramer-Douglas-Peucker simplification ───────────────────────
// Iterative to avoid call-stack overflow on long coastlines (Norway, etc.).

function rdp(pts, tol) {
  if(pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while(stack.length > 0) {
    const [s, e] = stack.pop();
    if(e - s <= 1) continue;
    const [ax, ay] = pts[s];
    const [bx, by] = pts[e];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let maxDist = 0, maxIdx = s;
    for(let i = s + 1; i < e; i++) {
      const [px, py] = pts[i];
      let d;
      if(len2 === 0) {
        d = Math.hypot(px - ax, py - ay);
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      }
      if(d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if(maxDist > tol) {
      keep[maxIdx] = 1;
      stack.push([s, maxIdx], [maxIdx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// ─── Ring processing ──────────────────────────────────────────────────────

function ringInBbox(ring) {
  return ring.some(([lon, lat]) =>
    lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat
  );
}

function processRing(ring) {
  // Discard vertices far outside the bbox
  const clipped = ring.filter(([lon, lat]) =>
    lon >= minLon - CLIP_PAD && lon <= maxLon + CLIP_PAD &&
    lat >= minLat - CLIP_PAD && lat <= maxLat + CLIP_PAD
  );
  if(clipped.length < 3) return null;
  const simplified = rdp(clipped, tolerance);
  if(simplified.length < 3) return null;
  // Quantise to 2 decimal places and flatten
  return simplified.flatMap(([lon, lat]) => [
    Math.round(lon * 100) / 100,
    Math.round(lat * 100) / 100,
  ]);
}

// ─── HTML injection ───────────────────────────────────────────────────────

// Replaces the _EU_POLYS block (including any preceding // comment lines)
// in the HTML source.  Works whether the block was hand-written or previously
// generated by this script.
function injectPolys(html, jsConst) {
  const DECL = 'const _EU_POLYS = [';
  const declIdx = html.indexOf(DECL);
  if(declIdx < 0) throw new Error('_EU_POLYS declaration not found in ' + HTML_FILE);

  // Walk backward over lines that start with //
  let startIdx = html.lastIndexOf('\n', declIdx) + 1;
  while(startIdx > 0) {
    const prevNl   = html.lastIndexOf('\n', startIdx - 2);
    const prevLine = html.slice(prevNl + 1, startIdx).trim();
    if(prevLine.startsWith('//')) startIdx = prevNl + 1;
    else break;
  }

  // Bracket-counting to find the matching outer ];
  let depth = 0, i = declIdx + DECL.length - 1; // position of opening [
  while(i < html.length) {
    if(html[i] === '[') depth++;
    else if(html[i] === ']') { depth--; if(depth === 0) break; }
    i++;
  }
  if(depth !== 0) throw new Error('Could not find closing ]; for _EU_POLYS');
  // i = index of closing ]
  let endIdx = i + 1;
  if(html[endIdx] === ';') endIdx++;
  if(html[endIdx] === '\n') endIdx++;

  return html.slice(0, startIdx) + jsConst + '\n' + html.slice(endIdx);
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Source  : ${SOURCE_URL}`);
  console.log(`BBox    : lon ${minLon}→${maxLon}, lat ${minLat}→${maxLat}`);
  console.log(`Tolerance: ${tolerance}°`);
  console.log('');

  console.log('Fetching TopoJSON...');
  const topo = await fetchJson(SOURCE_URL);
  const downloadKB = (JSON.stringify(topo).length / 1024).toFixed(0);
  console.log(`  Downloaded: ~${downloadKB} KB`);

  if(!topo.transform || !topo.objects?.countries) {
    throw new Error('Unexpected TopoJSON structure — missing transform or countries');
  }

  console.log('Decoding arcs...');
  const arcs  = decodeArcs(topo);
  const rings  = outerRings(arcs, topo.objects.countries);
  console.log(`  Total rings from topology: ${rings.length}`);

  console.log('Filtering, clipping and simplifying...');
  const polys = [];
  let skipped = 0;
  for(const ring of rings) {
    if(!ringInBbox(ring)) { skipped++; continue; }
    const flat = processRing(ring);
    if(flat && flat.length >= 6) polys.push(flat);
  }
  const totalPairs = polys.reduce((s, p) => s + p.length / 2, 0);
  console.log(`  Polygons in bbox: ${polys.length}  (${skipped} outside — discarded)`);
  console.log(`  Coordinate pairs: ${Math.round(totalPairs)}`);

  // Build JS constant
  const hdr = [
    '// Generated by build-backdrop.js — Natural Earth 10m via world-atlas',
    `// ${polys.length} polygons · bbox lon ${minLon}→${maxLon} lat ${minLat}→${maxLat} · RDP ${tolerance}°`,
    'const _EU_POLYS = [',
  ].join('\n');
  const body    = polys.map(p => `  [${p.join(',')}]`).join(',\n');
  const jsConst = `${hdr}\n${body},\n];`;

  const constKB = (Buffer.byteLength(jsConst, 'utf-8') / 1024).toFixed(1);
  console.log(`  Constant size   : ${constKB} KB`);

  if(parseFloat(constKB) > 600) {
    console.warn('  Warning: output exceeds 600 KB — consider increasing --tolerance');
  }

  if(dryRun) {
    console.log('\n[dry-run] No files written.');
    return;
  }

  if(outFile) {
    fs.writeFileSync(outFile, jsConst, 'utf-8');
    console.log(`\nWritten to ${outFile}`);
  } else {
    console.log(`\nInjecting into adif-stats.html...`);
    const html    = fs.readFileSync(HTML_FILE, 'utf-8');
    const updated = injectPolys(html, jsConst);
    fs.writeFileSync(HTML_FILE, updated, 'utf-8');
    const totalKB = (Buffer.byteLength(updated, 'utf-8') / 1024).toFixed(0);
    console.log(`Done.  adif-stats.html is now ${totalKB} KB.`);
  }
}

main().catch(e => { console.error('\nError:', e.message); process.exit(1); });
