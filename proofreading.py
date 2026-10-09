"""Local Czech spelling and explicit, explainable proofreading rules."""
from __future__ import annotations

import ctypes
import ctypes.util
import hashlib
import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from threading import Lock

DATA = Path(__file__).parent / "data" / "cs_CZ"
WORD = re.compile(r"[^\W\d_]+(?:[’'][^\W\d_]+)?", re.UNICODE)


@dataclass(frozen=True)
class Finding:
    start: int
    end: int
    category: str
    original: str
    replacement: str
    message: str


class CzechDictionary:
    def __init__(self):
        manifest = json.loads((DATA / "provenance.json").read_text())
        for name, expected in manifest["sha256"].items():
            if hashlib.sha256((DATA / name).read_bytes()).hexdigest() != expected:
                raise RuntimeError(f"Kontrolní součet slovníku nesouhlasí: {name}")
        self.lock = Lock()
        library = ctypes.util.find_library("hunspell-1.7") or ctypes.util.find_library("hunspell")
        self.lib = ctypes.CDLL(library) if library else None
        if self.lib:
            lib = self.lib
            lib.Hunspell_create.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
            lib.Hunspell_create.restype = ctypes.c_void_p
            lib.Hunspell_spell.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
            lib.Hunspell_spell.restype = ctypes.c_int
            lib.Hunspell_suggest.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.POINTER(ctypes.c_char_p)), ctypes.c_char_p]
            lib.Hunspell_suggest.restype = ctypes.c_int
            lib.Hunspell_free_list.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.POINTER(ctypes.c_char_p)), ctypes.c_int]
            lib.Hunspell_destroy.argtypes = [ctypes.c_void_p]
            self.handle = lib.Hunspell_create(str(DATA / "cs_CZ.aff").encode(), str(DATA / "cs_CZ.dic").encode())
            if not self.handle:
                raise RuntimeError("Český pravopisný slovník se nepodařilo otevřít.")
        else:
            from spylls.hunspell import Dictionary
            self.dictionary = Dictionary.from_files(str(DATA / "cs_CZ"))

    @lru_cache(maxsize=50000)
    def accepts(self, word: str) -> bool:
        with self.lock:
            if self.lib:
                return bool(self.lib.Hunspell_spell(self.handle, word.encode("utf-8")))
            return self.dictionary.lookup(word)

    @lru_cache(maxsize=10000)
    def suggestions(self, word: str) -> tuple[str, ...]:
        with self.lock:
            if self.lib:
                items = ctypes.POINTER(ctypes.c_char_p)()
                count = self.lib.Hunspell_suggest(self.handle, ctypes.byref(items), word.encode("utf-8"))
                try:
                    return tuple(items[index].decode("utf-8") for index in range(min(count, 3)))
                finally:
                    self.lib.Hunspell_free_list(self.handle, ctypes.byref(items), count)
            from itertools import islice
            return tuple(islice(self.dictionary.suggest(word), 3))


@lru_cache(maxsize=1)
def get_dictionary() -> CzechDictionary:
    return CzechDictionary()


GRAMMAR = [
    (r"\bby\s+jste\b", "byste", "Podmiňovací způsob se píše jako jedno slovo: byste."),
    (r"\bby\s+jsme\b", "bychom", "Spisovný tvar podmiňovacího způsobu je bychom."),
    (r"\bby\s+jsi\b", "bys", "Spisovný tvar podmiňovacího způsobu je bys."),
    (r"\baby\s+jste\b", "abyste", "Správný tvar je abyste."),
    (r"\baby\s+jsme\b", "abychom", "Spisovný tvar je abychom."),
    (r"\baby\s+jsem\b", "abych", "Správný tvar je abych."),
    (r"\baby\s+jsi\b", "abys", "Správný tvar je abys."),
    (r"\bkdyby\s+jste\b", "kdybyste", "Správný tvar je kdybyste."),
    (r"\bkdyby\s+jsme\b", "kdybychom", "Spisovný tvar je kdybychom."),
    (r"\bkdyby\s+jsem\b", "kdybych", "Správný tvar je kdybych."),
    (r"\bkdyby\s+jsi\b", "kdybys", "Správný tvar je kdybys."),
    (r"\bvíce\s+lepší\b", "lepší", "Dvojí stupňování: postačuje lepší."),
    (r"\bnejvíce\s+nejlepší\b", "nejlepší", "Dvojí stupňování: postačuje nejlepší."),
]
STYLE = [
    (r"\bv\s+současné\s+době\b", "nyní"),
    (r"\bv\s+tomto\s+okamžiku\b", "teď"),
    (r"\bz\s+důvodu\s+toho,\s+že\b", "protože"),
    (r"\bosobně\s+si\s+myslím\b", "myslím"),
    (r"\bv\s+každém\s+případě\b", "každopádně"),
]
KNOWN_TYPOS = {"vyjímka": "výjimka", "standartní": "standardní", "samozdřejmě": "samozřejmě",
               "nashledanou": "na shledanou", "narozdíl": "na rozdíl", "mimojiné": "mimo jiné"}


def check_text(text: str, stylistic: bool = False, ignored_words: tuple[str, ...] = ()) -> list[Finding]:
    dictionary = get_dictionary()
    findings: list[Finding] = []
    occupied: list[tuple[int, int]] = []

    def add(start, end, category, replacement, message, protect=True):
        if any(start < right and end > left for left, right in occupied):
            return
        original = text[start:end]
        if original[:1].isupper() and replacement:
            replacement = replacement[0].upper() + replacement[1:]
        findings.append(Finding(start, end, category, original, replacement, message))
        if protect:
            occupied.append((start, end))

    for pattern, replacement, message in GRAMMAR:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            add(*match.span(), "Gramatika", replacement, message)
    for match in re.finditer(r"\b([^\W\d_]+)(\s+)\1\b", text, re.IGNORECASE):
        add(*match.span(), "Gramatika", match.group(1), "Stejné slovo se opakuje bezprostředně za sebou; ověřte, zda je opakování záměrné.")

    protected = [match.span() for match in re.finditer(r"https?://\S+|www\.\S+|[\w.+-]+@[\w.-]+\.[\w]+", text)]
    ignored = {word.casefold() for word in ignored_words}
    for match in WORD.finditer(text):
        word = match.group()
        if len(word) < 2 or len(word) > 64 or word.isupper() or word.casefold() in ignored:
            continue
        if any(match.start() < end and match.end() > start for start, end in protected + occupied):
            continue
        if word.casefold() in KNOWN_TYPOS:
            add(*match.span(), "Pravopis", KNOWN_TYPOS[word.casefold()], "Běžná pravopisná chyba.")
        elif not dictionary.accepts(word):
            candidates = dictionary.suggestions(word)
            add(*match.span(), "Pravopis", candidates[0] if candidates else "",
                "Slovo není v českém slovníku. Ověřte zejména vlastní jména a odborné výrazy."
                + (" Možnosti: " + ", ".join(candidates) + "." if candidates else ""))

    for match in re.finditer(r"(?<=\S)[ \t]+(?=[,.;:!?])", text):
        add(*match.span(), "Interpunkce", "", "Před tímto interpunkčním znaménkem nemá být mezera.")
    for match in re.finditer(r"[,;:!?](?=[^\W\d_])", text):
        if any(match.start() >= left and match.start() < right for left, right in protected):
            continue
        add(*match.span(), "Interpunkce", match.group() + " ", "Za interpunkčním znaménkem chybí mezera.")
    for match in re.finditer(r"([,;:])\1+", text):
        add(*match.span(), "Interpunkce", match.group(1), "Opakované interpunkční znaménko.")
    for match in re.finditer(r"(?<=\S)[ \t]{2,}(?=\S)", text):
        add(*match.span(), "Typografie", " ", "Vícenásobná mezera uvnitř řádku; ověřte, zda není součástí sazby.")
    if stylistic:
        for pattern, replacement in STYLE:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                add(*match.span(), "Stylistika", replacement,
                    "Volitelné zkrácení formulace. Použijte jen tehdy, pokud zachová význam a autorský hlas.")
    return sorted(findings, key=lambda item: (item.start, item.end))
