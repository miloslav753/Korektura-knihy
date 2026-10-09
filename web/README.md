# Korektura knihy bez instalace

Samostatná HTML aplikace pro aktuální webové prohlížeče. PDF, český slovník a české OCR se zpracovávají ve Web Workeru a WebAssembly přímo na zařízení uživatele. PDF a heslo zůstávají v prohlížeči. Místní knihovny a OCR model jsou vložené do HTML; nevyžaduje CDN. Jazykový model se používá přes ruční přenos do ChatGPT nebo volitelné externí API. Výstupy jsou standardní PDF zvýraznění s českými komentáři a samostatné CSV / JSON.

## Použití

Otevřete sestavený `dist/index.html` v prohlížeči. Soubor v distribučním ZIP se jmenuje **Korektura-knihy-2.0.html**. Není potřeba žádný instalátor ani Python. Stránku lze načíst také z HTTPS hostingu. Místní PDF/OCR a základní pravidla pracují bez sítě; jazykový model potřebuje internet.

Výchozí volba **ChatGPT Plus – ruční přenos bloků** připraví text s kontextem a zadání pro každý blok. Zadání zkopírujte do svého ChatGPT, celou JSON odpověď vložte do aplikace a potvrďte. Bloky se nabídnou postupně; PDF lze vytvořit až po přijetí odpovědi pro všechny bloky. Plus nezahrnuje API, takže není možné z této aplikace automaticky čerpat předplatné. Nepředáváte heslo ani přihlášení ChatGPT aplikaci.

Volba **Jazykový model – automaticky přes API** používá OpenAI GPT-4.1 nebo OpenRouter Qwen3-235B Instruct (`qwen/qwen3-235b-a22b-2507`). Zadejte API klíč příslušného poskytovatele do pole v aplikaci; neposílejte jej v chatu ani v knize. API má samostatné účtování mimo Plus. Klíč se drží pouze v paměti relace a neukládá se do reportů, zadání ani lokálního úložiště. Poskytovateli se posílá text vybraných stran s okolním kontextem. Volba **Základní pravidla – bez internetu** nic neodesílá.

Příprava aplikace a načítání PDF mají vlastní ukazatel průběhu. Čtení z disku ukazuje MB a procenta; při otevírání PDF se zobrazuje neurčitý průběh a uplynulý čas. Korektura ukazuje stránku, procenta, čas a samostatný průběh OCR. Po načtení je výrazné tlačítko **Spustit korekturu**. Přetažení během přípravy bezpečně počká na hotové nástroje. Při zastavení se pracovní proces ihned ukončí; tlačítkem **Obnovit aplikaci** lze pokračovat bez znovuotevření HTML. Příprava a načítání mají timeout 120 s, kontrola timeout 180 s bez nového hlášení průběhu.

Knihy se načítají po stránkách, text v blocích s překryvem. Volitelná stylistika, povolená slova, výběr stran, průběh, zastavení, filtrování a stránkování seznamu jsou součástí rozhraní. Výstup zachovává všechny původní strany, text, rozměry, otočení a existující komentáře. U zaheslovaného PDF se zachová šifrování a heslo. OCR nezapisuje novou textovou vrstvu do skenu; přidává pouze anotace. Limity jsou 150 MB, 10 000 stran a 50 000 nálezů na kontrolu. Velké knihy je vhodné kontrolovat po rozsazích stran.

Zadání jazykovému modelu pokrývá celé věty, shodu podmětu s přísudkem, chybějící a nadbytečné čárky, velká a malá písmena, volitelnou stylistiku a smysl vět. Text se dělí přibližně po 3500 znacích, s 1000 znaky okolního kontextu; věta může pokračovat přes stránku. Vybraný rozsah má limit milion znaků. Návrh musí obsahovat doslovnou část zdroje, jednoznačné místo, kategorii a vysvětlení. Nejednoznačný nález, překryv nebo poškození chráněné části se odmítne. Nejistý významový problém je poznámkou bez automaticky vymyšlené opravy.

Rozpoznaná příjmení, geografické názvy, ustálené zkratky a německé, francouzské, latinské a anglické citace se chrání. Názvy lze upravit pouze změnou velikosti písmen v příslušné kategorii. Vlastní seznam může chránit další slova i celé názvy (oddělené čárkou, středníkem nebo novým řádkem); ty se nemění ani při opravě velkých písmen. Jazyková detekce používá Franc-all 7.2.0. Krátké a nejisté citace zůstávají konzervativně chráněné, tedy někdy i české citace. Rozpoznávání i samotný model mohou chybovat.

Qwen3 má podle [oficiální dokumentace](https://qwenlm.github.io/blog/qwen3/) v tréninku 119 jazyků včetně češtiny. To není zárukou kvality korektury české knihy. Úplné jazykové složení tréninku GPT-4.1 OpenAI nezveřejňuje. Přesnost konkrétního modelu je potřeba ověřit na vlastním textu. Dostupnost API modelů se řídí poskytovatelem. Výstup zůstává anotovaným PDF, které zachovává text a sazbu.

Základní režim používá český slovník LibreOffice/Hunspell přes Nspell a vybraná explicitní pravidla. Úplná větná analýza, shoda podmětu s přísudkem a všechny čárky v tomto režimu nejsou pokryty.

## Internetový odkaz pro uživatele

Složka `dist/` je hotový statický web. Nahrajte její obsah na svůj HTTPS hosting; vstupní soubor musí mít název **index.html**. Poskytovatel pak přidělí skutečnou internetovou adresu. Žádný Pythonový server, databáze nebo instalace na počítačích uživatelů nejsou potřeba. Pouze automatická online korektura vyžaduje uživatelův API klíč.

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

Sestavení vytvoří `dist/index.html`, `.nojekyll`, `sources.zip` a `build-provenance.json`. Zdrojový ZIP je také vložený v HTML a lze ho stáhnout v rozhraní. MuPDF používá AGPL-3.0-or-later, Nspell, Noble hashes a Franc MIT, Tesseract.js / Tesseract.js-core a OCR model Apache-2.0. Původní licenční texty českého slovníku jsou přiložené. Preferované zdroje MuPDF jsou dostupné v původním projektu verze 1.28.1; odkazy a licenční text jsou v HTML a zdrojovém archivu.

## Ověření

`npm test` spouští 28 integračních a jazykových testů, včetně čekání na připravenost pracovního procesu, chyb, timeoutů a zastavení. Pro skutečný test v prohlížeči v připraveném cloudovém prostředí:

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

## Spuštění z místního souboru (verze 1.2)

Pracovní proces i PDF engine jsou sestavené jako klasické skripty. Asynchronní inicializace MuPDF se uzavře do async funkce; engine se načte z přibaleného blobu pomocí `importScripts`. Nevzniká module fetch, který Chromium při neprůhledném původu místního souboru odmítá. Build ověřuje syntaxi obou klasických skriptů. Slovník, WASM, OCR a jejich kontrolní součty se stále načítají pouze z HTML. Pokud pracovním procesům chybí WebCrypto, hash se ověří stejným SHA-256 pomocí připnutého Noble hashes 2.0.1 (MIT); ověřování se nevynechává.

Regrese: `python -u web/tests/opaque_origin_check.py` proti stejnému internímu serveru. Celé sestavené HTML se otevře v povoleném sandboxovaném rámci s neprůhledným původem, obdobným místnímu souboru. Bez sítě ověří spuštění, stostránkové PDF, stažení a české OCR. Očekávání: 3 zprávy PASS. Původní module worker zde selhával přesně hláškou o zastavení pracovního procesu bez detailů. Administrátorská politika cloudového Chromia pro `file://` zůstává nezměněná; tento test neopravňuje k tvrzení, že byl proveden přímý test souboru na Windows nebo v Edge.


## Ověření jazykového modelu ve verzi 2.0

`python -u web/tests/model_browser_check.py` z kořene repozitáře se stejným venv a interním serverem ověřuje celý ruční postup Plus s připravenou odpovědí, chybné ID knihy, přesné kotvení chybějících/nadbytečných čárek, velkých písmen, stylistiky a významové poznámky. Ověří odmítnutí zásahu do názvu, zkratky a čtyř cizojazyčných citací, skutečné stažení PDF a neměnnost textu i vykreslení. Také ověří API komunikaci se simulovaným poskytovatelem, chybějící kredit, metadata spotřeby, nepřítomnost klíče v reportu, povinnost odpovědi pro každý blok a mobilní šířku formuláře. Očekávání: 4 zprávy PASS.

Tyto testy používají připravené JSON odpovědi a simulované API. Nejde o měření jazykové kvality skutečného modelu ani potvrzení živé dostupnosti poskytovatelů. Bez uživatelského účtu/klíče nebyl proveden žádný skutečný modelový požadavek. Přímý test v Edge na Windows a Acrobat Readeru zůstává neprovedený.
