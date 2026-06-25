"""Tests for pdf_parser."""

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from parsers.pdf_parser import (
    convert_pdf_to_markdown,
    _text_to_markdown,
    _table_to_markdown,
    _is_likely_heading,
)


def _create_test_pdf() -> str | None:
    """Create a minimal test PDF with some text."""
    try:
        # Try reportlab first
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas
    except ImportError:
        try:
            # Try fpdf2
            from fpdf import FPDF
        except ImportError:
            return None
        else:
            pdf = FPDF()
            pdf.add_page()
            pdf.set_font("Helvetica", size=12)
            pdf.cell(200, 10, text="Test PDF Document", align="C")
            pdf.ln(20)
            pdf.set_font("Helvetica", size=10)
            pdf.multi_cell(0, 10, text="This is a test PDF with some content for parsing.")
            pdf.ln(10)
            pdf.set_font("Helvetica", "B", size=10)
            pdf.cell(0, 10, text="Section Heading")
            fd, path = tempfile.mkstemp(suffix=".pdf")
            with os.fdopen(fd, "wb") as f:
                f.write(pdf.output())
            return path

    # reportlab approach
    fd, path = tempfile.mkstemp(suffix=".pdf")
    c = canvas.Canvas(path, pagesize=letter)
    c.drawString(100, 750, "Test PDF Document")
    c.drawString(100, 700, "This is a test PDF with some content.")
    c.save()
    return path


def test_convert_pdf_basic():
    """Test basic PDF to markdown conversion."""
    pdf_path = _create_test_pdf()
    if pdf_path is None:
        print("SKIP: no PDF library available (reportlab or fpdf2)")
        return

    try:
        result = convert_pdf_to_markdown(pdf_path)

        # Should not be empty
        assert len(result.strip()) > 0, "Result should not be empty"
        # Should contain some text
        assert "Test" in result or "test" in result.lower()

        print(f"PASS: test_convert_pdf_basic (output {len(result)} chars)")
    finally:
        os.unlink(pdf_path)


def test_text_normalization():
    """Test text normalization helper."""
    text = "Line 1\n\n\n\nLine 2"
    result = _text_to_markdown(text)
    assert "Line 1\n\nLine 2" in result
    print("PASS: test_text_normalization")


def test_table_conversion():
    """Test Markdown table conversion."""
    data = [
        ["Header 1", "Header 2"],
        ["Cell 1", "Cell 2"],
        ["Cell 3", "Cell 4"],
    ]
    result = _table_to_markdown(data)
    assert "| Header 1 | Header 2 |" in result
    assert "| Cell 1 | Cell 2 |" in result
    assert "---" in result
    print("PASS: test_table_conversion")


def test_heading_detection():
    """Test heuristic heading detection."""
    assert _is_likely_heading("CHAPTER ONE") == 1
    assert _is_likely_heading("1.1 Introduction to Topic") == 2
    assert _is_likely_heading("1.1.1 Detailed Analysis") == 3
    assert _is_likely_heading("This is just a normal sentence that goes on.") is None
    print("PASS: test_heading_detection")


def test_empty_table():
    """Test empty table handling."""
    assert _table_to_markdown([]) == ""
    assert _table_to_markdown([[], []]) == ""
    print("PASS: test_empty_table")


if __name__ == "__main__":
    test_text_normalization()
    test_table_conversion()
    test_heading_detection()
    test_empty_table()
    test_convert_pdf_basic()
    print("\nAll pdf parser tests passed!")
