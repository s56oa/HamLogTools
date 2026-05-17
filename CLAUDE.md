# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**HamLogTools** is a collection of browser-based tools for amateur radio operators to process and convert log formats. All tools are self-contained single-file HTML applications — no build step, no framework, no backend.

**Current tools:**
- `edi2adif.html` — Converts REG1TEST EDI v1 contest logs to ADIF and other formats
- `edi-crosscheck.html` — Cross-checks a new EDI log against historical logs (+ optional prebuilt OEVSV IARU R1 baseline) to flag callsign typos and locator mismatches
- `vhf-logger/vhf-logger.html` — Browser-based contest logger for IARU R1 VHF/UHF contests; touch-first, multi-band, exports per-band EDI, live crosscheck hints from baseline
- `adif-merge.html` — Merges multiple ADIF log files into one; deduplication, filtering, inline editing, exports ADIF and CSV
- `adif-stats.html` — Browser-based ADIF log analysis tool; statistics by band/mode/continent/country/time, DXCC per band, activity heatmap, band×hour propagation matrix, QRB distribution, self-contained HTML export
- `adif-qrz-filter.js` — Node.js CLI tool that filters an ADIF log to keep only BURO-accepting stations by querying the QRZ.com XML API
- `build-baseline.js` — Node.js CLI tool that builds `crosscheck-baseline.json` from OEVSV IARU R1 contest CSV exports, consumed by `edi-crosscheck.html` and `vhf-logger/vhf-logger.html`; mirrors output to `vhf-logger/crosscheck-baseline.json`

## Development

No build system. Open any `.html` file directly in a browser. For iterative development use a local HTTP server to avoid CORS restrictions:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/edi2adif.html
```

## Architecture of edi2adif.html

Single HTML file with three co-located layers (CSS → HTML → JavaScript). No external JS dependencies; only Google Fonts is loaded remotely.

**JavaScript sections (marked with `// ═══` banners):**

| Section | Responsibility |
|---|---|
| I18N (`S` object, `t()`, `setLang()`) | Bilingual UI strings (SL/EN). All user-facing text goes through `t(key)`. |
| Band mapping (`BAND_MAP`, `normBand()`) | Regex table mapping EDI `PBand` values to canonical ADIF band names. |
| EDI parser (`parseEDI()`) | Reads header key=value pairs and `[QSORecords…]` section. Returns `{header, band, freq, qsos}`. |
| State (`_all`, `_filtered`, `_sources`, `_sortCol`, `_sortAsc`, `_desel`) | Module-level globals shared across all functions. |
| File loading (`handleFiles()`, `finishLoad()`) | Async `FileReader` loop; dedup via `_bandKey` (call\|date\|time\|band); tags QSOs with header metadata. |
| Filter + sort (`applyFilters()`, `sortFiltered()`) | Populates `_filtered` from `_all`; `COL_KEYS` array maps column index → QSO property. |
| Table render (`renderTable()`) | Rebuilds `<thead>` and `<tbody>` via string concatenation; row selection tracked in `_desel` Set. |
| Export helpers (`getExportPool()`, `adifField()`, `csvEsc()`, `dl()`) | `getExportPool()` is the single source of truth for which QSOs go into any export. |
| Render helpers (`htmlEsc()`, `modeBadge()`) | XSS-safe HTML escaping and mode → CSS badge class mapping. |
| Exporters (`exportADIF()`, `exportDARC()`, `exportCSV()`) | Each produces a complete file and triggers download via `dl()`. |

**Key data flow:**
1. Files → `handleFiles()` → `parseEDI()` → `_all[]`
2. `finishLoad()` assigns `_idx`, deduplicates, reveals `#app`, calls `buildFilters()` + `applyFilters()`
3. `applyFilters()` → `_filtered[]` → `renderTable()`
4. Export buttons call `getExportPool()` (respects "selected only" + dedup filter) → format → `dl()`

**QSO object shape** (after `handleFiles` enrichment):
```
call, mode, rstS, rstR, stx, srx, exch, wwl, dist, dupe,
date (YYYYMMDD), time (HHMM), dateDisp (DD.MM.YYYY), timeDisp (HH:MM),
src (filename), band, freq, myCall, myLoc, contest, pwr, ant, txeq, rxeq, ops,
_idx (insertion order), _key (call|date|time), _bandKey (call|date|time|band)
```

## Architecture of adif-merge.html

Single HTML file, no external JS dependencies. Same CSS palette and `showToast()` / `dl()` pattern as the other tools.

**JavaScript sections:**

| Section | Responsibility |
|---|---|
| I18N (`S`, `t()`, `setLang()`) | Bilingual UI strings (SL/EN). |
| ADIF parser (`parseADIF()`) | Sequential `<TAG:len[:type]>` scanner; handles `<EOH>` boundary, multi-line fields, case-insensitive tags. Returns array of QSO objects. |
| State (`_all`, `_filtered`, `_sources`, `_sortCol`, `_sortAsc`, `_desel`) | Module-level globals. |
| File loading (`handleFiles()`, `finishLoad()`) | Async `FileReader` loop; `recomputeDupes()` after each batch; reveals `#app` on first load. |
| Filter + sort (`applyFilters()`, `sortFiltered()`) | Populates `_filtered`; `COL_KEYS` maps column index → QSO property. |
| Table render (`renderTable()`) | String-concatenation rebuild; row selection in `_desel` Set. |
| Inline edit (`commitEdit()`, `cancelEdit()`, `restoreCell()`) | Updates both convenience property and `q.fields[TAG]`; validates non-empty band. |
| Export helpers (`getExportPool()`, `adifField()`, `csvEsc()`, `dl()`) | `getExportPool()` filters `!_desel.has(q._key) && !q.dupe`. |
| Render helpers (`htmlEsc()`, `modeBadge()`) | XSS-safe escaping; mode → badge class. |
| Exporters (`exportADIF()`, `exportCSV()`) | ADIF: lossless field roundtrip + `APP_ADIFMERGE_SRC` provenance tag. CSV: UTF-8 BOM for Excel. |
| Dedup (`recomputeDupes()`, `updateKey()`) | Clears all `dupe` flags then re-marks from `_all` insertion order. |

**Key data flow:**
1. Files → `handleFiles()` → `parseADIF()` → `_all[]`
2. `finishLoad()` assigns `_idx`, `recomputeDupes()`, reveals `#app`, calls `buildFilters()` + `applyFilters()`
3. `applyFilters()` → `_filtered[]` → `renderTable()`
4. Export buttons → `getExportPool()` → format → `dl()`

**QSO object shape:**
```
call, date (YYYYMMDD), time (HHMM), dateDisp, timeDisp, band, mode, rstS, rstR, grid,
src (filename), fields (all original ADIF tags, uppercase keys),
_idx, _key (call|band|mode|date|time), dupe
```

**Key notes:**
- `q.fields` stores ALL original ADIF tags for lossless roundtrip; inline editing updates both the convenience property and `q.fields[TAG]` simultaneously.
- ADIF export: `delete q.fields.APP_ADIFMERGE_SRC` before building record prevents duplicate annotation on re-merge.
- `recomputeDupes()`: clears all flags, re-marks from scratch — first occurrence in `_all` insertion order wins.
- Dedup key uses `|` as separator since CALL/BAND/MODE/DATE/TIME cannot contain `|`.

**Tests:** `adif-merge.test.js` — 112 tests, 21 groups (`parseADIF`, `updateKey`, `recomputeDupes`, `adifField`, `htmlEsc`, `csvEsc`, `modeBadge`, `buildFilename`, ADIF export, I18N, re-merge safety, and more).

## Architecture of adif-stats.html

Single HTML file, no external JS dependencies. Same CSS palette (`IBM Plex Sans` + `Space Mono`, deep dark palette) and `showToast()` / `dl()` pattern as `adif-merge.html`.

**JavaScript sections:**

| Section | Responsibility |
|---|---|
| I18N (`S`, `t()`, `setLang()`) | Bilingual UI strings (SL/EN). Includes `hmapDow`, `hmapMon`, `hmapMore` for heatmap labels. |
| PREFIX_DB + `lookupCall()` | ~200-entry DXCC prefix table; longest-prefix-first match (4→3→2→1 chars). Russia EU/AS split: first digit 9 or 0 → Asiatic Russia. Returns `{country, cont}`. |
| ADIF parser (`parseADIF()`) | Sequential `<TAG:len[:type]>` scanner; `<EOH>` boundary; QRB from `DISTANCE` field or haversine from `GRIDSQUARE` + `MY_GRIDSQUARE`. |
| Geo utils (`locToLatLon`, `haversine`) | Maidenhead → lat/lon, great-circle QRB in km. |
| Stats engine (`computeStats()`) | Single-pass over `_filtered`; builds `byBand`, `byMode`, `byCont`, `byCountry`, `byMonth`, `byHour`, `byDay`, `byBandHour`, `byDxcc`, `byBandDxcc`, `qrbBuckets[6]`. |
| Filter state (`_qsos`, `_filtered`, `_sources`) | `applyFilters()` applies band/mode/date-range from toolbar; result feeds `computeStats()`. |
| SVG helpers (`svgHBar`, `svgVBar`) | Inline SVG charts. `svgHBar`: horizontal bars (band/mode/continent). `svgVBar`: vertical bars (months/hours/QRB); `colW` dynamic, value label above bar when bar too short to label inside. |
| Render functions | `renderDashboard()` calls 11 section renderers: overview cards, band/mode/continent/country/time, top callsigns, DXCC per band, activity heatmap, band×hour matrix, QRB histogram. |
| `renderActivityHeatmap()` | GitHub-style 12×12 px cell grid; year→week→day layout; month abbreviations above first week of each month (I18N); day-of-week labels (I18N). |
| `renderBandHourHeatmap()` | 2D bands×24h UTC matrix; orange intensity scale; hover shows count. |
| Export (`exportHTML()`) | Serializes `#dashboard` innerHTML + inlined CSS to self-contained HTML report. Font link: `IBM Plex Sans + Space Mono`. |

**Key data flow:**
1. Files → `handleFiles()` → `parseADIF()` → `_qsos[]`
2. `finishLoad()` → `buildFilterOptions()` + `applyFilters()` → `_filtered[]`
3. `applyFilters()` → `computeStats(_filtered)` → render 11 sections
4. Filter/lang change → `applyFilters()` or `renderDashboard()` re-run

**QSO object shape:**
```
call, date (YYYYMMDD), time (HHMM), dateDisp, timeDisp, band, mode, rstS, rstR,
grid, myGrid, qrb (km), country, cont, src (filename), fields (all original ADIF tags, uppercase keys)
```

**Key notes:**
- `lookupCall()` is pure function — prefix table only, no state. Unknown call returns `{country:'Unknown', cont:'?'}`.
- `svgVBar(items, null, w)` is a bug: explicit `null` overrides the default `color='var(--accent)'`. Always pass an explicit color string (e.g. `'var(--accent2)'`).
- QRB buckets index: `[0]`<500 km, `[1]`500–1k, `[2]`1k–2k, `[3]`2k–5k, `[4]`5k–10k, `[5]`≥10k. QSOs with `qrb=0` are not bucketed.
- SVG text colors: use `var(--text)` and `var(--muted)`, not `var(--fg)` / `var(--fg2)` (undefined).

**Tests:** `adif-stats.test.js` — 133 tests, 21 groups (`lookupCall`, `normBand`, `normMode`, `locToLatLon`, `haversine`, `parseADIF` ×3, `computeStats` ×5, `applyFilters`, `fmtDate`, `fmtMonth`, `htmlEsc`, `svgHBar`, `svgVBar`, `I18N`).

## Architecture of edi-crosscheck.html

Single HTML file, no external JS dependencies. Same CSS palette and `showToast()` / `dl()` pattern as `edi2adif.html`.

**JavaScript sections:**

| Section | Responsibility |
|---|---|
| I18N (`S` object, `t()`, `setLang()`) | Bilingual UI strings (SL/EN). |
| Band mapping (`BAND_MAP`, `normBand()`) | Reused from `edi2adif.html`. |
| EDI parser (`parseEDI()`) | Slimmer variant: extracts callsign, mode, locator, date, band. |
| Utilities (`baseCall()`, `levenshtein()`, `htmlEsc()`) | Suffix stripping, edit distance with early exit, XSS escaping. |
| Historical DB (`_histDB`, `_locToCalls`, `_locToCallsRaw`) | Dual weighted+raw maps; see weighting model below. |
| DB population (`addToHistDB()`, `applyBaseline()`, `loadBaseline()`, `clearHist()`) | Two sources: dropped EDI files (weight 1) and prebuilt baseline JSON (weight `BASELINE_WEIGHT` = 3). |
| Crosscheck algorithm (`runCrosscheck()`) | Two-pass: (1) locator mismatch/missing vs. historical mode, (2) unknown callsign similarity via Levenshtein. Decisions use weighted counts, display uses raw counts. |
| Threshold controls (`updatePrag()`, `rerunCrosscheck()`) | `_minAppearances` (1–10) and `_minConfidence` (0.1–1.0) sliders; `_lastQsos` stores last new log for re-run. |
| Render (`renderSummaryBar()`, `renderResults()`, `updateDbCard()`) | Summary counts, filterable table with severity colour coding, dbCard with baseline tag + EDI stats. |
| HTML export (`exportIssues()`) | Generates a self-contained HTML report of all flagged QSOs with correction suggestions. |
| File loading (`loadHistFiles()`, `loadNewFile()`) | Async `FileReader` loops; historical files deduplicated by name+size. |
| Drag & drop + theme (`setupDrop()`, `toggleTheme()`) | Drag-over styling, click-to-input wiring, light/dark theme toggle with `localStorage`. |

**Weighting model:** `_histDB` entry tracks two parallel histograms per callsign: `locators` (weighted, used by algorithm) and `locatorsRaw` (raw counts, used by display), plus `total` / `totalRaw`. EDI QSO contributes +1 to both; baseline entry contributes +3 to weighted and +rawCount to raw. The `modeConf` ratio is invariant under uniform weighting so threshold semantics remain stable.

**Baseline lifecycle:**
1. Page load → `loadBaseline()` → `fetch('./crosscheck-baseline.json')` → `applyBaseline()` → `_histDB` (weight ×3)
2. On `fetch()` failure (CORS from `file://`, missing file) — silent fallback, tool runs EDI-only.
3. `clearHist()` clears EDI contributions and re-injects baseline from cached `_baselineRaw`.

**Key data flow:**
1. Historical EDI files → `loadHistFiles()` → `parseEDI()` → `addToHistDB()` → `_histDB` (weight ×1)
2. New EDI log → `loadNewFile()` → `parseEDI()` → `_lastQsos`
3. `runCrosscheck(_lastQsos)` → `_results[]` → `renderSummaryBar()` + `renderResults()`
4. Slider change → `updatePrag()` → `rerunCrosscheck()` → re-populates `_results`
5. `exportIssues()` → Blob HTML → download

**Issue types:**
- `LOC_MISMATCH` — locator differs from historical mode; `high` (mode confidence ≥ threshold, locator never seen) or `med`.
- `LOC_MISSING` — no locator in new log but history exists; `high`/`med` based on mode confidence.
- `CALL_SIMILAR` — callsign not in history; Levenshtein ≤ 2 matches, sorted distance ASC then count DESC.
- `CALL_BY_LOC` — callsign not in history but similar callsign worked from the same locator.
- `CALL_UNKNOWN` — callsign not in history, no similar match within distance 2.

**QSO object shape** (after `parseEDI`): `call, mode, wwl, dateDisp, band, src`

**Tests:** `edi-crosscheck.test.js` — 56 tests, 8 groups.

---

## Architecture of build-baseline.js

Node.js CLI script that builds `crosscheck-baseline.json` from a directory of OEVSV IARU R1 contest CSV exports. No external dependencies.

| Section | Responsibility |
|---|---|
| CLI parser (`parseArgs`) | `--in`, `--out`, `--min-appearances`, `--pretty`, `--verbose`, `--help` |
| Band mapping (`BAND_MAP`, `normBand()`) | 16 bands from 50 MHz to 300 GHz. Decimal-anchored regexes disambiguate "1.3 GHz" → 23cm from "122 GHz" → 2.5mm. |
| Callsign normalization (`baseCall()`, `callSuffix()`) | Mirrors `edi-crosscheck.html` exactly — same suffix-strip vs. prefix-keep heuristic. |
| Locator validation (`normLocator()`) | Maidenhead regex `[A-R]{2}[0-9]{2}[A-X]{2}`; first-4-upper + last-2-lower to match tool convention. |
| CSV parser (`parseCSVLine`, `readCSV`) | RFC-4180-ish quoted-field parser. Encoding fallback: UTF-8 → ISO-8859-1 on U+FFFD detection. Header-driven column mapping (tolerant to 23/25-col OEVSV variants). |
| Main (`main`) | Aggregate → filter (≥ `MIN_APP`) → sort → emit compact JSON with versioning. |

**Key data flow:**
1. Read CSV directory → header detection per file → row iteration
2. Validate row (call non-empty, locator regex, band recognized, suffix not `/MM` or `/AM`)
3. Aggregate into `Map<baseCall, Map<band, Map<loc, {count, portable}>>>`
4. Filter calls by total appearances ≥ `MIN_APP` (default 3)
5. Emit compact JSON: `c[call][bandIdx] = [[loc, count, portable?], ...]` sorted by count desc

**Output format** (consumed by `edi-crosscheck.html` and `vhf-logger.html`):
```json
{
  "v": "YYYY-MM-DD", "src": "iaru.oevsv.at", "minAppearances": 3,
  "n": { "calls": N, "entries": M, "files": F },
  "b": ["6m", "4m", "2m", ...],
  "c": { "CALL": { "bandIdx": [[loc, count, portable?], ...] } }
}
```

**Rebuild cadence:** quarterly or after major IARU R1 contests. Idempotent given the same inputs.

---

## Architecture of vhf-logger/vhf-logger.html

Single HTML file, no external JS dependencies. Same CSS palette and `showToast()` / `dl()` pattern as the other tools. `crosscheck-baseline.json` loaded on startup via `fetch()` for live autocomplete and crosscheck hints.

**JavaScript sections (marked with `// ════` banners):**

| Section | Responsibility |
|---|---|
| I18N (`S`, `t()`, `setLang()`) | Bilingual UI strings (SL/EN). |
| Band config (`BAND_MAP`, `normBand`, `BAND_OPTS`, `BAND_COLORS`) | 11 bands (6m–6mm) with canonical names, EDI header strings, and tab highlight colours. |
| Geo utils (`locToLatLon`, `haversine`, `calcBearing`) | Maidenhead → lat/lon, QRB distance, great-circle bearing. |
| Crosscheck module | `baseCall()`, `levenshtein()`, `_histDB` (weighted+raw dual maps), `applyBaseline()`, `loadBaseline()`, `lookupCall()`, `searchCalls()`. |
| State + persistence | `STORE='vhf-logger-v1'`, module-level `_sessions`, `_current`, `_editingQso`, `_manualTime`, `_soundEnabled`, `_statsOpen`, `_exportingSession`. `saveSessions()` in try/catch. |
| Clock (`tickClock`) | Fires every 5 s; skips update when `_editingQso` is set. |
| Navigation | `showHome()`, `showSetup()`, `showLogger()`, `pauseSession()`. |
| Home screen | `renderHome()`, `resumeSession()`, `deleteSession()`. |
| Setup screen | `editSessionSetup()`, `cancelSetup()`, `addBandRow()`, `removeBandRow()`, `onBandSel()`, `collectSetup()`, `startSession()`. |
| Logger core | `nextSerial()`, `isDupe()`, `recalcDupes()`, `updateNrS()`, `switchBand()`, `renderBandTabs()`, `renderStats()`, `renderTable()`, `scrollTableBottom()`. |
| QSO editing | `editQso()`, `cancelEdit()`, `saveEditedQso()`, `setupTableClickHandler()`, `deleteQso()`. |
| QSO form | `onCallInput()`, `onCallKey()`, `renderAc()`, `selectAc()`, `onWwlInput()`, `updateWwlColor()`, `onModeChange()`, `checkDupeField()`, `logQso()`, `resetForm()`. |
| Hints | `updateLocHint()`, `calcAzimuth()`, `updateXhint()`, `debouncedXhint()` (150 ms debounce). |
| Per-band stats | `toggleStatsPanel()`, `renderStatsDetail()`. Collapsible panel: QSOs/band, unique 4-char locator squares, total QRB, best DX. |
| Sound | `toggleSound()`, `playQsoBeep()`. Web Audio API 880 Hz beep (12 ms). |
| Manual time | `toggleTimeOvr()`, `onManualTimeInput()`. Stores `{date, time}` in `_manualTime`; read by `logQso()`. |
| Keyboard | `onRstKey(e, nextId)`, `onNrRKey(e)`. Tab/Enter advance RST_S → RST_R → NrR → logQso; Esc closes edit/autocomplete. |
| ZIP export | `_crc32` (IIFE CRC-32 table), `makeZip(files)`, `exportAllZip()`. STORE-method ZIP, no external deps. |
| EDI import | `parseEdiForImport(text)`, `triggerImport()`, `handleImportFile(input)`, `importEdi(text)`. |
| EDI export | `buildEdi()`, `showExportModal()`, `showExportFor()`, `_showExportFor()`, `_exportBand()`, `closeModal()`. |
| Backup / Restore | `exportBackup()` / `validateBackup()` / `triggerRestore()` / `handleRestoreFile()`. Structural validation with `_SAFE_ID=/^[a-z0-9]+$/` check on `id` and `_id`. 10 MB file limit. |
| Theme + init | `toggleTheme()`, `init()`. |

**Key data structures:**

Session: `{ id, contest, myCall, myLoc, operator, club, sect, qthName, rCall, rName, rCity, rCoun, rEmail, created, modified, activeBand, bands: [{band, freq, power, antenna, txEq, rxEq, antH}], qsos: [...] }`

QSO: `{ _id, band, mode, call, wwl, rstS, rstR, nrS, nrR, utcDate, utcTime, qrb, brg, dupe, xFlags }`

**EDI QSO record format — 15 semicolon-separated fields (col 0–14):**
```
YYMMDD;HHMM;CALL;MODE_NUM;RST_S;NR_S;RST_R;NR_R;;WWL;QRB;;;DUPE_FLAG
```
Col 8 = exchange (empty), col 11–12 = reserved (empty), col 13 = `D` if dupe. `PClub` header populated from `session.club`.

**Key invariants:**
- `isDupe(call, band, excludeId)` — uses `baseCall()` on both sides so `/P` portables match base call history; `excludeId` prevents false-dupe on the QSO being edited.
- `recalcDupes()` — iterates `_current.qsos` in order, rebuilds `dupe` flags per-band. Called after every edit or delete.
- `saveEditedQso()` — recalculates `xFlags` for the edited QSO, then calls `recalcDupes()` before persisting.
- `deleteQso()` — calls `cancelEdit()` first if the deleted QSO is the one being edited.
- `_editingExisting` — `true` while `editSessionSetup()` is open. `startSession()` updates `_current` in place rather than creating a new session; `cancelSetup()` returns to logger rather than home.
- `removeBandRow()` — guards against removing a band that has QSOs when `_editingExisting` is true.
- `_manualTime` — `{date: 'YYYYMMDD', time: 'HHMM'} | null`; read by `logQso()` to timestamp at a specific UTC time.
- `_exportingSession` — set at the top of `_showExportFor()` so `exportAllZip()` exports the correct session when called from the home screen.

**Key data flow:**
1. Page load → `loadBaseline()` → `fetch('./crosscheck-baseline.json')` → `applyBaseline()` → `_histDB`
2. Home → Setup → `startSession()` → `showLogger()`
3. `logQso()` → checks `_manualTime` → `isDupe()` + `lookupCall()` for xFlags → push QSO → `playQsoBeep()` → `syncCurrent()` → `renderTable()` + `renderStatsDetail()`
4. Row click → `editQso()` loads form, shows `#editTimeRow`, hides `#clockRow`
5. `logQso()` (while `_editingQso` set) → `saveEditedQso()` → `recalcDupes()` → `syncCurrent()`
6. Band tab click → `switchBand()` → `renderBandTabs()` + `renderTable()` + `updateNrS()` + `resetForm()`
7. Export button → `showExportModal()` → per-band `buildEdi()` → `dl()`; ZIP → `exportAllZip()` → `makeZip()` → `dl()`
8. ⚙ Edit → `editSessionSetup()` → `startSession()` updates `_current` → `showLogger(_current)`
9. ⬆ EDI → `triggerImport()` → `parseEdiForImport()` → `importEdi()` → `recalcDupes()` → `renderTable()`

**Tests:** `vhf-logger/vhf-logger.test.js` — 163 tests, 16 groups (`baseCall`, `normBand`, `locToLatLon`, `haversine`, `calcBearing`, `levenshtein`, `isDupe`, `recalcDupes`, `buildEdi`, `lookupCall`, `sessionEdit`, `parseEdiForImport`, `makeZip`, `bandColors`, `manualTime`, `backup`).

---

## Architecture of adif-qrz-filter.js

Node.js CLI script, no external dependencies. Pure Node.js `https` client for QRZ.com XML API.

| Layer | Responsibility |
|---|---|
| CLI parser (`parseArgs`) | `--username`, `--password`, `--key`, `--output`, `--delay`, `--cache`, `--include-unknown` |
| ADIF parser (`parseAdif`, `extractField`) | Splits on `<EOH>` / `<EOR>`, extracts `CALL` and `QSL_VIA` by tag:length |
| QRZ client (`qrzLogin`, `qrzLookup`) | XML over HTTPS, session-key auth, `qslmgr` text extraction |
| Fuzzy logic (`usesQslBuro`) | 14 exclusion regexes + 3 inclusion regexes on lowercased `qslmgr` text |
| Cache (`loadCache`, `saveCache`) | JSON file with 7-day TTL, keyed by callsign |
| Main (`main`) | Deduplicate calls → query QRZ → filter → write ADIF |

**Key data flow:**
1. Parse ADIF → `{ header, records[] }` (each record has `call`, `qslVia`, `raw`)
2. Build `uniqueCalls` + `managerCalls` from `QSL_VIA` fields
3. Query QRZ for each (with cache + rate limit) → `buroMap: call → boolean`
4. Filter: keep if `callBuro || mgrBuro`
5. Write output ADIF with original header + kept raw records

---

## Adding a New Tool

Follow the same single-file pattern. Reuse the CSS custom properties (`:root` color palette) and the `showToast()` / `dl()` utility pattern for consistency across tools.

## Domain Notes

- **EDI format**: REG1TEST v1. Sections are `[...]` headers; QSO records are semicolon-delimited in `[QSORecords;N]`. Field order is fixed: date, time, call, mode, rst_sent, nr_sent, rst_rcvd, nr_rcvd, exch, wwl, dist, new_exc, new_wwl, new_dxcc, dupe_flag (col 14, value `D`).
- **ADIF**: Fields are `<TAG:length>value`. Records end with `<EOR>`. Header ends with `<EOH>`.
- **Mode mapping** (EDI numeric → ADIF): `1=SSB, 2=CW, 3=CW, 4=SSB, 5=AM, 6=FM, 7=RTTY, 8=SSTV, 9=ATV`. Indices 3 and 4 are contest-specific sub-modes that map to the same ADIF mode.
- **Maidenhead locator case**: Received locator (`wwl`) stored as first 4 chars uppercase + last 2 chars lowercase (e.g. `JN65ar`). My locator (`myLoc`) kept fully uppercase. ADIF spec is case-insensitive but some tools break on all-uppercase 6-char grids.
- **DARC QSL CSV** columns: `Callsign, QSL Via, Date Time, Band, Mode, RST_SENT, QSL received`.

---
---

## Pregled projekta

**HamLogTools** je zbirka brskalniških orodij za radioamaterje, namenjena obdelavi in pretvorbi formatov dnevnikov. Vsa orodja so samostojne HTML datoteke — brez koraka gradnje, brez ogrodja, brez zalednega sistema.

**Trenutna orodja:**
- `edi2adif.html` — Pretvori REG1TEST EDI v1 tekmovalne dnevnike v format ADIF in druge formate
- `edi-crosscheck.html` — Preveri nov EDI dnevnik proti zgodovinskim dnevnikom (+ opcijski OEVSV IARU R1 baseline) in označi napake v klicnih znakih in lokatorjih
- `vhf-logger/vhf-logger.html` — Brskalniški beležnik za VHF/UHF/SHF tekmovalne dnevnike z live crosscheckom, EDI izvozom in izračunom QRB/azimuta
- `adif-merge.html` — Združuje več ADIF dnevniških datotek v eno; deduplikacija, filtriranje, urejanje v živo, izvoz ADIF in CSV
- `adif-qrz-filter.js` — Node.js CLI orodje, ki filtrira ADIF dnevnik in ohrani samo postaje, ki sprejemajo QSL preko biroja
- `build-baseline.js` — Node.js CLI orodje, ki gradi `crosscheck-baseline.json` iz OEVSV IARU R1 contest CSV exportov

## Razvoj

Ni sistema za gradnjo. Vsako `.html` datoteko odpri neposredno v brskalniku. Za iterativni razvoj uporabi lokalni HTTP strežnik, da se izogneš omejitvam CORS:

```bash
python3 -m http.server 8080
# nato odpri http://localhost:8080/edi2adif.html
```

Arhitekturna dokumentacija je v angleškem delu tega dokumenta.
