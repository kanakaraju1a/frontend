import tempfile
import unittest
import zipfile
from pathlib import Path

import fitz

from convert_pdf import convert_pdf_to_docx


class PdfToDocumentTests(unittest.TestCase):
    def test_visual_docx_contains_rendered_page_and_page_dimensions(self):
        with tempfile.TemporaryDirectory(prefix="fileflow-test-") as tmp:
            root = Path(tmp)
            pdf_path = root / "sample.pdf"
            docx_path = root / "sample.docx"
            document = fitz.open()
            page = document.new_page(width=420, height=300)
            page.insert_text((48, 80), "FileFlow conversion test")
            document.save(pdf_path)
            document.close()

            convert_pdf_to_docx(pdf_path, docx_path)

            self.assertTrue(docx_path.exists())
            self.assertGreater(docx_path.stat().st_size, 1000)
            with zipfile.ZipFile(docx_path) as archive:
                self.assertIn("word/media/page-1.png", archive.namelist())
                document_xml = archive.read("word/document.xml").decode("utf-8")
                self.assertIn('w:w="8400"', document_xml)
                self.assertIn('w:h="6000"', document_xml)


if __name__ == "__main__":
    unittest.main()
