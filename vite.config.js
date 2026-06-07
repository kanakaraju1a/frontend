import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        docToPdf: "doc-to-pdf/index.html",
        wordToPdf: "word-to-pdf/index.html",
        pdfToDoc: "pdf-to-doc/index.html",
        pdfToWord: "pdf-to-word/index.html",
        imageToPdf: "image-to-pdf/index.html",
        pdfToJpg: "pdf-to-jpg/index.html",
        jpgToPdf: "jpg-to-pdf/index.html",
        pngToPdf: "png-to-pdf/index.html",
        mergePdf: "merge-pdf/index.html",
        splitPdf: "split-pdf/index.html",
        compressPdf: "compress-pdf/index.html",
        pdfEditor: "pdf-editor/index.html",
        ocrPdf: "ocr-pdf/index.html",
        faq: "faq/index.html",
        about: "about/index.html",
        contact: "contact/index.html",
        privacyPolicy: "privacy-policy/index.html",
        terms: "terms/index.html",
        security: "security/index.html",
        supportedFormats: "supported-formats/index.html",
        conversionQuality: "conversion-quality/index.html",
        notFound: "404.html",
      },
    },
  },
});
