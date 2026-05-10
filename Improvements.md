# Improvements & Code Review — edi2adif.html

*[Slovenska različica / Slovenian version below](#izboljšave--pregled-kode--edi2adifhtml)*

---

## Code Review: Bugs & Issues

### Critical (fixed)

1. **Dead variable `dt` in `exportDARC()`**
   `dt` was computed but never used; `dateTime` was the variable actually inserted into the CSV. The dead line was removed.

2. **`_sel` Set was always empty**
   `_sel` was declared and cleared in `resetApp()` but never populated. The expression `!_sel.has(q._bandKey)||true` always evaluated to `true`. The variable `isSelected` was also computed and then never used. Both were removed.

3. **Sort by `#` column was broken**
   `COL_KEYS[0]` was `'_idx'` but no QSO object had an `_idx` property — values were always `undefined`. Sorting the `#` column had no effect. Fixed by assigning `q._idx = i` to every QSO in `finishLoad()`.

4. **`URL.createObjectURL` memory leak**
   The Blob URL was never revoked after download. Fixed by adding `setTimeout(()=>URL.revokeObjectURL(a.href), 0)` in `dl()`.

5. **`FREQ` ADIF field used a hardcoded nominal frequency**
   The value (e.g. `144.3`) was a band-centre constant, not the actual operating frequency. EDI does not store operating frequency precisely. The field was removed; `BAND` is sufficient for all downstream tools.

### Minor (fixed)

6. **`rebuildTable()` was a one-liner wrapper**
   Only called `renderTable()`. Removed; all callers now call `renderTable()` directly.

7. **Band column used the same badge colour as the Mode column**
   `mBadge` (computed from mode) was applied to both the band cell and the mode cell, giving them identical colouring. A new neutral CSS class `badge-band` was added for the band column.

8. **Global `drop` handler suppressed all drag-over events**
   The document-level `dragover` listener called `preventDefault()` unconditionally, interfering with text-selection drags. Handler now checks `e.dataTransfer.types.includes('Files')` before preventing default, and the `drop` handler returns early if no files are present.

9. **XSS: raw QSO fields inserted directly into innerHTML**
   Callsigns, filenames, locators, and other user-supplied strings were interpolated into HTML without escaping. Added `htmlEsc()` helper (escapes `&`, `<`, `>`, `"`) applied in `renderTable()`, `restoreCell()`, and `rebuildFileTags()`.

10. **`updateExportCount()` did not exclude duplicates**
    The export-count badge showed the total number of selected rows regardless of dupe status, diverging from `getExportPool()` which always excludes dupes. Fixed to use the same pool logic.

11. **`toggleAll(false)` only deselected visible (filtered) rows**
    Deselecting all added only `_filtered` QSO band-keys to `_desel`. After changing a filter, previously deselected rows outside the view reappeared selected. Fixed to iterate `_all` instead.

12. **`commitEdit()` silently ignored invalid input**
    Rejected date, time, callsign, and locator values were discarded without any user feedback. Added `showToast()` calls for each rejected case using i18n keys `errDate`, `errTime`, `errCall`, `errLoc`.

---

## Bug Fixes — Session 2026-05-09/10

13. **Mode mapping was wrong (3=FM, 6=SSB, 7=CW)**
    The EDI mode table was incorrect. Corrected to `1=SSB, 2=CW, 3=CW, 4=SSB, 5=AM, 6=FM, 7=RTTY, 8=SSTV, 9=ATV` per the adi2edi Rust tool and M1GEO+DH5YM Python tool. Mode dropdown in inline edit extended to include AM, RTTY, SSTV, ATV.

14. **Received locator stored fully uppercase**
    Maidenhead convention requires first 4 chars uppercase + chars 5–6 lowercase (e.g. `JN65ar`). Some tools reject all-uppercase 6-char locators. Fixed in `parseEDI()` and in inline edit `commitEdit()`. My locator (`myLoc`) remains fully uppercase.

15. **qslshop.de ADIF export rejected by qslshop.de**
    The existing DARC-derived export had: `ADIF_VER` (not `ADIF_VERS`), trailing spaces between fields, CRLF line endings, and decimal FREQ values. Rewrote `exportQSLShop()` to match the reference file format: `<ADIF_VERS:3>3.1` header, no inter-field spaces, LF-only endings, integer FREQ (`Math.round`), `TIME_OFF` equal to `TIME_ON`, and `RST_RCVD` included.

16. **ADIF field names non-standard**
    `MY_CALL` is not a valid ADIF 3.1.7 field; replaced with `STATION_CALLSIGN`. `CONTEST_ID` is an enumerated ADIF field requiring a specific value from the spec; replaced with `APP_EDIADIF_CONTEST` (application-defined field) for free-text contest names.

---

## Proposed New Features

### High Priority

#### ~~1. CSV / spreadsheet export~~ ✓ implemented
~~Export a generic CSV with all parsed fields (serial numbers, exchange, locator, distance) for import into spreadsheet applications or further analysis.~~

#### 2. Log statistics panel
Show a summary after loading: total QSOs per band/mode, unique callsigns worked, total distance, best DX, locator square coverage.

#### ~~3. Editable QSO fields~~ ✓ implemented
~~Allow clicking a cell (RST, locator, mode) to edit it before export — useful for correcting obvious logging errors without going back to the original software.~~

#### 4. Per-file header inspector
A collapsible panel showing the parsed EDI header fields for each loaded file (operator, contest, club, antenna, power) — useful for verifying correct file selection before export.

#### 5. Duplicate resolution UI
Currently duplicates are auto-flagged but the user cannot choose which copy to keep. Add a "resolve duplicates" view that shows both copies side by side.

### Medium Priority

#### 6. Cabrillo export
Cabrillo format is required for many contest submissions. Generate a Cabrillo file from the loaded EDI data.

#### 7. SOTA / POTA CSV export
Dedicated export for SOTA and POTA activation CSV formats, which have their own field requirements.

#### 8. Locator map visualization
Render worked squares on a Maidenhead grid map using Canvas or SVG. Show the operator's own square highlighted.

#### 9. Callsign lookup / enrichment
Optional integration with a public callsign API (HamDB) to enrich records with operator name and country before export.

#### 10. QSO time-proximity conflict detection
Flag QSOs where the same callsign was worked within a configurable time window on the same band (possible bust or log error), distinct from exact duplicates.

#### 11. Multi-file merge duplicate report
When merging multiple EDI files, show a dedicated report listing all cross-file duplicates with source filenames.

### Lower Priority

#### ~~12. Dark/light theme toggle~~ ✓ implemented
~~The current dark theme is hardcoded. A light mode option would improve readability in bright environments.~~

#### 13. Persistent settings via `localStorage`
Remember language preference, column sort state, and "hide duplicates" toggle between sessions.

#### 14. Keyboard navigation
Arrow keys to navigate rows, Enter to toggle selection, `E` to trigger export.

#### 15. Clipboard paste input
Allow pasting EDI file content directly as an alternative to drag-and-drop — useful when only the file content can be copied from a remote machine.

#### 16. Additional tool: ADIF merge/dedup
A standalone tool to merge multiple ADIF files, deduplicate QSOs, and re-export.

#### 17. Additional tool: EDI validator / linter
Parse an EDI file and report structural errors, missing mandatory fields, impossible times, invalid locators.

#### 18. PWA / offline support
Add a Service Worker and `manifest.json` so the tool can be installed and used fully offline — relevant for field day and portable operation where internet access is limited.

---
---

# Izboljšave & Pregled kode — edi2adif.html

## Pregled kode: Hrošči in težave

### Kritično (popravljeno)

1. **Mrtva spremenljivka `dt` v `exportDARC()`**
   `dt` je bila izračunana, a nikoli uporabljena; v CSV je bila dejansko vstavljena spremenljivka `dateTime`. Mrtva vrstica je bila odstranjena.

2. **Množica `_sel` je bila vedno prazna**
   `_sel` je bila deklarirana in čiščena v `resetApp()`, a nikoli polnjena. Izraz `!_sel.has(q._bandKey)||true` je vedno vrnil `true`. Spremenljivka `isSelected` je bila prav tako izračunana in nikoli uporabljena. Obe sta bili odstranjeni.

3. **Razvrščanje po stolpcu `#` ni delovalo**
   `COL_KEYS[0]` je bil `'_idx'`, vendar noben objekt QSO ni imel lastnosti `_idx` — vrednosti so bile vedno `undefined`. Razvrščanje po stolpcu `#` ni imelo učinka. Popravljeno z dodelitvijo `q._idx = i` vsakemu QSO v `finishLoad()`.

4. **Uhajanje pomnilnika pri `URL.createObjectURL`**
   URL bloba po prenosu ni bil nikoli sproščen. Popravljeno z dodajanjem `setTimeout(()=>URL.revokeObjectURL(a.href), 0)` v `dl()`.

5. **Polje ADIF `FREQ` je uporabljalo trdo kodirano nominalno frekvenco**
   Vrednost (npr. `144.3`) je bila konstanta sredine pasu, ne dejanska delovna frekvenca. EDI natančne delovne frekvence ne shranjuje. Polje je bilo odstranjeno; za vsa orodja zadostuje `BAND`.

### Manjše (popravljeno)

6. **`rebuildTable()` je bil enolinijski ovoj**
   Klical je le `renderTable()`. Odstranjen; vsi klicatelji zdaj kličejo `renderTable()` neposredno.

7. **Stolpec Band je imel enako barvo značke kot stolpec Mode**
   `mBadge` (izračunan iz načina) je bil uporabljen tako za celico pasu kot za celico načina, kar je dalo obema enako barvno kodiranje. Za stolpec pasu je bil dodan nov nevtralen razred CSS `badge-band`.

8. **Globalni obravnavalnik `drop` je zaustavljal vse drag-over dogodke**
   Listener `dragover` na ravni dokumenta je brezpogojno klical `preventDefault()`, kar je motilo vlečenje za izbiro besedila. Obravnavalnik zdaj preveri `e.dataTransfer.types.includes('Files')` pred preprečitvijo privzetega vedenja, obravnavalnik `drop` pa se prezgodaj vrne, če ni prisotnih datotek.

9. **XSS: neobdelana polja QSO neposredno vstavljena v innerHTML**
   Klicni znaki, imena datotek, lokatorji in drugi nizi, ki jih vnese uporabnik, so bili interpolirani v HTML brez ubežanja. Dodan pomočnik `htmlEsc()` (ubežanje `&`, `<`, `>`, `"`) uporabljen v `renderTable()`, `restoreCell()` in `rebuildFileTags()`.

10. **`updateExportCount()` ni izključeval duplikatov**
    Znački s številom izvoznih QSO je prikazoval skupno število izbranih vrstic, ne glede na status duplikata, kar je odstopalo od `getExportPool()`, ki vedno izključuje duplikate. Popravljeno z enakim skupinskim postopkom.

11. **`toggleAll(false)` je odznačil samo vidne (filtrirane) vrstice**
    Odznačitev vsega je dodala band-ključe QSO samo iz `_filtered` v `_desel`. Po spremembi filtra so se prej odznačene vrstice zunaj pogleda znova pojavile kot izbrane. Popravljeno z iteracijo `_all`.

12. **`commitEdit()` je tiho ignoriral neveljavni vnos**
    Zavrnjene vrednosti datuma, časa, klicnega znaka in lokatorja so bile zavržene brez povratne informacije za uporabnika. Dodani klici `showToast()` za vsak zavrnjen primer z i18n ključi `errDate`, `errTime`, `errCall`, `errLoc`.

---

## Popravki hroščev — seja 2026-05-09/10

13. **Mapiranje načinov je bilo napačno (3=FM, 6=SSB, 7=CW)**
    Tabela načinov EDI je bila napačna. Popravljeno na `1=SSB, 2=CW, 3=CW, 4=SSB, 5=AM, 6=FM, 7=RTTY, 8=SSTV, 9=ATV` skladno z orodjema adi2edi (Rust) in M1GEO+DH5YM (Python). Spustni meni v urejanju v živo razširjen z AM, RTTY, SSTV, ATV.

14. **Prejeti lokator shranjen v celoti z velikimi črkami**
    Maidenhead konvencija zahteva prve 4 znake z velikimi + znaka 5–6 z malimi (npr. `JN65ar`). Nekatera orodja zavrnejo 6-znakovne lokatorje z vsemi velikimi črkami. Popravljeno v `parseEDI()` in v urejanju v živo `commitEdit()`. Moj lokator (`myLoc`) ostane v celoti z velikimi črkami.

15. **Izvoz qslshop.de ADIF je bil zavrnjen pri qslshop.de**
    Obstoječi izvoz je imel: `ADIF_VER` (ne `ADIF_VERS`), presledke med polji, zaključke CRLF in decimalne vrednosti FREQ. `exportQSLShop()` je bil prepisano skladno z referenčno datoteko: glava `<ADIF_VERS:3>3.1`, brez presledkov med polji, zaključki LF, celo število FREQ (`Math.round`), `TIME_OFF` enak `TIME_ON` in vključen `RST_RCVD`.

16. **Imena polj ADIF nestandardna**
    `MY_CALL` ni veljavno polje ADIF 3.1.7; nadomeščeno z `STATION_CALLSIGN`. `CONTEST_ID` je naštevano polje ADIF z zahtevano specifično vrednostjo iz specifikacije; nadomeščeno z `APP_EDIADIF_CONTEST` (polje, ki ga definira aplikacija) za prosto-tekstovna imena tekmovanj.

---

## Predlagane nove funkcionalnosti

### Visoka prioriteta

#### ~~1. Izvoz CSV / preglednica~~ ✓ implementirano
~~Izvoz generičnega CSV z vsemi razčlenjenimi polji (serijske številke, izmenjava, lokator, razdalja) za uvoz v pregledničarje ali nadaljnjo analizo.~~

#### 2. Statistični panel dnevnika
Prikaz povzetka po nalaganju: skupaj QSO po pasu/načinu, edinstveni klicni znaki, skupna razdalja, najboljši DX, pokritost kvadrantov lokatorja.

#### ~~3. Urejevanje polj QSO~~ ✓ implementirano
~~Možnost klika na celico (RST, lokator, način) za urejanje pred izvozom — koristno za popravljanje očitnih napak beleženja brez vračanja v izvirno programsko opremo.~~

#### 4. Pregledovalnik glave za vsako datoteko
Zložljiva plošča s prikazom razčlenjenih polj glave EDI za vsako naloženo datoteko (operater, tekmovanje, klub, antena, moč) — koristno za preverjanje pravilnega izbora datoteke pred izvozom.

#### 5. Vmesnik za razreševanje duplikatov
Duplikati so trenutno avtomatično označeni, a uporabnik ne more izbrati, katero kopijo ohraniti. Dodaj pogled "razreši duplikate", ki pokaže obe kopiji vzporedno.

### Srednja prioriteta

#### 6. Izvoz Cabrillo
Format Cabrillo je zahtevan za številne tekmovalne oddaje. Generiraj datoteko Cabrillo iz naloženih EDI podatkov.

#### 7. Izvoz CSV za SOTA / POTA
Namenski izvoz za aktivacijske formate CSV SOTA in POTA, ki imata lastne zahteve po poljih.

#### 8. Vizualizacija karte lokatorjev
Prikaži delane kvadrante na Maidenhead mreži z uporabo Canvas ali SVG. Označi operaterjev lastni kvadrant.

#### 9. Iskanje / obogatitev klicnih znakov
Neobvezna integracija z javnim API-jem za klicne znake (HamDB) za obogatitev zapisov z imenom operaterja in državo pred izvozom.

#### 10. Zaznavanje konfliktov QSO v časovni bližini
Označi QSO-je, kjer je bil isti klicni znak delان v nastavljenem časovnem oknu na istem pasu (možna napaka ali napačen zapis), ločeno od točnih duplikatov.

#### 11. Poročilo o duplikatih pri spajanju več datotek
Pri spajanju več EDI datotek prikaži namenska poročilo z vsemi medDatotečnimi duplikati in imeni izvornih datotek.

### Nizka prioriteta

#### ~~12. Preklop med temno/svetlo temo~~ ✓ implementirano
~~Trenutna temna tema je trdo kodirana. Svetla možnost bi izboljšala berljivost v svetlih okoljih.~~

#### 13. Trajne nastavitve prek `localStorage`
Zapomni si jezikovne nastavitve, stanje razvrščanja stolpcev in preklop "skrij duplikate" med sejami.

#### 14. Navigacija s tipkovnico
Puščične tipke za navigacijo po vrsticah, Enter za preklop izbire, `E` za sprožitev izvoza.

#### 15. Vnos z lepljenjem iz odložišča
Dovoli lepljenje vsebine EDI datoteke neposredno kot alternativo povleci-in-spusti — koristno, ko je mogoče kopirati le vsebino datoteke z oddaljenega računalnika.

#### 16. Dodatno orodje: Spajanje/deduplikacija ADIF
Samostojno orodje za spajanje več ADIF datotek, odstranjevanje duplikatov QSO in ponovni izvoz.

#### 17. Dodatno orodje: Validator/linter EDI
Razčleni EDI datoteko in poroča o strukturnih napakah, manjkajočih obveznih poljih, nemogočih časih, neveljavnih lokatorjih.

#### 18. PWA / podpora brez povezave
Dodaj Service Worker in `manifest.json`, da je orodje mogoče namestiti in uporabljati popolnoma brez interneta — relevantno za terensko delovanje in prenosno delovanje, kjer je dostop do interneta omejen.
