import json
import os
import re
import tempfile
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from convert_pdf import convert_pdf_to_docx
from convert_doc import convert_doc_to_pdf
from compress_pdf import compress_pdf

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8765"))
MAX_UPLOAD_BYTES = int(os.environ.get("FILEFLOW_MAX_UPLOAD_MB", "100")) * 1024 * 1024
DEFAULT_ALLOWED_ORIGINS = "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5180,http://localhost:5180"
ALLOWED_ORIGINS = {
    origin.strip()
    for origin in os.environ.get("FILEFLOW_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS).split(",")
    if origin.strip()
}
ALLOW_VERCEL_PREVIEWS = os.environ.get("FILEFLOW_ALLOW_VERCEL_PREVIEWS", "false").lower() == "true"
PDF_EXTENSIONS = {".pdf"}
DOC_EXTENSIONS = {".doc", ".docx", ".rtf", ".odt", ".txt"}


def safe_name(name):
    base = Path(name or "converted.pdf").stem
    base = re.sub(r"[^A-Za-z0-9._ -]+", "", base).strip(" .")
    return base or "converted"


def parse_multipart(body, content_type):
    match = re.search(r"boundary=(?P<boundary>[^;]+)", content_type or "")
    if not match:
        raise ValueError("Missing multipart boundary.")

    boundary = ("--" + match.group("boundary").strip('"')).encode()
    for part in body.split(boundary):
        part = part.strip()
        if not part or part == b"--":
            continue
        header_blob, _, data = part.partition(b"\r\n\r\n")
        if not data:
            continue
        headers = header_blob.decode("utf-8", "ignore")
        if 'name="file"' not in headers:
            continue
        filename_match = re.search(r'filename="([^"]*)"', headers)
        filename = filename_match.group(1) if filename_match else "input.pdf"
        if data.endswith(b"\r\n"):
            data = data[:-2]
        if data.endswith(b"--"):
            data = data[:-2]
        return filename, data

    raise ValueError("No file field found.")


class Handler(BaseHTTPRequestHandler):
    def end_headers(self):
        origin = self.headers.get("Origin")
        parsed_origin = urlparse(origin or "")
        is_vercel_preview = ALLOW_VERCEL_PREVIEWS and parsed_origin.scheme in {"http", "https"} and parsed_origin.netloc.endswith(".vercel.app")
        if origin in ALLOWED_ORIGINS or is_vercel_preview:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_HEAD(self):
        if self.path in {"/", "/health"}:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            return
        self.send_error(404)

    def do_GET(self):
        if self.path in {"/", "/health"}:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        self.send_error(404)

    def do_POST(self):
        parsed_path = urlparse(self.path)
        route = parsed_path.path
        if route not in {"/convert", "/convert-doc-pdf", "/compress-pdf"}:
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0:
                raise ValueError("No file was uploaded.")
            if length > MAX_UPLOAD_BYTES:
                raise ValueError("File is too large.")
            filename, pdf_bytes = parse_multipart(
                self.rfile.read(length),
                self.headers.get("Content-Type", ""),
            )

            with tempfile.TemporaryDirectory(prefix="fileflow-") as tmp:
                tmpdir = Path(tmp)
                source_name = safe_name(filename)
                suffix = Path(filename or "").suffix.lower() or ".bin"
                if route == "/convert" and suffix not in PDF_EXTENSIONS:
                    raise ValueError("PDF to Document accepts PDF files only.")
                if route == "/compress-pdf" and suffix not in PDF_EXTENSIONS:
                    raise ValueError("Compress PDF accepts PDF files only.")
                if route == "/convert-doc-pdf" and suffix not in DOC_EXTENSIONS:
                    raise ValueError("Document to PDF accepts DOC, DOCX, RTF, ODT and TXT files only.")
                input_file = tmpdir / f"input{suffix}"
                input_file.write_bytes(pdf_bytes)

                if route == "/convert":
                    output_file = tmpdir / "output.docx"
                    convert_pdf_to_docx(input_file, output_file)
                    result_bytes = output_file.read_bytes()
                    content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    download_name = source_name + ".docx"
                elif route == "/convert-doc-pdf":
                    output_file = tmpdir / "output.pdf"
                    convert_doc_to_pdf(input_file, output_file)
                    result_bytes = output_file.read_bytes()
                    content_type = "application/pdf"
                    download_name = source_name + ".pdf"
                else:
                    params = parse_qs(parsed_path.query)
                    strength = params.get("strength", ["60"])[0]
                    output_file = tmpdir / "output.pdf"
                    compress_pdf(input_file, output_file, strength)
                    result_bytes = output_file.read_bytes()
                    content_type = "application/pdf"
                    download_name = source_name + "-compressed.pdf"

            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
            self.send_header("Content-Length", str(len(result_bytes)))
            self.end_headers()
            self.wfile.write(result_bytes)
        except Exception as exc:
            print(traceback.format_exc(), flush=True)
            if isinstance(exc, ValueError):
                message = str(exc)
                status = 400
            elif isinstance(exc, RuntimeError):
                message = str(exc)
                status = 500
            else:
                message = "Conversion failed. Please check the file and try again."
                status = 500
            payload = json.dumps({"error": message}).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    print(f"FileFlow converter API running at http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
