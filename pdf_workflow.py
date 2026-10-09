"""Read PDFs page by page and add standard PDF comments without rewriting text."""
from __future__ import annotations

import csv
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

import pymupdf

from proofreading import Finding, check_text

COLORS = {"Pravopis": (1, .65, .15), "Gramatika": (1, .35, .35),
          "Interpunkce": (.3, .65, 1), "Typografie": (.25, .75, .55), "Stylistika": (.7, .45, 1)}
_CLOUD_TESSDATA = Path("/workspace/.cloud-setup/korektura-knihy/tessdata")
DEFAULT_TESSDATA = _CLOUD_TESSDATA if _CLOUD_TESSDATA.is_dir() else Path(__file__).parent / "data" / "tessdata"


@dataclass
class Correction:
    id: int
    page: int
    category: str
    original: str
    replacement: str
    message: str
    source: str


@dataclass
class Result:
    pdf: bytes
    csv: bytes
    json: bytes
    corrections: list[Correction]
    counts: dict[str, int]
    checked_pages: int
    ocr_pages: list[int]
    skipped_pages: list[int]
    warnings: list[str]
    total_pages: int


def open_pdf(data: bytes, password: str = "") -> pymupdf.Document:
    if len(data) > 150 * 1024 * 1024:
        raise ValueError("PDF je větší než 150 MB. Rozdělte jej na menší části.")
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except (pymupdf.FileDataError, RuntimeError) as error:
        raise ValueError("Soubor se nepodařilo přečíst jako PDF.") from error
    if doc.needs_pass and not doc.authenticate(password):
        doc.close()
        raise ValueError("PDF je chráněno heslem. Zadejte správné heslo.")
    if not len(doc) or len(doc) > 10000:
        doc.close()
        raise ValueError("PDF musí obsahovat 1 až 10 000 stran.")
    return doc


def extract_page(page: pymupdf.Page) -> tuple[str, list[tuple[tuple, int] | None]]:
    text, positions = [], []
    line_id = 0
    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                for char in span.get("chars", []):
                    text.extend(char["c"])
                    positions.extend([(tuple(char["bbox"]), line_id)] * len(char["c"]))
            text.append("\n")
            positions.append(None)
            line_id += 1
    # Join words split by a typesetting hyphen, preserving each glyph's position.
    joined = "".join(text)
    remove = set()
    for match in re.finditer(r"[^\W\d_][\-\u00ad]\n(?=[^\W\d_])", joined):
        remove.update((match.start() + 1, match.start() + 2))
    return "".join(char for index, char in enumerate(text) if index not in remove), [position for index, position in enumerate(positions) if index not in remove]


def ocr_available() -> bool:
    tessdata = Path(os.environ.get("KOREKTURA_TESSDATA", str(DEFAULT_TESSDATA)))
    return bool(shutil.which("tesseract") and (tessdata / "ces.traineddata").is_file())


def extract_ocr(page: pymupdf.Page) -> tuple[str, list[tuple[tuple, int] | None]]:
    if not ocr_available():
        raise ValueError("České OCR není nainstalované. Spusťte scripts/setup_ocr.py.")
    tessdata = os.environ.get("KOREKTURA_TESSDATA", str(DEFAULT_TESSDATA))
    scale = min(2.8, (20_000_000 / (page.rect.width * page.rect.height)) ** .5)
    with tempfile.TemporaryDirectory(prefix="korektura-ocr-") as directory:
        image = Path(directory) / "page.png"
        page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False).save(image)
        try:
            completed = subprocess.run(["tesseract", str(image), "stdout", "--tessdata-dir", tessdata,
                                        "-l", "ces", "--psm", "3", "-c", "tessedit_create_tsv=1"],
                                       capture_output=True, text=True, timeout=120, check=True)
        except (subprocess.SubprocessError, OSError) as error:
            raise ValueError("OCR stránky selhalo. Zkuste menší rozsah nebo kvalitnější sken.") from error
    text, positions = [], []
    previous_line, line_id = None, -1
    reader = csv.DictReader(io.StringIO(completed.stdout), delimiter="\t")
    if not reader.fieldnames or not {"level", "text", "left", "top", "width", "height"}.issubset(reader.fieldnames):
        raise ValueError("OCR nevrátilo text s polohami slov. Zkontrolujte instalaci Tesseractu.")
    for row in reader:
        word = row.get("text", "").strip()
        if row.get("level") != "5" or not word:
            continue
        line_key = tuple(row[key] for key in ("block_num", "par_num", "line_num"))
        if text:
            text.append(" " if line_key == previous_line else "\n")
            positions.append(None)
        if line_key != previous_line:
            line_id += 1
        previous_line = line_key
        x, y, width, height = (int(row[key]) / scale for key in ("left", "top", "width", "height"))
        rect = pymupdf.Rect(x, y, x + width, y + height) * page.derotation_matrix
        text.extend(word)
        positions.extend([(tuple(rect), line_id)] * len(word))
    return "".join(text), positions


def page_findings(text: str, stylistic: bool, ignored: tuple[str, ...]) -> list[Finding]:
    # Overlap captures rules crossing block boundaries; absolute offsets deduplicate.
    found = {}
    start = 0
    while start < len(text):
        end = min(start + 6000, len(text))
        if end < len(text):
            boundary = text.rfind(" ", start + 5000, end)
            if boundary != -1:
                end = boundary
            else:
                while end < len(text) and not text[end].isspace():
                    end += 1
        for item in check_text(text[start:end], stylistic, ignored):
            absolute = Finding(item.start + start, item.end + start, item.category,
                               item.original, item.replacement, item.message)
            found[(absolute.start, absolute.end, absolute.category)] = absolute
        if end == len(text):
            break
        start = max(start + 1, end - 200)
        while start < end and not text[start - 1].isspace():
            start += 1
    ordered = sorted(found.values(), key=lambda item: (item.start, -item.end))
    unique = []
    for item in ordered:
        if not unique or item.start >= unique[-1].end:
            unique.append(item)
    return unique


def rectangles(positions, finding: Finding) -> list[pymupdf.Rect]:
    lines = {}
    for entry in positions[finding.start:finding.end]:
        if entry is not None:
            bbox, line_id = entry
            rect = pymupdf.Rect(bbox)
            if not rect.is_empty and not rect.is_infinite:
                if line_id in lines:
                    lines[line_id] |= rect
                else:
                    lines[line_id] = rect
    return list(lines.values())


def process_pdf(data: bytes, *, stylistic: bool = False, use_ocr: bool = True,
                first_page: int = 1, last_page: int | None = None, password: str = "",
                ignored_words: tuple[str, ...] = (), progress: Callable | None = None) -> Result:
    corrections, warnings, ocr_pages, skipped = [], [], [], []
    checked = 0
    with open_pdf(data, password) as doc:
        total = len(doc)
        last = total if last_page is None else last_page
        if not 1 <= first_page <= last <= total:
            raise ValueError("Vyberte platný rozsah stran PDF.")
        for index in range(first_page - 1, last):
            page = doc[index]
            if progress:
                progress(index - first_page + 1, last - first_page + 1, index + 1)
            text, positions = extract_page(page)
            source = "Text PDF"
            if len(text.strip()) < 30 and (page.get_images() or not text.strip()):
                if use_ocr and ocr_available():
                    text, positions = extract_ocr(page)
                    source = "OCR"
                    ocr_pages.append(index + 1)
                elif page.get_images():
                    skipped.append(index + 1)
                    warnings.append(f"Strana {index + 1}: sken bez textu, nebyla zkontrolována. Zapněte české OCR.")
                    continue
            if not text.strip():
                skipped.append(index + 1)
                warnings.append(f"Strana {index + 1}: nebyl nalezen text ke kontrole.")
                continue
            checked += 1
            for finding in page_findings(text, stylistic, ignored_words):
                rects = rectangles(positions, finding)
                if not rects:
                    raise ValueError(f"Nález na straně {index + 1} se nepodařilo přiřadit k místu v PDF.")
                if len(corrections) >= 50000:
                    raise ValueError("Více než 50 000 nálezů. Zpracujte menší rozsah stran.")
                correction = Correction(len(corrections) + 1, index + 1, finding.category,
                                        finding.original, finding.replacement, finding.message, source)
                annotation = page.add_highlight_annot(rects)
                annotation.set_colors(stroke=COLORS[finding.category])
                annotation.set_opacity(.35)
                proposal = finding.replacement or ("(bez návrhu; ověřte slovo)" if finding.category == "Pravopis" else "(odstranit)")
                annotation.set_info(title="Korektura knihy", subject=finding.category,
                    content=f"#{correction.id} · {finding.category}\nPůvodní: {finding.original}\n"
                            f"Návrh: {proposal}\n{finding.message}")
                annotation.update()
                corrections.append(correction)
            if progress:
                progress(index - first_page + 2, last - first_page + 1, index + 1)
        pdf = doc.tobytes(garbage=0, deflate=True, encryption=pymupdf.PDF_ENCRYPT_KEEP)
    counts = dict(Counter(item.category for item in corrections))
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(["Číslo", "Strana", "Kategorie", "Původní text", "Návrh opravy", "Komentář", "Zdroj"])
    for item in corrections:
        # Avoid spreadsheet formula execution when opening arbitrary book text.
        cells = [item.id, item.page, item.category, item.original, item.replacement, item.message, item.source]
        writer.writerow(["'" + cell if isinstance(cell, str) and cell.startswith(("=", "+", "-", "@")) else cell for cell in cells])
    details = {"counts": counts, "checked_pages": checked, "total_pages": total,
               "selected_pages": [first_page, last], "ocr_pages": ocr_pages,
               "skipped_pages": skipped, "warnings": warnings,
               "corrections": [asdict(item) for item in corrections]}
    return Result(pdf, buffer.getvalue().encode("utf-8-sig"),
                  json.dumps(details, ensure_ascii=False, indent=2).encode("utf-8"),
                  corrections, counts, checked, ocr_pages, skipped, warnings, total)
