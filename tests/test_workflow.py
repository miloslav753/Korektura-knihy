import csv
import io
import json
from pathlib import Path

import pymupdf
import pytest

from pdf_workflow import extract_page, ocr_available, page_findings, process_pdf
from proofreading import check_text, get_dictionary

FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")


@pytest.fixture
def make_pdf():
    def create(texts, rotation=0, password=None):
        assert FONT.is_file(), "Install DejaVuSans before running Unicode PDF integration tests"
        with pymupdf.open() as doc:
            for text in texts:
                page = doc.new_page()
                page.insert_font(fontname="czech", fontfile=str(FONT))
                page.insert_text((40, 70), text, fontname="czech", fontsize=16)
                page.set_rotation(rotation)
            return doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256,
                               owner_pw=password, user_pw=password) if password else doc.tobytes()
    return create


@pytest.mark.parametrize("original,replacement", [("by jste", "byste"), ("aby jsme", "abychom"),
                                                   ("kdyby jsem", "kdybych"), ("by jsi", "bys")])
def test_grammar(original, replacement):
    findings = check_text("Chtěl " + original + " přijít.")
    assert any(item.category == "Gramatika" and item.original == original and item.replacement == replacement for item in findings)


def test_spelling_morphology_ignores_and_style():
    dictionary = get_dictionary()
    assert dictionary.accepts("žluťoučký")
    assert dictionary.accepts("knihami")
    assert not dictionary.accepts("samozdřejmě")
    text = "Samozdřejmě čteme knihu. V současné době by jste chtěl přijít. Xqznovák."
    result = check_text(text, stylistic=True, ignored_words=("Xqznovák",))
    assert {item.category for item in result} == {"Pravopis", "Stylistika", "Gramatika"}
    assert any(item.replacement == "Samozřejmě" for item in result)
    assert not any(item.original == "Xqznovák" for item in result)
    assert not any(item.category == "Stylistika" for item in check_text(text))


def test_punctuation_and_protected_addresses():
    result = check_text("Ano ,ale ne,, opravdu. https://example.org/a:b www.example.cz test@example.cz")
    punctuation = [item for item in result if item.category == "Interpunkce"]
    assert any(item.original == " " and not item.replacement for item in punctuation)
    assert any(item.replacement == ", " for item in punctuation)
    assert any(item.original == ",," and item.replacement == "," for item in punctuation)
    assert not any("example" in item.original for item in result)


def test_annotations_exports_and_original_content(make_pdf):
    original = make_pdf(["Chtěl by jste přijít. To je vyjímka,ano.", "V současné době čteme knihu."])
    progress = []
    result = process_pdf(original, stylistic=True, progress=lambda *args: progress.append(args))
    assert result.checked_pages == 2
    assert result.counts == {"Gramatika": 1, "Pravopis": 1, "Interpunkce": 1, "Stylistika": 1}
    assert len(result.corrections) == 4
    assert progress[-1] == (2, 2, 2)
    with pymupdf.open(stream=original, filetype="pdf") as before, pymupdf.open(stream=result.pdf, filetype="pdf") as after:
        assert len(before) == len(after)
        for old, new in zip(before, after):
            assert old.get_text() == new.get_text()
            assert old.read_contents() == new.read_contents()
            assert old.rect == new.rect
            assert old.get_pixmap(annots=False, alpha=True).samples == new.get_pixmap(annots=False, alpha=True).samples
        annotations = [(annotation.type, dict(annotation.info), annotation.xref)
                       for page in after for annotation in page.annots()]
        assert len(annotations) == 4
        assert all(item[0][1] == "Highlight" for item in annotations)
        assert all("/QuadPoints" in after.xref_object(item[2]) for item in annotations)
        assert any("vyjímka" in item[1]["content"] for item in annotations)
    rows = list(csv.DictReader(io.StringIO(result.csv.decode("utf-8-sig"))))
    assert len(rows) == 4
    assert any(row["Návrh opravy"] == "výjimka" for row in rows)
    metadata = json.loads(result.json)
    assert metadata["counts"] == result.counts
    assert len(metadata["corrections"]) == 4


def test_page_range_and_existing_comments(make_pdf):
    data = make_pdf(["To je vyjímka.", "To je vyjímka.", "To je vyjímka."])
    with pymupdf.open(stream=data, filetype="pdf") as original:
        comment = original[0].add_text_annot((100, 100), "Původní komentář")
        comment.update()
        data = original.tobytes()
    result = process_pdf(data, first_page=2, last_page=2)
    assert result.checked_pages == 1
    assert all(item.page == 2 for item in result.corrections)
    with pymupdf.open(stream=result.pdf, filetype="pdf") as doc:
        assert len(doc) == 3
        assert len(list(doc[0].annots())) == 1
        assert list(doc[0].annots())[0].info["content"] == "Původní komentář"
        assert len(list(doc[1].annots())) == 1
        assert len(list(doc[2].annots())) == 0


def test_rotated_page_coordinates(make_pdf):
    original = make_pdf(["To je vyjímka."], rotation=90)
    result = process_pdf(original)
    with pymupdf.open(stream=result.pdf, filetype="pdf") as doc:
        page = doc[0]
        assert page.rotation == 90
        annotation = list(page.annots())[0]
        word = page.search_for("vyjímka")[0]
        assert annotation.rect.contains(word)


def test_password_and_invalid_pdf(make_pdf):
    data = make_pdf(["To je vyjímka."], password="tajne")
    with pytest.raises(ValueError, match="heslem"):
        process_pdf(data)
    result = process_pdf(data, password="tajne")
    assert result.counts["Pravopis"] == 1
    with pymupdf.open(stream=result.pdf, filetype="pdf") as encrypted:
        assert encrypted.needs_pass
        assert encrypted.authenticate("tajne")
    with pytest.raises(ValueError):
        process_pdf(b"not a PDF")
    with pytest.raises(ValueError, match="rozsah"):
        process_pdf(make_pdf(["Kniha."]), first_page=2)


def test_hyphenated_line_mapping(make_pdf):
    data = make_pdf(["Knihy jsou samo-\nzdřejmě zajímavé."])
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        text, positions = extract_page(doc[0])
    assert "samozdřejmě" in text
    assert len(text) == len(positions)
    result = process_pdf(data)
    assert any(item.original == "samozdřejmě" for item in result.corrections)


def test_block_overlap_and_long_words():
    text = "kniha " * 997 + "by jste " + "kniha " * 1100
    findings = page_findings(text, False, ())
    grammar = [item for item in findings if item.original == "by jste"]
    assert len(grammar) == 1
    assert text[grammar[0].start:grammar[0].end] == "by jste"
    assert page_findings("q" * 20000, False, ()) == []


def test_scan_ocr_and_preservation(make_pdf):
    assert ocr_available(), "Czech OCR must be installed for the integration run"
    text_pdf = make_pdf(["To je vyjímka. Chtěl by jste přijít."])
    with pymupdf.open(stream=text_pdf, filetype="pdf") as text_doc:
        image = text_doc[0].get_pixmap(matrix=pymupdf.Matrix(2, 2)).tobytes("png")
    with pymupdf.open() as scanned:
        page = scanned.new_page()
        page.insert_image(page.rect, stream=image)
        scan = scanned.tobytes()
    skipped = process_pdf(scan, use_ocr=False)
    assert skipped.checked_pages == 0 and skipped.skipped_pages == [1]
    result = process_pdf(scan, use_ocr=True)
    assert result.checked_pages == 1 and result.ocr_pages == [1]
    assert any(item.original == "vyjímka" for item in result.corrections)
    assert any(item.category == "Gramatika" for item in result.corrections)
    with pymupdf.open(stream=scan, filetype="pdf") as original, pymupdf.open(stream=result.pdf, filetype="pdf") as corrected:
        assert corrected[0].get_text() == ""
        assert original[0].get_pixmap(annots=False, alpha=True).samples == corrected[0].get_pixmap(annots=False, alpha=True).samples
