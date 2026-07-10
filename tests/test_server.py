import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen

from server import Handler, capabilities, parse_multipart, safe_name, validate_file_content


class ServerUnitTests(unittest.TestCase):
    def test_safe_name_removes_client_paths_and_unsafe_characters(self):
        self.assertEqual(safe_name(r"C:\fakepath\quarterly report?.pdf"), "quarterly report")

    def test_multipart_parser_preserves_binary_file_bytes(self):
        boundary = "FileFlowBoundary"
        payload = b"%PDF-1.4\ncontent ending with dashes--"
        body = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="file"; filename="sample.pdf"\r\n'
            "Content-Type: application/pdf\r\n\r\n"
        ).encode() + payload + f"\r\n--{boundary}--\r\n".encode()

        filename, parsed = parse_multipart(body, f"multipart/form-data; boundary={boundary}")

        self.assertEqual(filename, "sample.pdf")
        self.assertEqual(parsed, payload)

    def test_rejects_extension_spoofed_pdf(self):
        with self.assertRaisesRegex(ValueError, "not a valid PDF"):
            validate_file_content("/convert", ".pdf", b"not really a PDF")

    def test_capabilities_have_stable_boolean_shape(self):
        result = capabilities()
        self.assertEqual(set(result), {"pdfToDocument", "documentToPdf", "compressPdf"})
        self.assertTrue(all(isinstance(value, bool) for value in result.values()))


class HealthEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_health_reports_capabilities_and_security_headers(self):
        request = Request(self.base_url + "/health", headers={"Origin": "http://127.0.0.1:5173"})
        with urlopen(request, timeout=3) as response:
            payload = json.load(response)
            self.assertTrue(payload["ok"])
            self.assertIn("documentToPdf", payload["capabilities"])
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://127.0.0.1:5173")
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_health_supports_head(self):
        request = Request(self.base_url + "/health", method="HEAD")
        with urlopen(request, timeout=3) as response:
            self.assertEqual(response.status, 200)


if __name__ == "__main__":
    unittest.main()
