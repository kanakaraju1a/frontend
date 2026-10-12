import shutil
import subprocess
import zipfile
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree

from convert_doc import ps_quote
from pypdf import PdfReader, PdfWriter, Transformation


SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
A4_WIDTH = 595.28
A4_HEIGHT = 841.89
LETTER_WIDTH = 612
LETTER_HEIGHT = 792
EXCEL_LETTER_SCALE = 0.9275


def normalize_calc_pdf_to_letter(input_path, output_path):
    """Place A4 Calc pages on Letter canvases using Excel-compatible geometry."""
    reader = PdfReader(input_path)
    writer = PdfWriter()
    for source_page in reader.pages:
        width = float(source_page.mediabox.width)
        height = float(source_page.mediabox.height)
        is_portrait_a4 = abs(width - A4_WIDTH) < 2 and abs(height - A4_HEIGHT) < 2
        is_landscape_a4 = abs(width - A4_HEIGHT) < 2 and abs(height - A4_WIDTH) < 2
        if not (is_portrait_a4 or is_landscape_a4):
            writer.add_page(source_page)
            continue

        target_width, target_height = (
            (LETTER_WIDTH, LETTER_HEIGHT) if is_portrait_a4 else (LETTER_HEIGHT, LETTER_WIDTH)
        )
        scaled_width = width * EXCEL_LETTER_SCALE
        scaled_height = height * EXCEL_LETTER_SCALE
        x_offset = (target_width - scaled_width) / 2
        y_offset = max(0, (target_height - scaled_height) / 5)
        target_page = writer.add_blank_page(width=target_width, height=target_height)
        target_page.merge_transformed_page(
            source_page,
            Transformation().scale(EXCEL_LETTER_SCALE).translate(x_offset, y_offset),
        )

    with open(output_path, "wb") as output:
        writer.write(output)


def prepare_ooxml_workbook(input_path, output_path):
    """Preserve Excel print metadata while fitting each worksheet to one PDF page."""
    input_path = Path(input_path)
    output_path = Path(output_path)
    with zipfile.ZipFile(input_path, "r") as source, zipfile.ZipFile(output_path, "w") as target:
        for item in source.infolist():
            data = source.read(item.filename)
            if item.filename.startswith("xl/worksheets/sheet") and item.filename.endswith(".xml"):
                namespaces = {}
                for _event, (prefix, uri) in ElementTree.iterparse(BytesIO(data), events=("start-ns",)):
                    namespaces[prefix] = uri
                for prefix, uri in namespaces.items():
                    if prefix != "xml" and not (prefix.startswith("ns") and prefix[2:].isdigit()):
                        ElementTree.register_namespace(prefix or "", uri)
                root = ElementTree.fromstring(data)
                qualified = lambda name: f"{{{SPREADSHEET_NS}}}{name}"

                sheet_properties = root.find(qualified("sheetPr"))
                if sheet_properties is None:
                    sheet_properties = ElementTree.Element(qualified("sheetPr"))
                    root.insert(0, sheet_properties)
                page_setup_properties = sheet_properties.find(qualified("pageSetUpPr"))
                if page_setup_properties is None:
                    page_setup_properties = ElementTree.SubElement(sheet_properties, qualified("pageSetUpPr"))
                page_setup_properties.set("fitToPage", "1")
                page_setup_properties.set("autoPageBreaks", "0")

                page_setup = root.find(qualified("pageSetup"))
                if page_setup is None:
                    page_setup = ElementTree.Element(qualified("pageSetup"))
                    page_margins = root.find(qualified("pageMargins"))
                    insert_at = list(root).index(page_margins) + 1 if page_margins is not None else len(root)
                    root.insert(insert_at, page_setup)
                page_setup.attrib.pop("scale", None)
                page_setup.set("fitToWidth", "1")
                page_setup.set("fitToHeight", "1")
                data = ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)
            target.writestr(item, data)


def convert_spreadsheet_to_pdf(input_path, output_path):
    input_path = Path(input_path).resolve()
    output_path = Path(output_path).resolve()
    office = shutil.which("soffice") or shutil.which("libreoffice")
    if office:
        conversion_source = input_path
        if input_path.suffix.lower() in {".xlsx", ".xlsm"}:
            conversion_source = output_path.parent / f"{input_path.stem}-print-ready{input_path.suffix.lower()}"
            try:
                prepare_ooxml_workbook(input_path, conversion_source)
            except (OSError, zipfile.BadZipFile, ElementTree.ParseError) as exc:
                raise ValueError("The uploaded Excel workbook is invalid or damaged.") from exc
        profile_dir = output_path.parent / ".libreoffice-profile"
        profile_dir.mkdir(exist_ok=True)
        pdf_options = (
            'pdf:calc_pdf_Export:{"UseLosslessCompression":{"type":"boolean","value":"true"},'
            '"Quality":{"type":"long","value":"100"},'
            '"ReduceImageResolution":{"type":"boolean","value":"false"}}'
        )
        result = subprocess.run(
            [
                office,
                f"-env:UserInstallation={profile_dir.as_uri()}",
                "--headless",
                "--nologo",
                "--nodefault",
                "--nolockcheck",
                "--nofirststartwizard",
                "--convert-to",
                pdf_options,
                "--outdir",
                str(output_path.parent),
                str(conversion_source),
            ],
            capture_output=True,
            text=True,
            timeout=180,
        )
        generated = output_path.parent / f"{conversion_source.stem}.pdf"
        if result.returncode != 0 or not generated.exists():
            raise RuntimeError((result.stderr or result.stdout or "LibreOffice Calc conversion failed.").strip())
        normalized = output_path.parent / f"{conversion_source.stem}-letter.pdf"
        normalize_calc_pdf_to_letter(generated, normalized)
        normalized.replace(output_path)
        if generated != output_path:
            generated.unlink(missing_ok=True)
        return

    if not shutil.which("powershell"):
        raise RuntimeError("Excel to PDF is unavailable because LibreOffice Calc is not installed on the backend.")

    command = f"""
$ErrorActionPreference = 'Stop'
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {{
  $book = $excel.Workbooks.Open({ps_quote(input_path)}, 0, $true)
  try {{
    $book.ExportAsFixedFormat(0, {ps_quote(output_path)})
  }} finally {{
    $book.Close($false)
  }}
}} finally {{
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}}
"""
    result = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        capture_output=True,
        text=True,
        timeout=180,
    )
    if result.returncode != 0 or not output_path.exists():
        raise RuntimeError((result.stderr or result.stdout or "Microsoft Excel conversion failed.").strip())
