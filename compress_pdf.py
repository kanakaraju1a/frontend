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
    image_dpi = round(260 - (value * 2.15))
    image_dpi = max(45, min(240, image_dpi))
    jpeg_quality = round(98 - (value * 0.78))
    jpeg_quality = max(18, min(94, jpeg_quality))
    return image_dpi, jpeg_quality


def _preset_for_strength(strength):
    value = max(1, min(100, int(strength or 60)))
    if value >= 85:
        return "/screen"
    if value >= 60:
        return "/ebook"
    return "/printer"


def _candidate_settings(strength):
    value = max(1, min(100, int(strength or 60)))
    image_dpi, jpeg_quality = _settings_for_strength(value)
    candidates = [(image_dpi, jpeg_quality, _preset_for_strength(value))]

    if value >= 45:
        candidates.append((max(42, image_dpi - 20), max(16, jpeg_quality - 12), "/ebook"))
    if value >= 70:
        candidates.append((max(36, image_dpi - 38), max(12, jpeg_quality - 22), "/screen"))
    if value >= 90:
        candidates.append((32, 10, "/screen"))

    unique = []
    seen = set()
    for item in candidates:
        if item in seen:
            continue
        seen.add(item)
        unique.append(item)
    return unique


def compress_pdf(input_path, output_path, strength=60):
    gs = _ghostscript_binary()
    if not gs:
        raise RuntimeError(
            "PDF compression is unavailable because Ghostscript is not installed on the backend."
        )

    input_path = Path(input_path)
    output_path = Path(output_path)
    original_size = input_path.stat().st_size
    best_file = None
    best_size = None
    last_error = ""

    for index, (image_dpi, jpeg_quality, preset) in enumerate(_candidate_settings(strength), start=1):
        candidate = output_path.with_name(f"{output_path.stem}-{index}{output_path.suffix}")
        cmd = [
            gs,
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.4",
            f"-dPDFSETTINGS={preset}",
            "-dNOPAUSE",
            "-dQUIET",
            "-dBATCH",
            "-dDetectDuplicateImages=true",
            "-dCompressFonts=true",
            "-dSubsetFonts=true",
            "-dEmbedAllFonts=true",
            "-dAutoRotatePages=/None",
            "-dColorImageDownsampleType=/Bicubic",
            "-dGrayImageDownsampleType=/Bicubic",
            "-dMonoImageDownsampleType=/Subsample",
            "-dDownsampleColorImages=true",
            "-dDownsampleGrayImages=true",
            "-dDownsampleMonoImages=true",
            "-dEncodeColorImages=true",
            "-dEncodeGrayImages=true",
            "-dColorImageFilter=/DCTEncode",
            "-dGrayImageFilter=/DCTEncode",
            "-dConvertCMYKImagesToRGB=true",
            "-sColorConversionStrategy=sRGB",
            "-sProcessColorModel=DeviceRGB",
            "-dFastWebView=true",
            f"-dColorImageResolution={image_dpi}",
            f"-dGrayImageResolution={image_dpi}",
            f"-dMonoImageResolution={max(96, image_dpi * 2)}",
            f"-dJPEGQ={jpeg_quality}",
            f"-sOutputFile={candidate}",
            str(input_path),
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if result.returncode != 0 or not candidate.exists() or candidate.stat().st_size == 0:
            last_error = (result.stderr or result.stdout or "").strip()
            continue

        size = candidate.stat().st_size
        if best_size is None or size < best_size:
            best_file = candidate
            best_size = size

        if size <= original_size * 0.62:
            break

    if not best_file:
        raise RuntimeError(last_error or "PDF compression failed.")

    shutil.copyfile(best_file, output_path)
