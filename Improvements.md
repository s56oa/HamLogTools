# Izboljšave — HamLogTools

*Datum pregleda: 2026-05-15 · Različica: v1.8*

Dokument zajema odprte predloge izboljšav za vsa orodja projekta. Gre samo naprej — brez zgodovine opravljenih popravkov.

---

## 1. edi2adif.html

### Visoka prioriteta

**1.1 Statistični panel**
Po nalaganju prikaži povzetek: skupaj QSO po pasu/načinu, unikatni klicni znaki, skupna razdalja, najboljši DX, pokritost kvadrantov lokatorja. Brez sprememb podatkovnega modela — vse iz obstoječega `_all[]`.

**1.2 Pregled glave EDI**
Zložljiva plošča z razčlenjenimi polji glave za vsako naloženo datoteko (operator, tekmovanje, klub, antena, moč). Koristno za preverjanje pred izvozom, da je bila izbrana prava datoteka.

**1.3 Cabrillo izvoz**
Format Cabrillo je zahtevan za nekatere tekmovalne oddaje. Osnovna implementacija za IARU R1 VKV tekmovanje je ~50–80 vrstic; format je fiksen in dokumentiran.

### Srednja prioriteta

**1.4 Razreševanje duplikatov**
Duplikati so samodejno označeni, a uporabnik ne more izbrati, katero kopijo ohraniti. Pogled »reši duplikate« bi pokazal obe kopiji vzporedno z možnostjo ročne izbire.

**1.5 Vizualizacija karte lokatorjev**
Prikaži delane kvadrante na Maidenhead mreži (Canvas ali SVG). Funkciji `locToLatLon` in `haversine` sta implementirani v `vhf-logger.html` — portabilni brez predelave.

**1.6 Vnos iz odložišča**
Dovoli lepljenje vsebine EDI datoteke neposredno v polje namesto povleci-in-spusti — koristno pri oddaljenih strojih ali kopiranju iz e-pošte.

### Nizka prioriteta

**1.7 Izvoz za SOTA/POTA**
Namenski CSV format za SOTA in POTA aktivacijo s specifičnimi zahtevami po poljih.

**1.8 Trajne nastavitve**
Zapomni si jezikovno nastavitev in stanje razvrščanja stolpcev v `localStorage` med sejami brskalnika.

**1.9 Navigacija s tipkovnico**
Puščične tipke za navigacijo po vrsticah, Enter za preklop izbire, `E` za sprožitev izvoza.

---

## 2. edi-crosscheck.html

Orodje pokriva statistični crosscheck (LOC_MISMATCH, LOC_MISSING, CALL_SIMILAR, CALL_BY_LOC, CALL_UNKNOWN) z možnostjo nastavljanja pragov. Naslednje predloge so razvrščene po potrebnih vhodnih podatkih.

### Razred A — razširitve obstoječe statistike (brez novih virov)

**A1. Band-aware modus lokatorja** *(visoka prioriteta)*
Trenutna agregacija lokatorjev poteka čez vse pasove skupaj. Postaja, fiksna na 2m, je pogosto portable na 6m — to povzroča lažne pozitivne pri LOC_MISMATCH. Rešitev: `Map<call → Map<band → {locators, total}>>`. Per-band modus kot primarni; agregat čez vse pasove kot fallback, ko je per-band premalo zapisov. Ocena: ~30–50 vrstic JS + razširitev `_histDB`.

**A2. Suffix-aware lokator** *(visoka prioriteta)*
`/P` in `/M` zveze imajo legitimno drug lokator od fiksnega QTH in povzročajo flood LOC_MISMATCH opozoril. Rešitev: ohrani `q.suffix` v parserju; za `/P`/`/M` zniži resnost na `info` ali preskoči; za `/MM` lokator sploh ne preverja. V zgodovinski statistiki ločeno beleži fiksne in portable zveze. Ocena: ~20 vrstic.

**A3. Self-QSO check** *(visoka prioriteta)*
Operator je morda zalogiral samega sebe (testni QSO, tipkarska napaka lastnega znaka). Preberi `PCall` iz header; če `baseCall(q.call) === baseCall(PCall)`, označi `SELF_QSO` resnost `high`. Trivialno, a ujame realne napake. Ocena: ~10 vrstic.

**A4. Kronološka validacija** *(visoka prioriteta)*
Časi QSO niso preverjeni. `TIME_BACKWARDS`: če `time[i] < time[i-1] − 5 min` (toleranca za sočasne zveze) → resnost `med`. `TIME_OUTSIDE_WINDOW`: log, ki obsega > 48 ur, je sumljiv za večino VKV tekmovanj. Parser mora prebrati `time` iz stolpca 1 — trenutno se ne bere. Ocena: ~30 vrstic + razširitev parserja.

**A5. Header validacija** *(visoka prioriteta)*
`PCall`, `PWWLo`, `PBand`, `PSect` — vsako manjkajoče pomeni formalno neveljaven log za robota. Validacija:
- `PCall`: ITU pattern `^[A-Z0-9]{1,3}[0-9][A-Z0-9]*[A-Z]$`
- `PWWLo`: 6-znakovni Maidenhead, regex
- `PBand`: ujemanje z `BAND_MAP`
- `PSect`: neprazen niz

Prikaži ločen **panel »Težave v glavi«** nad QSO tabelo — ločeno od QSO crosschecka, ker so to strukturne napake, ne statistične. Ocena: ~40 vrstic.

**A6. Razdalja QRB: interna doslednost** *(srednja prioriteta)*
EDI stolpec 10 = razdalja v km, ki jo operator deklarira. Izračunaj iz lokatorjev (Maidenhead → haversine; funkciji sta v `vhf-logger.html`, portabilni brez sprememb). Če `|deklarirana − izračunana| > 5 % IN > 5 km` → `DIST_MISMATCH` resnost `med`; > 20 % → `high`. Brez zgodovine — samo self-consistency. Ocena: ~50 vrstic + port geo funkcij.

**A7. Notranji duplikat check** *(srednja prioriteta)*
Identifikacija duplikatov znotraj samega novega loga (`call|date|band|mode`), ne glede na EDI `dupe_flag`. Označi `DUPE_INTERNAL` resnost `med`. Opozori, kadar EDI flag in interna hevristika nista skladna (EDI trdi dupe, a ni dvojnika, ali obratno). Ocena: ~20 vrstic.

**A8. Callsign-aware Levenshtein** *(srednja prioriteta)*
Zamenjave `0↔O`, `1↔I`, `5↔S`, `2↔Z`, `8↔B` so pogoste tipkarske in slušne (CW, SSB fonetika) napake v radiu, a trenutno tehtajo enako kot katerakoli druga zamenjava. Definiraj `CONFUSION_PAIRS` s substitucijsko težo 0.4 namesto 1.0 — bolj realistični podobni predlogi z manjšim šumom. Ocena: ~25 vrstic.

**A9. Outlier filter pred modusom** *(nizka prioriteta)*
Enkraten tipkarski lokator v zgodovinski bazi (npr. JN65ab namesto JN65ax v 1 od 100 QSO) se pojavi v chip-listi kot »alternativa« in zmede uporabnika. Pred izračunom modusa odstrani lokatorje z `count == 1 AND count/total < 0.02 AND total ≥ 10`. Prikaži ločen indikator: *»X potencialnih outlierjev odstranjenih«*. Ocena: ~15 vrstic.

**A10. Time-aware modus z eksponentnim zmanjšanjem teže** *(nizka prioriteta)*
Postaje se selijo; stare zveze (5+ let) bi morale tehtati manj. Uteži: `weight = 0.85 ^ (currentYear − qsoYear)`. Faktor nastavljiv. Modus postane »centroid recentnih zapisov«. Zahteva `dateDisp` v parserju (že delno prisotno). Ocena: ~20 vrstic.

**A11. Per-call mode preference** *(nizka prioriteta)*
Nekatere postaje so izključno CW (EME, tekmovalne), druge SSB. Razširi `entry.modes: Map<mode, count>`. Nov check `MODE_UNEXPECTED` resnost `low`: historični mode-of-mode ≠ nov mode pri dovolj zaupanja. Manj kritično od lokatorja. Ocena: ~30 vrstic.

**A12. RST format check** *(nizka prioriteta)*
Stolpca RST_S in RST_R se ne bereta. Pravila: CW = 3 znaki (5NN/599), SSB/FM = 2 znaki (59). Check `RST_FORMAT` resnost `med` — formalna napaka, ki jo bo robot ujel. Zahteva razširitev parserja. Ocena: ~25 vrstic.

**A13. Konsistentnost lastnega lokatorja** *(nizka prioriteta)*
Beleži `_histOwnLocators: Map<PCall, Map<PWWLo, count>>` pri nalaganju zgodovinskih EDI datotek. Pri novem logu primerja `header.PWWLo` z modus-om iz preteklih logov. Odkriva pozabljene posodobitve QTH pri nastavljanju loggerja. Ocena: ~20 vrstic.

### Razred B — razširitve z interno tabelo (brez zunanjih klicev)

**B1. Razdalja plausibility per pas** *(srednja prioriteta)*
Interna tabela tipičnih maksimalnih dosegov po pasovih (npr. 2m = 2500 km tropo/MS, 24 GHz = 200 km). Check `DIST_IMPLAUSIBLE` resnost `med` (> max) ali `high` (> 2× max). Hevristika, ne strogo pravilo. Ocena: ~30 vrstic + tabela.

**B2. ITU prefiks → DXCC + lokator območje** *(srednja prioriteta)*
Minimalna tabela IARU R1 prefiksov z pričakovanimi Maidenhead območji (~80 vnosov: S5→JN65–76, DL→JN/JO/JP, OE→JN77–JO02 ...). Check `PREFIX_LOC_MISMATCH`: DL prefiks z JN65 lokatorjem (Slovenija) → resnost `high`. Ocena: ~50 vrstic + tabela.

**B3. Morski/oceanski lokator** *(nizka prioriteta)*
Lokatorji AA00–AA99 so v Atlantiku — neveljavni za fiksne postaje. Filter na IARU R1 »kopenske« grids. Check `LOC_OCEAN` resnost `med`. Ocena: ~20 vrstic + tabela območij.

**B4. Dovoljene kombinacije (pas, način)** *(nizka prioriteta)*
Tabela `ALLOWED_BAND_MODE` za IARU R1 (npr. FM na 6m ni tekmovalni način v večini sekcij). Check `BAND_MODE_INVALID` resnost `low`. Zahteva vzdrževanje tabele ob spremembi pravil. Ocena: ~25 vrstic + tabela.

### Znane odprte napake

- 3 napake pri renderiranju `LOC_MISSING` (chip prikaz, display polja) — zavestno nepopravljene, brez vpliva na algoritem crosschecka.

---

## 3. vhf-logger/vhf-logger.html

### Visoka prioriteta

**3.1 Cabrillo izvoz**
Cabrillo je zahtevan za nekatere IARU R1 tekmovalne oddaje poleg EDI. Osnovna implementacija za VKV tekmovanje je ~60–80 vrstic; format je fiksen in javno dokumentiran. Vzporedno z ZIP izvozom obstoječih EDI datotek.

**3.2 Iskanje/filter v tabeli QSO**
Pri večjem številu QSO (300+) je tabela neuporabna brez iskanja. Polje za hitro iskanje po klicnem znaku ali lokatorju — ni potrebna celotna filter infrastruktura iz edi2adif; zadostuje `filter()` na `_current.qsos` per band.

**3.3 Sprememba pasu obstoječega QSO**
`editQso()` ne dovoli spremembe pasu — QSO v napačnem pasu je treba zbrisati in na novo vnesti, pri čemer se izgubi serijska številka. Rešitev: v obrazcu za urejanje dodaj selektor pasu; `saveEditedQso()` premakne QSO na pravi pas, posodobi `nrS` in pokliče `recalcDupes()`.

### Srednja prioriteta

**3.4 Združevanje sej**
Ni mogoče združiti dveh sej istega tekmovanja (npr. prekinitev + nadaljevanje na drugem računalniku). EDI uvoz delno reši problem, ampak ne za vse primere. Rešitev: funkcija »Spoji z drugo sejo«, ki preveri ujemanje pasu/datuma, vstavi QSO in pokliče `recalcDupes()`.

**3.5 Vizualizacija karte lokatorjev**
Prikaži delane kvadrante na Maidenhead mreži med ali po tekmovanju. Funkciji `locToLatLon` in `haversine` sta že v kodi. Koristno za navigacijo po kvadrantih in analizo pokritosti po tekmovanju.

**3.6 Statistike: časovni histogram**
Per-band statistike kažejo skupaj QSO in QRB, ne pa kdaj so bili QSO narejeni. Histogram QSO po uri tekmovanja (0–24 h) bi razkril aktivnostne vzorce in praznine. Koristno za post-contest analizo.

**3.7 Interoperabilnost z edi2adif.html**
edi2adif ne more uvoziti ADIF — le EDI. Tok `vhf-logger → EDI → edi2adif` deluje; obratni tok (`edi2adif → vhf-logger`) ne obstaja, ker edi2adif nima EDI izvoza. Možnosti:
- Dodaj EDI izvoz per band v edi2adif (manjša sprememba)
- Ali dokumentiraj obstoječi enosmerni tok bolj jasno v README

### Nizka prioriteta

**3.8 Opomba per QSO**
Neformalno polje za opombo (npr. »slabo slišati«, »poslal URE«) — ne gre v EDI, ostane lokalno v `localStorage`. Lahek dodatek k QSO objektu brez vpliva na izvoz.

**3.9 Tiskanje / poročilo**
Gumb »Natisni dnevnik« generira print-friendly HTML s celotno tabelo QSO brez UI elementov. Brez zunanjih knjižnic — `window.print()` z `@media print` CSS.

**3.10 Razširjen frekvenčni plan**
BAND_OPTS ima eno frekvenco per pas. V setup obrazcu dodaj spustni seznam tipičnih frekvenc (SSB segment, CW segment, FM) za lažje nastavljanje brez ročnega vpisa.

---

## 4. adif-qrz-filter.js

**4.1 HamQTH kot rezervni vir**
QRZ.com zahteva plačljiv API ključ ali registracijo. HamQTH ponuja brezplačen XML API s podobnim formatom. Dodaj `--source=hamqth` parameter ali samodejni fallback ob napaki QRZ avtentikacije.

**4.2 Nastavljiv TTL predpomnilnika**
Predpomnilnik ima trdo kodiran 7-dnevni TTL. Dodaj `--cache-ttl=DAYS` parameter (privzeto 7). Omogoča daljši TTL za redko spreminjajoče se postaje.

**4.3 Ponavljanje ob napaki API**
Ob omrežni napaki ali rate-limit odgovoru (HTTP 429) orodje ne poskusi znova. Dodaj eksponentni backoff z do 3 ponovitvami pred preskočitvijo klicnega znaka.

---

## 5. build-baseline.js

**5.1 Primerjava z obstoječim baseline (`--diff`)**
Zastavica, ki primerja novo zgrajeni JSON z obstoječim `crosscheck-baseline.json` in izpiše:
- koliko novih klicnih znakov / koliko odstranjenih
- klicni znaki s spremembo modus lokatorja
- sprememba skupnega števila vnošev

Koristno pred zamenjavo produkcijskega baseline, da se oceni vpliv.

**5.2 Eksponentna časovna teža pri gradnji**
Skripta agregira vse CSV-je z enako težo ne glede na starost tekmovanja. Sinhronizacija z algoritmom A10 iz edi-crosscheck: pri gradnji uteži `entry.count` z `0.85 ^ (currentYear − contestYear)`. Starejši lokatorji dobijo manjšo težo pri izračunu modusa že pri gradnji baseline-a, ne šele v orodju.

---

## 6. Medorodna opažanja

**6.1 Podvojena crosscheck logika**
`baseCall()`, `levenshtein()`, `_histDB`, `applyBaseline()` in `lookupCall()` so skoraj identično implementirani v `edi-crosscheck.html` in `vhf-logger.html`. Popravek v enem orodju je treba ročno prenesti v drugega — potencialni vir razsinhronizacije. Ker ohranimo single-file pristop, ob vsaki spremembi crosscheck logike preverimo obe datoteki.

**6.2 Geo funkcije samo v vhf-logger**
`locToLatLon`, `haversine`, `calcBearing` obstajajo samo v `vhf-logger.html`. Za predloge A6 (razdalja plausibility) in B1 (razdalja per pas) v edi-crosscheck ter 1.5 (karta lokatorjev) v edi2adif jih je treba portirati. Funkcije so samozadostne (~40 vrstic skupaj) in brez odvisnosti.

**6.3 Testna pokritost**

| Orodje | Testi | Opomba |
|---|---|---|
| `edi2adif.test.js` | 122 | Dobra — algoritem, izvoz, i18n |
| `edi-crosscheck.test.js` | 56 | Osnovna — pokrita algoritem, render/UI ne |
| `adif-qrz-filter.test.js` | 48 | Dobra za logiko; API mock ni realen |
| `vhf-logger/vhf-logger.test.js` | 163 | Dobra — jedro, backup, EDI uvoz/izvoz |

Za vsako novo funkcionalnost iz zgornjih predlogov je treba dodati teste pred integracijo.

---

*Pregled opravil: Claude Sonnet 4.6 · 2026-05-15*
