# Code review — v1.4 baseline integracija

**Datum:** 2026-05-13
**Obseg:** `build-baseline.js` (nov, ~320 vrstic) + `edi-crosscheck.html` (~50-80 vrstic novih sprememb)
**Vidik:** funkcionalna pravilnost, robustnost, performance, sledenje obstoječim vzorcem v repu.

---

## 1. Povzetek

**Stanje:** koda je v dobri formi, testi gredo (56/56), E2E smoke verificiran. Najdene težave so večinoma **kozmetične** ali **defensive-code clean-ups**. Eden je **dead-code fallback**, ki je v nasprotju s CLAUDE.md (ne dodajaj fallback-ov za nemožne scenarije).

| Kategorija | Število |
|---|---|
| Kritičnih bugov | 0 |
| Srednje pomembnih | 2 |
| Manjših / kozmetičnih | 7 |
| Dokumentacijskih lukenj | 1 (README in CLAUDE.md ne omenjata baseline-a) |

---

## 2. `build-baseline.js`

### 2.1 Močne strani

- **Brez zunanjih odvisnosti** — uporablja samo `fs` in `path`. Skladno z vzorcem `adif-qrz-filter.js`.
- **Robusten CSV parser** — RFC-4180-ish, ročno napisan, obvlada double-quote escape (`""`), kvotirane vejice, mešane line endings.
- **Encoding fallback** — UTF-8 → latin1 ob detektiranju `�`. Latin1 je 1:1 mapping, lossless. Polji Call/WWL sta ASCII, tako da je odločitev varna.
- **Schema-tolerant** — mapira po imenih stolpcev (`Call`, `WWL`, `Band`), obvlada 23- in 25-stolpčno varianto, ki obstaja v realnih OEVSV CSV-jih.
- **Mirrors `baseCall()`** iz HTML-ja — dosledne ključe za runtime lookup.
- **Stable band ordering** — izhod sledi vrstnemu redu `BAND_MAP`, ne abecedi → konsistentni JSON med build-i.
- **Detailed report** — pokaže skipped vrstice po razlogu, kar olajša debug.

### 2.2 Težave

#### M1 (srednje, varnost) — `MIN_APP` ni validiran

```js
const MIN_APP = parseInt(args['--min-appearances'] || '3', 10);
```

Če uporabnik pošlje `--min-appearances abc`, `parseInt` vrne `NaN`. Posledica:
- `n >= NaN` je vedno `false` → `keepCalls` ostane prazen → izhod ima 0 calls.
- Uporabnik ne dobi opozorila, vidi samo "After filter ≥NaN: 0".

**Predlog popravka:**

```js
const minAppRaw = args['--min-appearances'];
const MIN_APP = minAppRaw === undefined ? 3 : parseInt(minAppRaw, 10);
if(!Number.isFinite(MIN_APP) || MIN_APP < 1){
  console.error(`--min-appearances must be a positive integer, got: ${minAppRaw}`);
  process.exit(1);
}
```

#### M2 (srednje, varnost) — `IN_DIR` ni absolutna pot in se ne validira

```js
const IN_DIR = args['--in'] || './iaru_oevsv_csv';
```

`fs.existsSync(IN_DIR)` to ujame, vendar ko `IN_DIR` kaže na *datoteko* (ne mapo), `fs.readdirSync` vrže nejasen error. Manjši use case, ampak prijaznejši UX:

```js
const stat = fs.existsSync(IN_DIR) ? fs.statSync(IN_DIR) : null;
if(!stat || !stat.isDirectory()){
  console.error(`Input must be a directory: ${IN_DIR}`);
  process.exit(1);
}
```

#### m1 (kozmetično) — Encoding sentinel `'�'` v izvorni kodi

```js
if(text.indexOf('�') >= 0) text = buf.toString('latin1');
```

Literal `�` (replacement char) v izvorni kodi je *legalen*, vendar:
- V nekaterih editorjih izgleda kot artifact ali napaka.
- Manj jasno za bralca.

**Predlog:** `if(text.includes('�'))` — eksplicitno + idiomatic `.includes()`.

#### m2 (kozmetično) — `parseArgs` ne validira ključev

Nepoznane flag-e (`--typo`) sprejme tiho. Ni varnostni problem, vendar uporabnik morda ne ugotovi, da je tipkal narobe.

**Predlog (opcijsko):** validiraj proti seznamu znanih flag-ov in opozori. Nizka prioriteta.

#### m3 (kozmetično) — `MIN_APP` privzeto v JSDoc je 1, v kodi 3

Help text v JSDoc piše:
```
node build-baseline.js --min-appearances 1          # keep everything
```

Ne pove privzetka (3). Doda zmedo. **Predlog:** posodobi komentar:
```
node build-baseline.js --min-appearances 5          # stricter quality filter
node build-baseline.js --min-appearances 1          # keep everything (no filter)
```

#### m4 (kozmetično) — `parseCSVLine` ne obvlada embedded newlines v kvotiranih poljih

RFC 4180 dovoljuje newline znotraj `"..."`. Trenutni `readCSV` najprej splita po `\r?\n`, kar bi razbil tak record. **Za OEVSV CSV-je to ne nastopi** (preverjeno), zato ni resnično breaking. Vredno omeniti v komentarju, da nekdo v prihodnosti ne preseneča:

```js
// NOTE: assumes no embedded newlines in quoted fields (true for OEVSV CSVs).
// If support is needed, switch to a stream parser that respects quote state.
```

#### m5 (kozmetično) — duplikirani CSV-ji niso detektirani

Če uporabnik slučajno ima isto CSV pod dvema imenoma v `iaru_oevsv_csv/`, count se podvoji. To je *legitimno* z vidika orodja (vsaka datoteka šteje), ampak presenetljivo. **Predlog:** dedup po `md5(content)` ali bar warning, če sta dva file-a `read` z identičnim content-om.

Nizka prioriteta.

---

## 3. `edi-crosscheck.html` — v1.4 spremembe

### 3.1 Močne strani

- **Razdelitev weighted vs. raw** je čista in dobro dokumentirana v komentarju nad `_histDB`. Algoritem ostaja netaknjen, display je popravljen, semantika confidence ratio je matematično pravilna (invariantna pod uniformnim utežjenjem).
- **Silent fallback** v `loadBaseline()` je pravilno implementiran s try/catch.
- **`clearHist()` re-injection** logika za baseline je elegantna (preprosto pokliče `applyBaseline(_baselineRaw)` po `_histDB.clear()`).
- **I18N** se ohrani — novi string `dbBaseLbl` ima oba jezika.
- **CSS variabilnost** uporablja obstoječe CSS custom properties (`var(--accent2)`) — usklajeno s temo.

### 3.2 Težave

#### M3 (srednje, code-quality / CLAUDE.md violation) — Dead fallback v `findSimilar`

```js
const e = _histDB.get(hcall);
// Display: raw count; falls back to weighted total if raw not tracked
// (defensive for old-shape entries during partial migrations).
const count = e.totalRaw != null ? e.totalRaw : e.total;
```

**Problem:** `addToHistDB` in `applyBaseline` **vedno** inicializirata `totalRaw` (preverjeno v kodi). Ni nobenega code path-a, ki bi ustvaril entry brez `totalRaw`. Komentar govori o "partial migrations" — ampak migration je končana, ni partial.

CLAUDE.md eksplicitno pravi:
> "Don't add error handling, fallbacks, or validation for scenarios that can't happen."

**Predlog popravka:**
```js
similar.push({ call: hcall, dist: d, count: _histDB.get(hcall).totalRaw });
```

#### m6 (kozmetično) — redundantna preverba v `CALL_BY_LOC`

```js
if(locCalls && locCalls.size > 0){
```

Če je `locCalls` truthy (`_locToCalls.has(locUp)`), je `size > 0` vedno true (Map se v naši kodi ne ustvari prazna — vedno se kliče `.set(...)` takoj po `new Map()` v `addToHistDB`). Preverba `> 0` je dead.

**Predlog:**
```js
if(locCalls){
```

#### m7 (kozmetično) — komentar v `applyBaseline` reže nepotrebno

```js
// Inject pre-built baseline (OEVSV CSV-derived call→band→locator stats) into
// _histDB. Bands are aggregated to flat locator counts to fit the current
// algorithm's data shape; per-band data remains in _baselineRaw for future use.
// Weight applied: BASELINE_WEIGHT × the count from baseline.
```

Kompromis: komentar je nad povprečjem dolg za projekt v stilu "minimal comments". Ampak hkrati pojasnjuje *zakaj* (aggregation, future use, weighting), kar je dragoceno. **Zadrži.**

#### m8 (manjše, defensive) — `_baselineCalls` se ne resetira ob unsuccessful re-load

```js
async function loadBaseline(){
  try {
    const r = await fetch('./crosscheck-baseline.json');
    if(!r.ok) return;
    ...
```

Trenutno `loadBaseline()` se kliče samo enkrat (na bootstrap). Če bi se v prihodnosti dodal "Reload baseline" gumb, in fetch ne uspe, je `_baselineCalls` od prejšnjega uspeha še vedno > 0 → UI kaže napačno baseline coverage.

**Predlog za future-proofing (ne nujno zdaj):**
```js
async function loadBaseline(){
  try {
    const r = await fetch('./crosscheck-baseline.json');
    if(!r.ok) return;
    const j = await r.json();
    // Only reset state after successful fetch+parse
    _baselineRaw = j;
    _baselineCalls = 0;
    _baselineVer   = '';
    applyBaseline(j);
    updateDbCard();
  } catch(e) {}
}
```

Nizka prioriteta (trenutno enkratno klicanje, ni "reload" UI).

#### m9 (manjše, UX) — uspeh `loadBaseline` ni viden v dev console

Pri silent fallback uporabnik (in dev) ne vidita, ali se je baseline naložil ali ne. Edini signal je `dbCard` v UI. Razvijalci, ki testirajo z DevTools, bi cenili kratek `console.info`:

```js
applyBaseline(j);
console.info(`[crosscheck] baseline loaded: ${_baselineCalls} calls, v${_baselineVer}`);
```

Opcijsko.

#### m10 (manjše, perf) — `runCrosscheck` rebuild-a `histCalls` ob vsakem klicu

```js
const histCalls = [..._histDB.keys()];
```

S 3.240 baseline + (typically) nekaj sto EDI calls, to je ~3.500 ključev → ~50 µs spread operacija. Trivialno za enkratni crosscheck. Pri `rerunCrosscheck` se to ponovi. Brez problema, ne kličemo to v tight loop.

**Ne popravljaj** — prematura optimizacija.

---

## 4. Skupne ugotovitve

### 4.1 Skladnost z `CLAUDE.md` pravili

✅ Brez zunanjih odvisnosti (oba file-a)
✅ Komentarji večinoma "why", ne "what"
❌ **Dead fallback v `findSimilar`** (točka M3) krši "no fallbacks for impossible cases"
✅ Brez polovično implementiranih featurov
✅ Brez ne-implementiranih TODO-jev

### 4.2 Konsistenca med HTML in build skripto

`BAND_MAP` se sedaj razlikuje med datotekama:

- `edi-crosscheck.html`: 10 vnosov (do 6mm/47 GHz), brez decimal-anchoring
- `build-baseline.js`: 16 vnosov (do 1mm/300 GHz), z decimal-anchoring fix

To je **OK** za trenutno funkcijo (baseline pasovi nad 6mm samo se shranijo, tool jih ne uporablja za normalizacijo lastnih EDI logov). Ampak pomembno: če bi se v EDI logih kdaj pojavila vrednost kot `"122 GHz"`, bi tool padel na fallback (vrne nespremenjeno) in te zveze se ne bi ujemale s svojim baseline-om.

**Predlog (future):** posodobi `BAND_MAP` v HTML-ju, da ujema build skripto. Brez urgence.

### 4.3 Manjkajoča dokumentacija

- **README.md**: omenja v1.0 funkcionalnosti, ne baseline ali `build-baseline.js`.
- **CLAUDE.md**: opisuje arhitekturo do v1.3, ne v1.4 (BASELINE_WEIGHT, raw vs. weighted, loadBaseline).
- **TESTING.md**: ni omemb test-ov za baseline (ki jih ni — verifikacija je bila E2E smoke).

To popravim v drugem koraku tega review-a.

### 4.4 Predlogi za teste, ki manjkajo (opcijsko)

Trenutno se baseline preveri samo z manual E2E smoke. Smiselno bi bilo dodati v `edi-crosscheck.test.js`:

1. **`applyBaseline()` populira `_histDB` pravilno** — mock JSON, preveri da je `_histDB.get('TEST').totalRaw === expected`.
2. **Weighted vs. raw distinkcija** — preveri, da `entry.total === entry.totalRaw * 3` po `applyBaseline`.
3. **`clearHist` ohrani baseline** — pokliči, preveri da `_histDB` ima baseline calls.
4. **`runCrosscheck` z baseline-derived entries** — preveri, da raw counts pridejo v issue objekte.

Niso kritični (vsa logika je pokrita z obstoječimi unit testi za algoritem + E2E za baseline), ampak bi prevent regression.

---

## 5. Priporočena vrsta popravkov

| # | Tip | Vpliv | Trud |
|---|---|---|---|
| 1 | **M3 — Odstrani dead fallback** v `findSimilar` | Code-quality compliance | 1 minuta |
| 2 | **M1 — Validate MIN_APP** | UX (boljša napaka) | 5 minut |
| 3 | **M2 — Validate IN_DIR is directory** | UX | 3 minute |
| 4 | Posodobi README.md + CLAUDE.md | Dokumentacija | 30 minut |
| 5 | m1 — `'�'` namesto `'�'` | Berljivost | 1 minuta |
| 6 | m6 — Odstrani `size > 0` dead check | Cleanup | 1 minuta |
| 7-9 | Kozmetično | Berljivost | 5 minut skupaj |
| 10 | Dodaj baseline teste | Regression safety | 1 ura |

Vse skupaj ~2 uri za vse popravke + dokumentacijo. **Najpomembnejši: M3 (CLAUDE.md compliance) in dokumentacija.**

---

## 6. Verifikacija — kaj je *ne-buggy*

Da bo review uravnotežen, naštevam, kar je preverjeno **pravilno**:

- ✅ **Algoritem nespremenjen**: 56/56 obstoječih testov gre.
- ✅ **Weighted decisions** (threshold, mode locator, severity): potrjeno z E2E test scenario-jem.
- ✅ **Raw display values**: chip-i kažejo pravilne raw counts (verificirano vizualno).
- ✅ **Confidence ratio**: matematično invariantno pod uniformnim weighting-om (ratio weighted/weighted = ratio raw/raw).
- ✅ **`clearHist` re-injection**: preverjeno, baseline ostane po clear-u.
- ✅ **Silent fallback** na file:// CORS: preverjeno (orodje deluje brez napake).
- ✅ **Encoding fallback** v build skripti: vse 35 OEVSV CSV-jev uspešno parsiranih.
- ✅ **CSV parser robust**: dva 8-char anomalna lokatorja in en invalid Maidenhead pravilno zavržena.

---

## 7. Zaključek

Implementacija v1.4 je **funkcionalno solidna**, z eno krhko točko (dead fallback) in nekaj kozmetičnimi cleanup-i. Glavna manjkajoča stvar je **dokumentacija** za uporabnika in razvijalca — to popravim takoj.

Resničnih bugov *ni*. Vse 56 obstoječih testov gre, E2E je verificiran, in popravek `144×` → `48×` problema je matematično utemeljen.

*Pripravil: Claude (Opus 4.7) — pregled brez popravkov v kodi (popravki samo v dokumentaciji).*
