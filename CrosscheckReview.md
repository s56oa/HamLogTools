# Funkcionalni pregled — edi-crosscheck.html

**Datum:** 2026-05-12
**Verzija orodja:** v1.3
**Področje:** algoritmi za crosscheck EDI tekmovalnih logov (REG1TEST v1), VKV pasovi IARU R1 (≥ 50 MHz)
**Obseg:** izključno algoritmične preverbe in nove predlagane preverbe; UX/UI ni del tega pregleda.

---

## 1. Kratek povzetek konteksta

V VKV tekmovanjih IARU R1 (Marconi, IARU Region 1 VHF/UHF/Microwave, Field Day, sub-regionalna NAC ipd.) sodelujoči oddajo EDI dnevnik tekmovalnemu robotu. Robot izvaja dve vrsti preverb:

1. **Notranja preverba enega dnevnika** (single-log validation) — formalna pravilnost zapisov, časovni red, sub-band, sub-mode itd. Ne potrebuje drugih virov.
2. **Križni crosscheck z drugimi dnevniki** (cross-log / UBN crosscheck) — robot zbere vse oddane dnevnike, jih medsebojno primerja in oceni UBN status vsakega QSO: **U**nique, **B**usted, **N**IL.

To orodje pokriva **tretji, vmesni pristop**: križni crosscheck *enega novega dnevnika* proti **zgodovinski statistični bazi** (preteklim dnevnikom istega operaterja/kluba). To je pred-oddajna ("pre-submission") sanity-check faza — ujame tipkarske napake in nedosledne lokatorje preden gre log v robot.

Ta hibridni pristop ima dobro razmerje koristi/cene: brez tekmovalnih virov in brez čakanja na robota, takoj uporabno.

---

## 2. Trenutno stanje implementacije (v1.3)

### Implementirani algoritmi

| Tip težave | Logika | Resnost |
|---|---|---|
| `LOC_MISMATCH` | Trenutni lokator ≠ zgodovinski modus (najpogostejši) | high (modus self-conf ≥ prag in nov lok. še nikoli viden) / med |
| `LOC_MISSING` | Nov QSO brez lokatorja, zgodovina obstaja | high / med po zaupanju v modus |
| `CALL_SIMILAR` | Klicni znak ni v zgodovini; Lev. dist. ≤ 2 obstaja | implicitno (chip d1/d2) |
| `CALL_UNKNOWN` | Klicni znak ni v zgodovini, ni podobnega | dim |
| `CALL_BY_LOC` | Klicni znak ni v zgodovini, **ampak** lokator je viden v zgodovini z drugim znakom v Lev. dist. ≤ 2 | composite |

### Močne strani

- **Normalizacija klicnega znaka** (`baseCall()`) ločuje pripone (`/P`, `/M`) od predpon (`OE/S59DGO`) — dobro narejeno.
- **Levenshtein z zgodnjim izhodom** (`maxDist`) — performančno solidno.
- **Sestavljen check `CALL_BY_LOC`** je inovativen — uporabi *dva* kanala dokazov (lokator + razdalja klicnega znaka). Konkurenčna orodja tega tipično nimajo.
- **Nastavljiva pragova** (`_minAppearances`, `_minConfidence`) — odlično za kalibracijo na različno velikih zgodovinskih bazah.
- **Statistika modus + štetje** (`historicalMode`, `count`, `total`) je transparentna — uporabnik vidi *zakaj* je QSO označen.

### Šibke strani / vrzeli

1. **Ni band-aware**: lokator-modus se računa preko **vseh pasov skupaj**. V VKV svetu je to napaka — postaja je lahko fiksna na 2m (vedno JN75ab), a portable na 6m (JN65xy za Es). Trenutna logika to označi kot konflikt.
2. **Ni time-aware**: če je postaja v 2021 oddajala iz JN65, v 2025 pa iz JN75 (preselitev), modus bo "nekonsistenten" in algoritem bo označil oboje za sumljiva.
3. **Ni outlier filter**: en sam tipkarski QSO v zgodovini (npr. JN65ab vs JN65ax — d=1 v 1 od 100 QSO) onesnaži statistiko. Modus tega ne čuti, ampak druga statistika lahko.
4. **Ni preverbe formata polja**: parser zavrže nepravilen lokator (regex `[A-R]{2}[0-9]{2}[A-X]{2}`) tiho — uporabnik ne ve, da je polje sploh bilo prisotno, a v napačnem formatu.
5. **Ni preverbe RST/serijska številka/exchange**: stolpci EDI 4–8 se sploh ne berejo. Tipične napake (RST 59 za CW, exchange = klicni znak, manjkajoč serijski) ostanejo neopažene.
6. **Ni preverbe header**: PCall, PWWLo, PExch, PSect se sploh ne preverjajo. Manjkajoč PWWLo v header je za UKV log fatalna napaka.
7. **Ni preverbe časa**: kronološko zaporedje, dvojni QSO v istem pasu/načinu, presledki, "QSO-i v prihodnost", QSO-i izven tekmovalnega okna — vse to manjka.
8. **Levenshtein ni callsign-aware**: 0↔O, 1↔I, 5↔S, 2↔Z so zelo pogoste tipkarske/slušne zamenjave v radiu, vendar imajo enako težo kot katerakoli druga zamenjava črke.
9. **Sklic z lastnim klicnim znakom**: PCall iz header lahko slučajno nastopi v `[QSORecords]` (= QSO sam s seboj). Ni preverbe.
10. **Razdalja (`dist`, stolpec 11) se ignorira**: čeprav je v parserju izpuščeno (in tako tudi v zgodovini), je velik nadzorni signal — operator-deklarirana razdalja vs. izračunana iz lokatorjev mora ujemati ±1 km.

---

## 3. Predlagane izboljšave po kategorijah izvedljivosti

Vsaka točka je opremljena s **kategorijo izvedljivosti**:

- **A** — izvedljivo z obstoječo zgodovinsko bazo, brez novih vhodov.
- **B** — zahteva *interno razširjeno tabelo* (npr. ITU prefiks → DXCC, frekvenčni plan, Maidenhead → koordinate), ki jo lahko vgnezdimo v HTML brez zunanjih klicev.
- **C** — zahteva drug vir podatkov v realnem času (drugi tekmovalni dnevniki za pravi UBN, callbook API, contest kalendar).

---

### 3.A — Razširitve obstoječe statistike (brez novih vhodov)

#### A1. Band-aware modus lokatorja
**Težava:** Trenutno `getModeLocator` agregira preko vseh pasov. Postaja, ki je vedno fiksna na 2m, lahko ima portable QTH na 6m.
**Predlog:** Zgodovinska baza naj sledi lokator-modus **per band**: `Map<baseCall → Map<band → {locators, total}>`. Ko crosscheckamo, najprej iščemo *band-specifični* modus. Če per-band ni dovolj zapisov (npr. < `_minAppearances`), padcraj na agregat (current behavior) kot fallback. To bo občutno zmanjšalo lažne pozitivne.

#### A2. Time-aware modus z eksponentnim zmanjšanjem teže
**Težava:** Stare zveze (5+ let) teže manj kot lanske, a trenutno imajo enako težo. Posledica: če je postaja se preselila, modus še vedno kaže *star* lokator.
**Predlog:** Vsakemu zgodovinskemu QSO dodaj `dateDisp` → leto. Pri izračunu modusa uteži:
```
weight(qso) = 0.85 ^ (currentYear - qsoYear)
```
Konec krepa: zveza iz 2026 šteje 1.0, iz 2024 ~0.72, iz 2020 ~0.38. Modus postane "centroid recentnih zapisov". Faktor `0.85` je predlog; lahko bi bil nastavljiv slider.

#### A3. Outlier filter pred modusom
**Težava:** Enkraten tipkarski QSO (`JN65ab` namesto `JN65ax`) v zgodovinski bazi povzroči, da je modus statistično pravilen, vendar pa "alternativa" (`JN65ab`) dobi 1 zapis in v `LOC_MISMATCH` chip-listi izgleda kot "alternativa, ki je bila videna". Uporabnika to zmede.
**Predlog:** Pred izračunom modusa odstrani lokatorje z `count == 1` (ali `count / total < 0.02`), če `total ≥ 10`. Pokaži ločen indikator: *"X potencialnih outlierjev odstranjenih iz baze za to postajo"*.

#### A4. Per-call mode preference (način oddaje)
**Težava:** Določene postaje so izključno CW (npr. tekmovalne SOTA / EME postaje), druge so SSB. Mode v zgodovini bi lahko bil signal — če zveza z S57XYZ v zgodovini je 100% CW, a nov QSO trdi SSB, je to lahko napaka.
**Predlog:** Razširi zgodovinski zapis na `entry.modes: Map<mode, count>`. Dodaj nov check `MODE_UNEXPECTED` z resnostjo **low**: `historical mode-of-mode ≠ new mode AND mode-conf ≥ prag`. Manj kritično od lokatorja, koristno kot kontrolni signal.

#### A5. Per-call band aktivnost
**Težava:** Postaja je lahko prisotna samo na 144 MHz, nikoli na 23cm. Če v novem dnevniku nastopi na 23cm, je verjetno tipkarski preplah/zamenjava klicnega znaka.
**Predlog:** `entry.bands: Map<band, count>`. Check `BAND_UNUSUAL` z resnostjo **low**: če klicni znak v zgodovini z minimalnim številom QSO (npr. ≥ 5) nikoli ni nastopil na band-u novega QSO, opozori.

#### A6. Distance plausibility (operatorska deklaracija vs. izračunana)
**Težava:** EDI stolpec 11 = razdalja v km, ki jo operator deklarira (ali zračuna logger). Trenutno se ignorira.
**Predlog:**
1. Dodaj v parser ekstrakcijo stolpca 11 → `q.distDecl`.
2. Iz lokatorjev (svojega in partnerjevega) izračunaj veliko-krožno razdaljo (Maidenhead → lat/lon → haversine). Funkcija ~30 vrstic, brez odvisnosti.
3. Check `DIST_MISMATCH` resnost: |decl - calc| > 5% AND > 5 km → **med**, > 20% → **high**.
4. To je *self-consistency* check, ne potrebuje zgodovine.

#### A7. Self-QSO check
**Težava:** Operator je lahko slučajno zalogiral sam sebe (npr. test QSO, ali napačno tipkanje lastnega znaka).
**Predlog:** Iz header preberi `PCall`. Skozi vse QSO: če `baseCall(q.call) === baseCall(PCall)`, doda `SELF_QSO` z resnostjo **high**.

#### A8. Header validacija
**Težava:** Preverba `PCall`, `PWWLo`, `PExch`, `PSect`, `PBand` — vsaka manjkajoča pomeni invalid log.
**Predlog:** Pred zagonom crosscheck, validiraj header. Pokaži poseben **panel "Header issues"** ločen od QSO tabele. Validacija:
- `PCall`: ujema se z ITU patternom `^[A-Z0-9]{1,3}[0-9][A-Z0-9]*[A-Z]$`
- `PWWLo`: 6-znakovni Maidenhead, regex
- `PBand`: ujema se z `BAND_MAP`
- `PSect`: prisotno (kategorija)
- `PExch`: prisotno za tekmovanja z exchange

#### A9. Kronološka kontrola
**Težava:** Manjkajoča kontrola, da časi QSO-jev v dnevniku tečejo monotono naraščajoče (z izjemo občasnih sočasnih QSO).
**Predlog:** Parser naj ekstrahira `time` (stolpec 2). Nato:
- Check `TIME_BACKWARDS`: če `time[i] < time[i-1] − 5min` (5 min toleranca za sočasne) → **med**.
- Check `TIME_OUTSIDE_DATE`: časovni žig ni v okviru sklenjenega tekmovalnega obdobja, če `TDate`/`TName` v header (lahko za sedaj samo, da log obsega > 48 ur — sumljivo za večino VKV tekmovanj).

#### A10. Notranji duplikat preko `_bandKey`
**Težava:** EDI ima `dupe_flag` v stolpcu 13, vendar nekateri loggerji ne nastavijo. Sam-duplikat (isti call + datum + pas + mode) bi moral biti označen.
**Predlog:** Po parsing, identificiraj duplikate v novem logu ne glede na flag (`call|date|band|mode`). Označi z `DUPE_INTERNAL` resnost **med**. Tudi izpostavi neskladje: če dupe-flag *je* nastavljen, a notranja heuristika ne najde dvojnika (ali obratno), opozori.

#### A11. Callsign-aware urejevalna razdalja
**Težava:** `levenshtein()` daje enako težo zamenjavi `S` ↔ `5` kot zamenjavi `Q` ↔ `Z`. V VKV/HF radiu sta `0↔O`, `1↔I`, `5↔S`, `2↔Z`, `8↔B` izredno pogoste tipkarske in slušne (CW, SSB) zamenjave.
**Predlog:** Definiraj `CONFUSION_PAIRS = [['0','O'],['1','I'],['5','S'],['2','Z'],['8','B'],['9','G']]`. Pri Levenshteinu, kjer je standardna razdalja zamenjave 1, pri pomembni *confusion pair* znaš 0.4. To bolj favorizira realistične typote pred naključnimi.

#### A12. Konsistentnost lastnega lokatorja
**Težava:** PWWLo v header bi se moral ujemati s tem, kar je operator deklariral v *prejšnjih* dnevnikih. Pogosta napaka: operator je posodobil logger, a pozabil posodobiti PWWLo.
**Predlog:** Ko nalagamo zgodovinske datoteke, beleži tudi `_histOwnLocators: Map<PCall, Map<PWWLo, count>>`. Pri novem logu primerjaj `header.PWWLo` z modus-om operaterja. Če se razlikuje, posebno opozorilo.

#### A13. Suffix-aware lokator handling
**Težava:** `baseCall()` strpi pripone `/P`, `/M`, `/MM`, `/AM`. Te pripone *spreminjajo lokacijo*: `/P` = portable (drug lokator OK), `/MM` = maritime mobile (lahko AA00aa). Trenutno se /P-zveza primerja z modusom, kjer modus prihaja iz fiksnih QSO → false positive za /P.
**Predlog:** Ohrani pripono v ločenem polju `q.suffix`. Pri `LOC_MISMATCH` check:
- Če `q.suffix === '/P'` ali `/M`: ne preglej; ali zniži resnost na **info**.
- Če `q.suffix === '/MM'`: ne preverjaj lokatorja (po definiciji premikajoč se).
- V zgodovinski statistiki: ločeno štej fiksne in portable zveze.

#### A14. RST format kontrola
**Težava:** Stolpca 5 in 7 (RST sent/received) trenutno se ne berejo. Tipične napake: RST 59 za CW (treba RST5NN ali 599), RST 5N za SSB.
**Predlog:**
- Parser ekstrahira `rstS`, `rstR`.
- Pravila:
  - CW (mode 2/3): RST mora biti 3 znaki (5NN, 339-599) ALI `nn` (npr. za MS/EME 27, 26).
  - SSB (mode 1/4): RST 2 znaki (51-59).
  - FM (mode 6): RST 2 znaki (51-59).
- Check `RST_FORMAT` resnost: **med** (formalna napaka, robot bo to ujel).

#### A15. Sub-band frekvenčna doslednost
**Težava:** EDI nima frekvence per QSO, ima samo `PBand` v header. Vendar `PBand` lahko nakaže "144 MHz", in mode označuje "CW". CW na 2m je v sub-bandu 144.025–144.150 MHz, FM je 145.5+ MHz. Brez frekvence per-QSO ne moremo preveriti, *ampak*:
**Predlog:** Vsaj preveri kombinacije *band + mode* — npr. EME mode na 6m je redko (večinoma 2m in višje); FM na 6m v večini IARU R1 ni dovoljen kot tekmovalni način (lokalno odvisno). Slovenija ima sub-band rules. **Kategorija A**, če imamo interno *kombinacijsko tabelo allowed (band, mode)*; sicer **B**.

#### A16. Power/setup polja (PAdr1, PAnt, RPwr) v header
**Težava:** Manjkajoča TX power / antenna deklaracija je formalna napaka v IARU R1 logu.
**Predlog:** Preveri, da so `RPwr`, `RAnt` (ali enakovredne sekcije) v header neprazne. Resnost **low** kot info.

#### A17. Centroidni modus lokatorja (namesto majoritarnega)
**Težava:** Modus = "najpogostejši lokator" je groba mera. Če postaja je oddajala iz JN65ab 50×, iz JN65ac 49× (le 1 stolpec stran), modus je JN65ab — vendar centroid bi bil bližje sredine. To je pomembno za fine-grade krajevne razlike.
**Predlog:** Izračunaj **centroid** zgodovinskih lokatorjev (geografsko, prek Maidenhead → koordinate → povprečje). Označi novi QSO z **velikim odstopanjem od centroida** (npr. > 50 km). Drobne razlike (susedni Maidenhead kvadrati) niso označene, kar zmanjša noise.

---

### 3.B — Razširitve z interno tabelo (brez zunanjih klicev)

#### B1. ITU prefix → DXCC tabela
**Težava:** Klicni znak `LX1ABC` ima predpono `LX` = Luksemburg. Lokator za LX mora biti v JN29-JN39. Tipkarska napaka v prefiksu se da zaznati le z DXCC tabelo.
**Predlog:** Vgnezdi minimalno (samo IARU R1 prefiksi + sosednji) DXCC tabelo, npr. ~80 vnosov: `{ 'S5': 'SVN', 'OE': 'AUT', 'DL': 'DEU', 'I': 'ITA', 'F': 'FRA', ... }` z razponi pričakovanih Maidenhead lokatorjev. Check `PREFIX_LOC_MISMATCH`: če prefiks pravi DL, a lokator je JN65 (= Slovenija), resnost **high**.
Tabela < 100 vrstic; lahko v `BAND_MAP`-stilu.

#### B2. Razdalja Maidenhead → lat/lon
**Težava:** Iz lokatorjev `JN65ab` in `JN76cd` izračunaj zračno razdaljo. Potrebno za A6, A17 in plausibility (B3).
**Predlog:** Implementiraj `gridToLatLon(grid)` (15 vrstic) in `haversine(lat1, lon1, lat2, lon2)` (8 vrstic). Standardna formula, brez odvisnosti.

#### B3. Distance plausibility per pas (band-conditioned max)
**Težava:** Trditev "QSO na 24 GHz, razdalja 800 km" je *tehnično možna*, vendar zelo redka (običajno < 200 km tropo, izjemoma rainscatter). Brez tabele tipičnih dosegov ni meril.
**Predlog:** Interna tabela:
```js
BAND_DIST_MAX = {
  '6m':    3000,  // sporadic E
  '2m':    2500,  // tropo, MS, aurora
  '70cm':  1500,
  '23cm':  1200,
  '13cm':   800,
  '9cm':    600,
  '6cm':    500,
  '3cm':    600,
  '1.25cm': 250,
  '6mm':    200,
}
```
Check `DIST_IMPLAUSIBLE` resnost **med**: izračunana razdalja > `BAND_DIST_MAX[band]`. **High**, če > 2× max. Polno priznaš, da meje so heuristične — meritev kvalitete, ne strogo pravilo.

#### B4. Prefiks→celina sub-grid range za prefiks-tipa napake
**Težava:** Dopolnitev B1: tabela ne le "DL = Nemčija", temveč tudi "DL pričakuje grids JN/JO/JP 30–69".
**Predlog:** Razširi tabelo iz B1 s polji `expectedGridFirst2Chars: ['JN', 'JO', 'JP']`. Check `PREFIX_GRID_RANGE`: nov QSO ima DL prefiks, a lokator se začne s `IK` (jug Italije) — sumljivo.

#### B5. Pseudo-Maidenhead "sea" filter
**Težava:** Lokatorji `AA00aa` ali `RR99xx` so v Atlantiku/Pacifiku — fizično ne dosegljivi za fiksne postaje. /MM jih opravičuje, fiksni klicni znaki ne.
**Predlog:** Definiraj območje "land-grids" za IARU R1: roughly `IJ–KQ` (vzhod-zahod) in `64–99` (sever-jug). QSO z lokatorjem izven tega okna AND prefiks ni `MM/`/`AM/` → check `LOC_OCEAN` resnost **med**.

#### B6. Frekvenčni plan: dovoljeni (band, mode) kombinaciji
**Težava:** Razlog za A15.
**Predlog:** Tabela:
```js
ALLOWED_BAND_MODE = {
  '6m':    ['SSB','CW','FM'],   // FM redko v IARU R1 contests
  '2m':    ['SSB','CW','FM','RTTY','SSTV'],
  '70cm':  ['SSB','CW','FM','RTTY','SSTV','ATV'],
  '23cm':  ['SSB','CW','FM','RTTY','ATV'],
  '13cm':  ['SSB','CW','FM','ATV'],
  ...
}
```
Check `BAND_MODE_INVALID` resnost **low**. Robot tekmovalnih dnevnikov tega ne bo zavrnil, ampak lahko zniža točke.

#### B7. Tipično-tekmovalna časovna okna
**Težava:** Vsako IARU R1 VKV tekmovanje ima fiksno datumsko okno (npr. 1. vikend septembra). Brez kalendarja ne moremo preveriti datumov.
**Predlog:** Vgnezdi tabelo večjih IARU R1 VKV tekmovanj **lokalno** (npr. zadnjih 5 let, ~50 vnosov):
```js
CONTESTS_2026 = [
  { name: 'IARU R1 VHF', start: '2026-09-05T14:00Z', end: '2026-09-06T14:00Z', bands: ['2m'] },
  { name: 'IARU R1 UHF/SHF', start: '2026-10-03T14:00Z', end: '2026-10-04T14:00Z', bands: ['70cm','23cm','13cm','9cm','6cm','3cm','1.25cm','6mm'] },
  { name: 'Marconi Memorial', start: '2026-11-07T14:00Z', end: '2026-11-08T14:00Z', bands: ['2m'], mode: 'CW' },
  ...
];
```
Check: ali datumi QSO ležijo znotraj nekega znanega okna in ali band ustreza. To je **B-naloga** brez zunanjega klica, vendar tabela mora biti vzdrževana.

---

### 3.C — Zahtevajo druge vire podatkov (ne implementirati v offline orodju)

#### C1. Pravi UBN crosscheck (Unique / Busted / NIL)
Klasični UBN zahteva *druge tekmovalne dnevnike za isto tekmovanje*. Brez tega ni nadomestilo. Smiselno samo za robote, ne za pre-submission tool. **Ne predlagamo implementacije.**

#### C2. QRZ.com / HamQTH lookup
Za nepoznane klicne znake (`CALL_UNKNOWN`) bi lahko poklicali QRZ XML API za uradni lokator. Vendar:
- Doda zunanjo odvisnost (CORS, API ključ).
- Operator že ima orodje za pre-filter (`adif-qrz-filter.js`).
- Boljša rešitev: opcijski **manual paste** — uporabnik prilepi QRZ lokator za nepoznane klicne znake. **Možno za prihodnost, ne nujno.**

#### C3. Real-time DX cluster / RBN potrditev
QSO time + frekvenca + call vs. live cluster spots = potrditev prisotnosti. Zahteva live API, izven obsega.

#### C4. Cross-log mutual check (več dnevnikov istega tekmovanja)
Uporabnik bi naložil *dva* dnevnika (npr. svoj + sosednjega kluba). Orodje bi preverilo *medsebojno* skladnost: ali sta sosednja zalogirala drug drugega? Časi? Lokatorji? To je **delna UBN brez robota**, izvedljivo v brskalniku, ampak zahteva drugačno arhitekturo (več "novih" dnevnikov, ne le zgodovinske baze). **Sredstvo za novo orodje** (`edi-mutual-crosscheck.html`), ne za to.

---

### 3.D — Hibridni vir: prebuilt baseline iz javnih CSV

Posebna kategorija. Brez algoritmičnih sprememb (samo ponovna uporaba obstoječih checkov), brez runtime zunanjih klicev, vendar z **build-time** uvozom javnih podatkov.

#### D1. OEVSV IARU R1 contest CSV kot baseline

**Vir:** `iaru.oevsv.at/v_upld/prg_list.php` — javni arhiv oddanih in robotsko-validiranih EDI logov za IARU R1 VKV tekmovanja. Vsako tekmovanje omogoča CSV export z (najmanj) polji `Call`, `WWL`.

**Semantična vrednost** — to je ortogonalno od EDI vhoda:
- **EDI**: *"jaz sem zalogiral S57XYZ kot JN75ab"* — partnerjev lokator, kakor ga jaz slišim. Lahko moja tipkarska napaka.
- **CSV**: *"S57XYZ je v IARU VHF 2024 oddal log s svojim lokatorjem JN75ab"* — operaterjev lasten, deklarirani lokator, ki je prešel robot. **Avtoritativen.**

Posledica za algoritem: CSV vnosi imajo zaslužno **višjo težo** (predlog: weight × 3) pri izračunu modusa lokatorja. To prebije šum iz tipkarskih napak v lastnih EDI logih.

#### D2. Tri arhitekturne variante

| Varianta | Distribucija | Velikost HTML | Update path | Single-file? |
|---|---|---|---|---|
| **A — Baked into HTML** | data inline v HTML | ~45 KB → ~250 KB | Nova verzija HTML | Da |
| **B — HTML + adjacent JSON** (priporočena) | `edi-crosscheck.html` + `crosscheck-baseline.json` | ~45 KB (nesp.) | Zamenjaj JSON | Skoraj (2 datoteki) |
| **C — Drop-in starter pack** | `baseline-YYYY-QN.json` v repu, uporabnik manualno spusti | ~45 KB (nesp.) | Uporabnik prenese nov | Da |

**Realna ocena teže** (kompakten format, IARU R1 aktivni operatorji ≥ 3 nastopov, ~5.000 entries, per-band):
- Surovi JSON: ~500 KB
- Kompaktni (kratki ključi, array-of-arrays, band indeksi): ~200-250 KB

#### D3. Priporočilo: Varianta B

**Razlogi:**
1. **Filozofija repa.** Že obstaja vzorec `adif-qrz-filter.js` + `.qrz-cache.json` (orodje + adjacent data). Crosscheck z `baseline.json` je usklajen vzorec, ne nova arhitektura.
2. **HTML ostane majhen** — pregleden, grep-abilen, hitro nalaganje v brskalniku.
3. **Update brez release-a HTML-ja** — JSON je lahko ločen artefakt, posodobljen kvartalno/letno brez taga.
4. **Izbira za uporabnika**: prenese le HTML (čisto, samo lastni EDI) ali oboje (z baseline).
5. **Community contributions** — če 9A, S5, OK klub pošlje svoj data set, ga lahko merge-amo v JSON brez dotika kode.

**Varianta A je smiselna le, če** je potrebna distribucija kot enojna datoteka (email priloga, USB ključ). V tem primeru predlog: build skripta generira *oboje* — `edi-crosscheck.html` (čisto) in `edi-crosscheck-bundled.html` (z embedded baseline) iz istih izvornih podatkov.

**Varianta C** je rezerva, če odlocimo, da je avtomatski fetch JSON pri `file://` open-u prevelika UX trnek (CORS pri lokalnem odpiranju). Brez lokalnega HTTP strežnika bo varianta B namreč padla na "no baseline" fallback.

#### D4. Build pipeline (predpostavljeno za varianto B)

Ni del HTML orodja — ločena Node.js skripta v repu:

```
build-baseline.js
  ↓
prebere CSV-je iz data/oevsv/*.csv
  ↓
filtri (gl. D5)
  ↓
agregira: call → band → locator → count
  ↓
zapiše crosscheck-baseline.json
  ↓
(opcijsko) inject v edi-crosscheck-bundled.html
```

Velikostni red: ~80-120 vrstic Node.js, brez zunanjih odvisnosti.

**Politika obnavljanja:** kvartalno ali po vsakem major IARU R1 contestu (IARU R1 VHF/UHF/SHF, Marconi). Vsak baseline ima `versionDate`, ki se prikaže v `dbCard`.

#### D5. Build-time filtri kakovosti

Brez tega bo baseline poln šuma. Predlagani filtri:

1. **Min. nastopov** ≥ 3 — odstrani enkratne udeležence in DXpedicije.
2. **Časovno okno** — zadnjih 5 let (drsečo). Starejši zapisi obtežijo manj (eksponentno; ujema se z A2).
3. **Izpust pripon `/MM`, `/AM`**: po definiciji nepredvidljivi lokatorji.
4. **Filter `/P`, `/M`**: NE izpustiti, ampak shraniti ločeno (`contextHint: 'portable'`). Algoritem lahko zniža težo, če nov log ni contest. (Povezano z A13.)
5. **Posebni klicni znaki** (DXpedicije, special-event): heuristično prepoznaj (tipičen pattern: kratki, neobičajni prefiksi za eno tekmovanje). Označi ali izpusti.
6. **Klubske vs. osebne** postaje: ne mešaj — baseline naj jih ohrani kot ločene zapise z istim `call` ključem (zveza ohrani identiteto).
7. **DX out-of-region** zveze: filter naj omeji na IARU R1 prefikse (S5, 9A, OE, DL, F, G, I, OK, OM, HA, OZ, SM, OH, LA, EA, CT, ON, PA, ...). Mimoidoči DX iz R2/R3 v IARU R1 contestih bi onesnažil bazo.

#### D6. Spremembe v `edi-crosscheck.html` (varianta B)

Brez algoritmičnih sprememb. Le:

1. **Bootstrap** (~15 vrstic): pri startu poskusi `fetch('./crosscheck-baseline.json')`. Če uspe, kliči razširjeno `addToHistDB(qsos, { source: 'baseline', weight: 3 })`.
2. **`addToHistDB` razširitev** (~10 vrstic): nov parameter `opts = { source, weight }`. Vsak count se množi z `weight`.
3. **`getModeLocator`** (brez sprememb) — že dela na count-ih, ki bodo zdaj utežene vsote.
4. **`dbCard` UI**: dodatne statistike "iz baseline: X klicnih znakov (verzija YYYY-QN)" + obstoječe "iz tvojih EDI: Y QSO".
5. **Gumb "Brez baseline"** v dbCard: za uporabnika, ki želi pregledati samo proti lastnim EDI logom (npr. za debug ali principled reasons).

Skupno ~50-80 vrstic JS sprememb. Algoritem ostaja netaknjen.

#### D7. Tveganja in skrita semantika

- **Kontestni vs. doma QTH bias.** OEVSV baseline beleži *contest* lokator (pogosto hribovska postojanka, drug grid kot domači). Za crosscheck *contest log-a* — ki je primarni use case tega orodja — je to **pravilno** in **boljše** kot doma QTH. Za morebitno bodočo uporabo na non-contest dnevnikih bi bil to sistematični bias; trenutno scope ni problem.
- **Staranje podatkov.** Operator je v 2021 oddajal iz JN65, v 2025 iz JN75. Baseline brez časovne uteži bi prikazal "konflikt". Rešitev: build-time filter D5.2 (zadnjih 5 let, eksponentna teža) reši to že pri build-time. Algoritem orodja ostane neoteščen.
- **Robotsko-validiran ≠ pravilen.** Robot lahko sprejme log z napačnim PWWLo, če je notranje konsistenten. Baseline tega ne ujame. Vendar v praksi je ta klasa napak < 1% in jo bo izpostavil sam crosscheck nad ti-isto bazo (mode = JN75ab pri 99% nastopov, en log z JN65ab izstopa kot outlier; D5.1 minimalni count to ublaži).
- **Licenca / atribucija.** OEVSV in udeleženci so podatke z oddajo dali v javni rezultat. Build skripta naj citira vir v `baseline.json`: `{ source: 'iaru.oevsv.at', generatedAt: '...', license: 'public contest results' }`. Pri redistribuciji vir naj se navede v README.

---

## 4. Prioritetni hitri zmagovalci

Če moramo izbrati največji efekt z najmanj truda, predlagamo to vrstno:

1. **A1 (band-aware modus)** — največji vpliv na false positive rate, ~30-50 vrstic kode.
2. **A13 (suffix-aware lokator)** — odpravi flood pozitivnih za /P zveze, ~20 vrstic.
3. **A7 (self-QSO check)** — trivialno, najde realne napake, ~10 vrstic.
4. **A9 (kronološka kontrola)** — pomemben formalni check za robot validation, ~30 vrstic.
5. **A6 + B2 (distance plausibility self-consistency)** — splošno koristno, ~50 vrstic.
6. **A11 (callsign-aware Levenshtein)** — bolj točni "similar" predlogi, ~25 vrstic.
7. **A8 (header validacija)** — najbolj formalna preverba, prikaži ločeno v UI, ~40 vrstic.
8. **A3 (outlier filter pred modusom)** — čisti chip-list, ~15 vrstic.

Po teh 8 točkah bi orodje pokrivalo večino "low-hanging fruit" pre-submission validacij.

Točke A2, A4, A5, A14, A15, A17, B1, B3, B6 so druga faza — boljša natančnost, ampak diminishing returns.

Točka B7 (contest kalendar) je politična — zahteva vzdrževanje. Ali vredno samo, če orodje nadgradimo v širši okvir (CLI nadgradnja, brand).

---

## 5. Tveganja in pomisleki

### Risk 1: previsoka false-positive rate
Crosscheck orodje, ki vsako tretjo zvezo označi rdeče, postane irelevantno. Trenutno orodje je v tem smislu **dobro nastavljeno** (uporabniku konfigurabilni pragovi). Vsaka nova preverba mora ohraniti to disciplino — privzeti pragovi naj bodo *konservativni* (manj alarmov, raje propustimo kakšen problem kot da slep noise).

### Risk 2: zgodovinska baza ni kalibrirana za vse postaje
Klicni znak, ki ima v zgodovini le 2 zvezi, ima statistično nesmiselen modus. Trenutni `_minAppearances` to brani — dobro. Vsaka razširjena statistika (modes, bands) potrebuje *svoj* minimum, ne le splošen.

### Risk 3: razširitev parserja → bug
EDI parser je trenutno minimalen (zavestno). Dodajanje RST, časa, razdalje, header validacije ga bo razširilo. Priporočamo:
- Edge-case fuzzing nad realnimi EDI vzorci (S59DGOJulijsko2021.edi v repu kot startni primer).
- Robustnost: nepravilni stolpec naj ne zruši parsa, ampak naj zapis tiho preskoči s šteto napako.
- Vsaka nova preverba naj bo *opcijska* z `opt-in` ali default-on z `dismiss`.

### Risk 4: scope creep
Orodje je pre-submission **sanity check**, ne polni robot. Privlačnost B7 (kalendar tekmovanj) ali C2 (QRZ lookup) je velika, ampak razmisli, ali naj orodje raste vodoravno (več orodij, kot je trend v repu) ali navpično (en moster). Trenutna struktura repa (eno orodje = en HTML) zagovarja vodoravno rast: `edi-validator.html`, `edi-mutual-crosscheck.html` ipd.

---

## 6. Zaključek

Orodje v1.3 dobro pokriva *jedrne* zgodovinsko-statistične preverbe (LOC_MISMATCH, CALL_SIMILAR, CALL_BY_LOC). Glavne vrzeli so:
- pomanjkanje **band-/time-/suffix-zavedanja** v statistiki (A1, A2, A13);
- ignoriranje **deklarirane razdalje** in **časa** (A6, A9);
- pomanjkanje **formalne validacije** header in stolpcev RST (A8, A14).

Vse našteto v razredu **A** je izvedljivo brez novih virov in večinoma < 50 vrstic kode po točki. Razred **B** (DXCC tabela, distance per band) doda več eksaktnih ne-statističnih preverb, vendar zahteva vzdrževanje tabel.

Razred **C** (UBN, QRZ) ni primeren za ta tool — to so domena tekmovalnih robotov oz. ločenih orodij.

Razred **D** (prebuilt baseline iz OEVSV CSV) je **ortogonalna izboljšava**: ne dodaja novih checkov, ampak občutno izboljša *vse obstoječe* z avtoritativnim zunanjim virom lokatorjev. Po naši oceni najboljši ROI med vsemi predlogi, če je sprejemljiv mali strošek build pipeline-a. Implementacija po **varianti B** (HTML + adjacent JSON) ohrani filozofijo repa in omogoči lažje vzdrževanje. Algoritmične spremembe v HTML-ju so minimalne (~50-80 vrstic), večinski del dela je v ločeni Node.js skripti za pripravo baseline-a.

---

*Pripravil: Claude (Opus 4.7) — pregled brez sprememb kode.*
