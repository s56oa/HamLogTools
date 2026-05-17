# S56OA HamLogTools

Tools for amateur radio log processing and format conversion.

**[Slovenska različica / Slovenian version ↓](#s56oa-hamlogtools-sl)**

---

## Tools

| Tool | Type | Purpose |
|---|---|---|
| [`edi2adif.html`](edi2adif.html) | Browser app | Convert REG1TEST EDI v1 contest logs to ADIF and CSV formats |
| [`edi-crosscheck.html`](edi-crosscheck.html) | Browser app | Crosscheck a new EDI log against historical logs + optional OEVSV IARU R1 baseline — flags locator mismatches and callsign typos |
| [`vhf-logger/vhf-logger.html`](vhf-logger/vhf-logger.html) | Browser app | Real-time VHF/UHF/SHF contest logger with live crosscheck hints, QRB/bearing display, and REG1TEST EDI export |
| [`adif-merge.html`](adif-merge.html) | Browser app | Merge multiple ADIF log files — deduplication, filter by band/mode/source, inline editing, export to ADIF and CSV |
| [`adif-stats.html`](adif-stats.html) | Browser app | Analyse an ADIF log — statistics by band/mode/continent/country/time, DXCC per band, activity heatmap, band×hour propagation matrix, QRB distribution, HTML export |
| [`adif-qrz-filter.js`](adif-qrz-filter.js) | Node.js CLI | Filter an ADIF log to keep only QSOs with BURO-accepting stations |
| [`build-baseline.js`](build-baseline.js) | Node.js CLI | Build `crosscheck-baseline.json` from OEVSV IARU R1 contest CSV exports for use with `edi-crosscheck.html` and `vhf-logger/vhf-logger.html` |

---

## S56OA EDI → ADIF Converter (`edi2adif.html`)

Converts [REG1TEST EDI v1](http://www.edi.kkn.net/) contest logs to ADIF and other formats.
Open the file in any modern browser — no installation required.

**[➜ Open edi2adif.html](edi2adif.html)**

### Features

- **Drag & drop** one or more `.edi` files simultaneously
- **Preview table** with sorting by any column and live search by callsign
- **Filters** by band, mode, and source file
- **Duplicate detection** — cross-file duplicates flagged automatically (same call + date + time + band); hide them with one click
- **Row selection** — cherry-pick QSOs to include in the export
- **Inline editing** — correct mode, RST, locator, date, time, callsign before export
- **Three export formats:**
  - **ADIF** — full export with all available fields (call, date/time, band, mode, RST sent/received, serial numbers, locator, distance, my callsign, my locator, power, contest name, operators, equipment)
  - **DARC QSL CSV** — for the DARC QSL bureau online service
  - **Generic CSV** — 19 columns with all parsed fields, for spreadsheet import or further analysis
- **Bilingual UI** — Slovenian and English
- **Dark/light theme** toggle with localStorage persistence

### Supported Bands

| EDI `PBand` value | ADIF band |
|---|---|
| 50 MHz, 6m | `6m` |
| 144 / 145 MHz, 2m | `2m` |
| 430 / 432 MHz, 70 cm | `70cm` |
| 1.2 / 1.3 GHz, 1296 MHz, 23 cm | `23cm` |
| 2.3 GHz, 2320 MHz, 13 cm | `13cm` |
| 3.4 GHz, 3400 MHz, 9 cm | `9cm` |
| 5.7 GHz, 5760 MHz, 6 cm | `6cm` |
| 10 GHz, 10368 MHz, 3 cm | `3cm` |
| 24 GHz, 24048 MHz, 1.25 cm | `1.25cm` |
| 47 GHz, 6 mm | `6mm` |

**Supported modes:** SSB · CW · FM · AM · RTTY · SSTV · ATV

### How to Use

1. Download `edi2adif.html` (single file, ~42 KB)
2. Open it in any modern browser (Chrome, Firefox, Edge, Safari)
3. Drag one or more `.edi` files onto the drop zone, or click **Choose files**
4. Review the QSO table — sort columns, filter, search, hide duplicates
5. Optionally select specific rows for export
6. Click the desired export button

No internet connection required after the page loads (except for Google Fonts).
All processing happens in your browser — no files or QSO data are uploaded anywhere.

---

## S56OA EDI Crosscheck (`edi-crosscheck.html`)

Browser tool that compares a new EDI contest log against a statistical database built from
historical EDI logs. Helps catch locator mismatches and callsign typos before submitting the log.
Open the file in any modern browser — no installation required.

**[➜ Open edi-crosscheck.html](edi-crosscheck.html)**

### How it works

1. **Optional baseline:** If [`crosscheck-baseline.json`](crosscheck-baseline.json) is present next to the HTML and the page is served over HTTP, a prebuilt baseline of 3 000+ IARU R1 contest stations (call → locator, derived from public OEVSV CSV exports) is loaded automatically on startup. This gives a useful crosscheck even *without* any of your own EDI history.
2. **Phase 1 — extend database:** Drag any number of past EDI logs (1–50+) onto the tool. Locator counts from your EDI logs are merged into the baseline.
3. **Phase 2 — crosscheck:** Drag the new EDI log. Every QSO is checked against the combined database.

> **Note on `file://` opening:** modern browsers block `fetch()` from `file://` URLs for security. If you double-click the HTML, the baseline silently fails to load and the tool works exactly like v1.3 (your EDI history only). To use the baseline, serve over HTTP (`python3 -m http.server`) — see [How to Use](#how-to-use-1) below.

### What is flagged

| Badge | Colour | Condition |
|---|---|---|
| `LOC!` | Red | Locator differs from historical mode; mode confidence ≥ threshold and new locator was never seen before |
| `LOC?` | Amber | Locator differs from historical mode; lower confidence or new locator appeared before (operator moved) |
| `LOC?` | Amber | QSO has no locator but the callsign exists in history — suggests the historical mode locator |
| `CALL?` | Amber | Callsign not in history; similar callsign found globally (Levenshtein distance 1–2) |
| `LOC-CALL?` | Blue | Callsign not in history; similar callsign found *from the same locator* (composite heuristic) |
| `?` | Grey | Callsign not in history; no similar callsign found |
| `✓` | Green | Callsign in history, locator matches historical mode |

Portable and mobile suffixes (`/P`, `/M`, `/MM`, etc.) are stripped before lookup — `S59DGO/P` is matched against `S59DGO` history. Italian regional suffixes (`/IV3`, `/I2`, etc.) and numerical district suffixes (`/1`, `/2`) are also stripped. Prefix-slash callsigns (`OE/S59DGO`) are kept unchanged.

The locator check requires at least **3** historical appearances by default, but this is configurable via the **Min. appearances** slider (1–10). The **Confidence** slider (10–100%) controls the `high` vs `medium` severity cutoff. Both sliders can be adjusted after loading a new log — click **Re-run** to apply the new thresholds without reloading the file.

### Features

- **OEVSV IARU R1 baseline** (v1.4+) — optional prebuilt database of ~3 240 contest callsigns with their declared locators, loaded automatically on startup if `crosscheck-baseline.json` is present. Each baseline entry weighs 3× a single EDI QSO (authoritative own-locator declarations from robotically-validated contest logs). Display chips still show **raw counts** to remain intuitive.
- **Configurable thresholds** — adjust minimum historical appearances (1–10) and mode-confidence cutoff (10–100%) via toolbar sliders; re-run crosscheck without reloading the file
- **Missing-locator suggestion** — flags QSOs that have no locator but whose callsign exists in history, suggesting the most common historical locator
- **Composite callsign check** — when a callsign is unknown globally, also checks callsigns that have historically operated from the *same locator* (catches typos like `IK3GOY` → `IW3GOA` when both are from `JN65DM`)
- **HTML export** — download a self-contained HTML report of all flagged QSOs with correction suggestions
- **Persistent baseline** — the "Clear history" button clears only your dropped EDI logs; the baseline remains in place.

### How to Use

1. Download `edi-crosscheck.html` (single file, ~50 KB). Optionally also download [`crosscheck-baseline.json`](crosscheck-baseline.json) (~220 KB) for the OEVSV baseline.
2. **For baseline support**, serve over a local HTTP server (browsers block `fetch()` from `file://`):
   ```bash
   cd /path/to/HamLogTools
   python3 -m http.server 8080
   # then open: http://localhost:8080/edi-crosscheck.html
   ```
   For double-click `file://` use, the tool still works fully — just without the baseline.
3. Drag historical EDI logs onto the first drop zone (optional if baseline is loaded)
4. Drag the new EDI log onto the second drop zone
5. Review the results table — filter by "flagged only" or search by callsign
6. Optionally adjust the sliders and click **Re-run** to change sensitivity
7. Click **Export issues** to download an HTML report

No internet connection required. All processing is local in your browser.

---

## S56OA VHF/UHF Contest Logger (`vhf-logger/vhf-logger.html`)

Real-time contest logger for VHF/UHF/SHF bands. Stores sessions in `localStorage` — no server required.
Open the file in any modern browser (for baseline support, serve over HTTP).

**[➜ Open vhf-logger/vhf-logger.html](vhf-logger/vhf-logger.html)**

### Features

- **Multi-band session** — configure up to 11 bands (6m through 6mm) with independent QSO tables, serial numbers, and statistics
- **Live crosscheck** — callsign autocomplete and mismatch hints powered by `crosscheck-baseline.json` (same database as `edi-crosscheck.html`); baseline loaded automatically on startup over HTTP
- **QRB + bearing** — great-circle distance and azimuth calculated from Maidenhead locators and displayed per QSO
- **Dupe detection** — real-time warning with `baseCall()` normalization so `S59DGO/P` is correctly matched against `S59DGO`; per-band, excludes the QSO currently being edited
- **Inline editing** — click any logged QSO to correct call, locator, RST, serial, mode, or time; dupe flags and xFlags recalculated on save
- **Session metadata editing** — ⚙ Edit button in the logger toolbar opens the setup form pre-filled with the current session's data; saves changes to the existing session in place without losing any QSOs
- **Per-band stats panel** — 📊 toggle shows a collapsible table with QSOs/band, unique Maidenhead squares, total QRB, and best DX call+distance; state persisted in `localStorage`
- **ZIP export** — one click downloads a ZIP file containing separate EDI files for all bands that have QSOs
- **EDI import** — ⬆ EDI button imports an existing REG1TEST EDI file into the current session; merges QSOs into the matching band row (band must already be configured)
- **Manual time override** — ✎ button reveals a UTC time input next to the clock; QSOs logged while override is active use the specified time instead of the live clock (for late entries)
- **Keyboard shortcuts** — Enter on the last serial field submits the QSO; Tab advances RST_S → RST_R → NrR → Log; Esc cancels editing or closes the autocomplete/time override
- **Band tab colours** — each band tab is highlighted in a distinct colour when active (6m = amber, 2m = blue, 70cm = teal, etc.)
- **QSO sound** — 🔊 toggle enables a short 880 Hz beep on each successfully logged QSO (Web Audio API); two short lower-pitch pips warn on missing locator or serial; persisted in `localStorage`
- **WWL auto-fill** — when a callsign is selected from the autocomplete dropdown, the known baseline locator is filled in automatically; can be overridden by typing
- **Missing field warning** — if locator or received serial is absent when logging, a soft warning highlights the field in red and shows a **Save anyway** override button; does not block logging
- **EDI export** — produces valid REG1TEST EDI files (one per band): correct `[REG1TEST;1]` header, `SPowe`/`SAnte`/`STXEq`/`SRXEq`/`SAntH` equipment fields, `PSect` category, full C* score summary block (`CQSOs`, `CQSOP`, `CWWLs`, `CWWLB`, `CExcs`, `CExcB`, `CDXCs`, `CDXCB`, `CToSc`, `CODXC`), and correct 15-field QSO records (dupe flag at col 14 per spec)
- **Session management** — multiple concurrent sessions; pause/resume between contest legs; delete individual QSOs or entire sessions
- **Backup / Restore** — ⬇ Backup downloads all sessions as a versioned JSON file; ⬆ Restore replaces localStorage from a backup file after structure validation (protects against browser data loss or device transfer)
- **Offline-capable PWA** — installable on iOS and Android home screen; service worker caches the app shell and baseline for fully offline use after first load
- **Bilingual UI** — Slovenian and English
- **Dark/light theme** toggle with `localStorage` persistence
- **Mobile-friendly** — `100dvh` layout avoids iOS Safari toolbar overlap; touch targets ≥ 32 × 32 px

### How to Use

1. Download `vhf-logger/vhf-logger.html` (~60 KB). The baseline `vhf-logger/crosscheck-baseline.json` is included in the same subfolder and is loaded automatically.
2. **For baseline support**, serve over a local HTTP server:
   ```bash
   cd /path/to/HamLogTools
   python3 -m http.server 8080
   # then open: http://localhost:8080/vhf-logger/vhf-logger.html
   ```
   Without the baseline the logger still works fully for dupe detection, EDI export, and QRB calculation.
3. Click **New session**, fill in the setup form (call, locator, contest, operator, club, section, reporter contact, bands with equipment), then click **Start**. To change any field later, click **⚙ Edit** in the logger toolbar.
4. Type a callsign in the QSO form — autocomplete and crosscheck hints appear automatically
5. Enter locator, RST, serial, mode; Tab moves between RST fields; press **Enter** on the last serial field or click **Log** to save the QSO
6. Click any row to edit; press **Esc** or click the ✕ to cancel; click the trash icon to delete
7. Click **Export EDI** for per-band files, or the **⬇ Vsi pasovi (ZIP)** button in the export modal for all bands at once
8. Click **📊** to toggle the per-band stats panel; **🔊** to toggle QSO beep; **⬆ EDI** to import an existing EDI file

No internet connection required after the page loads. All data stays in your browser's `localStorage`.

---

## S56OA ADIF Merge (`adif-merge.html`)

Merges multiple ADIF log files into a single deduplicated log.
Open the file in any modern browser — no installation required.

**[➜ Open adif-merge.html](adif-merge.html)**

### Features

- **Drag & drop** one or more `.adi` / `.adif` files simultaneously; load additional files at any time
- **Preview table** with sorting by any column and live search by callsign
- **Deduplication** — QSOs with the same CALL + BAND + MODE + DATE + TIME are flagged automatically; first occurrence wins; hide duplicates with one click
- **Filters** by band, mode, and source file
- **Row deselection** — cherry-pick QSOs to exclude from the export
- **Inline editing** — correct callsign, date, time, band, mode, RST, locator before export
- **Two export formats:**
  - **ADIF** — lossless roundtrip: all original ADIF tags preserved; `APP_ADIFMERGE_SRC` tag annotates each record with the source filename (stripped on re-merge to prevent duplication)
  - **CSV** — UTF-8 BOM prefix for direct Excel opening without the import wizard
- **Bilingual UI** — Slovenian and English
- **Dark/light theme** toggle with `localStorage` persistence

### How to Use

1. Download `adif-merge.html` (single file, ~35 KB)
2. Open it in any modern browser (Chrome, Firefox, Edge, Safari)
3. Drag one or more `.adi` or `.adif` files onto the drop zone, or click **Choose files**
4. Review the QSO table — sort columns, filter, search, hide duplicates
5. Optionally deselect rows to exclude from export
6. Click **Export ADIF** or **Export CSV**

No internet connection required. All processing happens in your browser — no files or QSO data are uploaded anywhere.

---

## S56OA ADIF Statistics (`adif-stats.html`)

Analyses a single ADIF log file and presents statistics in an interactive dashboard.
Open the file in any modern browser — no installation required.

**[➜ Open adif-stats.html](adif-stats.html)**

### Features

- **Drag & drop** a single `.adi` / `.adif` file onto the drop zone, or click to browse
- **Overview card** — total QSOs, active days, distinct callsigns, DXCC entities worked, best DX with date range
- **Statistics by band** — QSO count and percentage for each band, with visual progress bar
- **Statistics by mode** — QSO count and percentage for each mode (SSB, CW, FT8, FM, …)
- **Statistics by continent** — QSO count per continent (EU, NA, AS, AF, OC, SA, AN) with DXCC prefix lookup
- **Statistics by country / DXCC entity** — top 20 entities by QSO count with continent
- **Statistics by time** — QSOs per month and per UTC hour (SVG bar charts, auto-width)
- **Top callsigns** — the 10 callsigns worked most often
- **DXCC per band** — table of DXCC entities with a progress bar per worked band
- **Activity heatmap** — GitHub-style year × week × day grid; month labels above columns; day-of-week labels on left; colour intensity by QSO count
- **Band × hour propagation matrix** — 2D grid (band rows × 24 UTC hour columns); orange-scale cell intensity; hover shows count
- **QRB distribution histogram** — 6 distance buckets (< 500 km through ≥ 10 000 km); uses ADIF `DISTANCE` field or calculates from `GRIDSQUARE` + `MY_GRIDSQUARE` via haversine
- **HTML export** — download a self-contained HTML snapshot with all charts, heatmaps, and tables embedded
- **Date range filter** — show statistics for a specific date range without reloading the file
- **Bilingual UI** — Slovenian and English
- **Dark/light theme** toggle with `localStorage` persistence

### How to Use

1. Download `adif-stats.html` (single file, ~60 KB)
2. Open it in any modern browser (Chrome, Firefox, Edge, Safari)
3. Drag an `.adi` or `.adif` file onto the drop zone, or click **Choose file**
4. Explore the dashboard — all charts update automatically
5. Optionally set **Date from / to** to filter the statistics to a time range
6. Click **Export HTML** to download a standalone report

No internet connection required. All processing happens in your browser — no files or QSO data are uploaded anywhere.

---

## Baseline Builder (`build-baseline.js`)

Node.js CLI script that builds `crosscheck-baseline.json` from a directory of OEVSV IARU R1 contest CSV exports. Used to occasionally refresh the prebuilt baseline that `edi-crosscheck.html` loads on startup.

**Source:** OEVSV IARU R1 contest results database at <https://iaru.oevsv.at/v_upld/prg_list.php>. Each contest has a CSV export button containing (at minimum) `Call` and `WWL` columns. Download multiple contests' CSVs into one directory, then run the script.

### Requirements

- **Node.js v18+**
- No external dependencies
- Directory of OEVSV contest CSV exports

### Workflow

```bash
# 1. Create a directory for your CSV downloads:
mkdir iaru_oevsv_csv

# 2. Download CSV exports from OEVSV for the contests you want to include.
#    Save them into iaru_oevsv_csv/ (any filenames are fine).

# 3. Build the baseline:
node build-baseline.js

# Output: ./crosscheck-baseline.json
```

### Options

```bash
node build-baseline.js                              # defaults
node build-baseline.js --in ./iaru_oevsv_csv        # custom input dir
node build-baseline.js --out ./crosscheck-baseline.json
node build-baseline.js --min-appearances 5          # stricter quality filter
node build-baseline.js --min-appearances 1          # keep everything (no filter)
node build-baseline.js --pretty                     # indented JSON for inspection
node build-baseline.js --verbose                    # per-file row stats
```

| Option | Default | Description |
|---|---|---|
| `--in DIR` | `./iaru_oevsv_csv` | Directory containing CSV files |
| `--out FILE` | `./crosscheck-baseline.json` | Output JSON path |
| `--min-appearances N` | `3` | Minimum total contest entries to include a callsign |
| `--pretty` | off | Pretty-print JSON output |
| `--verbose` | off | Per-file processing stats |

### What it does

1. **Reads all `*.csv` files** in the input directory (encoding auto-detection: UTF-8 → ISO-8859-1 fallback)
2. **Maps columns by name** — tolerant to OEVSV's 23-column and 25-column variants (50 MHz has extra `LL Squares` columns)
3. **Validates each row:** Maidenhead regex on WWL, callsign with `/MM` or `/AM` suffix is dropped (always unpredictable)
4. **Normalizes:** callsign via `baseCall()` (same logic as the HTML tool), band via `BAND_MAP`, locator to first-4-upper + last-2-lower
5. **Aggregates** into per-call, per-band locator histograms with portable flag
6. **Filters** by `--min-appearances`
7. **Writes compact JSON** with metadata (`v` = build date, `src`, `n.calls`, `n.entries`, `n.files`, band index, calls dict)

### Refresh schedule

The baseline ages because operators may move QTH or new operators emerge. Recommended cadence: **rebuild every 3–6 months**, or after major IARU R1 contests (IARU R1 VHF, UHF/SHF, Marconi Memorial). Each rebuild:

```bash
# 1. Download fresh CSVs into iaru_oevsv_csv/ (add new contests, optionally remove old ones)
# 2. Rebuild:
node build-baseline.js
# 3. The script writes crosscheck-baseline.json and mirrors it to vhf-logger/crosscheck-baseline.json.
#    Both HTML tools pick up the new file automatically on next page load.
```

### Output format

Compact JSON, ~220 KB for a typical IARU R1 dataset (3 000+ callsigns, 16 bands):

```json
{
  "v": "2026-05-13",
  "src": "iaru.oevsv.at",
  "minAppearances": 3,
  "n": { "calls": 3240, "entries": 10564, "files": 35 },
  "b": ["6m", "4m", "2m", "70cm", "23cm", ...],
  "c": {
    "DK0NA": { "2": [["JO50ti", 16]], "3": [["JO50ti", 16]], ... },
    "S59P":  { "2": [["JN86ao", 15]], ... },
    ...
  }
}
```

Each call entry is `{ bandIndex: [[locator, count, portableFlag?], ...] }`, sorted by count descending. A third element `1` marks the locator as exclusively portable (`/P` or `/M` only).

---

## ADIF QRZ BURO Filter (`adif-qrz-filter.js`)

Node.js CLI tool that filters an ADIF log to keep only QSOs with stations that accept
QSL cards via the QSL Bureau. For each unique callsign it queries the QRZ.com XML API;
if the QSO has a `QSL_VIA` field, the manager's callsign is checked too.
Results are cached locally for 7 days.

### Requirements

- **Node.js v18+**
- **QRZ.com account** with XML API access (any subscription level)
- Internet connection during the run

### Features

- **Deduplication** — one API call per unique callsign, even if it appears in multiple QSOs
- **QSL manager support** — reads `QSL_VIA` from ADIF and checks the manager's bureau status too
- **Local cache** — 7-day JSON cache (`.qrz-cache.json`) avoids re-querying the same callsigns
- **Rate limiting** — configurable delay between API calls (default 1200 ms)
- **Fuzzy logic** — understands "via BURO", "bureau ok", "direct only", "no bureau", "LoTW only", etc.
- **Unknown callsigns** — stations not found in QRZ are discarded by default (`--include-unknown` to keep)

### How to Use

```bash
# Login with username/password
node adif-qrz-filter.js contest.adi --username=S59ABC --password=secret

# Use an existing session key
node adif-qrz-filter.js contest.adi --key=a1b2c3d4

# Custom output path and delay
node adif-qrz-filter.js contest.adi --key=a1b2c3d4 --output=buro.adi --delay=800

# Keep callsigns not found in QRZ
node adif-qrz-filter.js contest.adi --key=a1b2c3d4 --include-unknown
```

**Options:**

| Option | Default | Description |
|---|---|---|
| `--username=USER` | — | QRZ.com username (requires `--password`) |
| `--password=PASS` | — | QRZ.com password |
| `--key=SESSION` | — | Existing QRZ session key (skip login) |
| `--output=FILE` | `input-buro.adi` | Output ADIF filename |
| `--delay=MS` | `1200` | Delay between QRZ API calls in milliseconds |
| `--cache=FILE` | `.qrz-cache.json` | Local cache file path |
| `--include-unknown` | off | Keep QSOs for callsigns not found in QRZ |

> **Note:** Callsign data is sent to QRZ.com during the run. See [QRZ.com privacy policy](https://www.qrz.com/page/privacy.html).

---

## Tests

Business-logic unit tests run in Node.js (v18+), no extra dependencies:

```bash
# EDI → ADIF converter
node --test --test-reporter=spec edi2adif.test.js

# EDI Crosscheck
node --test --test-reporter=spec edi-crosscheck.test.js

# ADIF Merge
node --test --test-reporter=spec adif-merge.test.js

# ADIF QRZ BURO filter
node --test --test-reporter=spec adif-qrz-filter.test.js

# VHF/UHF Contest Logger
node --test --test-reporter=spec vhf-logger/vhf-logger.test.js

# ADIF Statistics
node --test --test-reporter=spec adif-stats.test.js
```

| Test file | Tests | Groups |
|---|---|---|
| `edi2adif.test.js` | 122 | 9 (`normBand`, `parseEDI`, `adifField`, `csvEsc`, `modeBadge`, i18n, duplicates, CSV export, inline edit) |
| `edi-crosscheck.test.js` | 56 | 8 (`baseCall`, `levenshtein`, `parseEDI`, `runCrosscheck` locator mismatch ×6, `runCrosscheck` callsign ×8, missing locator ×4, thresholds ×3, callsign by locator ×4) |
| `adif-merge.test.js` | 112 | 21 (`parseADIF`, `updateKey`, `recomputeDupes`, `adifField`, `htmlEsc`, `csvEsc`, `modeBadge`, `buildFilename`, ADIF export, I18N, re-merge safety, and more) |
| `adif-qrz-filter.test.js` | 48 | 4 (`parseAdif`, `extractField`, `usesQslBuro` ×3, `cache`) |
| `vhf-logger/vhf-logger.test.js` | 163 | 16 (`baseCall`, `normBand`, `locToLatLon`, `haversine`, `calcBearing`, `levenshtein`, `isDupe`, `recalcDupes`, `buildEdi`, `lookupCall`, `sessionEdit`, `parseEdiForImport`, `makeZip`, `bandColors`, `manualTime`, `backup`) |
| `adif-stats.test.js` | 133 | 21 (`lookupCall`, `normBand`, `normMode`, `locToLatLon`, `haversine`, `parseADIF` ×3, `computeStats` ×6, `applyFilters`, `fmtDate`, `fmtMonth`, `htmlEsc`, `svgHBar`, `svgVBar`, `I18N`) |

See [TESTING.md](TESTING.md) for full test documentation.

---

## Planned Improvements

See [Improvements.md](Improvements.md) for the full bug history and feature roadmap.

---

## License

MIT

---
---

# S56OA HamLogTools [SL]

Orodja za obdelavo in pretvorbo formatov radioamaterskih dnevnikov.

---

## Orodja

| Orodje | Vrsta | Namen |
|---|---|---|
| [`edi2adif.html`](edi2adif.html) | Brskalniška app | Pretvorba REG1TEST EDI v1 tekmovalnih dnevnikov v ADIF in CSV formate |
| [`edi-crosscheck.html`](edi-crosscheck.html) | Brskalniška app | Crosscheck novega EDI dnevnika glede na zgodovinske dnevnike + opcijski OEVSV IARU R1 baseline — zaznava napake lokatorjev in klicnih znakov |
| [`vhf-logger/vhf-logger.html`](vhf-logger/vhf-logger.html) | Brskalniška app | Beležnik tekmovalnih dnevnikov VHF/UHF/SHF v realnem času z live crosscheckom, prikazom QRB/azimuta in izvozom REG1TEST EDI |
| [`adif-merge.html`](adif-merge.html) | Brskalniška app | Združevanje več ADIF dnevniških datotek — deduplikacija, filtri po pasu/načinu/izvoru, urejanje v živo, izvoz ADIF in CSV |
| [`adif-stats.html`](adif-stats.html) | Brskalniška app | Analiza ADIF dnevnika — statistika po pasu/načinu/kontinentu/državi/času, DXCC per pas, toplotna karta aktivnosti, matrika pas×ura, porazdelitev QRB, HTML izvoz |
| [`adif-qrz-filter.js`](adif-qrz-filter.js) | Node.js CLI | Filtriranje ADIF dnevnika — ohrani samo zveze s postajami, ki sprejemajo biro |
| [`build-baseline.js`](build-baseline.js) | Node.js CLI | Zgradi `crosscheck-baseline.json` iz OEVSV IARU R1 contest CSV exportov za uporabo z `edi-crosscheck.html` in `vhf-logger/vhf-logger.html` |

---

## S56OA EDI → ADIF Converter (`edi2adif.html`)

Pretvori [REG1TEST EDI v1](http://www.edi.kkn.net/) tekmovalne dnevnike v format ADIF in druge formate.
Datoteko odpri v katerem koli sodobnem brskalniku — namestitev ni potrebna.

**[➜ Odpri edi2adif.html](edi2adif.html)**

### Funkcionalnosti

- **Povleci in spusti** eno ali več `.edi` datotek hkrati
- **Tabela za predogled** z razvrščanjem po katerem koli stolpcu in iskanjem v živo po klicnem znaku
- **Filtri** po pasu, načinu in izvorni datoteki
- **Zaznavanje duplikatov** — medDatotečni duplikati so samodejno označeni (enak klicni znak + datum + čas + pas); z enim klikom jih skriješ
- **Izbor vrstic** — ročno izberi QSO-je, ki jih vključiš v izvoz
- **Urejanje v živo** — popravi način, RST, lokator, datum, čas, klicni znak pred izvozom
- **Trije izvozni formati:**
  - **ADIF** — celoten izvoz z vsemi razpoložljivimi polji (klicni znak, datum/čas, pas, način, RST oddano/sprejeto, serijske številke, lokator, razdalja, moj klicni znak, moj lokator, moč, ime tekmovanja, operaterji, oprema)
  - **DARC QSL CSV** — za spletno storitev QSL urada DARC
  - **Splošni CSV** — 19 stolpcev z vsemi razčlenjenimi polji, za uvoz v pregledničarje ali nadaljnjo analizo
- **Dvojezični vmesnik** — slovenščina in angleščina
- **Temna/svetla tema** s shranitvijo v localStorage

### Podprti pasovi

| Vrednost EDI `PBand` | Pas ADIF |
|---|---|
| 50 MHz, 6m | `6m` |
| 144 / 145 MHz, 2m | `2m` |
| 430 / 432 MHz, 70 cm | `70cm` |
| 1,2 / 1,3 GHz, 1296 MHz, 23 cm | `23cm` |
| 2,3 GHz, 2320 MHz, 13 cm | `13cm` |
| 3,4 GHz, 3400 MHz, 9 cm | `9cm` |
| 5,7 GHz, 5760 MHz, 6 cm | `6cm` |
| 10 GHz, 10368 MHz, 3 cm | `3cm` |
| 24 GHz, 24048 MHz, 1,25 cm | `1.25cm` |
| 47 GHz, 6 mm | `6mm` |

**Podprti načini:** SSB · CW · FM · AM · RTTY · SSTV · ATV

### Navodila za uporabo

1. Prenesi `edi2adif.html` (ena datoteka, ~42 KB)
2. Odpri jo v katerem koli sodobnem brskalniku (Chrome, Firefox, Edge, Safari)
3. Povleci eno ali več `.edi` datotek na območje za spuščanje ali klikni **Izberi datoteke**
4. Preglej tabelo QSO — razvrščaj stolpce, filtriraj, išči, skrij duplikate
5. Po želji ročno izberi vrstice za izvoz
6. Klikni željeni gumb za izvoz

Po nalaganju strani internetna povezava ni potrebna (razen za Google Fonts).
Vsa obdelava poteka v brskalniku — nobene datoteke ali podatki o zvezah niso nikamor naloženi.

---

## S56OA EDI Crosscheck (`edi-crosscheck.html`)

Brskalniško orodje, ki primerja nov EDI tekmovalni dnevnik z bazo, zgrajeno iz zgodovinskih EDI dnevnikov.
Pomaga odkriti verjetne napake v lokatorjih in klicnih znakih pred oddajo dnevnika.
Datoteko odpri v katerem koli sodobnem brskalniku — namestitev ni potrebna.

**[➜ Odpri edi-crosscheck.html](edi-crosscheck.html)**

### Kako deluje

1. **Opcijski baseline:** Če je poleg HTML datoteke prisotna datoteka [`crosscheck-baseline.json`](crosscheck-baseline.json) in je stran odprta preko HTTP-ja, se ob zagonu samodejno naloži pred-zgrajen baseline 3 000+ IARU R1 tekmovalnih postaj (klicni znak → lokator, izpeljano iz javnih OEVSV CSV exportov). To omogoča smiseln crosscheck *brez* lastne EDI zgodovine.
2. **Faza 1 — razširitev baze:** Povleci poljubno število preteklih EDI dnevnikov (1–50+). Štetja lokatorjev iz lastnih EDI dnevnikov se združijo z baseline-om.
3. **Faza 2 — crosscheck:** Povleci nov EDI dnevnik. Vsaka zveza se preveri glede na združeno bazo.

> **Opomba o `file://` odpiranju:** sodobni brskalniki blokirajo `fetch()` iz `file://` URL-jev zaradi varnosti. Če dvoklikneš HTML, se baseline tiho ne naloži in orodje deluje natanko kot v1.3 (samo lastna EDI zgodovina). Za uporabo baseline-a postrežaj preko HTTP-ja (`python3 -m http.server`) — glej [Navodila za uporabo](#navodila-za-uporabo-1) spodaj.

### Kaj se zaznava

| Oznaka | Barva | Pogoj |
|---|---|---|
| `LOC!` | Rdeča | Lokator se razlikuje od zgodovinskega modusa; zaupanje v modus ≥ prag in nov lokator še nikoli ni bil viden |
| `LOC?` | Rumena | Lokator se razlikuje od zgodovinskega modusa; nižje zaupanje ali nov lokator je bil že viden (prenosna postaja) |
| `LOC?` | Rumena | Zveza nima lokatorja, a klicni znak obstaja v zgodovini — predlaga zgodovinski modus lokator |
| `CALL?` | Rumena | Klicni znak ni v zgodovini; najden je podoben klicni znak globalno (Levenshteinova razdalja 1–2) |
| `LOC-CALL?` | Modra | Klicni znak ni v zgodovini; najden je podoben klicni znak *z istega lokatorja* (kompozitna hevristika) |
| `?` | Siva | Klicni znak ni v zgodovini; ni podobnega klicnega znaka |
| `✓` | Zelena | Klicni znak je v zgodovini, lokator ustreza modusu |

Prenosne in mobilne pripone (`/P`, `/M`, `/MM` itd.) se odstranijo pred iskanjem — `S59DGO/P` se primerja z zgodovino `S59DGO`. Italijanski regionalni sufiksi (`/IV3`, `/I2` itd.) in številčni sufiksi okrajev (`/1`, `/2`) se prav tako odstranijo. Klicni znaki s predponsko poševnico (`OE/S59DGO`) ostanejo nespremenjeni.

Preverjanje lokatorja zahteva privzeto vsaj **3** zgodovinske pojavitve, a je to nastavljivo prek drsnika **Min. pojavitev** (1–10). Drsnik **Confidence** (10–100%) določa mejo med resnostjo `high` in `medium`. Oba drsnika lahko spremeniš po nalaganju novega dnevnika — klikni **Ponovi**, da se pragovi uveljavijo brez ponovnega nalaganja datoteke.

### Funkcionalnosti

- **OEVSV IARU R1 baseline** (v1.4+) — opcijska pred-zgrajena baza ~3 240 tekmovalnih klicnih znakov z deklariranimi lokatorji, samodejno naložena ob zagonu, če je `crosscheck-baseline.json` prisoten. Vsak baseline vnos šteje 3× toliko kot en EDI QSO (avtoritativna deklaracija lastnega lokatorja iz robotsko-validiranih tekmovalnih dnevnikov). Chip-i v prikazu kažejo **raw številke** zaradi intuitivnosti.
- **Nastavljivi pragovi** — nastavi najmanjše zgodovinske pojavitve (1–10) in prag zaupanja v modus (10–100%) prek drsnikov v orodni vrstici; ponovi crosscheck brez ponovnega nalaganja datoteke
- **Predlog za manjkajoč lokator** — označi zveze brez lokatorja, če klicni znak obstaja v zgodovini, in predlaga najpogostejši zgodovinski lokator
- **Kompozitno preverjanje klicnega znaka** — ko je klicni znak neznan globalno, orodje preveri tudi klicne znake, ki so zgodovinsko delovali z *istega lokatorja* (uje napake kot `IK3GOY` → `IW3GOA`, ko sta oba iz `JN65DM`)
- **HTML izvoz** — prenesi samostojno HTML poročilo vseh označenih zvez s predlogi popravkov
- **Trajni baseline** — gumb "Počisti zgodovino" počisti samo tvoje spuščene EDI dnevnike; baseline ostane.

### Navodila za uporabo

1. Prenesi `edi-crosscheck.html` (ena datoteka, ~50 KB). Opcijsko prenesi tudi [`crosscheck-baseline.json`](crosscheck-baseline.json) (~220 KB) za OEVSV baseline.
2. **Za baseline podporo** postrežaj preko lokalnega HTTP strežnika (brskalniki blokirajo `fetch()` iz `file://`):
   ```bash
   cd /pot/do/HamLogTools
   python3 -m http.server 8080
   # nato odpri: http://localhost:8080/edi-crosscheck.html
   ```
   Za dvoklik `file://` orodje deluje normalno — samo brez baseline-a.
3. Povleci zgodovinske EDI dnevnike na prvo območje za spuščanje (opcijsko, če je baseline naložen)
4. Povleci nov EDI dnevnik na drugo območje za spuščanje
5. Preglej tabelo rezultatov — filtriraj po "samo označeni" ali išči po klicnem znaku
6. Po želji prilagodi drsnika in klikni **Ponovi**, da spremeniš občutljivost
7. Klikni **Izvoz problemov**, da preneseš HTML poročilo

Internetna povezava ni potrebna. Vsa obdelava poteka lokalno v brskalniku.

---

## S56OA VHF/UHF Contest Logger (`vhf-logger/vhf-logger.html`)

Beležnik tekmovalnih dnevnikov v realnem času za VHF/UHF/SHF pasove. Seje shranjuje v `localStorage` — strežnik ni potreben.
Datoteko odpri v katerem koli sodobnem brskalniku (za baseline podporo postrežaj preko HTTP).

**[➜ Odpri vhf-logger/vhf-logger.html](vhf-logger/vhf-logger.html)**

### Funkcionalnosti

- **Večpasovna seja** — nastavi do 11 pasov (6m do 6mm) z neodvisnimi tabelami QSO, serijskimi številkami in statistiko
- **Live crosscheck** — avtodokončanje klicnih znakov in namigi o neskladjih, ki jih poganja `crosscheck-baseline.json` (enaka baza kot `edi-crosscheck.html`); baseline se ob zagonu samodejno naloži preko HTTP
- **QRB + azimut** — razdalja po velikem krogu in azimut izračunana iz Maidenhead lokatorjev in prikazana per QSO
- **Zaznavanje duplikatov** — opozorilo v realnem času z normalizacijo `baseCall()`, tako da se `S59DGO/P` pravilno ujame z `S59DGO`; per-pas, izključuje QSO, ki se trenutno ureja
- **Urejanje v živo** — klikni kateri koli vnos v dnevniku za popravek klicnega znaka, lokatorja, RST, serije, načina ali časa; zastavice duplikatov in xFlags se preračunajo ob shranitvi
- **Urejanje podatkov seje** — gumb ⚙ Uredi v orodni vrstici beležnika odpre nastavitveni obrazec, predizpolnjen s trenutnimi podatki seje; spremembe se shranijo v obstoječo sejo brez izgube QSO-jev
- **Statistika po pasovih** — gumb 📊 prikaže/skrije plošče s statistiko: QSO/pas, unikatni Maidenhead kvadrati, skupna QRB, best DX; stanje ohranjeno v `localStorage`
- **ZIP izvoz** — en klik prenese ZIP datoteko z ločenimi EDI datotekami za vse pasove, ki imajo QSO-je
- **EDI uvoz** — gumb ⬆ EDI uvozi obstoječo REG1TEST EDI datoteko v trenutno sejo; QSO-ji se dodajo v ustrezno vrstico pasu (pas mora biti že nastavljen v seji)
- **Ročni vnos časa** — gumb ✎ prikaže polje za vnos UTC časa poleg ure; QSO-ji, vneseni medtem, dobijo določen čas namesto žive ure (za zamujene vnose)
- **Tipkovnične bližnjice** — Enter na zadnjem polju serije odda QSO; Tab napreduje RST_S → RST_R → NrR → Zabeleži; Esc prekine urejanje ali zapre avtodokončanje
- **Barve zavihkov** — vsak aktivni zavihek pasu je označen v svoji barvi (6m = jantarna, 2m = modra, 70cm = tirkizna itd.)
- **Zvok QSO** — gumb 🔊 vklopi/izklopi kratek 880 Hz pip ob vsakem uspešno zabeleženenem QSO (Web Audio API); dva krajša pipa nižje frekvence opozorita na manjkajoč lokator ali serial; stanje ohranjeno v `localStorage`
- **Samodejno zapolnjevanje WWL** — ob izbiri klicnega znaka iz autocomplete dropdowna se znani baseline lokator samodejno vnese v polje WWL; možno ručno prepisati
- **Opozorilo o manjkajočih poljih** — če lokator ali sprejet serial manjkata ob vnosu QSO, se polje označi z rdečo in prikaže opozorilo z gumbom **Shrani vseeno**; ne blokira vnosa
- **EDI izvoz** — ustvari veljavne REG1TEST EDI datoteke (eno per pas): pravilna glava `[REG1TEST;1]`, polja opreme `SPowe`/`SAnte`/`STXEq`/`SRXEq`/`SAntH`, kategorija `PSect`, blok C* povzetka točkanja (`CQSOs`, `CQSOP`, `CWWLs`, `CWWLB`, `CExcs`, `CExcB`, `CDXCs`, `CDXCB`, `CToSc`, `CODXC`) in pravilni 15-polni zapisi QSO (zastavica duplikata na stolpcu 14 po specifikaciji)
- **Upravljanje sej** — več sočasnih sej; premor/nadaljevanje med deli tekmovanja; brisanje posameznih QSO ali celotnih sej
- **Backup / Obnovi** — gumb ⬇ Backup prenese vse seje kot verzioniran JSON; gumb ⬆ Obnovi nadomesti localStorage iz backup datoteke po strukturni validaciji (zaščita pred izgubo podatkov ali prenosom na drugo napravo)
- **PWA brez povezave** — namestitven na začetni zaslon iOS in Android; service worker predpomni lupino aplikacije in baseline za popolno delovanje brez interneta po prvem nalaganju
- **Dvojezični vmesnik** — slovenščina in angleščina
- **Temna/svetla tema** s shranitvijo v `localStorage`
- **Primerno za mobilne naprave** — postavitev `100dvh` se izogiba prekrivanju z orodno vrstico iOS Safari; površine za dotik ≥ 32 × 32 px

### Navodila za uporabo

1. Prenesi `vhf-logger/vhf-logger.html` (~60 KB). Baseline `vhf-logger/crosscheck-baseline.json` je vključen v isti podmapi in se naloži samodejno.
2. **Za baseline podporo** postrežaj preko lokalnega HTTP strežnika:
   ```bash
   cd /pot/do/HamLogTools
   python3 -m http.server 8080
   # nato odpri: http://localhost:8080/vhf-logger/vhf-logger.html
   ```
   Brez baseline-a beležnik deluje normalno za zaznavanje duplikatov, EDI izvoz in izračun QRB.
3. Klikni **Nova seja**, izpolni nastavitveni obrazec (klicni znak, lokator, tekmovanje, operater, klub, sekcija, kontakt odgovornega, pasovi z opremo), nato klikni **Začni**. Za poznejše spremembe klikni **⚙ Uredi** v orodni vrstici beležnika.
4. Vtipkaj klicni znak v obrazec QSO — avtodokončanje in crosscheck namigi se prikažejo samodejno
5. Vnesi lokator, RST, serijo, način; Tab premakne med polji RST; pritisni **Enter** na zadnjem polju serije ali klikni **Zabeleži** za shranitev
6. Klikni kateri koli vnos za urejanje; pritisni **Esc** ali klikni ✕ za preklic; klikni ikono koša za brisanje
7. Klikni **Izvozi EDI** za eno datoteko per pas, ali gumb **⬇ Vsi pasovi (ZIP)** v izvozu za vse pasove naenkrat
8. Klikni **📊** za statistiko po pasovih; **🔊** za vklop/izklop pipa; **⬆ EDI** za uvoz obstoječe EDI datoteke

Po nalaganju strani internetna povezava ni potrebna. Vsi podatki ostanejo v `localStorage` brskalnika.

---

## S56OA ADIF Merge (`adif-merge.html`)

Združuje več ADIF dnevniških datotek v en deduplikiran dnevnik.
Datoteko odpri v katerem koli sodobnem brskalniku — namestitev ni potrebna.

**[➜ Odpri adif-merge.html](adif-merge.html)**

### Funkcionalnosti

- **Povleci in spusti** eno ali več `.adi` / `.adif` datotek hkrati; dodatne datoteke dodaj kadarkoli
- **Tabela za predogled** z razvrščanjem po katerem koli stolpcu in iskanjem v živo po klicnem znaku
- **Deduplikacija** — zveze z enakim CALL + BAND + MODE + DATE + TIME so samodejno označene; zmaga prva pojavitev; duplikate skrij z enim klikom
- **Filtri** po pasu, načinu in izvorni datoteki
- **Odznačevanje vrstic** — ročno izključi posamezne QSO-je iz izvoza
- **Urejanje v živo** — popravi klicni znak, datum, čas, pas, način, RST, lokator pred izvozom
- **Dva izvozna formata:**
  - **ADIF** — lossless roundtrip: vsa originalna ADIF polja ohranjena; oznaka `APP_ADIFMERGE_SRC` zabeleži izvorno datoteko (ob ponovnem mergeu se samodejno odstrani)
  - **CSV** — UTF-8 BOM predpona za neposredno odpiranje v Excelu brez čarovnika za uvoz
- **Dvojezični vmesnik** — slovenščina in angleščina
- **Temna/svetla tema** s shranitvijo v `localStorage`

### Navodila za uporabo

1. Prenesi `adif-merge.html` (ena datoteka, ~35 KB)
2. Odpri jo v katerem koli sodobnem brskalniku (Chrome, Firefox, Edge, Safari)
3. Povleci eno ali več `.adi` ali `.adif` datotek na območje za spuščanje ali klikni **Izberi datoteke**
4. Preglej tabelo QSO — razvrščaj stolpce, filtriraj, išči, skrij duplikate
5. Po želji odznači vrstice, ki jih ne želiš izvoziti
6. Klikni **Izvozi ADIF** ali **Izvozi CSV**

Po nalaganju strani internetna povezava ni potrebna. Vsa obdelava poteka v brskalniku — nobene datoteke ali podatki o zvezah niso nikamor naloženi.

---

## S56OA ADIF Statistics (`adif-stats.html`)

Analizira eno ADIF dnevniško datoteko in prikaže statistiko v interaktivni nadzorni plošči.
Datoteko odpri v katerem koli sodobnem brskalniku — namestitev ni potrebna.

**[➜ Odpri adif-stats.html](adif-stats.html)**

### Funkcionalnosti

- **Povleci in spusti** eno `.adi` / `.adif` datoteko na območje za spuščanje ali klikni za iskanje
- **Pregledna kartica** — skupno QSO, aktivni dnevi, unikatni klicni znaki, DXCC entitete, best DX z datumskim obsegom
- **Statistika po pasovih** — število QSO in odstotek za vsak pas z vizualnim napredovalnim trakom
- **Statistika po načinih** — število QSO in odstotek za vsak način (SSB, CW, FT8, FM, …)
- **Statistika po kontinentih** — število QSO per kontinent (EU, NA, AS, AF, OC, SA, AN) s DXCC iskanjem predpon
- **Statistika po državah / DXCC entitetah** — 20 najpogostejših entitet po številu QSO s kontinentom
- **Statistika po času** — QSO per mesec in per UTC uro (SVG palični grafikoni, samodejna širina)
- **Top klicni znaki** — 10 klicnih znakov, s katerimi si delal največ
- **DXCC per pas** — tabela DXCC entitet z napredovalnim trakom per delovan pas
- **Toplotna karta aktivnosti** — GitHub-style mreža leto × teden × dan; oznake mesecev nad stolpci; oznake dni levo; intenzivnost barve po številu QSO
- **Matrika pas × ura razširjanja** — 2D mreža (pasovne vrstice × 24 UTC urnih stolpcev); oranžna lestvica; hover prikaže število
- **Histogram porazdelitve QRB** — 6 razdaljevnih razredov (< 500 km do ≥ 10 000 km); uporablja ADIF polje `DISTANCE` ali izračuna iz `GRIDSQUARE` + `MY_GRIDSQUARE` prek haversina
- **HTML izvoz** — prenesi samostojno HTML posnetek z vsemi grafikoni, toplotnimi kartami in tabelami
- **Filter datumskega obsega** — prikaži statistiko za določen datumski obseg brez ponovnega nalaganja
- **Dvojezični vmesnik** — slovenščina in angleščina
- **Temna/svetla tema** s shranitvijo v `localStorage`

### Navodila za uporabo

1. Prenesi `adif-stats.html` (ena datoteka, ~60 KB)
2. Odpri jo v katerem koli sodobnem brskalniku (Chrome, Firefox, Edge, Safari)
3. Povleci `.adi` ali `.adif` datoteko na območje za spuščanje ali klikni **Izberi datoteko**
4. Prebrskaj nadzorno ploščo — vsi grafikoni se samodejno posodobijo
5. Po želji nastavi **Datum od / do** za filtriranje statistike na časovni obseg
6. Klikni **Izvozi HTML** za prenos samostojnega poročila

Po nalaganju strani internetna povezava ni potrebna. Vsa obdelava poteka v brskalniku — nobene datoteke ali podatki o zvezah niso nikamor naloženi.

---

## Graditelj baseline-a (`build-baseline.js`)

Node.js CLI skripta, ki gradi `crosscheck-baseline.json` iz mape OEVSV IARU R1 tekmovalnih CSV exportov. Uporablja se za občasno osveževanje pred-zgrajenega baseline-a, ki ga `edi-crosscheck.html` naloži ob zagonu.

**Vir:** OEVSV baza rezultatov IARU R1 tekmovanj na <https://iaru.oevsv.at/v_upld/prg_list.php>. Vsako tekmovanje ima gumb za CSV export z (najmanj) stolpcema `Call` in `WWL`. Prenesi CSV-je več tekmovanj v eno mapo, nato zaženi skripto.

### Zahteve

- **Node.js v18+**
- Brez zunanjih odvisnosti
- Mapa z OEVSV tekmovalnimi CSV exporti

### Potek

```bash
# 1. Ustvari mapo za CSV prenose:
mkdir iaru_oevsv_csv

# 2. Prenesi CSV exporte iz OEVSV za tekmovanja, ki jih želiš vključiti.
#    Shrani jih v iaru_oevsv_csv/ (poljubna imena datotek).

# 3. Zgradi baseline:
node build-baseline.js

# Izhod: ./crosscheck-baseline.json
```

### Možnosti

```bash
node build-baseline.js                              # privzeto
node build-baseline.js --in ./iaru_oevsv_csv        # nastavljiva vhodna mapa
node build-baseline.js --out ./crosscheck-baseline.json
node build-baseline.js --min-appearances 5          # strožji kvalitetni filter
node build-baseline.js --min-appearances 1          # obdrži vse (brez filtra)
node build-baseline.js --pretty                     # zamiknjen JSON za pregled
node build-baseline.js --verbose                    # statistika po datotekah
```

| Možnost | Privzeto | Opis |
|---|---|---|
| `--in DIR` | `./iaru_oevsv_csv` | Mapa s CSV datotekami |
| `--out FILE` | `./crosscheck-baseline.json` | Pot izhodnega JSON |
| `--min-appearances N` | `3` | Najmanjše skupno število tekmovalnih nastopov za vključitev klicnega znaka |
| `--pretty` | izkl. | Zamiknjen JSON izhod |
| `--verbose` | izkl. | Statistika obdelave po datotekah |

### Kaj počne

1. **Prebere vse `*.csv` datoteke** v vhodni mapi (samodejna detekcija encodinga: UTF-8 → ISO-8859-1 fallback)
2. **Mapira stolpce po imenu** — tolerantna do OEVSV variant z 23 in 25 stolpci (50 MHz ima dodatna `LL Squares` stolpca)
3. **Validira vsako vrstico:** Maidenhead regex na WWL, klicni znak s pripono `/MM` ali `/AM` se zavrže (po definiciji nepredvidljiv)
4. **Normalizira:** klicni znak preko `baseCall()` (enaka logika kot HTML orodje), pas preko `BAND_MAP`, lokator v prve 4 velike + zadnji 2 mali
5. **Agregira** v histograme lokatorjev per klicni znak in pas z oznako portable
6. **Filtrira** glede na `--min-appearances`
7. **Zapiše kompakten JSON** z metapodatki (`v` = datum gradnje, `src`, `n.calls`, `n.entries`, `n.files`, indeks pasov, slovar klicnih znakov)

### Urnik obnavljanja

Baseline se s časom stara, ker se operatorji selijo ali pojavijo novi. Priporočeni interval: **rebuild vsake 3–6 mesecev**, ali po večjih IARU R1 tekmovanjih (IARU R1 VHF, UHF/SHF, Marconi Memorial). Vsaka osvežitev:

```bash
# 1. Prenesi sveže CSV-je v iaru_oevsv_csv/ (dodaj nova tekmovanja, opcijsko odstrani stara)
# 2. Rebuild:
node build-baseline.js
# 3. Skripta zapiše crosscheck-baseline.json in ga preslika v vhf-logger/crosscheck-baseline.json.
#    Obe HTML orodji samodejno pobereta novo datoteko ob naslednjem nalaganju strani.
```

### Format izhoda

Kompakten JSON, ~220 KB za tipičen IARU R1 dataset (3 000+ klicnih znakov, 16 pasov):

```json
{
  "v": "2026-05-13",
  "src": "iaru.oevsv.at",
  "minAppearances": 3,
  "n": { "calls": 3240, "entries": 10564, "files": 35 },
  "b": ["6m", "4m", "2m", "70cm", "23cm", ...],
  "c": {
    "DK0NA": { "2": [["JO50ti", 16]], "3": [["JO50ti", 16]], ... },
    "S59P":  { "2": [["JN86ao", 15]], ... },
    ...
  }
}
```

Vsak vnos klicnega znaka je `{ indeksPasu: [[lokator, count, portableFlag?], ...] }`, urejen po count padajoče. Tretji element `1` označuje, da je lokator izključno portable (samo `/P` ali `/M`).

---

## ADIF → QRZ BURO Filter (`adif-qrz-filter.js`)

Node.js CLI orodje, ki filtrira ADIF dnevnik in ohrani samo tiste zveze, kjer postaja
sprejema QSL kartice preko biroja. Za vsak unikaten klicni znak poizveduje po QRZ.com XML API;
če je v zvezah prisotno polje `QSL_VIA`, preveri tudi status managerjevega biroja.
Rezultati se predpomnijo lokalno za 7 dni.

### Zahteve

- **Node.js v18+**
- **Račun na QRZ.com** z dostopom do XML API (katerakoli raven naročnine)
- Internetna povezava med zagonom

### Funkcionalnosti

- **Deduplikacija** — en API klic na unikaten klicni znak, tudi če se pojavi v več zvezah
- **Podpora QSL managerjem** — prebere `QSL_VIA` iz ADIF in preveri biro status managerja
- **Lokalni predpomnilnik** — 7-dnevni JSON predpomnilnik (`.qrz-cache.json`) preprečuje ponovne poizvedbe
- **Omejevanje hitrosti** — nastavljiv zamik med API klici (privzeto 1200 ms)
- **Fuzzy logika** — razume "via BURO", "bureau ok", "direct only", "no bureau", "LoTW only" itd.
- **Neznani klicni znaki** — postaje, ki jih QRZ ne najde, se privzeto zavržejo (ohrani jih z `--include-unknown`)

### Navodila za uporabo

```bash
# Prijava z uporabniškim imenom in geslom
node adif-qrz-filter.js contest.adi --username=S59ABC --password=secret

# Uporaba obstoječega ključa seje
node adif-qrz-filter.js contest.adi --key=a1b2c3d4

# Nastavljiva izhodna pot in zamik
node adif-qrz-filter.js contest.adi --key=a1b2c3d4 --output=buro.adi --delay=800

# Ohrani klicne znake, ki jih QRZ ne najde
node adif-qrz-filter.js contest.adi --key=a1b2c3d4 --include-unknown
```

**Možnosti:**

| Možnost | Privzeto | Opis |
|---|---|---|
| `--username=USER` | — | Uporabniško ime QRZ.com (zahteva `--password`) |
| `--password=PASS` | — | Geslo QRZ.com |
| `--key=SESSION` | — | Obstoječ ključ seje QRZ (preskoči prijavo) |
| `--output=FILE` | `input-buro.adi` | Ime izhodne ADIF datoteke |
| `--delay=MS` | `1200` | Zamik med API klici v milisekundah |
| `--cache=FILE` | `.qrz-cache.json` | Pot do lokalne predpomnilniške datoteke |
| `--include-unknown` | izkl. | Ohrani QSO-je za klicne znake, ki jih QRZ ne najde |

> **Opomba:** Med zagonom se klicni znaki pošljejo QRZ.com. Glej [politiko zasebnosti QRZ.com](https://www.qrz.com/page/privacy.html).

---

## Testi

Enotni testi poslovne logike tečejo v Node.js (v18+), brez dodatnih odvisnosti:

```bash
# EDI → ADIF pretvornik
node --test --test-reporter=spec edi2adif.test.js

# EDI Crosscheck
node --test --test-reporter=spec edi-crosscheck.test.js

# ADIF Merge
node --test --test-reporter=spec adif-merge.test.js

# ADIF QRZ BURO filter
node --test --test-reporter=spec adif-qrz-filter.test.js

# Beležnik VHF/UHF tekmovanj
node --test --test-reporter=spec vhf-logger/vhf-logger.test.js

# ADIF Statistics
node --test --test-reporter=spec adif-stats.test.js
```

| Testna datoteka | Testov | Skupin |
|---|---|---|
| `edi2adif.test.js` | 122 | 9 (`normBand`, `parseEDI`, `adifField`, `csvEsc`, `modeBadge`, i18n, duplikati, CSV izvoz, urejanje v živo) |
| `edi-crosscheck.test.js` | 56 | 8 (`baseCall`, `levenshtein`, `parseEDI`, `runCrosscheck` lokator ×6, `runCrosscheck` klicni znak ×8, manjkajoč lokator ×4, pragovi ×3, klicni znak po lokatorju ×4) |
| `adif-merge.test.js` | 112 | 21 (`parseADIF`, `updateKey`, `recomputeDupes`, `adifField`, `htmlEsc`, `csvEsc`, `modeBadge`, `buildFilename`, ADIF izvoz, I18N, varnost ponovnega mergea in več) |
| `adif-qrz-filter.test.js` | 48 | 4 (`parseAdif`, `extractField`, `usesQslBuro` ×3, `cache`) |
| `vhf-logger/vhf-logger.test.js` | 163 | 16 (`baseCall`, `normBand`, `locToLatLon`, `haversine`, `calcBearing`, `levenshtein`, `isDupe`, `recalcDupes`, `buildEdi`, `lookupCall`, `sessionEdit`, `parseEdiForImport`, `makeZip`, `bandColors`, `manualTime`, `backup`) |
| `adif-stats.test.js` | 133 | 21 (`lookupCall`, `normBand`, `normMode`, `locToLatLon`, `haversine`, `parseADIF` ×3, `computeStats` ×6, `applyFilters`, `fmtDate`, `fmtMonth`, `htmlEsc`, `svgHBar`, `svgVBar`, `I18N`) |

Celotna dokumentacija je v [TESTING.md](TESTING.md).

---

## Načrtovane izboljšave

Polna zgodovina hroščev in načrt prihodnjih funkcionalnosti je v [Improvements.md](Improvements.md).

---

## Licenca

MIT
