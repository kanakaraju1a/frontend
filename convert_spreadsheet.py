import shutil
import subprocess
from pathlib import Path

from convert_doc import ps_quote


def convert_spreadsheet_to_pdf(input_path, output_path):
    input_path = Path(input_path).resolve()
    output_path = Path(output_path).resolve()
    office = shutil.which("soffice") or shutil.which("libreoffice")
    if office:
        result = subprocess.run(
            [
                office,
                "--headless",
                "--convert-to",
                "pdf:calc_pdf_Export",
                "--outdir",
                str(output_path.parent),
                str(input_path),
            ],
            capture_output=True,
            text=True,
            timeout=180,
        )
        generated = output_path.parent / f"{input_path.stem}.pdf"
        if result.returncode != 0 or not generated.exists():
            raise RuntimeError((result.stderr or result.stdout or "LibreOffice Calc conversion failed.").strip())
        if generated != output_path:
            generated.replace(output_path)
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
