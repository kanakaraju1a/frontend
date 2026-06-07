import subprocess
import sys
import shutil
from pathlib import Path


def ps_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def convert_doc_to_pdf(input_path, output_path):
    input_path = Path(input_path).resolve()
    output_path = Path(output_path).resolve()
    office = shutil.which("soffice") or shutil.which("libreoffice")
    if office:
        result = subprocess.run(
            [
                office,
                "--headless",
                "--convert-to",
                "pdf",
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
            raise RuntimeError((result.stderr or result.stdout or "LibreOffice conversion failed.").strip())
        if generated != output_path:
            generated.replace(output_path)
        return

    command = f"""
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {{
  $doc = $word.Documents.Open({ps_quote(input_path)}, $false, $true)
  try {{
    $doc.ExportAsFixedFormat({ps_quote(output_path)}, 17)
  }} finally {{
    $doc.Close($false)
  }}
}} finally {{
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}}
"""
    result = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        capture_output=True,
        text=True,
        timeout=180,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "Microsoft Word conversion failed.").strip())


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python convert_doc.py input.docx output.pdf")
    convert_doc_to_pdf(sys.argv[1], sys.argv[2])
