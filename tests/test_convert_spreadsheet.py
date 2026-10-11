import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from convert_spreadsheet import convert_spreadsheet_to_pdf


class SpreadsheetConversionTests(unittest.TestCase):
    def test_libreoffice_calc_export_moves_generated_pdf(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as tmp:
            folder = Path(tmp)
            source = folder / "quarterly.xlsx"
            output = folder / "output.pdf"
            source.write_bytes(b"PK workbook")

            def fake_run(command, **_kwargs):
                self.assertIn("pdf:calc_pdf_Export", command)
                (folder / "quarterly.pdf").write_bytes(b"%PDF-result")
                return type("Result", (), {"returncode": 0, "stderr": "", "stdout": ""})()

            with patch("convert_spreadsheet.shutil.which", return_value="/usr/bin/libreoffice"), patch("convert_spreadsheet.subprocess.run", side_effect=fake_run):
                convert_spreadsheet_to_pdf(source, output)

            self.assertEqual(output.read_bytes(), b"%PDF-result")


if __name__ == "__main__":
    unittest.main()
