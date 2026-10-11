import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from convert_spreadsheet import convert_spreadsheet_to_pdf, prepare_ooxml_workbook


class SpreadsheetConversionTests(unittest.TestCase):
    def test_libreoffice_calc_export_moves_generated_pdf(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as tmp:
            folder = Path(tmp)
            source = folder / "quarterly.xlsx"
            output = folder / "output.pdf"
            worksheet = b'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:Z40"/><pageMargins left="0.3" right="0.3" top="1" bottom="0.5" header="0" footer="0"/><pageSetup paperSize="9" orientation="portrait" scale="75"/></worksheet>'''
            with zipfile.ZipFile(source, "w") as workbook:
                workbook.writestr("xl/worksheets/sheet1.xml", worksheet)
                workbook.writestr("placeholder.txt", b"keep me")

            def fake_run(command, **_kwargs):
                self.assertTrue(any("calc_pdf_Export" in argument for argument in command))
                self.assertTrue(any("UseLosslessCompression" in argument for argument in command))
                self.assertTrue(any(argument.startswith("-env:UserInstallation=") for argument in command))
                Path(command[-1]).with_suffix(".pdf").write_bytes(b"%PDF-result")
                return type("Result", (), {"returncode": 0, "stderr": "", "stdout": ""})()

            with patch("convert_spreadsheet.shutil.which", return_value="/usr/bin/libreoffice"), patch("convert_spreadsheet.subprocess.run", side_effect=fake_run):
                convert_spreadsheet_to_pdf(source, output)

            self.assertEqual(output.read_bytes(), b"%PDF-result")

    def test_print_preparation_preserves_page_settings_and_fits_sheet(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as tmp:
            folder = Path(tmp)
            source = folder / "source.xlsx"
            prepared = folder / "prepared.xlsx"
            worksheet = b'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:AQ43"/><pageMargins left="0.5" right="0.5" top="1.8" bottom="0.3" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" scale="75" r:id="rId1"/></worksheet>'''
            with zipfile.ZipFile(source, "w") as workbook:
                workbook.writestr("xl/worksheets/sheet1.xml", worksheet)

            prepare_ooxml_workbook(source, prepared)

            with zipfile.ZipFile(prepared) as workbook:
                xml = workbook.read("xl/worksheets/sheet1.xml").decode("utf-8")
            self.assertIn('paperSize="9"', xml)
            self.assertIn('orientation="portrait"', xml)
            self.assertIn('top="1.8"', xml)
            self.assertIn('fitToPage="1"', xml)
            self.assertIn('fitToWidth="1"', xml)
            self.assertIn('fitToHeight="1"', xml)
            self.assertIn('xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"', xml)
            self.assertIn('r:id="rId1"', xml)
            self.assertNotIn('scale="75"', xml)


if __name__ == "__main__":
    unittest.main()
