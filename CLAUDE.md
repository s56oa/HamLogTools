# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**HamLogTools** — browser-based tools for amateur radio log processing. All HTML tools are single-file, no build step, no framework, no backend. Shared conventions across all HTML tools: `:root` CSS palette, `showToast()` / `dl()`, bilingual SL/EN I18N via `t(key)` / `setLang()`, dark/light theme with `localStorage`.

**Tools:**
- `edi2adif.html` — REG1TEST EDI v1 → ADIF/CSV converter
- `edi-crosscheck.html` — crosscheck EDI log against historical DB + optional OEVSV IARU R1 baseline
- `vhf-logger/vhf-logger.html` — real-time VHF/UHF/SHF contest logger; EDI export, live crosscheck hints
- `adif-merge.html` — merge multiple ADIF files; dedup, filter, inline edit, ADIF+CSV export
- `adif-stats.html` — ADIF log dashboard: band/mode/cont/country/time stats, DXCC per band, activity heatmap, band×hour matrix, QRB histogram, HTML export
- `adif-qrz-filter.js` — Node.js CLI: filter ADIF to BURO-accepting stations via QRZ.com XML API
- `build-baseline.js` — Node.js CLI: build `crosscheck-baseline.json` from OEVSV IARU R1 CSV exports

## Development

No build system. Open any `.html` directly in a browser. HTTP server needed for `fetch()` (baseline load in edi-crosscheck, vhf-logger, adif-stats):

```bash
python3 -m http.server 8080
# then open http://localhost:8080/edi2adif.html
```

---

## Architecture of edi2adif.html

**Key functions:** `parseEDI()` → `{header, band, freq, qsos[]}`; `handleFiles()` dedup via `_bandKey`; `applyFilters()` → `_filtered[]`; `getExportPool()` single export truth (respects row selection + dedup filter); `exportADIF()` / `exportDARC()` / `exportCSV()`.

**QSO shape** (after `handleFiles` enrichment):
```
call, mode, rstS, rstR, stx, srx, exch, wwl, dist, dupe,
date (YYYYMMDD), time (HHMM), dateDisp (DD.MM.YYYY), timeDisp (HH:MM),
src, band, freq, myCall, myLoc, contest, pwr, ant, txeq, rxeq, ops,
_idx, _key (call|date|time), _bandKey (call|date|time|band)
```

**Tests:** `edi2adif.test.js` — 122 tests, 9 groups (`normBand`, `parseEDI`, `adifField`, `csvEsc`, `modeBadge`, i18n, duplicates, CSV export, inline edit).

---

## Architecture of adif-merge.html

**Key functions:** `parseADIF()` sequential `<TAG:len[:type]>` scanner (`<EOH>` boundary, case-insensitive); `recomputeDupes()` clears all flags then re-marks from `_all` insertion order; `commitEdit()` updates both convenience property and `q.fields[TAG]`; `exportADIF()` deletes `q.fields.APP_ADIFMERGE_SRC` before building to prevent re-merge duplication.

**QSO shape:** `call, date (YYYYMMDD), time (HHMM), dateDisp, timeDisp, band, mode, rstS, rstR, grid, src, fields (all ADIF tags uppercase), _idx, _key (call|band|mode|date|time), dupe`

**Key notes:**
- `q.fields` holds ALL original ADIF tags for lossless roundtrip; inline edit must update both the convenience property and `q.fields[TAG]` simultaneously.
- Dedup key uses `|` separator since CALL/BAND/MODE/DATE/TIME cannot contain `|`.
- `recomputeDupes()`: first occurrence in `_all` insertion order wins.

**Tests:** `adif-merge.test.js` — 112 tests, 21 groups (`parseADIF`, `updateKey`, `recomputeDupes`, `adifField`, `htmlEsc`, `csvEsc`, `modeBadge`, `buildFilename`, ADIF export, I18N, re-merge safety, and more).

---

## Architecture of adif-stats.html

**Key functions:** `lookupCall(call)` → `{country, cont}` — pure prefix lookup (~200-entry `PREFIX_DB`, longest-first 4→3→2→1 chars, Russia EU/AS by first digit: 9 or 0 → AS); `parseADIF()` — same scanner pattern, sets `qrb` from `DISTANCE` field or haversine(`GRIDSQUARE`, `MY_GRIDSQUARE`); `computeStats(_filtered)` single-pass → `{byBand, byMode, byCont, byCountry, byMonth, byHour, byDay, byBandHour, byDxcc, byBandDxcc, qrbBuckets[6]}`; `svgHBar()` / `svgVBar()` inline SVG charts; `renderDashboard()` calls 11 section renderers including `renderActivityHeatmap()` and `renderBandHourHeatmap()`.

**QSO shape:** `call, date (YYYYMMDD), time (HHMM), dateDisp, timeDisp, band, mode, rstS, rstR, grid, myGrid, qrb (km), country, cont, src, fields`

**Key notes:**
- `svgVBar(items, null, w)` → `fill="null"` (bars invisible). Always pass explicit color string (e.g. `'var(--accent2)'`).
- SVG text: use `var(--text)` / `var(--muted)` — `var(--fg)` / `var(--fg2)` are undefined.
- QRB buckets: `[0]`<500 km, `[1]`500–1k, `[2]`1k–2k, `[3]`2k–5k, `[4]`5k–10k, `[5]`≥10k. `qrb=0` not bucketed.
- Variable shadowing risk inside heatmap helpers: `const t = ...` shadows global `t()`. Use `ratio` or any other name.

**Tests:** `adif-stats.test.js` — 133 tests, 21 groups (`lookupCall`, `normBand`, `normMode`, `locToLatLon`, `haversine`, `parseADIF` ×3, `computeStats` ×6, `applyFilters`, `fmtDate`, `fmtMonth`, `htmlEsc`, `svgHBar`, `svgVBar`, `I18N`).

---

## Architecture of edi-crosscheck.html

**Key functions:** `parseEDI()` slim variant (call, mode, wwl, dateDisp, band, src); `addToHistDB(qsos)` weight×1; `applyBaseline()` weight×3; `runCrosscheck(qsos)` returns `_results[]`; `clearHist()` resets EDI contributions, re-injects baseline from cached `_baselineRaw`.

**Weighting model:** `_histDB[call]` has parallel `locators` (weighted, for algorithm) and `locatorsRaw` (raw, for display), plus `total` / `totalRaw`. EDI QSO: +1 both. Baseline entry: +3 weighted, +rawCount raw. `modeConf = weightedCount/total` — invariant under uniform weighting so threshold semantics stay stable.

**Issue types:** `LOC_MISMATCH` (high/med), `LOC_MISSING` (high/med), `CALL_SIMILAR`, `CALL_BY_LOC`, `CALL_UNKNOWN`.

**Baseline lifecycle:** page load → `loadBaseline()` → `fetch('./crosscheck-baseline.json')` → `applyBaseline()`; CORS failure from `file://` → silent fallback to EDI-only mode.

**Tests:** `edi-crosscheck.test.js` — 56 tests, 8 groups (`baseCall`, `levenshtein`, `parseEDI`, `runCrosscheck` ×4 scenarios, thresholds, callsign-by-locator).

---

## Architecture of build-baseline.js

Node.js CLI, no external deps. Options: `--in DIR` (default `./iaru_oevsv_csv`), `--out FILE`, `--min-appearances N` (default 3), `--pretty`, `--verbose`.

Output format consumed by `edi-crosscheck.html` and `vhf-logger.html`:
```json
{ "v":"YYYY-MM-DD", "src":"iaru.oevsv.at", "minAppearances":3,
  "n":{"calls":N,"entries":M,"files":F}, "b":["6m","4m","2m",...],
  "c":{"CALL":{"bandIdx":[[loc,count,portable?],...]}}}
```
Mirrors output to `vhf-logger/crosscheck-baseline.json`. Rebuild quarterly or after major IARU R1 contests.

---

## Architecture of vhf-logger/vhf-logger.html

**Key functions:** `isDupe(call, band, excludeId)` — `baseCall()` both sides, `excludeId` prevents false-dupe on edited QSO; `recalcDupes()` full rebuild per-band from `_current.qsos`; `buildEdi()` — REG1TEST v1 spec-compliant; `validateBackup()` structural checks with `_SAFE_ID=/^[a-z0-9]+$/` on `id` and `_id`.

**Session shape:** `{ id, contest, myCall, myLoc, operator, club, sect, qthName, rCall, rName, rCity, rCoun, rEmail, created, modified, activeBand, bands:[{band,freq,power,antenna,txEq,rxEq,antH}], qsos:[] }`

**QSO shape:** `{ _id, band, mode, call, wwl, rstS, rstR, nrS, nrR, utcDate, utcTime, qrb, brg, dupe, xFlags }`

**EDI QSO record — 15 semicolon-separated fields (col 0–14):**
```
YYMMDD;HHMM;CALL;MODE_NUM;RST_S;NR_S;RST_R;NR_R;;WWL;QRB;;;DUPE_FLAG
```
Col 8 = exchange (empty), col 11–12 = reserved (empty), col 13 = `D` if dupe.

**Key invariants:**
- `recalcDupes()` called after every edit, delete, or import.
- `saveEditedQso()` recalculates `xFlags` then calls `recalcDupes()` before persisting.
- `deleteQso()` calls `cancelEdit()` first if the deleted QSO is being edited.
- `_editingExisting=true` while `editSessionSetup()` open; `startSession()` updates `_current` in-place; `cancelSetup()` returns to logger, not home.
- `removeBandRow()` guards against removing a band that has QSOs when `_editingExisting`.
- `_manualTime = {date:'YYYYMMDD', time:'HHMM'} | null` — read by `logQso()`.
- `_exportingSession` — set by `_showExportFor()` so `exportAllZip()` targets the correct session from home screen.

**Tests:** `vhf-logger/vhf-logger.test.js` — 163 tests, 16 groups (`baseCall`, `normBand`, `locToLatLon`, `haversine`, `calcBearing`, `levenshtein`, `isDupe`, `recalcDupes`, `buildEdi`, `lookupCall`, `sessionEdit`, `parseEdiForImport`, `makeZip`, `bandColors`, `manualTime`, `backup`).

---

## Architecture of adif-qrz-filter.js

Node.js CLI, no external deps. `usesQslBuro()`: 14 exclusion + 3 inclusion regexes on lowercased `qslmgr` text. 7-day JSON cache (`.qrz-cache.json`). Rate limit default 1 200 ms. `--include-unknown` keeps QRZ-missing callsigns.

**Tests:** `adif-qrz-filter.test.js` — 48 tests, 4 groups (`parseAdif`, `extractField`, `usesQslBuro` ×3, `cache`).

---

## Adding a New Tool

Follow the single-file pattern. Reuse `:root` CSS palette, `showToast()` / `dl()`, `t(key)` I18N, `htmlEsc()` for all innerHTML.

## Domain Notes

- **EDI format** (REG1TEST v1): `[QSORecords;N]` with semicolon; 15 fields col 0–14, dupe flag at col 14 value `D`. `TDate=YYYYMMDD;YYYYMMDD` (first and last QSO date).
- **ADIF**: `<TAG:length>value`. Records end `<EOR>`. Header ends `<EOH>`. Tags case-insensitive; store uppercase.
- **Mode mapping** EDI→ADIF: `1=SSB, 2=CW, 3=CW, 4=SSB, 5=AM, 6=FM, 7=RTTY, 8=SSTV, 9=ATV`.
- **Maidenhead locator case**: received `wwl` — first 4 uppercase + last 2 lowercase (e.g. `JN65ar`). My locator fully uppercase. ADIF spec is case-insensitive but some tools break on all-uppercase.
- **`baseCall()`**: strips suffix if part before `/` contains a digit; otherwise keeps as `prefix/call` (e.g. `OE/S59DGO` kept, `S59DGO/P` stripped to `S59DGO`).
- **DARC QSL CSV** columns: `Callsign, QSL Via, Date Time, Band, Mode, RST_SENT, QSL received`.
- **vm sandbox pattern** (tests): `node:vm` evaluates the `<script>` block; `function` declarations are ctx properties; `let`/`const` are not. Use a second `vm.runInContext` to inject helper accessors. `assert.deepStrictEqual` fails on vm objects — compare individual properties with `assert.equal`.
