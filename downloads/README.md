# Korektura knihy 2.2 – automaticky

ZIP `Korektura-knihy-2.2.zip` rozbalte a otevřete `Korektura-knihy-2.2.html`.
Vyberte PDF, zadejte API klíč OpenAI nebo OpenRouter a spusťte korekturu.
Kniha se zpracuje po blocích bez ručního kopírování nebo vkládání JSON.
Na konci vznikne jedno PDF s anotacemi. OCR je přibalené.

ChatGPT Plus samotné API přístup nezahrnuje. API má samostatné účtování.
Hotové bloky se ukládají v prohlížeči, případně lze stáhnout a znovu načíst
zálohu `.korektura`. Kartu a počítač během běhu ponechte aktivní.

Ověřeno na 300stránkovém PDF s více než milionem znaků za použití řízených
odpovědí API; nešlo o placené volání živého modelu. Windows Edge a přímé
file:// nejsou v cloudu dostupné k přímému testu.

Oprava 2.1.2 zlepšuje kotvení návrhů podle rozložení textu PDF a přidává konkrétní důvody odmítnutí. Staré zálohy lze znovu ověřit bez opětovného volání hotových bloků do API.

Verze 2.1.2 rozlišuje HTTP chyby přihlášení, oprávnění, modelu, kreditu a rychlostního limitu. Nezobrazuje části API klíče.


Verze 2.2 přidává skutečné slovníkové podklady k promptu, požadavek úplné kontroly
včetně popisků a poznámek pod čarou, OCR obrazových oblastí i na smíšených stranách
a přehled o pokrytí stran v JSON. PDF komentáře mají tři sekce s tučnými nadpisy
Původní znění / Návrh opraveného znění / Odůvodnění návrhu.

Změna zadání vyžaduje novou kontrolu; staré odpovědi 2.1.x se nepoužijí jako
splnění nového zadání a API může novou kontrolu účtovat. Zálohy 2.2 lze obnovovat.
