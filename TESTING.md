# Testing — HamLogTools

*[Slovenska različica / Slovenian version ↓](#testiranje--hamlogtools-sl)*

---

## Overview

The test suite covers the pure business-logic functions of `edi2adif.html`.
All tests run in Node.js using the built-in `node:test` runner — no external
dependencies required.

**Test file:** `edi2adif.test.js`
**Tests:** 109 across 8 test groups

---

## Running the tests

```bash
# Quick run (compact output)
node --test edi2adif.test.js

# Full spec output (group tree, timing)
node --test --test-reporter=spec edi2adif.test.js
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

### 4 · `csvEsc` (8 tests)
Verifies CSV escaping for DARC QSL export.

- Plain strings returned unchanged.
- Strings containing a comma or double-quote are wrapped in double-quotes.
- Embedded double-quotes are doubled (`"` → `""`).
- `null` and `undefined` coerced to `''`; numbers coerced to string.

### 5 · `i18n` (5 tests)
Verifies the translation lookup function `t(key)` and `setLang(lang)`.

- Default language is Slovenian (`sl`).
- Switching to `en` and back to `sl` works correctly.
- Unknown keys return the key string itself (safe fallback).

### 6 · Duplicate detection (6 tests)
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

### 7 · CSV export row format (9 tests)
Verifies the row-generation logic for the generic CSV export.

- Header has exactly 19 columns; each data row has the same column count.
- Row number is the first column.
- Serial numbers (`stx`, `srx`) have leading zeros stripped (`001` → `1`).
- Missing optional fields (exchange, locator, power, etc.) produce empty columns.
- Contest names containing commas are wrapped in double-quotes by `csvEsc`.
- Distance `0` is treated as absent and produces an empty cell; distance `> 0` is kept.

### 8 · Inline edit — field mutation (11 tests)
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
| Export functions (`exportADIF`, `exportLoTW`, `exportDARC`) | Depend on `_all` state, DOM checkboxes, and `Blob`/`URL.createObjectURL`. End-to-end browser tests (e.g. Playwright) would be needed. |
| Sorting (`sortFiltered`, `setSort`) | Depends on `_filtered` state; testable only with a full state setup. |

---
---

# Testiranje — HamLogTools [SL]

## Pregled

Testna zbirka pokriva čiste funkcije poslovne logike v `edi2adif.html`.
Vsi testi tečejo v Node.js z vgrajenim izvajalcem `node:test` — brez
zunanjih odvisnosti.

**Testna datoteka:** `edi2adif.test.js`
**Testov:** 109 v 8 skupinah

---

## Zaganjanje testov

```bash
# Hiter zagon (strnjeni izpis)
node --test edi2adif.test.js

# Celoten spec izpis (drevo skupin, časi)
node --test --test-reporter=spec edi2adif.test.js
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

### 4 · `csvEsc` (8 testov)
Preverja ubežanje CSV za izvoz DARC QSL.

- Navadni nizi vrnjeni nespremenjeni.
- Nizi z vejico ali dvojnimi narekovaji so zaviti v dvojne narekovaje.
- Vdelani dvojni narekovaji se podvojijo (`"` → `""`).
- `null` in `undefined` pretvorjeni v `''`; števila pretvorjena v niz.

### 5 · `i18n` (5 testov)
Preverja funkcijo za iskanje prevodov `t(ključ)` in `setLang(jezik)`.

- Privzeti jezik je slovenščina (`sl`).
- Preklop na `en` in nazaj na `sl` deluje pravilno.
- Neznani ključi vrnejo sam ključ (varna rezervna vrednost).

### 6 · Zaznavanje duplikatov (6 testov)
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

### 7 · Format vrstice CSV izvoza (9 testov)
Preverja logiko generiranja vrstic za generični CSV izvoz.

- Glava ima natanko 19 stolpcev; vsaka vrstica s podatki ima enako število stolpcev.
- Zaporedna številka vrstice je v prvem stolpcu.
- Serijske številke (`stx`, `srx`) imajo odstranjene vodilne ničle (`001` → `1`).
- Manjkajoča neobvezna polja (izmenjava, lokator, moč itd.) ustvarijo prazne stolpce.
- Imena tekmovanj z vejicami so zavita v dvojne narekovaje prek `csvEsc`.
- Razdalja `0` je obravnavana kot odsotna in ustvari prazno celico; razdalja `> 0` je ohranjena.

### 8 · Urejanje v živo — mutacija polj (11 testov)
Preverja logiko shranjevanja iz `commitEdit()`.

`startEdit`/`commitEdit` manipulirata z resničnimi vozlišči DOM in ju ni mogoče
izvajati iz vm konteksta brez polnih brskalniških API-jev. Logika mutacije
je reimplementirana neposredno in testirana v izolaciji.

| Podskupina | Kaj se preverja |
|---|---|
| Osnovna polja | `rstS`, `rstR` in `mode` so obrezani in shranjeni neposredno v objekt QSO. |
| Validacija lokatorja | Veljavna 6-znakovna Maidenhead mreža (A–R, 0–9, A–X) se shrani z mešanimi črkami (prvi 4 z velikimi, zadnja 2 z malimi; npr. `JN65ar`). 4-znakovni, 8-znakovni, znaki zunaj Maidenhead, prvi par S–Z in nečiselni srednji par so zavrnjeni in `wwl` se postavi na `''`. |

---

## Kaj ni testirano

| Področje | Razlog |
|---|---|
| `handleFiles` | Zahteva asinhroni brskalniški `FileReader`; ni nadomestljiv v čistem vm kontekstu. |
| `finishLoad` / funkcije za posodobitev DOM | Kličejo `.style`, `.innerHTML` itd. na resničnih vozliščih DOM; smiselno le v brskalniku. |
| Izvozne funkcije (`exportADIF`, `exportLoTW`, `exportDARC`, `exportCSV`) | Odvisne od stanja `_all`, potrditvenih polj DOM in `Blob`/`URL.createObjectURL`. Potrebni bi bili celostni brskalniški testi (npr. Playwright). |
| `startEdit` / `restoreCell` / `commitEdit` (DOM del) | Upravljanje z dejanskimi vozlišči TD; testabilno le z jsdom ali Playwright. Logika validacije je testirana v skupini 8. |
| Razvrščanje (`sortFiltered`, `setSort`) | Odvisno od stanja `_filtered`; testabilno le s celotno nastavitvijo stanja. |
