# Korektura knihy

Webová aplikace pro české korektury PDF. Nahrajete PDF z počítače, spustíte kontrolu a stáhnete původní dokument doplněný o zvýraznění a komentáře. Samostatný seznam návrhů je dostupný v CSV a JSON. Aplikace při kontrole nepřepisuje původní text ani sazbu.

## Doporučená verze: pouze webový prohlížeč, bez instalace

Verze **2.0** v `web/` zpracovává PDF a OCR **přímo v prohlížeči**. Nevyžaduje Python, spouštěč ani systémový Tesseract. Podporuje ChatGPT Plus pomocí ručního přenosu bloků, automatickou korekturu přes samostatně účtované API nebo základní pravidla bez internetu. Místní nástroje jsou přibaleny do jediného souboru HTML; jazykový model vyžaduje internet.

1. [Stáhněte hotovou aplikaci v ZIP](https://github.com/miloslav753/Korektura-knihy/raw/refs/heads/codex/browser-download/downloads/Korektura-knihy-bez-instalace.zip), rozbalte jej a otevřete **Korektura-knihy-2.0.html** (vývojové sestavení: `web/dist/index.html`).
2. Otevřete jej v aktuálním Chrome, Edge, Firefoxu nebo Safari.
3. Vyberte PDF, vyčkejte na načtení, nastavte rozsah a způsob kontroly a klikněte na **Spustit korekturu**.
4. Při použití **ChatGPT Plus** zkopírujte připravené zadání každého bloku do svého ChatGPT a celou JSON odpověď vložte zpět do aplikace. Až budou všechny bloky hotové, vytvořte PDF. Plus nezahrnuje API; plně automatický přenos z této aplikace v rámci Plus není dostupný.
5. Stáhněte PDF s komentáři a seznam v CSV nebo JSON. API režim provede přenos automaticky s vaším API klíčem a samostatným účtováním.

PDF a heslo zůstávají v paměti prohlížeče. API režim odesílá text vybraných stran s okolním kontextem poskytovateli modelu; Plus režim ho předává prostřednictvím vašeho ručního vložení do ChatGPT. Základní režim nic neodesílá. Aplikace funguje také na **statickém HTTPS hostingu**. Veřejná internetová adresa musí vzniknout skutečným nasazením na hosting; publikování cloudového vývojového prostředí ji nevytváří.

Ověřeno v Chromiu: načtení z interního statického serveru, následné úplné odpojení sítě, nahrání a stažení PDF/CSV/JSON, původní obsah a vykreslení, stylistika, rozsah, chybné PDF, heslo a zachované šifrování, otočení, české OCR a mobilní rozložení. Místní otevření přes `file://` je v cloudovém testovacím prohlížeči blokováno jeho administrátorskou politikou; přímé otevření souboru z disku zde nebylo možné ověřit. Přímý test v Acrobatu ani test na Windows nebyl proveden.

Zadání pro model zahrnuje český pravopis, gramatiku, čárky v souvětích, velká a malá písmena, volitelnou stylistiku a smysl vět. Ochranné kontroly odmítají návrhy měnící rozpoznané vlastní názvy, zkratky a cizojazyčné citace. Vlastní seznam umožňuje doplnit další chráněné názvy. Rozpoznávání je konzervativní a omylné; výsledky vyžadují posouzení. Qwen3 uvádí češtinu ve svých [trénovacích jazycích](https://qwenlm.github.io/blog/qwen3/). OpenAI nezveřejňuje úplné jazykové složení trénovacích dat GPT-4.1.

Ověřeno je zpracování připravených modelových odpovědí, odmítání chybných návrhů, API komunikace se simulovanou odpovědí a zachování PDF. Skutečná kvalita ChatGPT ani živá dostupnost API modelů bez účtu/klíče nebyla měřena. Podrobnosti sestavení, testů a hostování jsou v **web/README.md**. Zdrojový archiv a licence jsou vložené také přímo do HTML aplikace. Následující pokyny a rozsah základních pravidel platí pro původní Pythonovou verzi.

## Původní verze s Pythonem

Následující pokyny platí pro původní serverovou aplikaci `app.py`. Pro použití nové prohlížečové verze je nepotřebujete.

## Spuštění ve Windows

1. Nainstalujte **Python 3.12** z [python.org](https://www.python.org/downloads/) a při instalaci zaškrtněte **Add Python to PATH**.
2. Rozbalte celou aplikaci do složky na počítači.
3. Dvojklikem spusťte **Spustit-Windows.bat**. První spuštění stáhne knihovny; potřebuje připojení k internetu.
4. Otevře se webová stránka v prohlížeči. Vyberte PDF, nastavte kontrolu a klikněte na **Spustit korekturu**.
5. Výsledné PDF a seznam korektur uložíte tlačítky **Stáhnout**. Okno spouštěče nechte otevřené; jeho zavřením aplikaci ukončíte.

Textová PDF lze zpracovat bez dalších programů. Pro skenovaná PDF nainstalujte také Tesseract 5 a přidejte jeho program do PATH. Spouštěč potom připraví český OCR model. Pythonový spouštěč je připraven pro Windows, ale v cloudovém prostředí byl ověřen Linux; Windows je třeba ověřit na konkrétním počítači.

## Linux, macOS a vývoj

Python 3.12, poté v kořeni repozitáře:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m streamlit run app.py
```

Alternativně po instalaci použijte `bash scripts/run.sh`. V připraveném cloudu tento spouštěč používá již nainstalované prostředí `/workspace/.cloud-setup/korektura-knihy/venv`. Stránka se otevírá v prohlížeči; Pythonový server musí běžet po celou dobu používání. Cloudový vývojový server sám nevytváří veřejnou internetovou adresu.

Pro české OCR nainstalujte systémový **Tesseract 5**, potom spusťte:

```bash
python scripts/setup_ocr.py
```

Model se ukládá do ignorovaného `data/tessdata/`. V cloudu je dostupný v `/workspace/.cloud-setup/korektura-knihy/tessdata`. Vlastní umístění lze určit proměnnou `KOREKTURA_TESSDATA`. Stažení používá pevnou revizi a kontrolní součet SHA-256. Pravopis funguje i bez OCR. Při dostupné knihovně Hunspell aplikace používá rychlý nativní modul; jinak použije přenosný Pythonový Spylls.

## Co aplikace kontroluje

- **Pravopis:** český slovník Hunspell a vybrané časté chyby. Vlastní jména a odborné výrazy mohou být správné i mimo slovník; přidejte je mezi povolená slova.
- **Gramatika:** explicitní pravidla pro běžné chybné tvary podmiňovacího způsobu, dvojí stupňování a bezprostředně opakovaná slova.
- **Interpunkce a typografie:** mezery u znamének, zdvojená znaménka a více mezer uvnitř řádku.
- **Volitelná stylistika:** kratší varianty vybraných obratů. Doporučení lze vypnout.

Nálezy jsou návrhy k posouzení. Nejde o úplnou gramatickou analýzu češtiny: složitá větná stavba, shoda podmětu s přísudkem a všechny čárky ve větách nejsou pokryty. Literární styl a význam musí posoudit člověk. OCR může zaměnit znaky; zkontrolujte komentáře proti obrazu skenu.

## Dokumenty a výstupy

- Zpracování probíhá po stránkách a uvnitř stránky v blocích s překryvem. Zobrazí se průběh, počty kategorií a stránkovaný seznam nálezů.
- Lze vybrat rozsah stran; výstupní PDF stále obsahuje **všechny původní stránky**. Poznámky se přidávají pouze v kontrolovaném rozsahu.
- Stránky bez použitelného textu jsou oznámeny jako nezkontrolované, nikoli jako bezchybné.
- Limity: 150 MB na PDF, 10 000 stran a 50 000 nálezů na kontrolu. Pro rozsáhlé knihy zvolte menší rozsah stran.
- PDF používá standardní anotace **Highlight** s **QuadPoints** a českým komentářem pro panel Komentáře v Acrobat Readeru. Acrobat samotný v cloudu není dostupný; přímý test v něm nebyl proveden.
- Zachovají se obsah stránek, rozměry, otočení, existující komentáře a u zaheslovaného PDF také šifrování a heslo.
- CSV je UTF-8 s BOM pro českou diakritiku; JSON obsahuje také upozornění, rozsah a informace o OCR. CSV chrání text začínající znakem vzorce před automatickým spuštěním v tabulkovém editoru.
- Nahraná PDF a výsledky se neukládají do projektových souborů. Zůstávají v paměti relace a mohou být po dobu běhu dostupné serveru a jeho správci. Dočasné obrazy pro OCR se po zpracování odstraní. Text se neposílá externí jazykové službě. Aplikace není opatřena přihlášením; veřejné nasazení vyžaduje vhodnou autentizaci a HTTPS.

## Ověření

```bash
python -m pip install -r requirements-dev.txt
python -m pytest tests -q
```

Integrační testy ověřují českou morfologii, korekturní pravidla, exporty, anotace, neměnnost obsahu a vykreslení, rozsah stran, původní komentáře, otočení, hesla, spojování slov rozdělených sazbou a české OCR. OCR test vyžaduje Tesseract a český model. Unicode PDF testy potřebují DejaVuSans (`/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`).

Skutečný prohlížečový test nahrání a stažení, změny nastavení, hesla, skenu a mobilního rozložení:

```bash
# V prvním terminálu spusťte aplikaci.
bash scripts/run.sh --server.headless=true --server.address=127.0.0.1
# Ve druhém terminálu, s aktivním venv:
python tests/browser_check.py
```

Prohlížečový test používá systémový Chromium nebo Chromium nainstalované přes `python -m playwright install chromium`. Jiný server lze určit pomocí `KOREKTURA_TEST_URL`. V cloudu je systémový Chromium připraven.

## Slovníky a licence

Český slovník pochází z [LibreOffice/dictionaries](https://github.com/LibreOffice/dictionaries), revize a kontrolní součty jsou v `data/cs_CZ/provenance.json`. Původní autorské a licenční podmínky jsou přiloženy v `README_cs.txt` a `README_en.txt`; slovník je distribuován podle těchto podmínek. Český OCR model pochází z [tesseract-ocr/tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) (Apache-2.0). Závislosti mají vlastní licence; PyMuPDF používá AGPL nebo komerční licenci.
