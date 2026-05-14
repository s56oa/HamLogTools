# Testing — HamLogTools

*[Slovenska različica / Slovenian version ↓](#testiranje--hamlogtools-sl)*

---

## Overview

All tests run in Node.js using the built-in `node:test` runner — no external dependencies required.

| Test file | Tool | Tests | Groups |
|---|---|---|---|
| `edi2adif.test.js` | `edi2adif.html` | 120 | 9 |
| `edi-crosscheck.test.js` | `edi-crosscheck.html` | 56 | 8 |
| `adif-qrz-filter.test.js` | `adif-qrz-filter.js` | 48 | 4 |
| `vhf-logger.test.js` | `vhf-logger.html` | 123 | 15 |

The sections below document each test file in detail.

---

## Running the tests

```bash
node --test --test-reporter=spec edi2adif.test.js
node --test --test-reporter=spec edi-crosscheck.test.js
node --test --test-reporter=spec adif-qrz-filter.test.js
node --test --test-reporter=spec vhf-logger.test.js
```

Requires **Node.js v18 or later** (`node:test` was stabilised in v18;
the project was developed on v25).

---

## How the tests work

`edi2adif.html` is a single-file browser app with no module system.
The test file extracts the embedded `<script>` block at runtime and evaluates
it inside a `node:vm` sandbox that provides a minimal DOM mock:

```
edi2adif.html ──► regex extract <script> ──► vm.createContext (mock DOM)
                                               └── vm.runInContext(script)
                                                        │
                                     function declarations promoted to ctx
                                                        │
                                   ctx.normBand, ctx.parseEDI, … exposed
```

The mock provides no-op implementations for `document.getElementById`,
`document.addEventListener`, `URL.createObjectURL`, `Blob`, `FileReader`,
etc. — enough for the script to initialise without a real browser.

> **vm prototype note:** Objects returned by functions running inside a vm
> context share the vm's `Object.prototype`, not the host's. Using
> `assert.deepStrictEqual` on them fails even when all properties are
> identical. All assertions therefore compare individual properties with
> `assert.equal`.

---

## Test groups

### 1 · `normBand` (27 tests)
Verifies the regex table that maps EDI `PBand` values to canonical ADIF
band names and nominal frequencies.

| Sub-group | What is checked |
|---|---|
| Empty / unknown input | Falsy input returns `{band:'', freq:''}`. Unrecognised strings pass through with no frequency. Whitespace is trimmed before matching. |
| 6 m – 23 cm | Each band matched by frequency (MHz), wavelength (e.g. `2m`), and GHz strings with both dot and comma decimal separators. |
| Microwave bands | 13 cm through 6 mm — band name verified for all eight entries. |

### 2 · `parseEDI` (36 tests)
Exercises the EDI-to-QSO parser across header fields, record parsing, edge
cases, and error handling.

| Sub-group | What is checked |
|---|---|
| Header extraction | `PCall`, `PWWLo`, `TName`, `SPowe`, `MOpe1/2` stored under lowercased keys in the `header` object. Band resolved via `normBand`. |
| QSO count | `ERROR` callsigns and records with fewer than 10 semicolon-delimited fields are silently skipped. |
| Callsign normalisation | Lowercased callsigns are uppercased. |
| Mode mapping | EDI mode codes 1 → `SSB`, 2 → `CW`, 3 → `CW`, 4 → `SSB`, 5 → `AM`, 6 → `FM`, 7 → `RTTY`, 8 → `SSTV`, 9 → `ATV`. |
| Date parsing | `YYYYMMDD` stored; `DD.MM.YYYY` display string generated. YY ≥ 90 → 1900+YY; YY < 90 → 2000+YY. |
| Time parsing | `HHMM` stored; `HH:MM` display string generated. |
| RST & exchange | `rstS`, `rstR`, `stx`, `srx` fields extracted from correct column positions. |
| Locator validation | 6-character Maidenhead grids kept in mixed case (first 4 uppercase, last 2 lowercase — e.g. `JN65ar`); 4-character grids rejected (`wwl` set to `''`). |
| Distance | Parsed as integer; zero preserved. |
| Duplicate flag | Column 13 value `D` → `dupe=true`; absent → `dupe=false`. |
| Key generation | `_key` follows `CALL\|YYYYMMDD\|HHMM` format; does not include band (that is added later by `handleFiles`). |
| Source tracking | `src` filename attached to every QSO. |
| Edge cases | Empty input, short records, CRLF line endings, minimum-field records (exactly 10 fields). |

> `handleFiles` is not tested here because it depends on the async browser
> `FileReader` API. Fields it adds to QSOs (`myCall`, `myLoc`, `contest`,
> `pwr`, `ops`, `band`, `_bandKey`) are therefore tested via the returned
> `header` object and the dedup group below.

### 3 · `adifField` (10 tests)
Verifies ADIF field serialisation: `<TAG:length>value `.

- Tag name uppercased regardless of input case.
- `null`, `undefined`, and `''` return an empty string (field omitted).
- Numeric value `0` is serialised (not treated as falsy/empty).
- Length field in output matches the actual string length of the value.

### 4 · `csvEsc` (11 tests)
Verifies CSV escaping for DARC QSL and generic CSV export.

- Plain strings returned unchanged.
- Strings containing a comma, double-quote, newline (`\n`), or carriage return (`\r`) are wrapped in double-quotes.
- Embedded double-quotes are doubled (`"` → `""`).
- `null` and `undefined` coerced to `''`; numbers coerced to string.

### 5 · `modeBadge` (8 tests)
Verifies the mapping from mode string to CSS badge class used in the table renderer.

- `SSB` and `AM` map to `badge-ssb` (analog voice modes).
- `CW` maps to `badge-cw`.
- `FM` maps to `badge-fm`.
- `RTTY`, `SSTV`, `ATV`, and unknown modes fall back to `badge-digi`.

### 6 · `i18n` (5 tests)
Verifies the translation lookup function `t(key)` and `setLang(lang)`.

- Default language is Slovenian (`sl`).
- Switching to `en` and back to `sl` works correctly.
- Unknown keys return the key string itself (safe fallback).

### 7 · Duplicate detection (6 tests)
Verifies the cross-file deduplication algorithm from `finishLoad`.

The `_all` array is a lexical `let` binding inside the vm scope and cannot
be mutated from outside. The 5-line algorithm is therefore reimplemented
inline and tested in isolation:

- No duplicates → all `dupe=false`.
- Two entries with the same `_bandKey` → second flagged.
- Three identical entries → only the first kept.
- Same call + time but different band → **not** a duplicate.
- Entry already marked `dupe=true` by the EDI parser stays `dupe=true`;
  a following identical entry is also flagged by the dedup pass.
- Mixed unique / duplicate set verified row-by-row.

---

### 8 · CSV export row format (9 tests)
Verifies the row-generation logic for the generic CSV export.

- Header has exactly 19 columns; each data row has the same column count.
- Row number is the first column.
- Serial numbers (`stx`, `srx`) have leading zeros stripped (`001` → `1`).
- Missing optional fields (exchange, locator, power, etc.) produce empty columns.
- Contest names containing commas are wrapped in double-quotes by `csvEsc`.
- Distance `0` is treated as absent and produces an empty cell; distance `> 0` is kept.

### 9 · Inline edit — field mutation (11 tests)
Verifies the save logic from `commitEdit()`.

`startEdit`/`commitEdit` manipulate real DOM nodes and cannot be driven from
a vm context without full browser APIs. The mutation logic is replicated
inline and tested in isolation.

| Sub-group | What is checked |
|---|---|
| Basic fields | `rstS`, `rstR`, and `mode` are trimmed and saved directly to the QSO object. |
| Locator validation | Valid 6-char Maidenhead grid (A–R, 0–9, A–X) saved in mixed case (first 4 uppercase, last 2 lowercase; e.g. `JN65ar`). 4-char, 8-char, non-Maidenhead characters, S–Z first pair, and non-digit middle pair are all rejected and clear `wwl` to `''`. |

---

## What is not tested

| Area | Reason |
|---|---|
| `handleFiles` | Requires async browser `FileReader`; not polyfillable in a pure vm context. |
| `finishLoad` / DOM update functions | Call `document.getElementById(...).style`, `.innerHTML`, etc. on real DOM nodes; only meaningful in a browser. |
| Export functions (`exportADIF`, `exportDARC`, `exportCSV`) | Depend on `_all` state, DOM checkboxes, and `Blob`/`URL.createObjectURL`. End-to-end browser tests (e.g. Playwright) would be needed. |
| Sorting (`sortFiltered`, `setSort`) | Depends on `_filtered` state; testable only with a full state setup. |

---
---

# Testiranje — HamLogTools [SL]

## Pregled

Vsi testi tečejo v Node.js z vgrajenim izvajalcem `node:test` — brez zunanjih odvisnosti.

| Testna datoteka | Orodje | Testov | Skupin |
|---|---|---|---|
| `edi2adif.test.js` | `edi2adif.html` | 120 | 9 |
| `edi-crosscheck.test.js` | `edi-crosscheck.html` | 56 | 8 |
| `adif-qrz-filter.test.js` | `adif-qrz-filter.js` | 48 | 4 |
| `vhf-logger.test.js` | `vhf-logger.html` | 95 | 11 |

Spodnji razdelki dokumentirajo vsako testno datoteko podrobno.

---

## Zaganjanje testov

```bash
node --test --test-reporter=spec edi2adif.test.js
node --test --test-reporter=spec edi-crosscheck.test.js
node --test --test-reporter=spec adif-qrz-filter.test.js
node --test --test-reporter=spec vhf-logger.test.js
```

Zahteva **Node.js v18 ali novejši** (`node:test` je bil stabiliziran v v18;
projekt je bil razvit na v25).

---

## Kako testi delujejo

`edi2adif.html` je enostranska brskalniška aplikacija brez sistema modulov.
Testna datoteka ob zagonu izvleče vgrajeni blok `<script>` in ga izvede
znotraj peskovnika `node:vm`, ki zagotavlja minimalni nadomestek DOM-a:

```
edi2adif.html ──► regex izvleče <script> ──► vm.createContext (nadom. DOM)
                                                └── vm.runInContext(skripta)
                                                         │
                                      deklaracije funkcij prenesene v ctx
                                                         │
                                   ctx.normBand, ctx.parseEDI, … dostopni
```

Nadomestek zagotavlja brezdejavne implementacije za `document.getElementById`,
`document.addEventListener`, `URL.createObjectURL`, `Blob`, `FileReader`
itd. — dovolj, da se skripta inicializira brez pravega brskalnika.

> **Opomba o prototipih vm:** Objekti, ki jih vrnejo funkcije v vm kontekstu,
> delijo `Object.prototype` iz vm, ne iz gostitelja. Zato `assert.deepStrictEqual`
> na njih ne uspe, čeprav so vse lastnosti identične. Vsa primerjanja zato
> primerjajo posamezne lastnosti z `assert.equal`.

---

## Skupine testov

### 1 · `normBand` (27 testov)
Preverja tabelo regularnih izrazov, ki preslika vrednosti EDI `PBand` v
kanonična imena pasov ADIF in nominalne frekvence.

| Podskupina | Kaj se preverja |
|---|---|
| Prazen / neznan vnos | Lažni vnos vrne `{band:'', freq:''}`. Neprepoznani nizi se prenesejo brez frekvence. Beli prostor se obreže pred ujemanjem. |
| 6 m – 23 cm | Vsak pas se ujema po frekvenci (MHz), valovni dolžini (npr. `2m`) in nizih GHz z decimalno piko in vejico. |
| Mikrovalovni pasovi | 13 cm do 6 mm — ime pasu preverjeno za vseh osem vnosov. |

### 2 · `parseEDI` (36 testov)
Preverja razčlenjevalnik EDI v QSO prek polj glave, razčlenjevanja zapisov,
robnih primerov in obravnavanja napak.

| Podskupina | Kaj se preverja |
|---|---|
| Ekstrakcija glave | `PCall`, `PWWLo`, `TName`, `SPowe`, `MOpe1/2` shranjeni pod ključi z malimi črkami v objektu `header`. Pas razrešen prek `normBand`. |
| Število QSO | Klicni znaki `ERROR` in zapisi z manj kot 10 polji (ločenimi s podpičjem) so tiho preskočeni. |
| Normalizacija klicnega znaka | Klicni znaki z malimi črkami se pretvorijo v velike. |
| Mapiranje načina | EDI kode načina 1 → `SSB`, 2 → `CW`, 3 → `CW`, 4 → `SSB`, 5 → `AM`, 6 → `FM`, 7 → `RTTY`, 8 → `SSTV`, 9 → `ATV`. |
| Razčlenjevanje datuma | Shranjeno `YYYYMMDD`; generiran prikazni niz `DD.MM.YYYY`. LL ≥ 90 → 1900+LL; LL < 90 → 2000+LL. |
| Razčlenjevanje časa | Shranjeno `HHMM`; generiran prikazni niz `HH:MM`. |
| RST in izmenjava | Polja `rstS`, `rstR`, `stx`, `srx` izvlečena iz pravilnih položajev stolpcev. |
| Validacija lokatorja | Maidenhead mreže s 6 znaki se ohranijo z mešanimi črkami (prvi 4 znaki z velikimi, zadnja 2 z malimi — npr. `JN65ar`); mreže s 4 znaki so zavrnjene (`wwl` nastavljeno na `''`). |
| Razdalja | Razčlenjena kot celo število; ničla ohranjena. |
| Zastavica duplikata | Vrednost `D` v stolpcu 13 → `dupe=true`; odsotnost → `dupe=false`. |
| Generiranje ključa | `_key` sledi obliki `KLICNI_ZNAK\|YYYYMMDD\|HHMM`; ne vsebuje pasu (ta se doda pozneje v `handleFiles`). |
| Sledenje izvoru | Ime datoteke `src` je pripeto vsakemu QSO. |
| Robni primeri | Prazen vnos, kratki zapisi, zaključki vrstic CRLF, zapisi z minimalnim številom polj (točno 10). |

> `handleFiles` tu ni testiran, ker je odvisen od asinhronega brskalnikovega
> API-ja `FileReader`. Polja, ki jih doda QSO-jem (`myCall`, `myLoc`, `contest`,
> `pwr`, `ops`, `band`, `_bandKey`), so zato preverjena prek vrnjenega objekta
> `header` in spodnje skupine za deduplikacijo.

### 3 · `adifField` (10 testov)
Preverja serializacijo polj ADIF: `<OZNAKA:dolžina>vrednost `.

- Ime oznake pretvorjeno v velike črke ne glede na vhodni primer.
- `null`, `undefined` in `''` vrnejo prazen niz (polje izpuščeno).
- Numerična vrednost `0` je serializirana (ne obravnavana kot lažna/prazna).
- Polje dolžine v izhodu ustreza dejanski dolžini vrednosti.

### 4 · `csvEsc` (11 testov)
Preverja ubežanje CSV za izvoz DARC QSL in generični CSV.

- Navadni nizi vrnjeni nespremenjeni.
- Nizi z vejico, dvojnimi narekovaji, novo vrstico (`\n`) ali zaključkom vrstice (`\r`) so zaviti v dvojne narekovaje.
- Vdelani dvojni narekovaji se podvojijo (`"` → `""`).
- `null` in `undefined` pretvorjeni v `''`; števila pretvorjena v niz.

### 5 · `modeBadge` (8 testov)
Preverja preslikavo niza načina v razred CSS značke, ki se uporablja v prikazu tabele.

- `SSB` in `AM` preslikata v `badge-ssb` (analogni govorni načini).
- `CW` preslika v `badge-cw`.
- `FM` preslika v `badge-fm`.
- `RTTY`, `SSTV`, `ATV` in neznani načini padejo na rezervno vrednost `badge-digi`.

### 6 · `i18n` (5 testov)
Preverja funkcijo za iskanje prevodov `t(ključ)` in `setLang(jezik)`.

- Privzeti jezik je slovenščina (`sl`).
- Preklop na `en` in nazaj na `sl` deluje pravilno.
- Neznani ključi vrnejo sam ključ (varna rezervna vrednost).

### 7 · Zaznavanje duplikatov (6 testov)
Preverja algoritem deduplikacije iz `finishLoad`.

Polje `_all` je leksikalna vezava `let` znotraj obsega vm in je ni mogoče
mutirati od zunaj. 5-vrstični algoritem je zato reimplementiran neposredno
in testiran v izolaciji:

- Brez duplikatov → vse `dupe=false`.
- Dva vnosa z enakim `_bandKey` → drugi označen.
- Trije enaki vnosi → ohranjen le prvi.
- Enak klicni znak + čas, a različen pas → **ni** duplikat.
- Vnos, ki ga je razčlenjevalnik EDI že označil z `dupe=true`, ostane označen;
  naslednji enaki vnos je prav tako označen s prehodom deduplikacije.
- Mešana množica edinstvenih in podvojenih vnosov preverjena vrstico po vrstico.

---

### 8 · Format vrstice CSV izvoza (9 testov)
Preverja logiko generiranja vrstic za generični CSV izvoz.

- Glava ima natanko 19 stolpcev; vsaka vrstica s podatki ima enako število stolpcev.
- Zaporedna številka vrstice je v prvem stolpcu.
- Serijske številke (`stx`, `srx`) imajo odstranjene vodilne ničle (`001` → `1`).
- Manjkajoča neobvezna polja (izmenjava, lokator, moč itd.) ustvarijo prazne stolpce.
- Imena tekmovanj z vejicami so zavita v dvojne narekovaje prek `csvEsc`.
- Razdalja `0` je obravnavana kot odsotna in ustvari prazno celico; razdalja `> 0` je ohranjena.

### 9 · Urejanje v živo — mutacija polj (11 testov)
Preverja logiko shranjevanja iz `commitEdit()`.

`startEdit`/`commitEdit` manipulirata z resničnimi vozlišči DOM in ju ni mogoče
izvajati iz vm konteksta brez polnih brskalniških API-jev. Logika mutacije
je reimplementirana neposredno in testirana v izolaciji.

| Podskupina | Kaj se preverja |
|---|---|
| Osnovna polja | `rstS`, `rstR` in `mode` so obrezani in shranjeni neposredno v objekt QSO. |
| Validacija lokatorja | Veljavna 6-znakovna Maidenhead mreža (A–R, 0–9, A–X) se shrani z mešanimi črkami (prvi 4 z velikimi, zadnja 2 z malimi; npr. `JN65ar`). 4-znakovni, 8-znakovni, znaki zunaj Maidenhead, prvi par S–Z in nečiselni srednji par so zavrnjeni in `wwl` se postavi na `''`. |

---

## `edi-crosscheck.test.js` — 56 tests · 8 groups

Covers the pure logic of `edi-crosscheck.html`: suffix stripping, edit distance, EDI parsing, and all crosscheck algorithms including configurable thresholds and missing-locator suggestions.

### How the tests work

`edi-crosscheck.html` is evaluated inside a `node:vm` context, the same pattern as `edi2adif.html`. Unlike that tool, no code is stripped — instead a Proxy-based DOM mock absorbs all property access and method calls silently, so the startup event-wiring runs without error.

Module-level state (`_histDB`, `_results`) is `const`/`let` and therefore not accessible as ctx properties. Tests route all state through function declarations:
- `clearHist()` — resets the DB and result set between tests
- `addToHistDB(qsos)` — populates the historical database
- `runCrosscheck(qsos)` — runs the check and **returns** the results array

### Test groups

#### 1 · `baseCall` (13 tests)
Verifies suffix stripping for crosscheck matching.

- **Portable/mobile suffixes** (`/P`, `/M`, `/MM`, `/AM`, `/QRP`, `/R`, `/A`, `/B`) stripped from trailing position.
- **Italian regional suffixes** (`/IV3`, `/I1`, etc.) stripped — treated the same as `/P` because they indicate the same station operating from a different region.
- **Numerical district suffixes** (`/1`, `/2`, etc.) stripped.
- **Prefix-slash callsigns** (`OE/S59DGO`, `F/ON4AAA`) left unchanged — they represent a different operating location (prefix is a country/region prefix, not a suffix).
- Heuristic: if the part *before* the slash contains a digit, it's a `callsign/suffix` pattern and the suffix is stripped; otherwise it's a `prefix/call` pattern and kept as-is.
- Plain callsigns unchanged. Result always uppercased.

#### 2 · `levenshtein` (9 tests)
Verifies the Levenshtein distance function with `maxDist=2` early-exit.

- Distance 0 for identical strings.
- Distance 1 for single substitution, insertion, or deletion.
- Distance 2 for two substitutions.
- Returns `maxDist+1` when the length difference alone exceeds `maxDist` (early exit).
- Handles empty strings correctly.

#### 3 · `parseEDI` (9 tests)
Verifies QSO extraction from an EDI file fragment.

- Two-record file parsed correctly; callsigns and portable suffixes preserved.
- Band resolved from `PBand` header and applied to all QSOs.
- Locator stored in mixed-case convention (`JN65ar`); invalid locators cleared to `''`.
- Date formatted as `DD.MM.YYYY`; two-digit year expanded.
- `ERROR` callsigns skipped; CRLF line endings handled.

#### 4 · `runCrosscheck — locator mismatch` (6 tests)

| Test | What is verified |
|---|---|
| Clean match | No issue when locator equals historical mode |
| High severity | `LOC_MISMATCH` severity `high` when mode confidence ≥ 60% and new locator never seen |
| Medium severity | `LOC_MISMATCH` severity `med` when new locator appeared before (e.g. portable operation) |
| Threshold | No flag when callsign has fewer than 3 historical appearances |
| No locator | No `LOC_MISMATCH` when QSO has no locator (`wwl = ''`) — instead `LOC_MISSING` may be raised |
| allLocs order | Historical locator list in the issue is sorted by count descending |

#### 5 · `runCrosscheck — callsign check` (8 tests)

| Test | What is verified |
|---|---|
| CALL_SIMILAR d=1 | Call not in history; distance-1 match found and ranked first |
| CALL_UNKNOWN | Call not in history; no similar found within distance 2 |
| In history | No call issue when base call exists in DB |
| Portable normalisation | `S59ABC/P` matched against `S59ABC` history — no call flag |
| Sort order | Similar suggestions sorted by distance ASC, then count DESC |
| Distance 2 | Distance-2 matches also flagged (`CALL_SIMILAR`) |
| Combined issues | Unknown call produces only `CALL_SIMILAR`; no spurious LOC issue without history |
| Deduplication | Repeated unknown call in new log reuses precomputed similar-call list |

#### 6 · `runCrosscheck — missing locator suggestion` (4 tests)

| Test | What is verified |
|---|---|
| Suggests mode locator | `LOC_MISSING` raised when new log QSO has no locator but history exists |
| Medium severity | `LOC_MISSING` severity `med` when mode confidence is below the threshold |
| Threshold | No `LOC_MISSING` when fewer than `_minAppearances` historical entries |
| Empty history locators | No `LOC_MISSING` when all historical entries have empty locators |

#### 7 · `runCrosscheck — configurable thresholds` (3 tests)

| Test | What is verified |
|---|---|
| `_minAppearances` | No flag when historical count is below the slider threshold |
| `_minConfidence` | Severity respects the confidence slider (high vs med) |
| Empty locators ignored | Empty historical locators do not affect mode calculation |

#### 8 · `runCrosscheck — callsign by locator` (4 tests)

| Test | What is verified |
|---|---|
| CALL_BY_LOC basic | Suggests calls historically seen from the same locator and within Levenshtein ≤ 2 |
| No match | No `CALL_BY_LOC` when no historical calls from that locator are within distance 2 |
| Separate from CALL_SIMILAR | `CALL_BY_LOC` and `CALL_SIMILAR` appear as distinct issues in the result |
| Redundant coexistence | `CALL_BY_LOC` is raised even when its candidates overlap with `CALL_SIMILAR` — both signals are shown as corroborating evidence |

---

## CLI Tool Tests — `adif-qrz-filter.test.js`

A separate test suite covers the Node.js CLI tool. It also uses `node:test` with no external dependencies.

**Tests:** 48 across 4 test groups

### Running

```bash
node --test adif-qrz-filter.test.js
node --test --test-reporter=spec adif-qrz-filter.test.js
```

### Test groups

| # | Group | Tests | What is checked |
|---|---|---|---|
| 1 | `parseAdif` | 6 | ADIF parsing: header extraction, record splitting, `QSL_VIA` extraction, CRLF handling, missing `CALL` skipping |
| 2 | `extractField` | 8 | Generic `<TAG:length>value` extraction for `CALL`, `QSL_VIA`, case-insensitivity, trimming, uppercasing, ADIF type specifier (`<TAG:len:TYPE>`) |
| 3 | `usesQslBuro` | 31 | Fuzzy logic: 12 positive cases (buro/bureau + European variants: buero/büro/buerau/boureau/burea/buiro; "Direct or Bureau" wins), 16 negative cases (no/direct only/only via LoTW/eQSL only/"QSL via CALL"), 3 edge cases (null/empty) |
| 4 | `cache` | 3 | JSON cache save/load round-trip, 7-day TTL purge, missing file handling |

### How the tests work

The CLI tool is evaluated inside a `node:vm` context that stubs `fs`, `https`, `process`, and `console`. Pure functions (`parseAdif`, `extractField`, `usesQslBuro`, `loadCache`, `saveCache`) are extracted and tested directly.

> **Note on `deepStrictEqual`:** As with the `edi2adif.html` vm tests, `assert.deepStrictEqual` on vm-created objects can fail even when properties are identical. The cache tests therefore use `assert.equal` on individual properties or `Object.keys().length` for empty-object checks.

---

## `vhf-logger.test.js` — 123 tests · 15 groups

Covers the pure logic of `vhf-logger.html`: callsign normalization, band mapping, geo utilities, dupe detection, dupe recalculation, EDI build, crosscheck lookup, EDI import parsing, ZIP generation, band colors, and manual time state.

### How the tests work

`vhf-logger.html` is evaluated inside a `node:vm` context using the same Proxy-based DOM mock as `edi-crosscheck.html`. Because module-level `let` bindings are not ctx properties, helpers are injected via a second `vm.runInContext` call. The ctx also explicitly receives `TextEncoder`, `TextDecoder`, `Uint8Array`, `DataView`, and `ArrayBuffer` so that `makeZip` can run correctly:
- `_setCurrentForTest(session)` — sets the active session for dupe-related tests
- `_getCurrentForTest()` — reads the active session back
- `_getEditingExistingForTest()` — reads the `_editingExisting` flag for session-edit tests
- `_getI18nValueForTest(lang, key)` — reads a value from the `S` i18n object for i18n coverage tests
- `_getManualTimeForTest()` — reads the `_manualTime` state variable
- `_setManualTimeForTest(v)` — sets `_manualTime` for state tests
- `_getBandColorsForTest()` — returns the `BAND_COLORS` map

### Test groups

#### 1 · `baseCall` (10 tests)
Verifies suffix stripping used for dupe detection and crosscheck lookup.

- `/P`, `/M`, `/MM`, `/AM`, `/QRP` suffixes stripped from trailing position.
- Numerical district suffixes (`/1`, `/2`) stripped.
- Prefix-slash callsigns (`OE/S59DGO`) kept unchanged (heuristic: slash before digit-containing part = suffix, otherwise = prefix).
- Plain callsigns unchanged; result always uppercased.

#### 2 · `normBand` (10 tests)
Verifies the band mapping table.

- Canonical band names returned for MHz strings (`144 MHz`, `432 MHz`), wavelength strings (`2m`, `70cm`), and GHz strings (`1.3 GHz`).
- Empty/unknown input returns `{band:'', freq:''}`.
- Whitespace trimmed before matching.

#### 3 · `locToLatLon` (7 tests)
Verifies Maidenhead locator → latitude/longitude conversion.

- `JN65VP` → approx. lat 45.5°N, lon 13.8°E (Ajdovščina area).
- `IO91wm` → approx. lat 51.3°N, lon -0.1°E (London area).
- Sub-square letters (3rd pair) converted correctly.
- Invalid input (wrong length, wrong characters) returns `null`.
- 4-character locators return `null` (only 6-character supported).

#### 4 · `haversine` (4 tests)
Verifies great-circle distance calculation.

- `JN65VP` → `JN58UD` ≈ 320 km (±30).
- Same locator → distance `0`.
- Result is an integer (floored).
- Distance is symmetric.

#### 5 · `calcBearing` (5 tests)
Verifies great-circle bearing calculation.

- Result is in range 0–359.
- Result is an integer.
- Due north → 0, due east → 90, due south → 180, due west → 270 (±2° tolerance for sub-square centre offset).

#### 6 · `levenshtein` (7 tests)
Verifies the Levenshtein distance function with `maxDist=2` early exit.

- Distance 0 for identical strings.
- Distance 1 for single substitution, insertion, or deletion.
- Returns `maxDist+1` when length difference alone exceeds `maxDist` (early exit).
- Handles empty strings correctly.

#### 7 · `isDupe` (7 tests)
Verifies dupe detection using `baseCall()` normalization and `excludeId`.

- Same call + band → dupe detected.
- Same base call with `/P` suffix → also detected as dupe.
- Different band → not a dupe.
- `excludeId` param prevents false-dupe when checking the QSO being edited.
- No session (`_current = null`) → always returns `false`.

#### 8 · `recalcDupes` (4 tests)
Verifies full dupe-flag recalculation across a session.

- First occurrence of a base call per band → `dupe=false`; subsequent → `dupe=true`.
- `/P` portable call normalizes to base call — counted as dupe of plain base call.
- Per-band isolation: same call on different bands both get `dupe=false`.
- After `recalcDupes`, the `_current.qsos` array is mutated in place.

#### 9 · `buildEdi` (25 tests)
Verifies REG1TEST EDI v1 output format.

- File starts with `[REG1TEST;1]` header.
- `TDate` uses full `YYYYMMDD` (header); QSO records use `YYMMDD`.
- `TName`, `PCall`, `PWWLo`, `PBand`, `PClub`, `PSect`, `MOpe1` headers present and correct.
- Equipment headers: `SPowe`, `SAnte`, `STXEq`, `SRXEq`, `SAntH` populated from band config.
- C* summary block: `CQSOs`, `CQSOP`, `CWWLs`, `CWWLB`, `CExcs`, `CExcB`, `CDXCs`, `CDXCB`, `CToSc`, `CODXC` — computed from non-dupe QSOs.
- `[QSORecords N]` section present with correct count.
- QSO line has exactly 14 semicolon-separated fields (col 0–13).
- Dupe flag at col 13: `D` for duped QSO, empty for normal QSO.
- `nrS` / `nrR` zero-padded to 3 digits.
- `WWL` in QSO line is 6 characters uppercase.
- `PClub` header populated from `session.club`.
- Modes: `SSB` → `1`, `CW` → `2`, `FM` → `6`.

#### 10 · `lookupCall` (6 tests)
Verifies crosscheck lookup against the weighted+raw baseline DB.

- Call in baseline → `found=true`, `modeLoc` set to most common locator.
- `/P` portable → base call looked up correctly.
- Call not in baseline → `found=false`, `similar` array populated from Levenshtein search.
- `similar` list sorted by distance ASC, then count DESC.
- Call completely unknown with no close match → `found=false`, `similar=[]`.

#### 11 · `sessionEdit` (10 tests)
Verifies state and i18n coverage for the session-editing feature.

- `_editingExisting` flag initialises to `false`.
- Four new SL i18n keys (`btnEditSetup`, `setupEdit`, `btnSaveSetup`, `errBandHasQsos`) are non-empty strings.
- Four new EN i18n keys (same set) are non-empty strings.
- `sl.setupEdit` and `en.setupEdit` are distinct strings (translation exists).

#### 12 · `parseEdiForImport` (10 tests)
Verifies EDI file parsing for the import feature.

- Correct QSO count from a 3-record EDI fragment.
- `YYMMDD` date in QSO records converted to full `YYYYMMDD` (YY ≥ 80 → 19xx, YY < 80 → 20xx).
- Mode number `1` → `SSB`, `2` → `CW`.
- Dupe flag `D` at col 13 detected; clean QSOs have `dupe=false`.
- Callsign uppercased; locator normalised to 4-upper + 2-lower mixed case.
- Header fields (`PBand`, `PCall`) extracted.
- UTC time parsed correctly from `HHMM`.

#### 13 · `makeZip` (5 tests)
Verifies the minimal ZIP generator (STORE/no-compression).

- Returns a `Uint8Array`.
- First 4 bytes are the ZIP local file header magic `PK\x03\x04`.
- Last 22 bytes start with the end-of-central-directory magic `PK\x05\x06`.
- EOCD entry count field matches the number of files passed in.
- Empty file list produces a valid minimal ZIP (≥ 22 bytes).

#### 14 · `bandColors` (4 tests)
Verifies the `BAND_COLORS` map used to colour band tabs.

- Map has entries for `2m` and `70cm`.
- `2m` and `70cm` have distinct colour values.
- All values are 7-character `#rrggbb` hex strings.

#### 15 · `manualTime` (7 tests)
Verifies manual UTC time override state and i18n keys for new features.

- `_manualTime` initialises to `null`.
- State can be set and read back via helpers.
- `sl.toastImported` contains `${n}` placeholder.
- `sl.errImportBand` contains `${band}` placeholder.
- `sl.btnExportAll` and `en.btnExportAll` are non-empty strings.
- `sl.btnImport` and `en.btnImport` are non-empty strings.

---

## `edi-crosscheck.test.js` — 56 testov · 8 skupin

Pokriva čisto logiko `edi-crosscheck.html`: odstranjevanje pripon, razdalja urejanja, razčlenjevanje EDI in vse algoritme crosschecka, vključno z nastavljivimi pragovi in predlogi za manjkajoče lokatorje.

### Kako testi delujejo

`edi-crosscheck.html` se izvede znotraj konteksta `node:vm` po enakem vzorcu kot `edi2adif.html`. Za razliko od tega orodja kode ne odstranjujemo — namesto tega nadomestek DOM na osnovi `Proxy` tiho absorbira vse dostope do lastnosti in klice metod, tako da se začetno priklapljanje poslušalcev dogodkov izvede brez napak.

Stanje na ravni modula (`_histDB`, `_results`) je `const`/`let` in zato ni dostopno kot lastnost ctx. Testi upravljajo z vsem stanjem prek deklaracij funkcij:
- `clearHist()` — ponastavi bazo in rezultate med testi
- `addToHistDB(qsos)` — polni zgodovinsko bazo
- `runCrosscheck(qsos)` — izvede crosscheck in **vrne** polje rezultatov

### Skupine testov

#### 1 · `baseCall` (13 testov)
Preverja odstranjevanje pripon za ujemanje pri crosschecku.

- **Prenosne/mobilne pripone** (`/P`, `/M`, `/MM`, `/AM`, `/QRP`, `/R`, `/A`, `/B`) se odstranijo z zadnjega mesta.
- **Italijanski regionalni sufiksi** (`/IV3`, `/I1` itd.) se odstranijo — obravnavani so enako kot `/P`, ker gre za isto postajo, ki oddaja iz druge regije.
- **Številčni sufiksi okrajev** (`/1`, `/2` itd.) se odstranijo.
- **Klicni znaki z predponsko poševnico** (`OE/S59DGO`, `F/ON4AAA`) ostanejo nespremenjeni — predstavljajo drugačno lokacijo delovanja (predpona je državna/regionalna, ne sufiks).
- Hevristika: če del *pred* poševnico vsebuje številko, gre za vzorec `klicniZnak/sufiks` in sufiks se odstrani; sicer gre za `predpona/klicniZnak` in se ohrani nespremenjeno.
- Navadni klicni znaki nespremenjeni. Rezultat je vedno z velikimi črkami.

#### 2 · `levenshtein` (9 testov)
Preverja funkcijo Levenshteinove razdalje z zgodnjim izhodom pri `maxDist=2`.

- Razdalja 0 za enake nize.
- Razdalja 1 za eno zamenjavo, vstavljanje ali brisanje.
- Razdalja 2 za dve zamenjavi.
- Vrne `maxDist+1`, ko razlika v dolžini sama presega `maxDist` (zgodnji izhod).
- Pravilno obravnava prazne nize.

#### 3 · `parseEDI` (9 testov)
Preverja ekstrakcijo QSO iz fragmenta EDI datoteke.

- Datoteka z dvema zapisoma razčlenjena pravilno; klicni znaki in prenosne pripone ohranjeni.
- Pas razrešen iz glave `PBand` in apliciran na vse QSO-je.
- Lokator shranjen po konvenciji mešanih črk (`JN65ar`); neveljavni lokatorji počiščeni na `''`.
- Datum formatiran kot `DD.MM.YYYY`; dvo-cifreno leto razvito.
- Klicni znaki `ERROR` preskočeni; obravnavani zaključki vrstic CRLF.

#### 4 · `runCrosscheck — neskladje lokatorja` (6 testov)

| Test | Kaj se preverja |
|---|---|
| Čisto ujemanje | Brez težave, ko se lokator ujema z zgodovinskim modusom |
| Visoka resnost | `LOC_MISMATCH` resnost `high`, ko zaupanje v modus ≥ 60% in nov lokator še nikoli ni bil viden |
| Srednja resnost | `LOC_MISMATCH` resnost `med`, ko je bil nov lokator že viden (npr. prenosna postaja) |
| Prag | Brez zastavice, ko ima klicni znak manj kot 3 zgodovinska pojavitev |
| Brez lokatorja | Ni `LOC_MISMATCH`, ko QSO nima lokatorja (`wwl = ''`) — namesto tega se lahko pojavi `LOC_MISSING` |
| Vrstni red allLocs | Seznam zgodovinskih lokatorjev v težavi je razvrščen po številu padajoče |

#### 5 · `runCrosscheck — preverjanje klicnega znaka` (8 testov)

| Test | Kaj se preverja |
|---|---|
| CALL_SIMILAR d=1 | Klicni znak ni v zgodovini; ujemanje z razdaljo 1 najdeno in razvrščeno na vrhu |
| CALL_UNKNOWN | Klicni znak ni v zgodovini; ni podobnega v razdalji 2 |
| V zgodovini | Brez težave z klicnim znakom, ko bazni klicni znak obstaja v bazi |
| Normalizacija prenosnih | `S59ABC/P` se primerja z zgodovino `S59ABC` — brez zastavice klicnega znaka |
| Vrstni red | Podobni predlogi razvrščeni po razdalji naraščajoče, nato po številu padajoče |
| Razdalja 2 | Ujemanja z razdaljo 2 so prav tako označena (`CALL_SIMILAR`) |
| Kombinacija težav | Neznani klicni znak ustvari samo `CALL_SIMILAR`; brez napačne LOC težave brez zgodovine |
| Deduplikacija | Ponavljajoči se neznani klicni znak v novem dnevniku ponovno uporabi preračunan seznam podobnih |

#### 6 · `runCrosscheck — predlog za manjkajoč lokator` (4 testa)

| Test | Kaj se preverja |
|---|---|
| Predlagaj modus | `LOC_MISSING` se sproži, ko nov dnevnik nima lokatorja, a zgodovina obstaja |
| Srednja resnost | `LOC_MISSING` resnost `med`, ko je zaupanje v modus pod pragom |
| Prag | Ni `LOC_MISSING`, ko je zgodovinskih pojavitev manj kot `_minAppearances` |
| Prazni lokatorji v zgodovini | Ni `LOC_MISSING`, ko imajo vsi zgodovinski vnosi prazne lokatorje |

#### 7 · `runCrosscheck — nastavljivi pragovi` (3 teste)

| Test | Kaj se preverja |
|---|---|
| `_minAppearances` | Ni zastavice, ko je zgodovinsko število pod pragom drsnika |
| `_minConfidence` | Resnost upošteva prag zaupanja drsnika (high vs med) |
| Prazni lokatorji prezrti | Prazni zgodovinski lokatorji ne vplivajo na izračun modusa |

#### 8 · `runCrosscheck — klicni znak po lokatorju` (4 testi)

| Test | Kaj se preverja |
|---|---|
| CALL_BY_LOC osnovno | Predlaga klicne znake, ki so bili zgodovinsko videni z istega lokatorja in so v razdalji Levenshtein ≤ 2 |
| Brez ujemanja | Ni `CALL_BY_LOC`, ko noben zgodovinski klicni znak z istega lokatorja ni v razdalji 2 |
| Ločeno od CALL_SIMILAR | `CALL_BY_LOC` in `CALL_SIMILAR` se pojavita kot ločeni težavi v rezultatu |
| Redundantno soobstajanje | `CALL_BY_LOC` se sproži tudi, ko se kandidati prekrivajo s `CALL_SIMILAR` — oba signala se prikažeta kot potrjevalni dokaz |

---

## Testi CLI orodja — `adif-qrz-filter.test.js`

Ločena testna zbirka pokriva Node.js CLI orodje. Tudi ta uporablja `node:test` brez zunanjih odvisnosti.

**Testov:** 48 v 4 skupinah

### Zaganjanje

```bash
node --test adif-qrz-filter.test.js
node --test --test-reporter=spec adif-qrz-filter.test.js
```

### Skupine testov

| # | Skupina | Testov | Kaj se preverja |
|---|---|---|---|
| 1 | `parseAdif` | 6 | Razčlenjevanje ADIF: ekstrakcija glave, razdelitev zapisov, izvleček `QSL_VIA`, obravnava CRLF, preskočitev manjkajočega `CALL` |
| 2 | `extractField` | 8 | Generična ekstrakcija `<TAG:dolžina>vrednost` za `CALL`, `QSL_VIA`, neobčutljivost na velikost črk, obrezovanje, pretvorba v velike črke, ADIF type specifier (`<TAG:len:TYPE>`) |
| 3 | `usesQslBuro` | 31 | Fuzzy logika: 12 pozitivnih primerov (buro/bureau + evropske črkovalice: buero/büro/buerau/boureau/burea/buiro; "Direct or Bureau" pravilno vrne true), 16 negativnih primerov (no/direct only/only via LoTW/eQSL only/"QSL via KLICNI_ZNAK"), 3 robni primeri (null/prazno) |
| 4 | `cache` | 3 | Krog shranjevanja/nalaganja JSON predpomnilnika, čiščenje po 7 dneh, obravnava manjkajoče datoteke |

### Kako testi delujejo

CLI orodje se izvede znotraj konteksta `node:vm`, ki nadomesti `fs`, `https`, `process` in `console`. Čiste funkcije (`parseAdif`, `extractField`, `usesQslBuro`, `loadCache`, `saveCache`) se izvlečejo in testirajo neposredno.

> **Opomba o `deepStrictEqual`:** Tako kot pri testih `edi2adif.html` v vm kontekstu lahko `assert.deepStrictEqual` na vm-ustvarjenih objektih ne uspe, čeprav so lastnosti identične. Testi predpomnilnika zato uporabljajo `assert.equal` na posameznih lastnostih ali `Object.keys().length` za preverjanje praznih objektov.

---

## `vhf-logger.test.js` — 123 testov · 15 skupin

Pokriva čisto logiko `vhf-logger.html`: normalizacijo klicnih znakov, mapiranje pasov, geo pomožnike, zaznavanje duplikatov, preračun duplikatov, gradnjo EDI, crosscheck poizvedbe, razčlenjevanje uvoza EDI, generiranje ZIP, barve pasov in stanje ročnega časa.

### Kako testi delujejo

`vhf-logger.html` se izvede znotraj konteksta `node:vm` z enakim nadomestkom DOM na osnovi Proxy kot `edi-crosscheck.html`. Ker modularni `let` vezani niso lastnosti ctx, se pomožne funkcije vbrizgajo prek drugega klica `vm.runInContext`. Ctx izrecno prejme `TextEncoder`, `TextDecoder`, `Uint8Array`, `DataView` in `ArrayBuffer` za pravilno delovanje `makeZip`:
- `_setCurrentForTest(seja)` — nastavi aktivno sejo za teste duplikatov
- `_getCurrentForTest()` — prebere aktivno sejo
- `_getEditingExistingForTest()` — prebere zastavico `_editingExisting`
- `_getI18nValueForTest(jezik, ključ)` — prebere vrednost iz `S` objekta za i18n teste
- `_getManualTimeForTest()` — prebere stanje `_manualTime`
- `_setManualTimeForTest(v)` — nastavi `_manualTime` za teste stanja
- `_getBandColorsForTest()` — vrne mapo `BAND_COLORS`

### Skupine testov

#### 1 · `baseCall` (10 testov)
Preverja odstranjevanje pripon, ki se uporablja pri zaznavanju duplikatov in crosscheck poizvedbah.

- Pripone `/P`, `/M`, `/MM`, `/AM`, `/QRP` se odstranijo z zadnjega mesta.
- Številčni sufiksi okrajev (`/1`, `/2`) se odstranijo.
- Klicni znaki s predponsko poševnico (`OE/S59DGO`) ostanejo nespremenjeni (hevristika: poševnica pred delom s številko = sufiks, sicer = predpona).
- Navadni klicni znaki nespremenjeni; rezultat je vedno z velikimi črkami.

#### 2 · `normBand` (10 testov)
Preverja tabelo za mapiranje pasov.

- Kanonska imena pasov se vrnejo za nize MHz (`144 MHz`, `432 MHz`), nize valovnih dolžin (`2m`, `70cm`) in nize GHz (`1.3 GHz`).
- Prazen/neznan vnos vrne `{band:'', freq:''}`.
- Beli prostor se obreže pred ujemanjem.

#### 3 · `locToLatLon` (7 testov)
Preverja pretvorbo Maidenhead lokatorja → zemljepisna širina/dolžina.

- `JN65VP` → pribl. lat 45,5°S, lon 13,8°V (območje Ajdovščine).
- `IO91wm` → pribl. lat 51,3°S, lon −0,1°V (območje Londona).
- Podskvadratne črke (3. par) pravilno pretvorjene.
- Neveljaven vnos (napačna dolžina, napačni znaki) vrne `null`.
- 4-znakovni lokatorji vrnejo `null` (podprti so samo 6-znakovni).

#### 4 · `haversine` (4 testi)
Preverja izračun razdalje po velikem krogu.

- `JN65VP` → `JN58UD` ≈ 320 km (±30).
- Enak lokator → razdalja `0`.
- Rezultat je celo število (zaokroženo navzdol).
- Razdalja je simetrična.

#### 5 · `calcBearing` (5 testov)
Preverja izračun smeri po velikem krogu.

- Rezultat je v obsegu 0–359.
- Rezultat je celo število.
- Sever → 0, vzhod → 90, jug → 180, zahod → 270 (toleranca ±2° za odmik sredine podskvadrata).

#### 6 · `levenshtein` (7 testov)
Preverja funkcijo Levenshteinove razdalje z zgodnjim izhodom pri `maxDist=2`.

- Razdalja 0 za enake nize.
- Razdalja 1 za eno zamenjavo, vstavljanje ali brisanje.
- Vrne `maxDist+1`, ko razlika v dolžini sama presega `maxDist` (zgodnji izhod).
- Pravilno obravnava prazne nize.

#### 7 · `isDupe` (7 testov)
Preverja zaznavanje duplikatov z normalizacijo `baseCall()` in parametrom `excludeId`.

- Enak klicni znak + pas → duplikat zaznan.
- Enak bazni klicni znak s pripono `/P` → prav tako zaznan kot duplikat.
- Različen pas → ni duplikat.
- Parameter `excludeId` preprečuje lažni duplikat pri preverjanju QSO, ki se ureja.
- Brez seje (`_current = null`) → vedno vrne `false`.

#### 8 · `recalcDupes` (4 testi)
Preverja popolni preračun zastavic duplikatov v seji.

- Prva pojavitev baznega klicnega znaka per pas → `dupe=false`; kasnejše → `dupe=true`.
- Prenosni klicni znak s `/P` se normalizira v bazni — šteje kot duplikat navadnega baznega klicnega znaka.
- Izolacija po pasovih: enak klicni znak na različnih pasovih oba dobita `dupe=false`.
- Po `recalcDupes` je polje `_current.qsos` mutirano na mestu.

#### 9 · `buildEdi` (25 testov)
Preverja izhodni format REG1TEST EDI v1.

- Datoteka se začne z glavo `[REG1TEST;1]`.
- `TDate` uporablja polni `YYYYMMDD` (glava); QSO zapisi uporabljajo `YYMMDD`.
- Prisotne in pravilne glave `TName`, `PCall`, `PWWLo`, `PBand`, `PClub`, `PSect`, `MOpe1`.
- Glave opreme: `SPowe`, `SAnte`, `STXEq`, `SRXEq`, `SAntH` izpolnjene iz konfiguracije pasu.
- Blok C*: `CQSOs`, `CQSOP`, `CWWLs`, `CWWLB`, `CExcs`, `CExcB`, `CDXCs`, `CDXCB`, `CToSc`, `CODXC` — izračunani iz QSO-jev brez duplikatov.
- Razdelek `[QSORecords N]` prisoten s pravilnim številom.
- Vrstica QSO ima natanko 14 polj, ločenih s podpičji (stolpci 0–13).
- Zastavica duplikata v stolpcu 13: `D` za podvojeni QSO, prazno za normalnega.
- `nrS` / `nrR` dopolnjeni z ničlami na 3 znake.
- `WWL` v vrstici QSO je 6 znakov z velikimi črkami.
- Glava `PClub` izpolnjena iz `session.club`.
- Načini: `SSB` → `1`, `CW` → `2`, `FM` → `6`.

#### 10 · `lookupCall` (6 testov)
Preverja crosscheck poizvedbo v uteženi+raw baseline bazi.

- Klicni znak v baseline → `found=true`, `modeLoc` nastavljen na najpogostejši lokator.
- Prenosni `/P` → bazni klicni znak se pravilno poišče.
- Klicni znak ni v baseline → `found=false`, polje `similar` izpolnjeno iz Levenshteinove iskanja.
- Seznam `similar` razvrščen po razdalji naraščajoče, nato po številu padajoče.
- Povsem neznan klicni znak brez bližnjega ujemanja → `found=false`, `similar=[]`.

#### 11 · `sessionEdit` (10 testov)
Preverja stanje in i18n pokritost za funkcijo urejanja seje.

- Zastavica `_editingExisting` se inicializira na `false`.
- Štirje novi SL i18n ključi (`btnEditSetup`, `setupEdit`, `btnSaveSetup`, `errBandHasQsos`) so neprazni nizi.
- Štirje novi EN i18n ključi (ista množica) so neprazni nizi.
- `sl.setupEdit` in `en.setupEdit` sta različna niza (prevod obstaja).

---

## Kaj ni testirano

| Področje | Razlog |
|---|---|
| `handleFiles` | Zahteva asinhroni brskalniški `FileReader`; ni nadomestljiv v čistem vm kontekstu. |
| `finishLoad` / funkcije za posodobitev DOM | Kličejo `.style`, `.innerHTML` itd. na resničnih vozliščih DOM; smiselno le v brskalniku. |
| Izvozne funkcije (`exportADIF`, `exportDARC`, `exportCSV`) | Odvisne od stanja `_all`, potrditvenih polj DOM in `Blob`/`URL.createObjectURL`. Potrebni bi bili celostni brskalniški testi (npr. Playwright). |
| `startEdit` / `restoreCell` / `commitEdit` (DOM del) | Upravljanje z dejanskimi vozlišči TD; testabilno le z jsdom ali Playwright. Logika validacije je testirana v skupini 8. |
| Razvrščanje (`sortFiltered`, `setSort`) | Odvisno od stanja `_filtered`; testabilno le s celotno nastavitvijo stanja. |
