# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**HamLogTools** is a collection of browser-based tools for amateur radio operators to process and convert log formats. All tools are self-contained single-file HTML applications — no build step, no framework, no backend.

**Current tools:**
- `edi2adif.html` — Converts REG1TEST EDI v1 contest logs to ADIF and other formats
- `edi-crosscheck.html` — Cross-checks a new EDI log against historical logs to flag callsign typos and locator mismatches
- `adif-qrz-filter.js` — Node.js CLI tool that filters an ADIF log to keep only BURO-accepting stations by querying the QRZ.com XML API

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
| Historical DB (`_histDB`, `addToHistDB()`, `clearHist()`) | `Map<baseCall → {locators: Map<loc,count>, total}>` built from dropped historical EDI files. |
| Crosscheck algorithm (`runCrosscheck()`) | Two-pass check: (1) locator mismatch/missing against historical mode, (2) unknown callsign similarity via Levenshtein. |
| Threshold controls (`updatePrag()`, `rerunCrosscheck()`) | `_minAppearances` (1–10) and `_minConfidence` (0.1–1.0) slider UI; `_lastQsos` stores last new log for re-run. |
| Render (`renderSummaryBar()`, `renderResults()`) | Summary counts, filterable table with severity colour coding. |
| HTML export (`exportIssues()`) | Generates a self-contained HTML file of all flagged QSOs with correction suggestions. |
| File loading (`loadHistFiles()`, `loadNewFile()`) | Async `FileReader` loops; historical files deduplicated by name+size. |
| Drag & drop + theme (`setupDrop()`, `toggleTheme()`) | Drag-over styling, click-to-input wiring, light/dark theme toggle with `localStorage`. |

**Key data flow:**
1. Historical EDI files → `loadHistFiles()` → `parseEDI()` → `addToHistDB()` → `_histDB`
2. New EDI log → `loadNewFile()` → `parseEDI()` → `_lastQsos`
3. `runCrosscheck(_lastQsos)` → `_results[]` (each entry has `qso`, `issues[]`, `base`, `idx`)
4. `renderSummaryBar()` + `renderResults()` → filtered table
5. Slider change → `updatePrag()` → enables `rerunCrosscheck()` → re-populates `_results`
6. `exportIssues()` → Blob HTML → download

**Issue types:**
- `LOC_MISMATCH` — new locator differs from historical mode; severity `high` (mode confidence ≥ threshold and locator never seen) or `med` (locator seen before).
- `LOC_MISSING` — new log QSO has no locator but history exists; severity `high`/`med` based on mode confidence.
- `CALL_SIMILAR` — callsign not in history; Levenshtein distance ≤ 2 matches found, sorted by distance ASC then count DESC.
- `CALL_UNKNOWN` — callsign not in history and no similar match within distance 2.

**QSO object shape** (after `parseEDI`):
```
call, mode, wwl, dateDisp, band, src
```

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
- `edi-crosscheck.html` — Preveri nov EDI dnevnik proti zgodovinskim dnevnikom in označi morebitne napake v klicnih znakih in lokatorjih
- `adif-qrz-filter.js` — Node.js CLI orodje, ki filtrira ADIF dnevnik in ohrani samo postaje, ki sprejemajo QSL preko biroja, s poizvedovanjem prek QRZ.com XML API

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
| Zgodovinska baza (`_histDB`, `addToHistDB()`, `clearHist()`) | `Map<bazniKlicniZnak → {locators: Map<lokator,števec>, total}>` zgrajena iz spuščenih zgodovinskih EDI datotek. |
| Algoritem crosschecka (`runCrosscheck()`) | Dvojni prehod: (1) neskladje/manjkajoč lokator proti zgodovinskemu modusu, (2) podobnost neznanega klicnega znaka prek Levenshteina. |
| Nadzor pragov (`updatePrag()`, `rerunCrosscheck()`) | Drsnika `_minAppearances` (1–10) in `_minConfidence` (0,1–1,0); `_lastQsos` shrani zadnji nov dnevnik za ponovni prehod. |
| Prikaz (`renderSummaryBar()`, `renderResults()`) | Povzetek s štetjem, filtrirajmo tabela z barvnim kodiranjem resnosti. |
| HTML izvoz (`exportIssues()`) | Ustvari samostojno HTML datoteko z vsemi označenimi QSO in predlogi popravkov. |
| Nalaganje datotek (`loadHistFiles()`, `loadNewFile()`) | Asinhroni zanki `FileReader`; zgodovinske datoteke deduplicirane po ime+velikost. |
| Povleci-in-spusti + tema (`setupDrop()`, `toggleTheme()`) | Oblikovanje povleci-nad, priklop klik-vnos, preklop svetla/temna tema s `localStorage`. |

**Potek podatkov:**
1. Zgodovinske EDI datoteke → `loadHistFiles()` → `parseEDI()` → `addToHistDB()` → `_histDB`
2. Nov EDI dnevnik → `loadNewFile()` → `parseEDI()` → `_lastQsos`
3. `runCrosscheck(_lastQsos)` → `_results[]` (vsak vnos ima `qso`, `issues[]`, `base`, `idx`)
4. `renderSummaryBar()` + `renderResults()` → filtrirana tabela
5. Sprememba drsnika → `updatePrag()` → omogoči `rerunCrosscheck()` → ponovno napolni `_results`
6. `exportIssues()` → Blob HTML → prenos

**Vrste težav:**
- `LOC_MISMATCH` — nov lokator se razlikuje od zgodovinskega modusa; resnost `high` (zaupanje v modus ≥ prag in lokator še nikoli viden) ali `med` (lokator že viden prej).
- `LOC_MISSING` — zveza v novem dnevniku nima lokatorja, a zgodovina obstaja; resnost `high`/`med` glede na zaupanje v modus.
- `CALL_SIMILAR` — klicni znak ni v zgodovini; najdena ujemanja z Levenshteinovo razdaljo ≤ 2, razvrščena po razdalji NAR, nato po številu PAD.
- `CALL_UNKNOWN` — klicni znak ni v zgodovini in ni podobnega ujemanja v razdalji 2.

**Oblika objekta QSO** (po `parseEDI`):
```
call, mode, wwl, dateDisp, band, src
```
