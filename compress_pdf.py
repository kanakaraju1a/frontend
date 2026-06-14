import shutil
import subprocess
from pathlib import Path


def _ghostscript_binary():
    for name in ("gs", "gswin64c", "gswin32c"):
        found = shutil.which(name)
        if found:
            return found
    return None


def _settings_for_strength(strength):
    value = max(1, min(100, int(strength or 60)))
    image_dpi = round(240 - (value * 1.65))
    image_dpi = max(72, min(220, image_dpi))
    jpeg_quality = round(96 - (value * 0.58))
    jpeg_quality = max(38, min(92, jpeg_quality))
    return image_dpi, jpeg_quality


def compress_pdf(input_path, output_path, strength=60):
    gs = _ghostscript_binary()
    if not gs:
        raise RuntimeError(
            "PDF compression is unavailable because Ghostscript is not installed on the backend."
        )

    input_path = Path(input_path)
    output_path = Path(output_path)
    image_dpi, jpeg_quality = _settings_for_strength(strength)

    cmd = [
        gs,
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        "-dDetectDuplicateImages=true",
        "-dCompressFonts=true",
        "-dSubsetFonts=true",
        "-dAutoRotatePages=/None",
        "-dColorImageDownsampleType=/Bicubic",
        "-dGrayImageDownsampleType=/Bicubic",
        "-dMonoImageDownsampleType=/Subsample",
        "-dDownsampleColorImages=true",
        "-dDownsampleGrayImages=true",
        "-dDownsampleMonoImages=true",
        f"-dColorImageResolution={image_dpi}",
        f"-dGrayImageResolution={image_dpi}",
        f"-dMonoImageResolution={max(150, image_dpi * 2)}",
        f"-dJPEGQ={jpeg_quality}",
        f"-sOutputFile={output_path}",
        str(input_path),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size == 0:
        details = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(details or "PDF compression failed.")

