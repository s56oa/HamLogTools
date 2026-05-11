# HamLogTools

Tools for amateur radio log processing and format conversion.

**[Slovenska različica / Slovenian version ↓](#hamlogtools-sl)**

---

## Tools

| Tool | Type | Purpose |
|---|---|---|
| [`edi2adif.html`](edi2adif.html) | Browser app | Convert REG1TEST EDI v1 contest logs to ADIF and CSV formats |
| [`edi-crosscheck.html`](edi-crosscheck.html) | Browser app | Crosscheck a new EDI log against historical logs — flags locator mismatches and callsign typos |
| [`adif-qrz-filter.js`](adif-qrz-filter.js) | Node.js CLI | Filter an ADIF log to keep only QSOs with BURO-accepting stations |

---

## EDI → ADIF Converter (`edi2adif.html`)

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

## EDI Crosscheck (`edi-crosscheck.html`)

Browser tool that compares a new EDI contest log against a statistical database built from
historical EDI logs. Helps catch locator mismatches and callsign typos before submitting the log.
Open the file in any modern browser — no installation required.

**[➜ Open edi-crosscheck.html](edi-crosscheck.html)**

### How it works

1. **Phase 1 — build database:** Drag any number of past EDI logs (1–50+) onto the tool. It builds a statistical map of which locator each callsign has historically used.
2. **Phase 2 — crosscheck:** Drag the new EDI log. Every QSO is checked against the database.

### What is flagged

| Badge | Colour | Condition |
|---|---|---|
| `LOC!` | Red | Locator differs from historical mode; mode confidence ≥ 60% and new locator was never seen before |
| `LOC?` | Amber | Locator differs from historical mode; lower confidence or new locator appeared before (operator moved) |
| `CALL?` | Amber | Callsign not in history; similar callsign found (Levenshtein distance 1–2) |
| `?` | Grey | Callsign not in history; no similar callsign found |
| `✓` | Green | Callsign in history, locator matches historical mode |

Portable and mobile suffixes (`/P`, `/M`, `/MM`, etc.) are stripped before lookup — `S59DGO/P` is matched against `S59DGO` history. The locator check requires at least 3 historical appearances for the callsign.

### How to Use

1. Download `edi-crosscheck.html` (single file, ~25 KB)
2. Open it in any modern browser (Chrome, Firefox, Edge, Safari)
3. Drag historical EDI logs onto the first drop zone — the database builds instantly
4. Drag the new EDI log onto the second drop zone
5. Review the results table — filter by "flagged only" or search by callsign

No internet connection required. All processing is local in your browser.

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

# ADIF QRZ BURO filter
node --test --test-reporter=spec adif-qrz-filter.test.js
```

| Test file | Tests | Groups |
|---|---|---|
| `edi2adif.test.js` | 120 | 9 (`normBand`, `parseEDI`, `adifField`, `csvEsc`, `modeBadge`, i18n, duplicates, CSV export, inline edit) |
| `edi-crosscheck.test.js` | 41 | 5 (`baseCall`, `levenshtein`, `parseEDI`, `runCrosscheck` locator ×6, `runCrosscheck` callsign ×8) |
| `adif-qrz-filter.test.js` | 48 | 4 (`parseAdif`, `extractField`, `usesQslBuro` ×3, `cache`) |

See [TESTING.md](TESTING.md) for full test documentation.

---

## Planned Improvements

See [Improvements.md](Improvements.md) for the full bug history and feature roadmap.

---

## License

MIT

---
---

# HamLogTools [SL]

Orodja za obdelavo in pretvorbo formatov radioamaterskih dnevnikov.

---

## Orodja

| Orodje | Vrsta | Namen |
|---|---|---|
| [`edi2adif.html`](edi2adif.html) | Brskalniška app | Pretvorba REG1TEST EDI v1 tekmovalnih dnevnikov v ADIF in CSV formate |
| [`edi-crosscheck.html`](edi-crosscheck.html) | Brskalniška app | Crosscheck novega EDI dnevnika glede na zgodovinske dnevnike — zaznava napake lokatorjev in klicnih znakov |
| [`adif-qrz-filter.js`](adif-qrz-filter.js) | Node.js CLI | Filtriranje ADIF dnevnika — ohrani samo zveze s postajami, ki sprejemajo biro |

---

## EDI → ADIF Converter (`edi2adif.html`)

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

## EDI Crosscheck (`edi-crosscheck.html`)

Brskalniško orodje, ki primerja nov EDI tekmovalni dnevnik z bazo, zgrajeno iz zgodovinskih EDI dnevnikov.
Pomaga odkriti verjetne napake v lokatorjih in klicnih znakih pred oddajo dnevnika.
Datoteko odpri v katerem koli sodobnem brskalniku — namestitev ni potrebna.

**[➜ Odpri edi-crosscheck.html](edi-crosscheck.html)**

### Kako deluje

1. **Faza 1 — zgradi bazo:** Na orodje povleci poljubno število preteklih EDI dnevnikov (1–50+). Orodje zgradi statistično mapo, kateri lokator je kateri klicni znak zgodovinsko uporabljal.
2. **Faza 2 — crosscheck:** Povleci nov EDI dnevnik. Vsaka zveza se preveri glede na bazo.

### Kaj se zaznava

| Oznaka | Barva | Pogoj |
|---|---|---|
| `LOC!` | Rdeča | Lokator se razlikuje od zgodovinskega modusa; zaupanje v modus ≥ 60% in nov lokator še nikoli ni bil viden |
| `LOC?` | Rumena | Lokator se razlikuje od zgodovinskega modusa; nižje zaupanje ali nov lokator je bil že viden (prenosna postaja) |
| `CALL?` | Rumena | Klicni znak ni v zgodovini; najden je podoben klicni znak (Levenshteinova razdalja 1–2) |
| `?` | Siva | Klicni znak ni v zgodovini; ni podobnega klicnega znaka |
| `✓` | Zelena | Klicni znak je v zgodovini, lokator ustreza modusu |

Prenosne in mobilne pripone (`/P`, `/M`, `/MM` itd.) so odstranjene pred iskanjem — `S59DGO/P` se primerja z zgodovino `S59DGO`. Preverjanje lokatorja zahteva vsaj 3 zgodovinska pojavitev klicnega znaka.

### Navodila za uporabo

1. Prenesi `edi-crosscheck.html` (ena datoteka, ~25 KB)
2. Odpri jo v katerem koli sodobnem brskalniku (Chrome, Firefox, Edge, Safari)
3. Povleci zgodovinske EDI dnevnike na prvo območje za spuščanje — baza se zgradi takoj
4. Povleci nov EDI dnevnik na drugo območje za spuščanje
5. Preglej tabelo rezultatov — filtriraj po "samo označeni" ali išči po klicnem znaku

Internetna povezava ni potrebna. Vsa obdelava poteka lokalno v brskalniku.

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

# ADIF QRZ BURO filter
node --test --test-reporter=spec adif-qrz-filter.test.js
```

| Testna datoteka | Testov | Skupin |
|---|---|---|
| `edi2adif.test.js` | 120 | 9 (`normBand`, `parseEDI`, `adifField`, `csvEsc`, `modeBadge`, i18n, duplikati, CSV izvoz, urejanje v živo) |
| `edi-crosscheck.test.js` | 41 | 5 (`baseCall`, `levenshtein`, `parseEDI`, `runCrosscheck` lokator ×6, `runCrosscheck` klicni znak ×8) |
| `adif-qrz-filter.test.js` | 48 | 4 (`parseAdif`, `extractField`, `usesQslBuro` ×3, `cache`) |

Celotna dokumentacija je v [TESTING.md](TESTING.md).

---

## Načrtovane izboljšave

Polna zgodovina hroščev in načrt prihodnjih funkcionalnosti je v [Improvements.md](Improvements.md).

---

## Licenca

MIT
