from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import unicodedata
from pathlib import Path

import pymupdf
import streamlit as st

from pdf_workflow import COLORS, ocr_available, open_pdf, process_pdf

st.set_page_config(page_title="Korektura knihy", page_icon="📖", layout="wide")


def page_count(number):
    word = "strana" if number == 1 else "strany" if 2 <= number <= 4 else "stran"
    return f"{number} {word}"


st.markdown("""
<style>
.stApp {background: #f8f6f1; color: #243b43;}
.stMainBlockContainer {max-width: 1150px; padding-top: 2.2rem;}
h1,h2,h3 {font-family: Georgia, 'Times New Roman', serif !important; color: #163b43;}
h1 {font-size: 3.2rem !important; letter-spacing: -.08rem;}
[data-testid="stFileUploader"] {background: white; border-radius: 16px; padding: 16px;}
[data-testid="stMetric"] {background: white; padding: 18px; border-radius: 12px;}
.book-eyebrow {font-size: .76rem; letter-spacing: .18rem; color: #697b77; font-weight: 700;}
.book-lead {font-size: 1.15rem; color: #63736e; max-width: 720px; margin-bottom: 24px;}
.book-steps {display: flex; flex-wrap: wrap; gap: 24px; padding: 14px 0 24px; color: #53665f;}
.book-steps span b {color: #a56b3b; margin-right: 8px;}
div[data-testid="stDownloadButton"] button {width: 100%;}
[data-testid="stToolbar"] {display: none;}
@media(max-width: 600px) {h1 {font-size: 2.3rem !important;} .book-steps {gap: 12px;}}
</style>
<div class="book-eyebrow">ČESKÝ TEXT · PŮVODNÍ SAZBA · PŘEHLEDNÉ KOREKTURY</div>
""", unsafe_allow_html=True)
st.title("Každé slovo na svém místě.")
st.markdown('<div class="book-lead">Nahrajte knihu v PDF. Projděte návrhy oprav a stáhněte si dokument s komentáři — ve stejném vzhledu jako originál.</div>'
            '<div class="book-steps"><span><b>01</b> Nahrajte PDF</span><span><b>02</b> Spusťte kontrolu</span><span><b>03</b> Stáhněte korektury</span></div>', unsafe_allow_html=True)

left, right = st.columns([1.5, 1], gap="large")
with left:
    st.subheader("Vaše kniha")
    uploaded = st.file_uploader("Vyberte PDF z počítače", type=["pdf"],
                                help="Původní soubor zůstane beze změny. Výsledek si stáhnete jako nové PDF.")
    st.caption("Zpracování probíhá na serveru této aplikace. Text se neposílá externí jazykové službě.")
with right:
    st.subheader("Rozsah kontroly")
    st.write("Český pravopis, běžné gramatické chyby, interpunkční mezery a typografie.")
    stylistic = st.checkbox("Přidat stylistická doporučení", value=False,
                            help="Nabídne kratší varianty vybraných formulací. Rozhodnutí o autorském stylu zůstává na vás.")
    has_ocr = ocr_available()
    use_ocr = st.checkbox("Rozpoznat text naskenovaných stran (OCR)", value=has_ocr, disabled=not has_ocr)
    if not has_ocr:
        st.caption("České OCR není v tomto prostředí dostupné. Textové PDF lze zkontrolovat.")

with st.expander("Co tato kontrola umí"):
    st.write("Pravopis používá český slovník Hunspell. Gramatická pravidla hledají například chybné podoby „by jste“, „aby jsme“ a opakovaná slova. Interpunkční kontrola hledá nesprávné mezery a zdvojená znaménka; neurčuje všechny čárky ve větách. Stylistická kontrola navrhuje zkrácení vybraných obratů.")
    st.write("Nálezy jsou návrhy k posouzení. Složitá větná stavba, shoda podmětu s přísudkem a literární styl vyžadují další kontrolu. Jména a odborné termíny můžete přidat mezi povolená slova. OCR může zaměnit znaky.")
    st.write("Výstup zachová původní text a stránky. Opravy se ukládají jako standardní PDF zvýraznění a komentáře pro Acrobat Reader; text se automaticky nepřepisuje.")

if uploaded is None:
    st.session_state.pop("proofreading_result", None)
    st.session_state.pop("result_key", None)
    st.divider()
    st.caption("Korektura knihy · Podpora české diakritiky · PDF, CSV a JSON")
    st.stop()

data = uploaded.getvalue()
password = ""
try:
    with pymupdf.open(stream=data, filetype="pdf") as probe:
        needs_password = probe.needs_pass
    if needs_password:
        password = st.text_input("Heslo k PDF", type="password")
    with open_pdf(data, password) as doc:
        pages = len(doc)
except (ValueError, pymupdf.FileDataError, RuntimeError) as error:
    st.error(str(error) if isinstance(error, ValueError) else "Vybraný soubor se nepodařilo otevřít jako PDF.")
    st.stop()

st.caption(f"{uploaded.name} · {page_count(pages)} · {len(data) / (1024 * 1024):.1f} MB")
with st.expander("Vybrat stránky a povolená slova"):
    col1, col2 = st.columns(2)
    first = int(col1.number_input("Od strany", min_value=1, max_value=pages, value=1, step=1))
    last = int(col2.number_input("Do strany", min_value=1, max_value=pages, value=pages, step=1))
    ignored = st.text_area("Povolená slova", placeholder="Například příjmení a názvy: Novotný, Hvozdnice",
                           help="Oddělte čárkou, mezerou nebo novým řádkem. Tato slova se nebudou označovat jako pravopisné nálezy.")
ignored_words = tuple(word for word in re.split(r"[,\s]+", ignored.strip()) if word)
settings = json.dumps([stylistic, use_ocr, first, last, ignored_words, password], ensure_ascii=False)
result_key = hashlib.sha256(data + settings.encode()).hexdigest()
if st.session_state.get("result_key") != result_key:
    st.session_state.pop("proofreading_result", None)

run = st.button("Spustit korekturu", type="primary", width="stretch", disabled=first > last)
if first > last:
    st.error("Počáteční strana musí být menší nebo rovna koncové straně.")
if run:
    progress_bar = st.progress(0, text="Připravuji dokument…")

    def update(done, total, page):
        progress_bar.progress(min(done / total, 1.0), text=f"Kontroluji stranu {page} · {done}/{total} dokončeno")

    try:
        with st.spinner("Provádím korekturu. U rozsáhlé knihy může kontrola chvíli trvat."):
            result = process_pdf(data, stylistic=stylistic, use_ocr=use_ocr,
                                 first_page=first, last_page=last, password=password,
                                 ignored_words=ignored_words, progress=update)
        st.session_state["proofreading_result"] = result
        st.session_state["result_key"] = result_key
    except ValueError as error:
        st.error(str(error))
    except Exception:
        logging.exception("PDF proofreading failed")
        st.error("Kontrolu se nepodařilo dokončit. Zkuste menší rozsah stran nebo jiné PDF.")
    finally:
        progress_bar.empty()

result = st.session_state.get("proofreading_result")
if result is None:
    st.stop()

st.divider()
st.subheader("Vaše korektury")
if result.checked_pages == 0:
    st.warning("Žádnou stránku nebylo možné jazykově zkontrolovat. Výstup není potvrzením bezchybnosti textu.")
else:
    st.success(f"Kontrola dokončena: {page_count(result.checked_pages)}. Původní text a sazba byly zachovány.")
metrics = st.columns(4)
metrics[0].metric("Nálezy celkem", len(result.corrections))
metrics[1].metric("Stylistická doporučení", result.counts.get("Stylistika", 0))
metrics[2].metric("Zkontrolované strany", result.checked_pages)
metrics[3].metric("Strany s OCR", len(result.ocr_pages))
for warning in result.warnings[:20]:
    st.warning(warning)
if len(result.warnings) > 20:
    st.caption("Další upozornění jsou uvedena v exportu JSON.")

ascii_name = unicodedata.normalize("NFKD", Path(uploaded.name).stem).encode("ascii", "ignore").decode()
stem = re.sub(r"[^\w .-]", "_", ascii_name)[:100] or "kniha"
downloads = st.columns(3)
downloads[0].download_button("Stáhnout PDF s korekturami", result.pdf, f"{stem}_korektury.pdf", "application/pdf", on_click="ignore", width="stretch")
downloads[1].download_button("Stáhnout seznam (CSV)", result.csv, f"{stem}_korektury.csv", "text/csv", on_click="ignore", width="stretch")
downloads[2].download_button("Stáhnout podrobnosti (JSON)", result.json, f"{stem}_korektury.json", "application/json", on_click="ignore", width="stretch")
st.caption("PDF obsahuje zvýraznění a komentáře. V Acrobat Readeru je najdete v panelu Komentáře. CSV lze otevřít v tabulkovém editoru.")

if result.corrections:
    st.write(" · ".join(f"{category}: {result.counts[category]}" for category in COLORS if category in result.counts))
    filter_col, search_col = st.columns([1, 2])
    category = filter_col.selectbox("Kategorie", ["Všechny"] + list(result.counts))
    search = search_col.text_input("Hledat v korekturách", placeholder="Původní text, návrh nebo komentář").casefold()
    filtered = [item for item in result.corrections if (category == "Všechny" or item.category == category)
                and (not search or search in (item.original + " " + item.replacement + " " + item.message).casefold())]
    if filtered:
        total_table_pages = math.ceil(len(filtered) / 50)
        table_key = "table_page_" + hashlib.sha256((result_key + category + search).encode()).hexdigest()[:16]
        table_page = int(st.number_input("Stránka seznamu", min_value=1, max_value=total_table_pages, value=1, key=table_key))
        selection = filtered[(table_page - 1) * 50:table_page * 50]
        st.dataframe([{"Číslo": item.id, "Strana": item.page, "Kategorie": item.category,
                       "Původní text": item.original, "Návrh": item.replacement,
                       "Komentář": item.message, "Zdroj": item.source} for item in selection],
                     hide_index=True, width="stretch")
        st.caption(f"Zobrazeno {len(selection)} z {len(filtered)} nalezených míst. Stažené soubory obsahují všechny korektury.")
    else:
        st.info("Zadanému filtru neodpovídá žádná korektura.")
elif result.checked_pages:
    st.info("V kontrolovaném rozsahu nebyly nalezeny chyby podle dostupného slovníku a pravidel.")
