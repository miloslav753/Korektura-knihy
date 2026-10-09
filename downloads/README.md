# Korektura knihy bez instalace

[Stáhnout aplikaci v ZIP](https://github.com/miloslav753/Korektura-knihy/raw/refs/heads/codex/browser-download/downloads/Korektura-knihy-bez-instalace.zip)

ZIP rozbalte a soubor **Korektura-knihy-2.0.html** otevřete v aktuálním Chrome nebo Edge. Python ani jiný program nemusíte instalovat. PDF a OCR se zpracovávají místně v prohlížeči.

Verze **2.0** nabízí tři postupy:

1. **ChatGPT Plus – ruční přenos bloků:** vložte PDF a spusťte korekturu. Zadání každého bloku zkopírujte do svého [ChatGPT](https://chatgpt.com/), jeho celou JSON odpověď vložte zpět do aplikace a potvrďte. Po načtení odpovědí všech bloků vytvořte a stáhněte PDF. Toto využívá váš účet Plus, bez API klíče; přenos odpovědí není automatický.
2. **Jazykový model – automaticky přes API:** zadejte klíč OpenAI pro GPT-4.1 nebo OpenRouter pro Qwen3-235B Instruct. Text se posílá po blocích s kontextem. API se účtuje samostatně a není součástí předplatného Plus.
3. **Základní pravidla – bez internetu:** původní slovník a elementární korektura, bez úplné větné analýzy.

Zadání pro model pokrývá českou gramatiku, chybějící i nadbytečné čárky, velká a malá písmena, volitelnou stylistiku a smysl vět. Aplikace ověřuje místo návrhu ve zdroji a chrání rozpoznané názvy, příjmení, zkratky a cizojazyčné citace. Další názvy můžete přidat do vlastního seznamu. Jazyková detekce i model jsou omylné; krátké nebo nejisté citace se chrání konzervativně, tedy i některé české citace. Výsledky posuďte.

Původní text PDF se zachovává a korektury jsou standardní PDF anotace. Seznam lze stáhnout v CSV a JSON. Zdrojový kód a licence jsou dostupné v rozhraní. Testy ověřily zpracování připravených odpovědí a PDF; skutečná kvalita modelu nebyla bez přístupu k účtu nebo API klíči měřena.

Při blokovaném přímém stažení otevřete soubor ZIP na GitHubu a zvolte **Download raw file**.

Verze **1.1** opravuje zaseknuté přetažení PDF během přípravy a doplňuje průběh načítání, kontroly a OCR, uplynulý čas, zastavení a obnovení po chybě. Po načtení PDF klikněte na **Spustit korekturu**.

Verze **1.2** opravuje spuštění pracovního procesu z místního HTML souboru v prohlížečích používajících neprůhledný bezpečnostní původ. Přibalené součásti se nadále ověřují SHA-256 i tam, kde pracovním procesům chybí WebCrypto. Otevřete nový soubor **Korektura-knihy-1.2.html**; starší verze nemusí tuto opravu obsahovat.
