# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**HamLogTools** is a collection of browser-based tools for amateur radio operators to process and convert log formats. All tools are self-contained single-file HTML applications — no build step, no framework, no backend.

**Current tools:**
- `edi2adif.html` — Converts REG1TEST EDI v1 contest logs to ADIF and other formats
- `edi-crosscheck.html` — Cross-checks a new EDI log against historical logs (+ optional prebuilt OEVSV IARU R1 baseline) to flag callsign typos and locator mismatches
- `vhf-logger.html` — Browser-based contest logger for IARU R1 VHF/UHF contests; touch-first, multi-band, exports per-band EDI, live crosscheck hints from baseline
- `adif-qrz-filter.js` — Node.js CLI tool that filters an ADIF log to keep only BURO-accepting stations by querying the QRZ.com XML API
- `build-baseline.js` — Node.js CLI tool that builds `crosscheck-baseline.json` from OEVSV IARU R1 contest CSV exports, consumed by `edi-crosscheck.html` and `vhf-logger.html`

## Development

No build system. Open any `.html` file directly in a browser. For iterative development use a local HTTP server to avoid CORS restrictions:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/edi2adif.html
```

## Architecture of edi2adif.html

Single HTML file with three co-located layers (CSS → HTML → JavaScript). No external JS dependencies; only Google Fonts is loaded remotely.

**JavaScript is organized into labeled sections (marked with `// ═══` banners):**

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
| Render helpers (`htmlEsc()`, `modeBadge()`) | XSS-safe HTML escaping and mode → CSS badge class mapping; used by `renderTable()` and `restoreCell()`. |
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

## Adding a New Tool

Follow the same single-file pattern. Reuse the CSS custom properties (`:root` color palette) and the `showToast()` / `dl()` utility pattern for consistency across tools.

## Domain Notes

- **EDI format**: REG1TEST v1. Sections are `[...]` headers; QSO records are semicolon-delimited in `[QSORecords N]`. Field order is fixed: date, time, call, mode, rst_sent, nr_sent, rst_rcvd, nr_rcvd, exch, wwl, dist, …, dupe_flag (col 13, value `D`).
- **ADIF**: Fields are `<TAG:length>value`. Records end with `<EOR>`. Header ends with `<EOH>`.
- **Mode mapping** (EDI numeric → ADIF): `1=SSB, 2=CW, 3=CW, 4=SSB, 5=AM, 6=FM, 7=RTTY, 8=SSTV, 9=ATV`. Indices 3 and 4 are contest-specific sub-modes that map to the same ADIF mode.
- **Maidenhead locator case**: Received locator (`wwl`) is stored as first 4 chars uppercase + last 2 chars lowercase (e.g. `JN65ar`). My locator (`myLoc`) is kept fully uppercase. ADIF spec is case-insensitive but some tools break on all-uppercase 6-char grids.
- **DARC QSL CSV** columns: `Callsign, QSL Via, Date Time, Band, Mode, RST_SENT, QSL received`.

## Architecture of edi-crosscheck.html

Single HTML file with three co-located layers (CSS → HTML → JavaScript). No external JS dependencies. Same CSS custom-property palette and `showToast()` / `dl()` utility pattern as `edi2adif.html`.

**JavaScript sections:**

| Section | Responsibility |
|---|---|
| I18N (`S` object, `t()`, `setLang()`) | Bilingual UI strings (SL/EN). |
| Band mapping (`BAND_MAP`, `normBand()`) | Reused from `edi2adif.html`. |
| EDI parser (`parseEDI()`) | Slimmer variant: extracts callsign, mode, locator, date, band. |
| Utilities (`baseCall()`, `levenshtein()`, `htmlEsc()`) | Suffix stripping, edit distance with early exit, XSS escaping. |
| Historical DB (`_histDB`, `_locToCalls`, `_locToCallsRaw`) | Dual weighted+raw maps; see "Weighting model" below. |
| DB population (`addToHistDB()`, `applyBaseline()`, `loadBaseline()`, `clearHist()`) | Two sources: dropped EDI files (weight 1) and prebuilt baseline JSON (weight `BASELINE_WEIGHT` = 3). |
| Crosscheck algorithm (`runCrosscheck()`) | Two-pass check: (1) locator mismatch/missing against historical mode, (2) unknown callsign similarity via Levenshtein. Decisions use weighted counts, display fields use raw counts. |
| Threshold controls (`updatePrag()`, `rerunCrosscheck()`) | `_minAppearances` (1–10) and `_minConfidence` (0.1–1.0) slider UI; `_lastQsos` stores last new log for re-run. |
| Render (`renderSummaryBar()`, `renderResults()`, `updateDbCard()`) | Summary counts, filterable table with severity colour coding, dbCard with baseline tag + EDI stats. |
| HTML export (`exportIssues()`) | Generates a self-contained HTML file of all flagged QSOs with correction suggestions. |
| File loading (`loadHistFiles()`, `loadNewFile()`) | Async `FileReader` loops; historical files deduplicated by name+size. |
| Drag & drop + theme (`setupDrop()`, `toggleTheme()`) | Drag-over styling, click-to-input wiring, light/dark theme toggle with `localStorage`. |

**Weighting model (v1.4):**

The `_histDB` entry tracks two parallel histograms per callsign:

```
Map<baseCall, {
  locators:    Map<locUPPER, weightedCount>,  // used by algorithm
  locatorsRaw: Map<locUPPER, rawCount>,       // used by display
  total:       int,                            // weighted sum
  totalRaw:    int,                            // raw sum
}>
```

- **EDI QSO** contributes `+1` to both weighted and raw.
- **Baseline entry** contributes `+BASELINE_WEIGHT` (=3) to weighted and `+rawCount` to raw.
- `_locToCalls` / `_locToCallsRaw` use the same dual structure.

**Why:** robotically-validated own-locator declarations in the OEVSV baseline are higher confidence than partner-reported locators in user EDI files. Decisions (threshold `_minAppearances`, mode locator, severity) use weighted to give baseline more pull. Display surfaces (chips, exports) show raw counts so numbers stay intuitive. The `modeConf` ratio (`modeLoc.count / histEntry.total`) is invariant under uniform weighting, so threshold semantics remain stable.

**Baseline lifecycle:**

1. On page load, `loadBaseline()` fetches `./crosscheck-baseline.json`.
2. On success, JSON is cached in `_baselineRaw` and `applyBaseline()` aggregates the per-band locator stats into the flat weighted+raw maps.
3. On `fetch()` failure (most commonly `file://` CORS, or missing file), silent fallback — tool runs with EDI-only history.
4. `clearHist()` clears EDI contributions and re-injects baseline from cached `_baselineRaw` (baseline is persistent).

**Key data flow:**
1. Page load → `loadBaseline()` → `fetch()` → `applyBaseline()` → `_histDB` (baseline contribution, weight ×3)
2. Historical EDI files → `loadHistFiles()` → `parseEDI()` → `addToHistDB()` → `_histDB` (EDI contribution, weight ×1)
3. New EDI log → `loadNewFile()` → `parseEDI()` → `_lastQsos`
4. `runCrosscheck(_lastQsos)` → `_results[]` (each entry has `qso`, `issues[]`, `base`, `idx`)
5. `renderSummaryBar()` + `renderResults()` → filtered table
6. Slider change → `updatePrag()` → enables `rerunCrosscheck()` → re-populates `_results`
7. `exportIssues()` → Blob HTML → download

**Issue types:**
- `LOC_MISMATCH` — new locator differs from historical mode; severity `high` (mode confidence ≥ threshold and locator never seen) or `med` (locator seen before).
- `LOC_MISSING` — new log QSO has no locator but history exists; severity `high`/`med` based on mode confidence.
- `CALL_SIMILAR` — callsign not in history; Levenshtein distance ≤ 2 matches found, sorted by distance ASC then count DESC.
- `CALL_BY_LOC` — callsign not in history but a similar callsign worked from the same locator (composite heuristic).
- `CALL_UNKNOWN` — callsign not in history and no similar match within distance 2.

**QSO object shape** (after `parseEDI`):
```
call, mode, wwl, dateDisp, band, src
```

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
5. Build stable band index (BAND_MAP order, unknowns alphabetically last)
6. Emit compact JSON: `c[call][bandIdx] = [[loc, count, portable?], ...]` sorted by count desc

**Output format** (consumed by `edi-crosscheck.html`):
```json
{
  "v": "YYYY-MM-DD",
  "src": "iaru.oevsv.at",
  "minAppearances": 3,
  "n": { "calls": N, "entries": M, "files": F },
  "b": ["6m", "4m", "2m", ...],
  "c": { "CALL": { "bandIdx": [[loc, count, portable?], ...] } }
}
```

**Rebuild cadence:** quarterly or after major IARU R1 contests. The script is idempotent given the same inputs.

---

## Architecture of vhf-logger.html

Single HTML file with three co-located layers (CSS → HTML → JavaScript). No external JS dependencies. Same CSS custom-property palette (`:root` dark/light variables) and `showToast()` / `dl()` pattern as the other tools. `crosscheck-baseline.json` loaded on startup via `fetch()` for live autocomplete and crosscheck hints during log entry.

**JavaScript sections (marked with `// ════` banners):**

| Section | Responsibility |
|---|---|
| I18N (`S`, `t()`, `setLang()`) | Bilingual UI strings (SL/EN). Keys include `lblClub`, `ariaTheme`, `ariaDelLog`, `ariaDelQso`, `errStorageFull`. |
| Band config (`BAND_MAP`, `normBand`, `BAND_OPTS`) | 11 bands (6m–6mm) with canonical names and EDI header strings. |
| Geo utils (`locToLatLon`, `haversine`, `calcBearing`) | Maidenhead → lat/lon, QRB distance, great-circle bearing. |
| Crosscheck module | `baseCall()`, `levenshtein()`, `_histDB` (weighted+raw dual maps, same structure as `edi-crosscheck.html`), `applyBaseline()`, `loadBaseline()`, `lookupCall()`, `searchCalls()`. |
| State + persistence | `STORE='vhf-logger-v1'`, module-level `let _sessions`, `_current`, `_editingQso`. `saveSessions()` wrapped in try/catch. |
| Clock (`tickClock`) | Fires every 5 s; skips display update when `_editingQso` is set. |
| Navigation | `showHome()`, `showSetup()`, `showLogger()`, `pauseSession()`. |
| Home screen | `renderHome()`, `resumeSession()`, `deleteSession()`. |
| Setup screen | `addBandRow()`, `removeBandRow()`, `onBandSel()`, `collectSetup()`, `startSession()`. Reads `fClub` input → `session.club` for EDI `PClub`. |
| Logger core | `nextSerial()`, `isDupe(call, band, excludeId)`, `recalcDupes()`, `updateNrS()`, `switchBand()`, `renderBandTabs()`, `renderStats()`, `renderTable()`, `scrollTableBottom()`. |
| QSO editing | `editQso()`, `cancelEdit()`, `saveEditedQso()`, `setupTableClickHandler()`, `deleteQso()`. |
| QSO form | `onCallInput()`, `onCallKey()`, `renderAc()`, `selectAc()`, `onWwlInput()`, `updateWwlColor()`, `onModeChange()`, `checkDupeField()`, `logQso()`, `resetForm()`. |
| Hints | `updateLocHint()`, `calcAzimuth()`, `updateXhint()`, `debouncedXhint()` (150 ms debounce). |
| EDI export | `buildEdi()`, `showExportModal()`, `showExportFor()`, `_showExportFor()`, `_exportBand()`, `closeModal()`. |
| Theme + init | `toggleTheme()`, `init()`. |

**Key data structures:**

Session object:
```js
{ id, contest, myCall, myLoc, operator, club, created, modified, activeBand,
  bands: [{band, freq, power, antenna}], qsos: [...] }
```

QSO object:
```js
{ _id, band, mode, call, wwl, rstS, rstR, nrS, nrR,
  utcDate, utcTime, qrb, brg, dupe, xFlags }
```

**EDI QSO record format — 14 semicolon-separated fields (col 0–13):**
```
YYMMDD;HHMM;CALL;MODE_NUM;RST_S;NR_S;RST_R;NR_R;;WWL;QRB;;;DUPE
```
Col 8 = exchange (empty), col 11–12 = reserved (empty), col 13 = `D` if dupe, empty otherwise. `PClub` header field is populated from `session.club`.

**Key invariants:**
- `isDupe(call, band, excludeId)` — uses `baseCall()` on both sides so `/P` portables are matched against base call history; `excludeId` prevents false-dupe warning on the QSO currently being edited.
- `recalcDupes()` — iterates `_current.qsos` in order, rebuilds `dupe` flags per-band using `baseCall()` normalization. Called after any edit or delete.
- `saveEditedQso()` — recalculates `xFlags` (LOC_MISMATCH / CALL_SIMILAR) for the edited QSO, then calls `recalcDupes()` before persisting.
- `deleteQso()` — calls `cancelEdit()` first if the deleted QSO is the one being edited.
- `debouncedXhint(call)` — 150 ms debounce around `updateXhint()` to throttle Levenshtein search on each keystroke.
- `saveSessions()` is wrapped in try/catch; shows `t('errStorageFull')` toast on quota exceeded.

**Key data flow:**
1. Page load → `loadBaseline()` → `fetch('./crosscheck-baseline.json')` → `applyBaseline()` → `_histDB`
2. Home → Setup → `startSession()` creates session with `club` field → `showLogger()`
3. `logQso()` → `isDupe()` + `lookupCall()` for xFlags → push QSO → `syncCurrent()` → `renderTable()`
4. Row click → `editQso()` loads form, shows `#editTimeRow`, hides `#clockRow`
5. `logQso()` (while `_editingQso` set) → delegates to `saveEditedQso()` → `recalcDupes()` → `syncCurrent()`
6. Band tab click → `switchBand()` → `renderBandTabs()` + `renderTable()` + `updateNrS()` + `resetForm()`
7. Export button → `showExportModal()` → per-band `buildEdi()` → `dl()`

**Tests:** `vhf-logger.test.js` — 77 tests across 10 groups (`baseCall`, `normBand`, `locToLatLon`, `haversine`, `calcBearing`, `levenshtein`, `isDupe`, `recalcDupes`, `buildEdi`, `lookupCall`).

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
| Main (`main`) | Deduplicate calls → query QRZ (with optional QSL managers) → filter → write ADIF |

**Key data flow:**
1. Parse ADIF → `{ header, records[] }` (each record has `call`, `qslVia`, `raw`)
2. Build `uniqueCalls` + `managerCalls` from `QSL_VIA` fields
3. Query QRZ for each (with cache + rate limit) → `buroMap: call → boolean`
4. Filter: keep if `callBuro || mgrBuro`
5. Write output ADIF with original header + kept raw records

---
---

## Pregled projekta

**HamLogTools** je zbirka brskalniških orodij za radioamaterje, namenjena obdelavi in pretvorbi formatov dnevnikov. Vsa orodja so samostojne HTML datoteke — brez koraka gradnje, brez ogrodja, brez zalednega sistema.

**Trenutna orodja:**
- `edi2adif.html` — Pretvori REG1TEST EDI v1 tekmovalne dnevnike v format ADIF in druge formate
- `edi-crosscheck.html` — Preveri nov EDI dnevnik proti zgodovinskim dnevnikom (+ opcijski pred-zgrajen OEVSV IARU R1 baseline) in označi morebitne napake v klicnih znakih in lokatorjih
- `vhf-logger.html` — Brskalniški beležnik za VHF/UHF/SHF tekmovalne dnevnike z live crosscheckom, EDI izvozom in izračunom QRB/azimuta
- `adif-qrz-filter.js` — Node.js CLI orodje, ki filtrira ADIF dnevnik in ohrani samo postaje, ki sprejemajo QSL preko biroja, s poizvedovanjem prek QRZ.com XML API
- `build-baseline.js` — Node.js CLI orodje, ki gradi `crosscheck-baseline.json` iz OEVSV IARU R1 contest CSV exportov, namenjeno za `edi-crosscheck.html` in `vhf-logger.html`

## Razvoj

Ni sistema za gradnjo. Vsako `.html` datoteko odpri neposredno v brskalniku. Za iterativni razvoj uporabi lokalni HTTP strežnik, da se izogneš omejitvam CORS:

```bash
python3 -m http.server 8080
# nato odpri http://localhost:8080/edi2adif.html
```

## Arhitektura edi2adif.html

Enojna HTML datoteka s tremi solociranimi plastmi (CSS → HTML → JavaScript). Brez zunanjih JS odvisnosti; edino Google Fonts se naloži iz spleta.

**JavaScript je organiziran v označene razdelke (označeni z `// ═══` pasicami):**

| Razdelek | Odgovornost |
|---|---|
| I18N (`S` objekt, `t()`, `setLang()`) | Dvojezični nizi vmesnika (SL/EN). Vse besedilo za uporabnika gre skozi `t(key)`. |
| Mapiranje pasov (`BAND_MAP`, `normBand()`) | Tabela regularnih izrazov, ki preslika vrednosti EDI `PBand` v kanonična imena pasov ADIF. |
| EDI razčlenjevalnik (`parseEDI()`) | Bere ključ=vrednost pare glave in razdelek `[QSORecords…]`. Vrne `{header, band, freq, qsos}`. |
| Stanje (`_all`, `_filtered`, `_sources`, `_sortCol`, `_sortAsc`, `_desel`) | Globalne spremenljivke na ravni modula, deljene med vsemi funkcijami. |
| Nalaganje datotek (`handleFiles()`, `finishLoad()`) | Asinhrona zanka `FileReader`; podvajanje prek `_bandKey` (klicni znak\|datum\|čas\|pas). |
| Filter + razvrščanje (`applyFilters()`, `sortFiltered()`) | Polni `_filtered` iz `_all`; `COL_KEYS` preslika indeks stolpca → lastnost QSO. |
| Prikaz tabele (`renderTable()`) | Znova zgradi `<thead>` in `<tbody>` prek stikanja nizov; izbor vrstic sledimo v množici `_desel`. |
| Pomožniki za izvoz (`getExportPool()`, `adifField()`, `csvEsc()`, `dl()`) | `getExportPool()` je edini vir resnice o tem, kateri QSO-ji gredo v kateri izvoz. |
| Pomožniki za prikaz (`htmlEsc()`, `modeBadge()`) | Varno ubežanje HTML (XSS) in preslikava načina v razred CSS za značko; uporabljata ju `renderTable()` in `restoreCell()`. |
| Izvozniki (`exportADIF()`, `exportDARC()`, `exportCSV()`) | Vsak ustvari popolno datoteko in sproži prenos prek `dl()`. |

**Potek podatkov:**
1. Datoteke → `handleFiles()` → `parseEDI()` → `_all[]`
2. `finishLoad()` dodeli `_idx`, odstrani duplikate, razkrije `#app`, pokliče `buildFilters()` + `applyFilters()`
3. `applyFilters()` → `_filtered[]` → `renderTable()`
4. Gumbi za izvoz pokličejo `getExportPool()` (upošteva "samo označene" + filter duplikatov) → format → `dl()`

## Dodajanje novega orodja

Sledi enakemu vzorcu z eno datoteko. Za doslednost med orodji ponovno uporabi CSS spremenljivke (barvna paleta `:root`) ter vzorec pomožnih funkcij `showToast()` in `dl()`.

## Opombe o domeni

- **Format EDI**: REG1TEST v1. Razdelki so glave `[...]`; zapisi QSO so ločeni s podpičji v `[QSORecords N]`. Vrstni red polj je fiksen: datum, čas, klicni znak, način, rst_oddano, nr_oddano, rst_sprejeto, nr_sprejeto, izmenjava, wwl, razdalja, …, zastavica duplikata (stolpec 13, vrednost `D`).
- **ADIF**: Polja so `<OZNAKA:dolžina>vrednost`. Zapisi se končajo z `<EOR>`. Glava se konča z `<EOH>`.
- **Mapiranje načina** (EDI številka → ADIF): `1=SSB, 2=CW, 3=CW, 4=SSB, 5=AM, 6=FM, 7=RTTY, 8=SSTV, 9=ATV`. Indeksa 3 in 4 sta tekmovalna pod-načina, ki se preslikata v isti ADIF način.
- **Velikost črk lokatorja**: Prejeti lokator (`wwl`) je shranjen z velikimi prvimi 4 znaki + malimi zadnjima 2 (npr. `JN65ar`). Moj lokator (`myLoc`) ostane v celoti z velikimi črkami. Specifikacija ADIF ne razlikuje velikosti, nekatera orodja pa se zatravnejo na 6-znakovnih lokatorjih z vsemi velikimi črkami.
- **DARC QSL CSV** stolpci: `Callsign, QSL Via, Date Time, Band, Mode, RST_SENT, QSL received`.

---

## Arhitektura edi-crosscheck.html

Enojna HTML datoteka s tremi solociranimi plastmi (CSS → HTML → JavaScript). Brez zunanjih JS odvisnosti. Enaka barvna paleta CSS spremenljivk (`:root`) in vzorec pomožnih funkcij `showToast()` / `dl()` kot v `edi2adif.html`.

**Razdelki JavaScript:**

| Razdelek | Odgovornost |
|---|---|
| I18N (`S` objekt, `t()`, `setLang()`) | Dvojezični nizi vmesnika (SL/EN). |
| Mapiranje pasov (`BAND_MAP`, `normBand()`) | Ponovno uporabljeno iz `edi2adif.html`. |
| EDI razčlenjevalnik (`parseEDI()`) | Ožja različica: izvleče klicni znak, način, lokator, datum, pas. |
| Pomožniki (`baseCall()`, `levenshtein()`, `htmlEsc()`) | Odstranjevanje pripon, razdalja urejanja z zgodnjim izhodom, ubežanje XSS. |
| Zgodovinska baza (`_histDB`, `_locToCalls`, `_locToCallsRaw`) | Dvojni weighted+raw maps; glej "Model uteževanja" spodaj. |
| Polnjenje baze (`addToHistDB()`, `applyBaseline()`, `loadBaseline()`, `clearHist()`) | Dva vira: spuščene EDI datoteke (teža 1) in pred-zgrajen baseline JSON (teža `BASELINE_WEIGHT` = 3). |
| Algoritem crosschecka (`runCrosscheck()`) | Dvojni prehod: (1) neskladje/manjkajoč lokator proti zgodovinskemu modusu, (2) podobnost neznanega klicnega znaka prek Levenshteina. Odločitve uporabljajo weighted štetja, prikazna polja raw. |
| Nadzor pragov (`updatePrag()`, `rerunCrosscheck()`) | Drsnika `_minAppearances` (1–10) in `_minConfidence` (0,1–1,0); `_lastQsos` shrani zadnji nov dnevnik za ponovni prehod. |
| Prikaz (`renderSummaryBar()`, `renderResults()`, `updateDbCard()`) | Povzetek s štetjem, filtrirana tabela z barvnim kodiranjem resnosti, dbCard z baseline tag-om + EDI statistiko. |
| HTML izvoz (`exportIssues()`) | Ustvari samostojno HTML datoteko z vsemi označenimi QSO in predlogi popravkov. |
| Nalaganje datotek (`loadHistFiles()`, `loadNewFile()`) | Asinhroni zanki `FileReader`; zgodovinske datoteke deduplicirane po ime+velikost. |
| Povleci-in-spusti + tema (`setupDrop()`, `toggleTheme()`) | Oblikovanje povleci-nad, priklop klik-vnos, preklop svetla/temna tema s `localStorage`. |

**Model uteževanja (v1.4):**

Vsak `_histDB` zapis sledi dvema vzporednima histogramoma per klicni znak:

```
Map<bazniKlicniZnak, {
  locators:    Map<locUPPER, utežene števec>,  // uporablja algoritem
  locatorsRaw: Map<locUPPER, raw števec>,      // uporablja prikaz
  total:       int,                             // utežena vsota
  totalRaw:    int,                             // raw vsota
}>
```

- **EDI QSO** prispeva `+1` k uteženemu in raw.
- **Baseline vnos** prispeva `+BASELINE_WEIGHT` (=3) k uteženemu in `+rawCount` k raw.
- `_locToCalls` / `_locToCallsRaw` uporabljata isto dvojno strukturo.

**Zakaj:** robotsko-validirane deklaracije lastnega lokatorja v OEVSV baseline-u imajo višje zaupanje kot lokatorji, ki jih je v EDI dnevniku zapisal partner. Odločitve (prag `_minAppearances`, modus lokator, severity) uporabljajo weighted, da baseline ima več teže. Prikazne površine (chip-i, izvozi) kažejo raw številke, da ostanejo intuitivne. Razmerje `modeConf` (`modeLoc.count / histEntry.total`) je invariantno pod uniformnim weighting-om, tako da threshold semantika ostane stabilna.

**Življenjski cikel baseline-a:**

1. Ob nalaganju strani `loadBaseline()` fetch-a `./crosscheck-baseline.json`.
2. Ob uspehu se JSON shrani v `_baselineRaw` in `applyBaseline()` agregira per-band statistiko v flat weighted+raw maps.
3. Ob `fetch()` napaki (najpogosteje `file://` CORS ali manjkajoča datoteka) — tih fallback, orodje deluje samo z EDI zgodovino.
4. `clearHist()` počisti EDI prispevke in re-inject-a baseline iz cached `_baselineRaw` (baseline je trajen).

**Potek podatkov:**
1. Nalaganje strani → `loadBaseline()` → `fetch()` → `applyBaseline()` → `_histDB` (baseline prispevek, teža ×3)
2. Zgodovinske EDI datoteke → `loadHistFiles()` → `parseEDI()` → `addToHistDB()` → `_histDB` (EDI prispevek, teža ×1)
3. Nov EDI dnevnik → `loadNewFile()` → `parseEDI()` → `_lastQsos`
4. `runCrosscheck(_lastQsos)` → `_results[]` (vsak vnos ima `qso`, `issues[]`, `base`, `idx`)
5. `renderSummaryBar()` + `renderResults()` → filtrirana tabela
6. Sprememba drsnika → `updatePrag()` → omogoči `rerunCrosscheck()` → ponovno napolni `_results`
7. `exportIssues()` → Blob HTML → prenos

**Vrste težav:**
- `LOC_MISMATCH` — nov lokator se razlikuje od zgodovinskega modusa; resnost `high` (zaupanje v modus ≥ prag in lokator še nikoli viden) ali `med` (lokator že viden prej).
- `LOC_MISSING` — zveza v novem dnevniku nima lokatorja, a zgodovina obstaja; resnost `high`/`med` glede na zaupanje v modus.
- `CALL_SIMILAR` — klicni znak ni v zgodovini; najdena ujemanja z Levenshteinovo razdaljo ≤ 2, razvrščena po razdalji NAR, nato po številu PAD.
- `CALL_BY_LOC` — klicni znak ni v zgodovini, ampak podoben klicni znak je delal iz istega lokatorja (kompozitna hevristika).
- `CALL_UNKNOWN` — klicni znak ni v zgodovini in ni podobnega ujemanja v razdalji 2.

**Oblika objekta QSO** (po `parseEDI`):
```
call, mode, wwl, dateDisp, band, src
```

---

## Arhitektura vhf-logger.html

Enojna HTML datoteka s tremi solociranimi plastmi (CSS → HTML → JavaScript). Brez zunanjih JS odvisnosti. Enaka barvna paleta CSS spremenljivk (`:root` temne/svetle spremenljivke) in vzorec pomožnih funkcij `showToast()` / `dl()` kot pri ostalih orodjih. `crosscheck-baseline.json` se naloži ob zagonu prek `fetch()` za live avtodokončanje in crosscheck namige med vnosom dnevnika.

**Razdelki JavaScript (označeni z `// ════` pasicami):**

| Razdelek | Odgovornost |
|---|---|
| I18N (`S`, `t()`, `setLang()`) | Dvojezični nizi vmesnika (SL/EN). Ključi vključujejo `lblClub`, `ariaTheme`, `ariaDelLog`, `ariaDelQso`, `errStorageFull`. |
| Konfiguracija pasov (`BAND_MAP`, `normBand`, `BAND_OPTS`) | 11 pasov (6m–6mm) s kanonskimi imeni in nizi za EDI glavo. |
| Geo pomožniki (`locToLatLon`, `haversine`, `calcBearing`) | Maidenhead → lat/lon, razdalja QRB, smer po velikem krogu. |
| Crosscheck modul | `baseCall()`, `levenshtein()`, `_histDB` (uteženi+raw dual maps, enaka struktura kot `edi-crosscheck.html`), `applyBaseline()`, `loadBaseline()`, `lookupCall()`, `searchCalls()`. |
| Stanje + trajnost | `STORE='vhf-logger-v1'`, modularni `let _sessions`, `_current`, `_editingQso`. `saveSessions()` zavita v try/catch. |
| Ura (`tickClock`) | Sproži se vsakih 5 s; preskoči posodobitev prikaza, ko je nastavljen `_editingQso`. |
| Navigacija | `showHome()`, `showSetup()`, `showLogger()`, `pauseSession()`. |
| Domači zaslon | `renderHome()`, `resumeSession()`, `deleteSession()`. |
| Zaslon za nastavitve | `addBandRow()`, `removeBandRow()`, `onBandSel()`, `collectSetup()`, `startSession()`. Prebere vnos `fClub` → `session.club` za EDI `PClub`. |
| Jedro beležnika | `nextSerial()`, `isDupe(call, band, excludeId)`, `recalcDupes()`, `updateNrS()`, `switchBand()`, `renderBandTabs()`, `renderStats()`, `renderTable()`, `scrollTableBottom()`. |
| Urejanje QSO | `editQso()`, `cancelEdit()`, `saveEditedQso()`, `setupTableClickHandler()`, `deleteQso()`. |
| Obrazec QSO | `onCallInput()`, `onCallKey()`, `renderAc()`, `selectAc()`, `onWwlInput()`, `updateWwlColor()`, `onModeChange()`, `checkDupeField()`, `logQso()`, `resetForm()`. |
| Namigi | `updateLocHint()`, `calcAzimuth()`, `updateXhint()`, `debouncedXhint()` (150 ms debounce). |
| EDI izvoz | `buildEdi()`, `showExportModal()`, `showExportFor()`, `_showExportFor()`, `_exportBand()`, `closeModal()`. |
| Tema + inicializacija | `toggleTheme()`, `init()`. |

**Ključne podatkovne strukture:**

Objekt seje:
```js
{ id, contest, myCall, myLoc, operator, club, created, modified, activeBand,
  bands: [{band, freq, power, antenna}], qsos: [...] }
```

Objekt QSO:
```js
{ _id, band, mode, call, wwl, rstS, rstR, nrS, nrR,
  utcDate, utcTime, qrb, brg, dupe, xFlags }
```

**Format zapisa EDI QSO — 14 polj, ločenih s podpičji (stolpci 0–13):**
```
LLMMDD;HHMM;KLICNI_ZNAK;NACIN_ST;RST_O;ST_O;RST_S;ST_S;;WWL;QRB;;;DUPE
```
Stolpec 8 = izmenjava (prazno), stolpci 11–12 = rezervirano (prazno), stolpec 13 = `D` pri duplikatu, sicer prazno. Polje glave `PClub` je izpolnjeno iz `session.club`.

**Ključne invariante:**
- `isDupe(call, band, excludeId)` — uporablja `baseCall()` na obeh straneh, da se prenosni `/P` ujamejo z zgodovino baznega klicnega znaka; `excludeId` preprečuje lažno opozorilo o duplikatu na QSO, ki ga trenutno urejamo.
- `recalcDupes()` — iterira `_current.qsos` po vrsti, obnavlja zastavice `dupe` po pasovih z normalizacijo `baseCall()`. Pokliče se po vsakem urejanju ali brisanju.
- `saveEditedQso()` — preračuna `xFlags` (LOC_MISMATCH / CALL_SIMILAR) za urejeni QSO, nato pokliče `recalcDupes()` pred shranjevanjem.
- `deleteQso()` — najprej pokliče `cancelEdit()`, če je brisujoči QSO tisti, ki se ureja.
- `debouncedXhint(call)` — 150 ms debounce okoli `updateXhint()` za dušenje Levenshteinove iskanja ob vsakem pritisku tipke.
- `saveSessions()` je zavita v try/catch; ob prekoračitvi kvote prikaže toast `t('errStorageFull')`.

**Potek podatkov:**
1. Nalaganje strani → `loadBaseline()` → `fetch('./crosscheck-baseline.json')` → `applyBaseline()` → `_histDB`
2. Domov → Nastavitve → `startSession()` ustvari sejo s poljem `club` → `showLogger()`
3. `logQso()` → `isDupe()` + `lookupCall()` za xFlags → doda QSO → `syncCurrent()` → `renderTable()`
4. Klik na vrstico → `editQso()` naloži obrazec, prikaže `#editTimeRow`, skrije `#clockRow`
5. `logQso()` (ko je nastavljen `_editingQso`) → delegira na `saveEditedQso()` → `recalcDupes()` → `syncCurrent()`
6. Klik na zavihek pasu → `switchBand()` → `renderBandTabs()` + `renderTable()` + `updateNrS()` + `resetForm()`
7. Gumb za izvoz → `showExportModal()` → `buildEdi()` po pasovih → `dl()`

**Testi:** `vhf-logger.test.js` — 77 testov v 10 skupinah (`baseCall`, `normBand`, `locToLatLon`, `haversine`, `calcBearing`, `levenshtein`, `isDupe`, `recalcDupes`, `buildEdi`, `lookupCall`).

---

## Arhitektura build-baseline.js

Node.js CLI skripta, ki gradi `crosscheck-baseline.json` iz mape OEVSV IARU R1 contest CSV exportov. Brez zunanjih odvisnosti.

| Razdelek | Odgovornost |
|---|---|
| CLI parser (`parseArgs`) | `--in`, `--out`, `--min-appearances`, `--pretty`, `--verbose`, `--help` |
| Mapiranje pasov (`BAND_MAP`, `normBand()`) | 16 pasov od 50 MHz do 300 GHz. Decimalka-zavarovani regex-i razlikujejo "1.3 GHz" → 23cm od "122 GHz" → 2.5mm. |
| Normalizacija klicnega znaka (`baseCall()`, `callSuffix()`) | Eksaktno enako kot `edi-crosscheck.html` — ista suffix-strip vs. prefix-keep hevristika. |
| Validacija lokatorja (`normLocator()`) | Maidenhead regex `[A-R]{2}[0-9]{2}[A-X]{2}`; prve 4 velike + zadnji 2 mali za ujemanje s konvencijo orodja. |
| CSV parser (`parseCSVLine`, `readCSV`) | RFC-4180-ish parser kvotiranih polj. Encoding fallback: UTF-8 → ISO-8859-1 ob detekciji U+FFFD. Mapiranje stolpcev po glavi (tolerantno do 23/25-stolpčnih OEVSV variant). |
| Main (`main`) | Agregira → filtrira (≥ `MIN_APP`) → razvrsti → izda kompakten JSON z versioniranjem. |

**Potek podatkov:**
1. Branje CSV mape → detekcija glave per datoteka → iteracija vrstic
2. Validacija vrstice (klicni znak neprazen, lokator regex, pas prepoznan, pripona ne `/MM` ali `/AM`)
3. Agregacija v `Map<bazniKlicniZnak, Map<pas, Map<lok, {count, portable}>>>`
4. Filtriranje klicnih znakov po skupnem številu nastopov ≥ `MIN_APP` (privzeto 3)
5. Gradnja stabilnega indeksa pasov (BAND_MAP vrstni red, neznane abecedno na konec)
6. Izdaja kompaktnega JSON: `c[call][bandIdx] = [[loc, count, portable?], ...]` razvrščen po count padajoče

**Format izhoda** (konzumira ga `edi-crosscheck.html`):
```json
{
  "v": "YYYY-MM-DD",
  "src": "iaru.oevsv.at",
  "minAppearances": 3,
  "n": { "calls": N, "entries": M, "files": F },
  "b": ["6m", "4m", "2m", ...],
  "c": { "CALL": { "bandIdx": [[loc, count, portable?], ...] } }
}
```

**Interval obnavljanja:** kvartalno ali po večjih IARU R1 tekmovanjih. Skripta je idempotentna pri enakih vhodnih podatkih.
