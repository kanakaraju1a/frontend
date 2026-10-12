import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfReader, PdfWriter

from convert_spreadsheet import (
    convert_spreadsheet_to_pdf,
    normalize_calc_pdf_to_letter,
    prepare_ooxml_workbook,
)


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
                generated = Path(command[-1]).with_suffix(".pdf")
                writer = PdfWriter()
                writer.add_blank_page(width=595.28, height=841.89)
                with generated.open("wb") as result_file:
                    writer.write(result_file)
                return type("Result", (), {"returncode": 0, "stderr": "", "stdout": ""})()

            with patch("convert_spreadsheet.shutil.which", return_value="/usr/bin/libreoffice"), patch("convert_spreadsheet.subprocess.run", side_effect=fake_run):
                convert_spreadsheet_to_pdf(source, output)

            converted = PdfReader(output)
            self.assertAlmostEqual(float(converted.pages[0].mediabox.width), 612, places=1)
            self.assertAlmostEqual(float(converted.pages[0].mediabox.height), 792, places=1)

    def test_a4_pdf_is_normalized_to_letter_without_rasterizing(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as tmp:
            folder = Path(tmp)
            source = folder / "source.pdf"
            output = folder / "output.pdf"
            writer = PdfWriter()
            writer.add_blank_page(width=595.28, height=841.89)
            with source.open("wb") as source_file:
                writer.write(source_file)

            normalize_calc_pdf_to_letter(source, output)

            converted = PdfReader(output)
            self.assertEqual(len(converted.pages), 1)
            self.assertAlmostEqual(float(converted.pages[0].mediabox.width), 612, places=1)
            self.assertAlmostEqual(float(converted.pages[0].mediabox.height), 792, places=1)

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
