# Korektura knihy bez instalace

[Stáhnout aplikaci v ZIP](https://github.com/miloslav753/Korektura-knihy/raw/refs/heads/codex/browser-download/downloads/Korektura-knihy-bez-instalace.zip)

ZIP rozbalte a soubor `Korektura-knihy-1.2.html` otevřete v aktuálním Chrome nebo Edge. Vyberte PDF, spusťte kontrolu a stáhněte PDF s komentáři. Python ani jiný program nemusíte instalovat. Soubor obsahuje český slovník a OCR; dokument se zpracovává místně v prohlížeči.

Kontrola nabízí pravopis a základní gramatická, interpunkční a volitelná stylistická pravidla. Úplná syntaktická kontrola české gramatiky není implementována. Původní text PDF se zachovává a korektury jsou standardní PDF anotace. Zdrojový kód a licence můžete stáhnout z rozhraní aplikace.

Při blokovaném přímém stažení otevřete soubor ZIP na GitHubu a zvolte **Download raw file**.

Verze **1.1** opravuje zaseknuté přetažení PDF během přípravy a doplňuje průběh načítání, kontroly a OCR, uplynulý čas, zastavení a obnovení po chybě. Po načtení PDF klikněte na **Spustit korekturu**.

Verze **1.2** opravuje spuštění pracovního procesu z místního HTML souboru v prohlížečích používajících neprůhledný bezpečnostní původ. Přibalené součásti se nadále ověřují SHA-256 i tam, kde pracovním procesům chybí WebCrypto. Otevřete nový soubor **Korektura-knihy-1.2.html**; starší verze nemusí tuto opravu obsahovat.
