# HamLogTools

Browser-based tools for amateur radio log processing and format conversion.
No installation, no server, no data leaves your computer.

**[Slovenska različica / Slovenian version ↓](#hamlogtools-sl)**

---

## Tools

### EDI → ADIF Converter (`edi2adif.html`)

Converts [REG1TEST EDI v1](http://www.edi.kkn.net/) contest logs to ADIF and other formats.
Open the file in any modern browser — that's all it takes.

**[➜ Open edi2adif.html](edi2adif.html)**

---

## Features

- **Drag & drop** one or more `.edi` files simultaneously
- **Preview table** with sorting by any column and live search by callsign
- **Filters** by band, mode, and source file
- **Duplicate detection** — cross-file duplicates flagged automatically (same call + date + time + band); hide them with one click
- **Row selection** — cherry-pick QSOs to include in the export
- **Five export formats:**
  - **ADIF** — full export with all available fields (call, date/time, band, mode, RST sent/received, serial numbers, locator, distance, my callsign, my locator, power, contest name, operators, equipment)
  - **LoTW ADIF** — trimmed to the fields required by Logbook of the World
  - **DARC QSL CSV** — for the DARC QSL bureau online service
  - **qslshop.de ADIF** — compatible with the qslshop.de online QSL printing service
  - **Generic CSV** — 19 columns with all parsed fields, for spreadsheet import or further analysis
- **Bilingual UI** — Slovenian and English

---

## Supported Bands

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

---

## How to Use

1. Download `edi2adif.html` (single file, ~25 KB)
2. Open it in any modern browser (Chrome, Firefox, Edge, Safari)
3. Drag one or more `.edi` files onto the drop zone, or click **Choose files**
4. Review the QSO table — sort columns, filter, search, hide duplicates
5. Optionally select specific rows for export
6. Click the desired export button

No internet connection required after the page loads (except for Google Fonts).

---

## Privacy

All processing happens entirely in your browser using the JavaScript File API.
No files or QSO data are uploaded anywhere.

---

## Tests

Business-logic unit tests run in Node.js (v18+), no extra dependencies:

```bash
node --test --test-reporter=spec edi2adif.test.js
```

109 tests · 8 groups: `normBand`, `parseEDI`, `adifField`, `csvEsc`, i18n, duplicate detection.
See [TESTING.md](TESTING.md) for full documentation.

---

## Planned Improvements

See [Improvements.md](Improvements.md) for the full bug history and roadmap of planned features (CSV export, statistics panel, Cabrillo export, locator map, PWA/offline support, and more).

---

## License

MIT

---
---

# HamLogTools [SL]

Brskalniška orodja za obdelavo in pretvorbo formatov radioamaterskih dnevnikov.
Brez namestitve, brez strežnika, podatki ne zapustijo vašega računalnika.

---

## Orodja

### EDI → ADIF Converter (`edi2adif.html`)

Pretvori [REG1TEST EDI v1](http://www.edi.kkn.net/) tekmovalne dnevnike v format ADIF in druge formate.
Datoteko odpri v katerem koli sodobnem brskalniku — to je vse.

**[➜ Odpri edi2adif.html](edi2adif.html)**

---

## Funkcionalnosti

- **Povleci in spusti** eno ali več `.edi` datotek hkrati
- **Tabela za predogled** z razvrščanjem po katerem koli stolpcu in iskanjem v živo po klicnem znaku
- **Filtri** po pasu, načinu in izvorni datoteki
- **Zaznavanje duplikatov** — medDatotečni duplikati so samodejno označeni (enak klicni znak + datum + čas + pas); z enim klikom jih skriješ
- **Izbor vrstic** — ročno izberi QSO-je, ki jih vključiš v izvoz
- **Pet izvoznih formatov:**
  - **ADIF** — celoten izvoz z vsemi razpoložljivimi polji (klicni znak, datum/čas, pas, način, RST oddano/sprejeto, serijske številke, lokator, razdalja, moj klicni znak, moj lokator, moč, ime tekmovanja, operaterji, oprema)
  - **LoTW ADIF** — okrnjen na polja, ki jih zahteva Logbook of the World
  - **DARC QSL CSV** — za spletno storitev QSL urada DARC
  - **qslshop.de ADIF** — združljiv s spletno storitvijo tiskanja QSL qslshop.de
  - **Splošni CSV** — 19 stolpcev z vsemi razčlenjenimi polji, za uvoz v pregledničarje ali nadaljnjo analizo
- **Dvojezični vmesnik** — slovenščina in angleščina

---

## Podprti pasovi

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

---

## Navodila za uporabo

1. Prenesi `edi2adif.html` (ena datoteka, ~25 KB)
2. Odpri jo v katerem koli sodobnem brskalniku (Chrome, Firefox, Edge, Safari)
3. Povleci eno ali več `.edi` datotek na območje za spuščanje ali klikni **Izberi datoteke**
4. Preglej tabelo QSO — razvrščaj stolpce, filtriraj, išči, skrij duplikate
5. Po želji ročno izberi vrstice za izvoz
6. Klikni željeni gumb za izvoz

Po nalaganju strani internetna povezava ni potrebna (razen za Google Fonts).

---

## Zasebnost

Vsa obdelava poteka izključno v tvojem brskalniku prek JavaScript File API.
Nobene datoteke ali podatki o zvezah niso nikamor naloženi.

---

## Testi

Enotni testi poslovne logike tečejo v Node.js (v18+), brez dodatnih odvisnosti:

```bash
node --test --test-reporter=spec edi2adif.test.js
```

109 testov · 8 skupin: `normBand`, `parseEDI`, `adifField`, `csvEsc`, i18n, zaznavanje duplikatov.
Celotna dokumentacija je v [TESTING.md](TESTING.md).

---

## Načrtovane izboljšave

Polna zgodovina hroščev in načrt prihodnjih funkcionalnosti (izvoz CSV, statistični panel, izvoz Cabrillo, karta lokatorjev, podpora PWA/brez povezave in še več) je v [Improvements.md](Improvements.md).

---

## Licenca

MIT
