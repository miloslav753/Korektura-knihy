# Korektura knihy bez instalace

Samostatná HTML aplikace pro aktuální webové prohlížeče. PDF, český slovník a české OCR se zpracovávají ve Web Workeru a WebAssembly přímo na zařízení uživatele. Aplikace nemá serverové API a neodesílá knihu ani heslo. Všechny knihovny a modely jsou vložené do HTML; nevyžaduje CDN. Výstupy jsou standardní PDF zvýraznění s českými komentáři a samostatné CSV / JSON.

## Použití

Otevřete sestavený `dist/index.html` v prohlížeči. Distribuční kopie se jmenuje `Korektura-knihy-bez-instalace.html`. Není potřeba žádný instalátor ani Python. Stránku lze načíst také z HTTPS hostingu; po načtení může zpracovávat dokumenty bez sítě.

Příprava aplikace a načítání PDF mají vlastní ukazatel průběhu. Čtení z disku ukazuje MB a procenta; při otevírání PDF se zobrazuje neurčitý průběh a uplynulý čas. Korektura ukazuje stránku, procenta, čas a samostatný průběh OCR. Po načtení je výrazné tlačítko **Spustit korekturu**. Přetažení během přípravy bezpečně počká na hotové nástroje. Při zastavení se pracovní proces ihned ukončí; tlačítkem **Obnovit aplikaci** lze pokračovat bez znovuotevření HTML. Příprava a načítání mají timeout 120 s, kontrola timeout 180 s bez nového hlášení průběhu.

Knihy se načítají po stránkách, text v blocích s překryvem. Volitelná stylistika, povolená slova, výběr stran, průběh, zastavení, filtrování a stránkování seznamu jsou součástí rozhraní. Výstup zachovává všechny původní strany, text, rozměry, otočení a existující komentáře. U zaheslovaného PDF se zachová šifrování a heslo. OCR nezapisuje novou textovou vrstvu do skenu; přidává pouze anotace. Limity jsou 150 MB, 10 000 stran a 50 000 nálezů na kontrolu. Velké knihy je vhodné kontrolovat po rozsazích stran.

Pravopis používá český slovník LibreOffice/Hunspell přes Nspell. Gramatika, interpunkce a stylistika používají vybraná explicitní pravidla. Úplná větná analýza, shoda podmětu s přísudkem a všechny čárky ve větách nejsou pokryty. Nálezy jsou návrhy k posouzení. Jména a odborné výrazy lze přidat mezi povolená slova. Automatické přepisování textu PDF není součástí aplikace; výsledkem je anotované PDF.

## Internetový odkaz pro uživatele

Složka `dist/` je hotový statický web. Nahrajte její obsah na svůj HTTPS hosting; vstupní soubor musí mít název **index.html**. Poskytovatel pak přidělí skutečnou internetovou adresu. Žádný Pythonový server, databáze, tajné klíče nebo instalace na počítačích uživatelů nejsou potřeba.

Pro nasazení pouze přes prohlížeč lze použít například [Netlify Drop](https://app.netlify.com/drop): přihlaste se ke svému účtu a přetáhněte tam rozbalenou složku se statickým webem. Účet, dostupnost a veřejnou adresu spravuje poskytovatel. V této úloze nebyl hostingový účet připojen a veřejná adresa nebyla vytvořena. Soubor HTML lze také nahrát do existujícího webového prostoru nebo použít GitHub Pages podle pravidel vlastního účtu.

Vstupní HTML je větší, protože zahrnuje PDF engine, slovník a OCR. Pro hosting je vhodné běžné gzip/Brotli HTTP komprimování. Aplikace využívá blobové pracovní procesy a WebAssembly; případná vlastní Content Security Policy musí tyto součásti povolit. GitHub Pages a standardní statické hostování bez přidané CSP je podporují.

## Sestavení pro vývojáře

Běžný uživatel níže uvedené kroky neprovádí. Pro sestavení jsou potřeba Node 24 / npm a připnutý český OCR model:

```bash
# Z kořene repozitáře připravte model s ověřeným SHA-256:
python3 scripts/setup_ocr.py
cd web
npm ci
npm run build
npm test
```

`build.mjs` ověřuje slovník proti `data/cs_CZ/provenance.json` a OCR proti připnutému SHA-256. Model hledá v `KOREKTURA_TESSDATA`, cloudové složce `/workspace/.cloud-setup/korektura-knihy/tessdata` nebo v `../data/tessdata`. Komprimované součásti se po rozbalení znovu ověřují v prohlížeči pomocí SHA-256. NPM balíčky jsou připnuté v `package-lock.json`; použijte `npm ci` a zachovejte ověřování balíčků a TLS.

Sestavení vytvoří `dist/index.html`, `.nojekyll`, `sources.zip` a `build-provenance.json`. Zdrojový ZIP je také vložený v HTML a lze ho stáhnout v rozhraní. MuPDF používá AGPL-3.0-or-later, Nspell MIT, Tesseract.js / Tesseract.js-core a OCR model Apache-2.0. Původní licenční texty českého slovníku jsou přiložené. Preferované zdroje MuPDF jsou dostupné v původním projektu verze 1.28.1; odkazy a licenční text jsou v HTML a zdrojovém archivu.

## Ověření

`npm test` spouští 14 integračních a jazykových testů, včetně čekání na připravenost pracovního procesu, chyb, timeoutů a zastavení. Pro skutečný test v prohlížeči v připraveném cloudovém prostředí:

```bash
# V prvním procesu:
python3 -m http.server 8510 --bind 127.0.0.1 --directory web/dist
# V druhém procesu, z kořene repozitáře:
/workspace/.cloud-setup/korektura-knihy/venv/bin/python -u web/tests/browser_check.py
```

Tyto Pythonové příkazy slouží jen k vývojovému testování. Test načte HTML, odpojí veškerou síť a skutečně zpracuje a stáhne dokumenty v prohlížeči; kontroluje také OCR, heslo, otočení a původní pixely. Očekávání: 8 zpráv PASS, včetně přetažení PDF ještě během přípravy aplikace. Jiný testovací server lze určit proměnnou `KOREKTURA_BROWSER_TEST_URL`.

Cloudový Chromium administrátorsky blokuje lokální adresy `file://`, proto je zde skutečný test přes místní soubor omezen. Hostovaná stránka a veškeré zpracování po odpojení sítě jsou ověřené. Veřejné nasazení, přímé otevření souboru na Windows a Acrobat Reader zde nebyly ověřeny.

Regrese chyb a zotavení v prohlížeči: `python -u web/tests/loading_check.py` ze stejného venv a proti stejnému serveru. Ověřuje selhání přípravy, pád pracovního procesu, timeout načítání, průběh času, okamžité zastavení a úspěšné opakování kontroly. Očekávání: 4 zprávy PASS.

Kontrola stostránkové knihy: `python -u web/tests/book_check.py`. Vytvoří malé PDF se 100 textovými stranami, zkontroluje všechny strany bez sítě, skutečný průběh, 200 očekávaných korektur a stažené PDF se zachovanými textovými streamy i RGBA vykreslením původních stran.
