import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / ".python_packages"))

from pdf2docx import Converter


def convert_pdf_to_docx(pdf_path, docx_path):
    converter = Converter(str(pdf_path))
    try:
        converter.convert(str(docx_path), start=0, end=None)
    finally:
        converter.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python convert_pdf.py input.pdf output.docx")
    convert_pdf_to_docx(Path(sys.argv[1]), Path(sys.argv[2]))
