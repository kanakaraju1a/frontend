import { useState, useRef, useCallback, useEffect } from "react";
import {
  FileText, FileOutput, Image, ArrowRight, Upload, Download,
  CheckCircle, X, ChevronDown, Menu, Home, HelpCircle, Zap,
  Shield, Gift, Smartphone, RotateCcw, ChevronRight, File, AlertCircle,
  Plus, Trash2, Type, ImagePlus, Copy, ZoomIn, ZoomOut
} from "lucide-react";

/* ─── Load external libs dynamically ─── */
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function ensureLibs() {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

async function ensurePdfLib() {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js");
}

const API_BASE = window.FILEFLOW_API_BASE || import.meta.env.VITE_FILEFLOW_API_BASE || "http://127.0.0.1:8765";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const FILEFLOW_UPLOAD_COUNT_KEY = "fileflow_uploaded_count";

function getUploadedCount() {
  try {
    return Math.max(0, Number(localStorage.getItem(FILEFLOW_UPLOAD_COUNT_KEY)) || 0);
  } catch {
    return 0;
  }
}

function trackUploadedFiles(count) {
  if (!count) return;
  try {
    const next = getUploadedCount() + count;
    localStorage.setItem(FILEFLOW_UPLOAD_COUNT_KEY, String(next));
    window.dispatchEvent(new CustomEvent("fileflow-upload-count", { detail: next }));
  } catch {
    // Ignore private browsing or storage restrictions.
  }
}

async function postFile(endpoint, file, outputName, onProgress, progressValue) {
  const formData = new FormData();
  formData.append("file", file, file.name);
  onProgress(progressValue);

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let details = "Start the FileFlow converter server and try again.";
    try {
      const payload = await response.json();
      if (payload?.error) details = payload.error;
    } catch {
      // Keep the friendly default.
    }
    throw new Error(details);
  }

  downloadBlob(await response.blob(), outputName);
}

async function postFileResult(endpoint, file, outputName, onProgress, progressValue) {
  const formData = new FormData();
  formData.append("file", file, file.name);
  onProgress(progressValue);

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let details = "Start the FileFlow converter server and try again.";
    try {
      const payload = await response.json();
      if (payload?.error) details = payload.error;
    } catch {
      // Keep the friendly default.
    }
    throw new Error(details);
  }

  const blob = await response.blob();
  downloadBlob(blob, outputName);
  return blob.size;
}

/* ── Real converters ── */
async function imagesToPdf(files, onProgress) {
  await ensureLibs();
  const { jsPDF } = window.jspdf;
  let pdf = null;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const url = URL.createObjectURL(file);
    await new Promise((res) => {
      const img = new window.Image();
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        const orient = w > h ? "l" : "p";
        if (!pdf) {
          pdf = new jsPDF({ orientation: orient, unit: "px", format: [w, h] });
        } else {
          pdf.addPage([w, h], orient);
        }
        pdf.addImage(img, file.type.includes("png") ? "PNG" : "JPEG", 0, 0, w, h);
        URL.revokeObjectURL(url);
        onProgress(Math.round(((i + 1) / files.length) * 100));
        res();
      };
      img.src = url;
    });
  }
  pdf.save("converted.pdf");
}

async function docxToPdf(files, onProgress) {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    await postFile("/convert-doc-pdf", file, file.name.replace(/\.(docx?|odt|rtf|txt)$/i, "") + ".pdf", onProgress, Math.round((i / files.length) * 100));
    onProgress(Math.round(((i + 1) / files.length) * 100));
  }
}

async function txtToPdf(files, onProgress) {
  await ensureLibs();
  const { jsPDF } = window.jspdf;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const text = await file.text();
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const margin = 15, pageW = 210 - margin * 2, lineH = 7;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);
    const lines = pdf.splitTextToSize(text || "(Empty)", pageW);
    let y = 20;
    for (const line of lines) {
      if (y > 280) { pdf.addPage(); y = 20; }
      pdf.text(line, margin, y);
      y += lineH;
    }
    pdf.save(file.name.replace(/\.txt$/i, "") + ".pdf");
    onProgress(Math.round(((i + 1) / files.length) * 100));
  }
}

function xmlEscape(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const ptToTwip = pt => Math.max(1, Math.round(pt * 20));
const ptToEmu = pt => Math.max(1, Math.round(pt * 12700));

function sectionXml(widthPt, heightPt, isLastPage) {
  const pageBreak = isLastPage ? "" : '<w:type w:val="nextPage"/>';
  return `<w:sectPr>${pageBreak}<w:pgSz w:w="${ptToTwip(widthPt)}" w:h="${ptToTwip(heightPt)}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
}

function blobToArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

function canvasToPngArrayBuffer(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async blob => {
      if (!blob) return reject(new Error("Could not render PDF page image."));
      resolve(await blobToArrayBuffer(blob));
    }, "image/png", 1);
  });
}

async function renderPdfPageImage(page, scale = 2.25) {
  const displayViewport = page.getViewport({ scale: 1 });
  const renderViewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  canvas.width = Math.ceil(renderViewport.width);
  canvas.height = Math.ceil(renderViewport.height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport: renderViewport }).promise;
  const data = await canvasToPngArrayBuffer(canvas);
  canvas.width = 0;
  canvas.height = 0;
  return { data, widthPt: displayViewport.width, heightPt: displayViewport.height };
}

function pageImageXml(relId, pageNo, widthPt, heightPt, isLastPage) {
  const cx = ptToEmu(widthPt);
  const cy = ptToEmu(heightPt);
  return `<w:p>
    <w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr>
    <w:r>
      <w:drawing>
        <wp:inline distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="${cx}" cy="${cy}"/>
          <wp:effectExtent l="0" t="0" r="0" b="0"/>
          <wp:docPr id="${pageNo}" name="PDF page ${pageNo}"/>
          <wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
          <a:graphic>
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic>
                <pic:nvPicPr><pic:cNvPr id="${pageNo}" name="page-${pageNo}.png"/><pic:cNvPicPr/></pic:nvPicPr>
                <pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
                <pic:spPr>
                  <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                </pic:spPr>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing>
    </w:r>
  </w:p>${sectionXml(widthPt, heightPt, isLastPage)}`;
}

async function pdfToDocx(files, onProgress) {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    await postFile("/convert", file, file.name.replace(/\.pdf$/i, "") + ".docx", onProgress, Math.round((i / files.length) * 100));
    onProgress(Math.round(((i + 1) / files.length) * 100));
  }
}

async function pdfToJpg(files, onProgress) {
  await ensureLibs();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
      downloadBlob(blob, `${file.name.replace(/\.pdf$/i, "")}-page-${p}.jpg`);
      canvas.width = 0;
      canvas.height = 0;
      onProgress(Math.round(((i + (p / pdf.numPages)) / files.length) * 100));
    }
  }
}

async function mergePdf(files, onProgress) {
  await ensurePdfLib();
  const output = await window.PDFLib.PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    const source = await window.PDFLib.PDFDocument.load(await files[i].arrayBuffer());
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach(page => output.addPage(page));
    onProgress(Math.round(((i + 1) / files.length) * 100));
  }
  downloadBlob(new Blob([await output.save()], { type: "application/pdf" }), "merged.pdf");
}

async function splitPdf(files, onProgress) {
  await ensurePdfLib();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const source = await window.PDFLib.PDFDocument.load(await file.arrayBuffer());
    const indices = source.getPageIndices();
    for (let p = 0; p < indices.length; p++) {
      const output = await window.PDFLib.PDFDocument.create();
      const [page] = await output.copyPages(source, [p]);
      output.addPage(page);
      downloadBlob(new Blob([await output.save()], { type: "application/pdf" }), `${file.name.replace(/\.pdf$/i, "")}-page-${p + 1}.pdf`);
      onProgress(Math.round(((i + ((p + 1) / indices.length)) / files.length) * 100));
    }
  }
}

function parsePageSelection(input, totalPages) {
  const text = input.trim();
  if (!text) throw new Error("Enter page numbers or ranges.");
  const pages = new Set();
  for (const rawPart of text.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;
    const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error(`Invalid page range: ${part}`);
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end < 1 || start > totalPages || end > totalPages || start > end) {
      throw new Error(`Page range out of bounds: ${part}`);
    }
    for (let p = start; p <= end; p++) pages.add(p - 1);
  }
  return [...pages].sort((a, b) => a - b);
}

function makePageGroups(indices, mode) {
  if (mode === "single") return indices.map(index => [index]);
  return [indices];
}

async function splitPdfWithOptions(file, options, onProgress) {
  await ensurePdfLib();
  const source = await window.PDFLib.PDFDocument.load(await file.arrayBuffer());
  const totalPages = source.getPageCount();
  const indices = options.mode === "all"
    ? source.getPageIndices()
    : parsePageSelection(options.selection, totalPages);
  const groups = makePageGroups(indices, options.outputMode);
  const baseName = file.name.replace(/\.pdf$/i, "");

  for (let i = 0; i < groups.length; i++) {
    const output = await window.PDFLib.PDFDocument.create();
    const pages = await output.copyPages(source, groups[i]);
    pages.forEach(page => output.addPage(page));
    const label = groups[i].length === 1
      ? `page-${groups[i][0] + 1}`
      : `pages-${groups[i][0] + 1}-${groups[i][groups[i].length - 1] + 1}`;
    const name = options.naming === "simple" ? `${label}.pdf` : `${baseName}-${label}.pdf`;
    downloadBlob(new Blob([await output.save()], { type: "application/pdf" }), name);
    onProgress(Math.round(((i + 1) / groups.length) * 100));
  }
}

async function compressPdf(files, onProgress) {
  await ensurePdfLib();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const pdf = await window.PDFLib.PDFDocument.load(await file.arrayBuffer());
    const bytes = await pdf.save({ useObjectStreams: true, addDefaultPage: false });
    downloadBlob(new Blob([bytes], { type: "application/pdf" }), file.name.replace(/\.pdf$/i, "") + "-compressed.pdf");
    onProgress(Math.round(((i + 1) / files.length) * 100));
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function compressPdfWithOptions(file, options, onProgress) {
  const strength = Math.max(1, Math.min(100, Number(options.compression) || 60));
  const size = await postFileResult(
    `/compress-pdf?strength=${encodeURIComponent(strength)}`,
    file,
    `${file.name.replace(/\.pdf$/i, "")}-compressed.pdf`,
    onProgress,
    15,
  );
  onProgress(100);
  return size;
}

async function ocrPdf() {
  throw new Error("OCR PDF needs a production OCR worker such as Tesseract, Google Vision, Azure OCR or AWS Textract before launch.");
}

/* ─── Design tokens ─── */
const T = {
  font: { display: "'Cormorant Garamond', Georgia, serif", body: "'Outfit', sans-serif" },
  color: {
    bg: "#F5F4F0", surface: "#FFFFFF", dark: "#111318", mid: "#4A4D55",
    muted: "#9299A6", border: "#E5E4DF",
    accent: { doc: "#2563EB", pdf: "#DC2626", img: "#059669" },
  },
  radius: { sm: 8, md: 14, lg: 20, pill: 999 },
};

const SITE_URL = "https://file-flows.vercel.app";

const P = {
  HOME: "home", DOC: "doc-to-pdf", WORD_PDF: "word-to-pdf", PDF: "pdf-to-doc", PDF_WORD: "pdf-to-word", IMG: "img-to-pdf",
  PDF_TO_JPG: "pdf-to-jpg", JPG_TO_PDF: "jpg-to-pdf", PNG_TO_PDF: "png-to-pdf",
  MERGE: "merge-pdf", SPLIT: "split-pdf", COMPRESS: "compress-pdf", EDITOR: "pdf-editor", OCR: "ocr-pdf",
  FAQ: "faq", ABOUT: "about", CONTACT: "contact", PRIVACY: "privacy-policy",
  TERMS: "terms", SECURITY: "security", FORMATS: "supported-formats", QUALITY: "conversion-quality",
};

const PAGE_PATH = {
  [P.HOME]: "/",
  [P.DOC]: "/doc-to-pdf/",
  [P.WORD_PDF]: "/word-to-pdf/",
  [P.PDF]: "/pdf-to-doc/",
  [P.PDF_WORD]: "/pdf-to-word/",
  [P.IMG]: "/image-to-pdf/",
  [P.PDF_TO_JPG]: "/pdf-to-jpg/",
  [P.JPG_TO_PDF]: "/jpg-to-pdf/",
  [P.PNG_TO_PDF]: "/png-to-pdf/",
  [P.MERGE]: "/merge-pdf/",
  [P.SPLIT]: "/split-pdf/",
  [P.COMPRESS]: "/compress-pdf/",
  [P.EDITOR]: "/pdf-editor/",
  [P.OCR]: "/ocr-pdf/",
  [P.FAQ]: "/faq/",
  [P.ABOUT]: "/about/",
  [P.CONTACT]: "/contact/",
  [P.PRIVACY]: "/privacy-policy/",
  [P.TERMS]: "/terms/",
  [P.SECURITY]: "/security/",
  [P.FORMATS]: "/supported-formats/",
  [P.QUALITY]: "/conversion-quality/",
};

const PATH_PAGE = {
  "/": P.HOME,
  "/index.html": P.HOME,
  "/doc-to-pdf": P.DOC,
  "/doc-to-pdf/": P.DOC,
  "/word-to-pdf": P.WORD_PDF,
  "/word-to-pdf/": P.WORD_PDF,
  "/pdf-to-doc": P.PDF,
  "/pdf-to-doc/": P.PDF,
  "/pdf-to-word": P.PDF_WORD,
  "/pdf-to-word/": P.PDF_WORD,
  "/image-to-pdf": P.IMG,
  "/image-to-pdf/": P.IMG,
  "/pdf-to-jpg": P.PDF_TO_JPG,
  "/pdf-to-jpg/": P.PDF_TO_JPG,
  "/jpg-to-pdf": P.JPG_TO_PDF,
  "/jpg-to-pdf/": P.JPG_TO_PDF,
  "/png-to-pdf": P.PNG_TO_PDF,
  "/png-to-pdf/": P.PNG_TO_PDF,
  "/merge-pdf": P.MERGE,
  "/merge-pdf/": P.MERGE,
  "/split-pdf": P.SPLIT,
  "/split-pdf/": P.SPLIT,
  "/compress-pdf": P.COMPRESS,
  "/compress-pdf/": P.COMPRESS,
  "/pdf-editor": P.EDITOR,
  "/pdf-editor/": P.EDITOR,
  "/ocr-pdf": P.OCR,
  "/ocr-pdf/": P.OCR,
  "/faq": P.FAQ,
  "/faq/": P.FAQ,
  "/about": P.ABOUT,
  "/about/": P.ABOUT,
  "/contact": P.CONTACT,
  "/contact/": P.CONTACT,
  "/privacy-policy": P.PRIVACY,
  "/privacy-policy/": P.PRIVACY,
  "/terms": P.TERMS,
  "/terms/": P.TERMS,
  "/security": P.SECURITY,
  "/security/": P.SECURITY,
  "/supported-formats": P.FORMATS,
  "/supported-formats/": P.FORMATS,
  "/conversion-quality": P.QUALITY,
  "/conversion-quality/": P.QUALITY,
};

const PAGE_LABEL = {
  [P.HOME]: "Home",
  [P.DOC]: "Document to PDF",
  [P.WORD_PDF]: "Word to PDF",
  [P.PDF]: "PDF to Document",
  [P.PDF_WORD]: "PDF to Word",
  [P.IMG]: "Image to PDF",
  [P.PDF_TO_JPG]: "PDF to JPG",
  [P.JPG_TO_PDF]: "JPG to PDF",
  [P.PNG_TO_PDF]: "PNG to PDF",
  [P.MERGE]: "Merge PDF",
  [P.SPLIT]: "Split PDF",
  [P.COMPRESS]: "Compress PDF",
  [P.EDITOR]: "PDF Editor",
  [P.OCR]: "OCR PDF",
  [P.FAQ]: "FAQ",
  [P.ABOUT]: "About",
  [P.CONTACT]: "Contact",
  [P.PRIVACY]: "Privacy Policy",
  [P.TERMS]: "Terms",
  [P.SECURITY]: "Security",
  [P.FORMATS]: "Supported Formats",
  [P.QUALITY]: "Conversion Quality",
};

const SEO = {
  [P.HOME]: {
    title: "FileFlow - Free PDF, Document and Image Converter",
    description: "Free online file converter for PDF to DOCX, Word to PDF, image to PDF, merge PDF, split PDF, compress PDF and PDF editing tools.",
  },
  [P.DOC]: {
    title: "DOC to PDF Converter - Convert Word to PDF Free | FileFlow",
    description: "Convert DOC, DOCX, RTF, ODT and TXT documents to PDF with FileFlow. Free Word to PDF conversion with clean pages and direct download.",
  },
  [P.WORD_PDF]: {
    title: "Word to PDF Converter - Convert DOCX to PDF | FileFlow",
    description: "Convert Word DOC and DOCX files to PDF online with FileFlow. Upload a Word document, create a PDF and download the finished file.",
  },
  [P.PDF]: {
    title: "PDF to DOC Converter - Convert PDF to Word Free | FileFlow",
    description: "Convert PDF to editable DOCX Word documents with FileFlow. Use the PDF to DOC converter for text-based PDFs, reports and documents.",
  },
  [P.PDF_WORD]: {
    title: "PDF to Word Converter - Convert PDF to DOCX | FileFlow",
    description: "Convert PDF files to editable Word DOCX documents with FileFlow. Open the direct PDF to Word page and download a Word file.",
  },
  [P.IMG]: {
    title: "Image to PDF Converter - JPG, PNG, WebP to PDF | FileFlow",
    description: "Convert JPG, PNG, WebP, GIF, BMP and TIFF images into a single PDF document with FileFlow. Free image to PDF conversion.",
  },
  [P.PDF_TO_JPG]: {
    title: "PDF to JPG Converter - Convert PDF Pages to Images | FileFlow",
    description: "Convert each PDF page into a high-quality JPG image with FileFlow. Free PDF to JPG converter for documents and scanned pages.",
  },
  [P.JPG_TO_PDF]: {
    title: "JPG to PDF Converter - Convert JPG Images to PDF | FileFlow",
    description: "Convert JPG and JPEG images into a PDF document with FileFlow. Upload photos or scans and download a clean PDF file.",
  },
  [P.PNG_TO_PDF]: {
    title: "PNG to PDF Converter - Convert PNG Images to PDF | FileFlow",
    description: "Convert PNG images into a shareable PDF file with FileFlow. Free PNG to PDF conversion for screenshots, forms and documents.",
  },
  [P.MERGE]: {
    title: "Merge PDF - Combine PDF Files Online | FileFlow",
    description: "Merge multiple PDF files into one PDF document with FileFlow. Combine PDF pages and download a single organized file.",
  },
  [P.SPLIT]: {
    title: "Split PDF - Extract PDF Pages and Ranges | FileFlow",
    description: "Split a PDF into all pages, selected page numbers or custom ranges like 1-6 and 8-9 with FileFlow.",
  },
  [P.COMPRESS]: {
    title: "Compress PDF - Reduce PDF File Size | FileFlow",
    description: "Compress PDF files with FileFlow using an adjustable compression range. Reduce PDF size and download an optimized file.",
  },
  [P.EDITOR]: {
    title: "PDF Editor - Add Pages, Images and Text | FileFlow",
    description: "Edit PDF pages with FileFlow. Add pages from another PDF, upload images, drag text, resize content and export a new PDF.",
  },
  [P.OCR]: {
    title: "OCR PDF - Convert Scanned PDF to Text | FileFlow",
    description: "OCR PDF page for scanned documents, text recognition and searchable PDF workflows.",
  },
  [P.FAQ]: {
    title: "FileFlow FAQ - File Conversion Help",
    description: "Answers about FileFlow PDF, Word and image conversion, privacy, file support, backend setup and conversion quality.",
  },
  [P.ABOUT]: {
    title: "About FileFlow - Built by Kanaka Raju",
    description: "Learn about FileFlow, a PDF, document and image conversion tool developed by Kanaka Raju, Full stack developer.",
  },
  [P.CONTACT]: {
    title: "Contact FileFlow - Support and Developer Information",
    description: "Contact FileFlow at enjoytech8@gmail.com for support, feedback and file conversion questions. Developed by Kanaka Raju, Full stack developer.",
  },
  [P.PRIVACY]: {
    title: "Privacy Policy - FileFlow",
    description: "Read FileFlow privacy details for browser-based conversion, backend processing, temporary files and contact information.",
  },
  [P.TERMS]: {
    title: "Terms of Service - FileFlow",
    description: "Read FileFlow terms of service for using the file conversion tools.",
  },
  [P.SECURITY]: {
    title: "Security - FileFlow",
    description: "Learn how FileFlow handles file conversion security, temporary files, upload limits, HTTPS and converter services.",
  },
  [P.FORMATS]: {
    title: "Supported File Formats - FileFlow",
    description: "See FileFlow supported formats for PDF, Word, DOCX, DOC, ODT, RTF, TXT, JPG, PNG, WebP and image conversion tools.",
  },
  [P.QUALITY]: {
    title: "Conversion Quality - FileFlow",
    description: "Understand FileFlow conversion quality, layout preservation, fonts, images, scanned PDFs and PDF to Word limitations.",
  },
};

const META = {
  [P.DOC]: {
    title: "Document to PDF", sub: "Convert Word, TXT, ODT and RTF files to shareable PDFs",
    Icon: FileText, accent: T.color.accent.doc,
    accepts: ".doc,.docx,.txt,.odt,.rtf", acceptLabel: "DOC, DOCX, TXT, ODT, RTF",
    FromIcon: FileText, ToIcon: FileOutput, from: "Document", to: "PDF",
    convert: async (files, onProgress) => {
      const docxFiles = files.filter(f => /\.(docx?|odt|rtf)$/i.test(f.name));
      const txtFiles = files.filter(f => /\.txt$/i.test(f.name));
      if (docxFiles.length) await docxToPdf(docxFiles, onProgress);
      if (txtFiles.length) await docxToPdf(txtFiles, onProgress);
    },
  },
  [P.WORD_PDF]: {
    title: "Word to PDF", sub: "Convert DOC and DOCX files to shareable PDFs",
    Icon: FileText, accent: T.color.accent.doc,
    accepts: ".doc,.docx", acceptLabel: "DOC, DOCX",
    FromIcon: FileText, ToIcon: FileOutput, from: "Word", to: "PDF",
    convert: docxToPdf,
  },
  [P.PDF]: {
    title: "PDF to Document", sub: "Extract and convert PDF content into editable DOCX files",
    Icon: FileOutput, accent: T.color.accent.pdf,
    accepts: ".pdf", acceptLabel: "PDF",
    FromIcon: FileOutput, ToIcon: FileText, from: "PDF", to: "DOCX",
    convert: pdfToDocx,
  },
  [P.PDF_WORD]: {
    title: "PDF to Word", sub: "Convert PDF content into editable Word DOCX files",
    Icon: FileOutput, accent: T.color.accent.pdf,
    accepts: ".pdf", acceptLabel: "PDF",
    FromIcon: FileOutput, ToIcon: FileText, from: "PDF", to: "Word",
    convert: pdfToDocx,
  },
  [P.IMG]: {
    title: "Image to PDF", sub: "Combine JPG, PNG, WebP and other images into a clean PDF",
    Icon: Image, accent: T.color.accent.img,
    accepts: ".jpg,.jpeg,.png,.webp,.gif,.bmp,.tiff", acceptLabel: "JPG, PNG, WebP, GIF, BMP",
    FromIcon: Image, ToIcon: FileOutput, from: "Image", to: "PDF",
    convert: imagesToPdf,
  },
  [P.PDF_TO_JPG]: {
    title: "PDF to JPG", sub: "Export each PDF page as a high-quality JPG image",
    Icon: FileOutput, accent: T.color.accent.pdf,
    accepts: ".pdf", acceptLabel: "PDF",
    FromIcon: FileOutput, ToIcon: Image, from: "PDF", to: "JPG",
    convert: pdfToJpg,
  },
  [P.JPG_TO_PDF]: {
    title: "JPG to PDF", sub: "Combine JPG and JPEG images into a PDF document",
    Icon: Image, accent: T.color.accent.img,
    accepts: ".jpg,.jpeg", acceptLabel: "JPG, JPEG",
    FromIcon: Image, ToIcon: FileOutput, from: "JPG", to: "PDF",
    convert: imagesToPdf,
  },
  [P.PNG_TO_PDF]: {
    title: "PNG to PDF", sub: "Combine PNG images into a PDF document",
    Icon: Image, accent: T.color.accent.img,
    accepts: ".png", acceptLabel: "PNG",
    FromIcon: Image, ToIcon: FileOutput, from: "PNG", to: "PDF",
    convert: imagesToPdf,
  },
  [P.MERGE]: {
    title: "Merge PDF", sub: "Combine multiple PDF files into one PDF",
    Icon: FileOutput, accent: T.color.accent.pdf,
    accepts: ".pdf", acceptLabel: "PDF",
    FromIcon: FileOutput, ToIcon: FileOutput, from: "PDF files", to: "Merged PDF",
    convert: mergePdf,
  },
  [P.SPLIT]: {
    title: "Split PDF", sub: "Split PDF pages into separate PDF files",
    Icon: FileOutput, accent: T.color.accent.pdf,
    accepts: ".pdf", acceptLabel: "PDF",
    FromIcon: FileOutput, ToIcon: FileOutput, from: "PDF", to: "Pages",
    convert: splitPdf,
  },
  [P.COMPRESS]: {
    title: "Compress PDF", sub: "Optimize PDF structure for a smaller file",
    Icon: FileOutput, accent: T.color.accent.pdf,
    accepts: ".pdf", acceptLabel: "PDF",
    FromIcon: FileOutput, ToIcon: Download, from: "PDF", to: "Smaller PDF",
    convert: compressPdf,
  },
  [P.EDITOR]: {
    title: "PDF Editor", sub: "Add pages, images and text, then export a new PDF",
    Icon: FileOutput, accent: T.color.accent.pdf,
    accepts: ".pdf", acceptLabel: "PDF",
    FromIcon: FileOutput, ToIcon: Download, from: "PDF", to: "Edited PDF",
    convert: async () => {},
  },
  [P.OCR]: {
    title: "OCR PDF", sub: "Recognize text in scanned PDFs with a production OCR worker",
    Icon: FileText, accent: T.color.accent.doc,
    accepts: ".pdf", acceptLabel: "PDF",
    FromIcon: FileOutput, ToIcon: FileText, from: "Scanned PDF", to: "Text",
    convert: ocrPdf,
  },
};

const TOOLS = [
  { page: P.DOC, Icon: FileText, label: "Document to PDF", desc: "Word, TXT, ODT, RTF", accent: T.color.accent.doc },
  { page: P.PDF, Icon: FileOutput, label: "PDF to Document", desc: "Extract to editable DOCX", accent: T.color.accent.pdf },
  { page: P.IMG, Icon: Image, label: "Image to PDF", desc: "JPG, PNG, WebP and more", accent: T.color.accent.img },
  { page: P.MERGE, Icon: FileOutput, label: "Merge PDF", desc: "Combine PDFs", accent: T.color.accent.pdf },
  { page: P.SPLIT, Icon: FileOutput, label: "Split PDF", desc: "Extract pages", accent: T.color.accent.pdf },
  { page: P.EDITOR, Icon: FileOutput, label: "PDF Editor", desc: "Edit pages and content", accent: T.color.accent.pdf },
  { page: P.COMPRESS, Icon: FileOutput, label: "Compress PDF", desc: "Optimize PDF files", accent: T.color.accent.pdf },
  { page: P.PDF_TO_JPG, Icon: Image, label: "PDF to JPG", desc: "Export page images", accent: T.color.accent.img },
  { page: P.JPG_TO_PDF, Icon: Image, label: "JPG to PDF", desc: "Convert JPG images", accent: T.color.accent.img },
  { page: P.PNG_TO_PDF, Icon: Image, label: "PNG to PDF", desc: "Convert PNG images", accent: T.color.accent.img },
];

const FAQ_DATA = [
  { q: "Are conversions really free?", a: "Yes — 100% free, no signup, no watermarks, no file limits. Everything runs in your browser." },
  { q: "Is my data secure?", a: "Image and PDF utility tools run in the browser. Word and advanced PDF conversions use the configured FileFlow converter service, which should delete temporary files after conversion." },
  { q: "What file size is supported?", a: "Up to 100 MB per file. For large PDFs with many pages, conversion may take a few seconds." },
  { q: "Does DOCX to PDF preserve formatting?", a: "DOCX to PDF uses Microsoft Word export in the local converter setup for better layout, font, image and table preservation." },
  { q: "Which browsers are supported?", a: "Chrome, Firefox, Safari and Edge — all modern versions on desktop and mobile." },
];

const TOOL_SEO = {
  [P.DOC]: {
    intro: "Convert Word and document files into clean PDFs for sharing, printing and archiving. This page supports DOC, DOCX, RTF, ODT and TXT workflows so people searching for document to PDF, Word to PDF or DOCX to PDF can open the right converter directly.",
    searches: ["doc to pdf converter", "docx to pdf", "word to pdf online", "convert document to pdf", "rtf to pdf"],
    useCases: ["Resumes and job applications", "Office reports and letters", "Forms, invoices and printable documents"],
    steps: ["Upload a DOC, DOCX, RTF, ODT or TXT file.", "Click Convert and wait for FileFlow to process the document.", "Download the finished PDF and review the layout."],
    faqs: [
      ["Can I convert DOCX to PDF online?", "Yes. Upload a DOCX file and FileFlow converts it to PDF using the configured backend converter."],
      ["Will fonts and images stay the same?", "Common fonts, images and tables are preserved best when the backend has LibreOffice or Microsoft Word available."],
      ["Is DOC to PDF free?", "Yes, FileFlow is free to use for document to PDF conversion."],
    ],
  },
  [P.WORD_PDF]: {
    intro: "Turn Word documents into PDFs that are easier to share and print. Use this direct Word to PDF converter page when you need a DOC or DOCX file saved as a portable PDF.",
    searches: ["word to pdf converter", "docx to pdf online", "convert word file to pdf", "free word to pdf", "doc to pdf"],
    useCases: ["Share Word files without editing", "Print stable PDF copies", "Submit school, office and government documents"],
    steps: ["Choose a DOC or DOCX file.", "Run the Word to PDF converter.", "Download the PDF output."],
    faqs: [
      ["What Word formats are supported?", "DOC and DOCX files are supported on the Word to PDF page."],
      ["Why does layout quality depend on the backend?", "Word files need a document engine such as LibreOffice or Microsoft Word to preserve layout accurately."],
    ],
  },
  [P.PDF]: {
    intro: "Convert PDF files into editable DOCX documents for Word and compatible editors. This direct PDF to DOC converter page is built for users who need to edit PDF content in a Word document.",
    searches: ["pdf to doc converter", "pdf to word", "pdf to docx", "convert pdf to editable word", "free pdf to word converter"],
    useCases: ["Edit text from reports", "Reuse PDF content in Word", "Update contracts, forms and notes"],
    steps: ["Upload your PDF file.", "Convert the PDF into a DOCX document.", "Download and edit the Word file."],
    faqs: [
      ["Can every PDF become a perfect Word document?", "No. PDF to Word quality depends on how the PDF was created, fonts, layout complexity and whether the PDF is scanned."],
      ["Do scanned PDFs need OCR?", "Yes. Scanned image-only PDFs need OCR before text can become editable."],
    ],
  },
  [P.PDF_WORD]: {
    intro: "Create editable Word files from PDF documents. Use PDF to Word when you need a DOCX output from a PDF file for editing, review or reuse.",
    searches: ["pdf to word converter", "convert pdf to word", "pdf to docx online", "editable word from pdf", "pdf document to word"],
    useCases: ["Make a PDF editable", "Extract text into DOCX", "Review and rewrite existing PDF documents"],
    steps: ["Select a PDF.", "Run conversion.", "Download the DOCX file."],
    faqs: [
      ["Is the output editable?", "Text-based PDFs usually produce editable DOCX content. Scanned PDFs need OCR."],
      ["Does it keep images?", "Images are preserved when the conversion engine can extract them from the PDF."],
    ],
  },
  [P.IMG]: {
    intro: "Combine images into a single PDF for forms, receipts, notes and photo documents. JPG, PNG, WebP, GIF, BMP and TIFF images can be arranged into one PDF file.",
    searches: ["image to pdf converter", "jpg png to pdf", "photos to pdf", "webp to pdf", "combine images into pdf"],
    useCases: ["Receipts and scanned paperwork", "Photo documents", "Screenshots and mobile captures"],
    steps: ["Upload JPG, PNG, WebP or other images.", "FileFlow places the images into a PDF.", "Download the combined PDF."],
    faqs: [
      ["Can I convert multiple images to one PDF?", "Yes. Upload multiple images and FileFlow combines them into one PDF."],
      ["Are images uploaded to a server?", "Image to PDF runs in the browser."],
    ],
  },
  [P.MERGE]: {
    intro: "Merge several PDF files into one organized PDF document. This page helps users combine contracts, scanned pages, reports and attachments into a single PDF.",
    searches: ["merge pdf", "combine pdf files", "join pdf online", "merge multiple pdfs", "combine pdf pages"],
    useCases: ["Combine scanned pages", "Merge reports and attachments", "Create one PDF from several documents"],
    steps: ["Upload two or more PDFs.", "Click Convert and Download.", "Save the merged PDF."],
    faqs: [
      ["Can I merge PDFs for free?", "Yes. FileFlow can merge PDFs directly in the browser."],
      ["Are merged PDFs uploaded?", "The merge tool runs locally in the browser."],
    ],
  },
  [P.SPLIT]: {
    intro: "Split a PDF into all pages, selected page numbers or custom ranges. Use the split PDF tool to extract one page, several pages or ranges such as 1-6, 8-9.",
    searches: ["split pdf", "extract pdf pages", "separate pdf pages", "split pdf by range", "save selected pdf pages"],
    useCases: ["Extract one page from a PDF", "Save selected page ranges", "Separate scanned documents"],
    steps: ["Upload a PDF.", "Choose all pages, page numbers or ranges.", "Download the split PDF files."],
    faqs: [
      ["Can I split only selected pages?", "Yes. Enter page numbers or ranges such as 1-6, 8-9."],
      ["Can I create one combined PDF?", "Yes. Choose the combined output option for selected pages."],
    ],
  },
  [P.COMPRESS]: {
    intro: "Reduce PDF size with backend PDF compression, image downsampling and font optimization. The compression range lets users increase or decrease optimization strength before downloading a smaller PDF.",
    searches: ["compress pdf", "reduce pdf size", "make pdf smaller", "pdf compressor", "compress pdf to smaller file"],
    useCases: ["Email large PDFs", "Upload documents under size limits", "Reduce scanned PDF file size"],
    steps: ["Upload a PDF.", "Adjust the compression range.", "Download the compressed PDF."],
    faqs: [
      ["Does compression change page content?", "FileFlow keeps pages intact while reducing image resolution and optimizing PDF output where possible."],
      ["Why are some PDFs not much smaller?", "Some PDFs are already optimized or contain mostly vector text, so there may be little extra size to remove."],
    ],
  },
  [P.EDITOR]: {
    intro: "Edit PDFs by adding pages, text and images, then export a new PDF. The editor supports page thumbnails, blank pages, imported pages from another PDF and draggable content.",
    searches: ["pdf editor", "edit pdf online", "add image to pdf", "add text to pdf", "insert pages into pdf"],
    useCases: ["Add missing pages", "Place images or signatures", "Insert text labels and notes"],
    steps: ["Upload a PDF.", "Add text, images, blank pages or pages from another PDF.", "Download the edited PDF."],
    faqs: [
      ["Can I add images to a PDF?", "Yes. Select a page, add an image, drag it into place and resize it."],
      ["Can I insert pages from another PDF?", "Yes. Upload another PDF on the right side, select a page and insert it with the plus button."],
    ],
  },
  [P.PDF_TO_JPG]: {
    intro: "Export PDF pages as high-quality JPG images. Use this converter when each page of a PDF needs to become a separate image file.",
    searches: ["pdf to jpg", "convert pdf to image", "pdf pages to jpg", "extract jpg from pdf", "pdf to photo"],
    useCases: ["Upload PDF pages as images", "Create page previews", "Share forms as JPG files"],
    steps: ["Upload a PDF.", "FileFlow renders each page.", "Download JPG images for each page."],
    faqs: [
      ["Does PDF to JPG run in the browser?", "Yes. PDF pages are rendered locally in the browser."],
      ["Will each page become a separate image?", "Yes. Each PDF page downloads as its own JPG file."],
    ],
  },
  [P.JPG_TO_PDF]: {
    intro: "Convert JPG and JPEG images into a clean PDF document. This direct JPG to PDF page is useful for photos, scanned forms and image documents.",
    searches: ["jpg to pdf", "jpeg to pdf", "image to pdf", "photo to pdf", "convert jpg images to pdf"],
    useCases: ["Turn photos into one PDF", "Convert scanned JPG forms", "Create PDF copies of image documents"],
    steps: ["Upload JPG images.", "Convert them into a PDF.", "Download the PDF file."],
    faqs: [
      ["Can I convert several JPGs at once?", "Yes. Multiple JPG files can be combined into one PDF."],
      ["Does JPG to PDF need a backend?", "No. It runs in the browser."],
    ],
  },
  [P.PNG_TO_PDF]: {
    intro: "Convert PNG images into a shareable PDF file. Use PNG to PDF for screenshots, transparent images, forms and other PNG documents.",
    searches: ["png to pdf", "convert png to pdf", "screenshot to pdf", "png image to pdf", "image to pdf converter"],
    useCases: ["Save screenshots as PDF", "Convert diagrams and forms", "Share PNG images as a document"],
    steps: ["Upload PNG images.", "Create the PDF.", "Download the result."],
    faqs: [
      ["Can transparent PNG files be converted?", "Yes. PNG files can be placed into a PDF."],
      ["Is PNG to PDF free?", "Yes. This browser tool is free to use."],
    ],
  },
};

function pageUrl(page) {
  return `${SITE_URL}${PAGE_PATH[page] || "/"}`;
}

function ensureMeta(selector, create) {
  let element = document.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    create(element);
    document.head.appendChild(element);
  }
  return element;
}

function ensureCanonical() {
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  return link;
}

function schemaScript(id, data) {
  let script = document.getElementById(id);
  if (!script) {
    script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = id;
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(data);
}

function buildSchemas(page) {
  const seo = SEO[page] || SEO[P.HOME];
  const label = PAGE_LABEL[page] || "FileFlow";
  const toolSeo = TOOL_SEO[page];
  const schemas = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "FileFlow",
      url: SITE_URL,
      logo: `${SITE_URL}/favicon.svg`,
      contactPoint: {
        "@type": "ContactPoint",
        email: "enjoytech8@gmail.com",
        contactType: "customer support",
      },
      founder: {
        "@type": "Person",
        name: "Kanaka Raju",
        jobTitle: "Full stack developer",
        sameAs: "https://www.linkedin.com/in/kanakaraju9390/",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: label === "Home" ? "FileFlow" : `${label} - FileFlow`,
      url: pageUrl(page),
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Any",
      description: seo.description,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  ];
  if (page === P.HOME) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "FileFlow file conversion tools",
      itemListElement: TOOLS.map((tool, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: tool.label,
        url: pageUrl(tool.page),
      })),
    });
  }
  if (page !== P.HOME) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: pageUrl(P.HOME) },
        { "@type": "ListItem", position: 2, name: label, item: pageUrl(page) },
      ],
    });
  }
  if (toolSeo?.steps?.length) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: `How to use ${label}`,
      description: toolSeo.intro,
      step: toolSeo.steps.map((text, index) => ({ "@type": "HowToStep", position: index + 1, text })),
    });
  }
  if (toolSeo?.faqs?.length || page === P.FAQ) {
    const faqs = toolSeo?.faqs
      ? [
        ...toolSeo.faqs,
        ...(toolSeo.searches?.length ? [[`What searches does ${label} help with?`, `${label} helps with searches such as ${toolSeo.searches.join(", ")}.`]] : []),
      ]
      : FAQ_DATA.map(({ q, a }) => [q, a]);
    schemas.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map(([q, a]) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    });
  }
  return schemas;
}

function useNav() {
  const getPage = useCallback(() => PATH_PAGE[window.location.pathname] || P.HOME, []);
  const [page, setPage] = useState(getPage);
  const go = useCallback((p) => {
    setPage(p);
    const nextPath = PAGE_PATH[p] || "/";
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const onPop = () => setPage(getPage());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [getPage]);

  useEffect(() => {
    const seo = SEO[page] || SEO[P.HOME];
    const url = pageUrl(page);
    document.title = seo.title;
    const description = ensureMeta('meta[name="description"]', element => element.setAttribute("name", "description"));
    const ogTitle = ensureMeta('meta[property="og:title"]', element => element.setAttribute("property", "og:title"));
    const ogDescription = ensureMeta('meta[property="og:description"]', element => element.setAttribute("property", "og:description"));
    const ogUrl = ensureMeta('meta[property="og:url"]', element => element.setAttribute("property", "og:url"));
    const twitterCard = ensureMeta('meta[name="twitter:card"]', element => element.setAttribute("name", "twitter:card"));
    const twitterTitle = ensureMeta('meta[name="twitter:title"]', element => element.setAttribute("name", "twitter:title"));
    const twitterDescription = ensureMeta('meta[name="twitter:description"]', element => element.setAttribute("name", "twitter:description"));
    description.setAttribute("content", seo.description);
    ensureCanonical().href = url;
    ogTitle.setAttribute("content", seo.title);
    ogDescription.setAttribute("content", seo.description);
    ogUrl.setAttribute("content", url);
    twitterCard.setAttribute("content", "summary");
    twitterTitle.setAttribute("content", seo.title);
    twitterDescription.setAttribute("content", seo.description);
    schemaScript("ff-jsonld", buildSchemas(page));
  }, [page]);

  return { page, go };
}

function PageLink({ page, go, children, style, className, onClick, ...props }) {
  return (
    <a
      href={PAGE_PATH[page] || "/"}
      className={className}
      onClick={event => {
        if (onClick) onClick(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        go(page);
      }}
      style={{ textDecoration: "none", ...style }}
      {...props}
    >
      {children}
    </a>
  );
}

function Header({ page, go }) {
  const [open, setOpen] = useState(false);
  const navLinks = [
    { label: "Doc → PDF", p: P.DOC }, { label: "PDF → Doc", p: P.PDF },
    { label: "Merge", p: P.MERGE }, { label: "Split", p: P.SPLIT },
    { label: "Compress", p: P.COMPRESS }, { label: "PDF Editor", p: P.EDITOR }, { label: "PDF → JPG", p: P.PDF_TO_JPG },
    { label: "Image → PDF", p: P.IMG }, { label: "OCR", p: P.OCR },
  ];
  const mobileLinks = [
    { label: "Home", p: P.HOME, Icon: Home },
    { label: "Doc to PDF", p: P.DOC, Icon: FileText },
    { label: "Word to PDF", p: P.WORD_PDF, Icon: FileText },
    { label: "PDF to Doc", p: P.PDF, Icon: FileOutput },
    { label: "PDF to Word", p: P.PDF_WORD, Icon: FileOutput },
    { label: "Merge PDF", p: P.MERGE, Icon: FileOutput },
    { label: "Split PDF", p: P.SPLIT, Icon: FileOutput },
    { label: "Compress PDF", p: P.COMPRESS, Icon: FileOutput },
    { label: "PDF to JPG", p: P.PDF_TO_JPG, Icon: Image },
    { label: "JPG to PDF", p: P.JPG_TO_PDF, Icon: Image },
    { label: "PNG to PDF", p: P.PNG_TO_PDF, Icon: Image },
    { label: "Image to PDF", p: P.IMG, Icon: Image },
    { label: "OCR PDF", p: P.OCR, Icon: FileText },
    { label: "FAQ", p: P.FAQ, Icon: HelpCircle },
  ];
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 200, background: "rgba(245,244,240,0.94)", backdropFilter: "blur(14px)", borderBottom: `1px solid ${T.color.border}` }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 20px", height: 62, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <PageLink page={P.HOME} go={go} aria-label="FileFlow home" style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: T.color.dark, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Zap size={17} color="#fff" strokeWidth={2.5} />
          </div>
          <span style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 22, color: T.color.dark, letterSpacing: "-0.3px" }}>FileFlow</span>
        </PageLink>
        <nav style={{ display: "flex", gap: 2, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }} className="ff-desk-nav">
          {navLinks.map(({ label, p }) => (
            <PageLink key={p} page={p} go={go} style={{
              background: page === p ? T.color.dark : "none", color: page === p ? "#fff" : T.color.mid,
              border: "none", borderRadius: T.radius.sm, padding: "7px 9px", display: "inline-flex",
              fontFamily: T.font.body, fontWeight: 500, fontSize: 12.5, cursor: "pointer", transition: "all .18s",
            }}>{label}</PageLink>
          ))}
        </nav>
        <button onClick={() => setOpen(!open)} className="ff-ham" style={{ display: "none", background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <Menu size={22} color={T.color.dark} />
        </button>
      </div>
      {open && (
        <div className="ff-mob-menu" style={{ background: T.color.surface, borderTop: `1px solid ${T.color.border}`, padding: "10px 20px 16px", maxHeight: "calc(100vh - 62px)", overflowY: "auto" }}>
          {mobileLinks.map(({ label, p, Icon: Ic }) => (
            <PageLink key={p} page={p} go={go} onClick={() => setOpen(false)} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
              background: page === p ? "#F0F0F0" : "none", border: "none", borderRadius: T.radius.sm,
              padding: "11px 12px", fontFamily: T.font.body, fontWeight: page === p ? 600 : 400,
              fontSize: 15, color: T.color.dark, cursor: "pointer", marginBottom: 2,
            }}><Ic size={16} color={T.color.mid} />{label}</PageLink>
          ))}
        </div>
      )}
    </header>
  );
}

function Crumb({ page, go }) {
  if (page === P.HOME) return null;
  return (
    <div style={{ borderBottom: `1px solid ${T.color.border}`, background: T.color.surface, padding: "9px 20px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", alignItems: "center", gap: 6 }}>
        <PageLink page={P.HOME} go={go} style={{ background: "none", border: "none", fontFamily: T.font.body, fontSize: 12.5, color: T.color.muted, cursor: "pointer", padding: 0 }}>Home</PageLink>
        <ChevronRight size={13} color={T.color.muted} />
        <span style={{ fontFamily: T.font.body, fontSize: 12.5, color: T.color.mid, fontWeight: 500 }}>{META[page]?.title || PAGE_LABEL[page] || "Page"}</span>
      </div>
    </div>
  );
}

function DropZone({ meta, onFiles }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef();
  return (
    <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files)); }}
      onClick={() => ref.current.click()}
      style={{
        border: `2px dashed ${drag ? meta.accent : "#CBD5E1"}`, borderRadius: T.radius.md,
        padding: "34px 22px", minHeight: 210, textAlign: "center", cursor: "pointer",
        background: drag ? `${meta.accent}0D` : "#FBFCFE",
        transition: "all .22s", boxShadow: drag ? `0 0 0 5px ${meta.accent}14` : "0 10px 28px rgba(17,19,24,0.04)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}>
      <input ref={ref} type="file" accept={meta.accepts} multiple style={{ display: "none" }}
        onChange={e => e.target.files.length && onFiles(Array.from(e.target.files))} />
      <div style={{ width: 58, height: 58, borderRadius: T.radius.md, background: `${meta.accent}12`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", border: `1px solid ${meta.accent}18` }}>
        <Upload size={25} color={meta.accent} strokeWidth={2} />
      </div>
      <p style={{ fontFamily: T.font.body, fontWeight: 700, fontSize: 16, color: T.color.dark, margin: "0 0 7px", lineHeight: 1.35 }}>
        Drop files here or <span style={{ color: meta.accent, textDecoration: "underline" }}>browse</span>
      </p>
      <p style={{ fontFamily: T.font.body, fontSize: 13, color: T.color.muted, margin: 0, lineHeight: 1.45, maxWidth: 360 }}>
        {meta.acceptLabel} · Max 100 MB per file
      </p>
    </div>
  );
}

function FileRow({ file, meta, onRemove, status }) {
  const ext = file.name.split(".").pop().toUpperCase();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", background: T.color.surface, borderRadius: T.radius.md, border: `1px solid ${T.color.border}` }}>
      <div style={{ width: 38, height: 38, borderRadius: T.radius.sm, background: `${meta.accent}10`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <File size={16} color={meta.accent} strokeWidth={2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontFamily: T.font.body, fontWeight: 600, fontSize: 13.5, color: T.color.dark, margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</p>
        <p style={{ fontFamily: T.font.body, fontSize: 12, color: T.color.muted, margin: 0 }}>{ext} · {(file.size / 1024).toFixed(1)} KB</p>
      </div>
      {status === "converting" && <div style={{ width: 18, height: 18, border: `2px solid ${meta.accent}`, borderTop: "2px solid transparent", borderRadius: "50%", animation: "ff-spin .75s linear infinite", flexShrink: 0 }} />}
      {status === "done" && <CheckCircle size={20} color="#059669" strokeWidth={2} />}
      {status === "error" && <AlertCircle size={20} color="#DC2626" strokeWidth={2} />}
      {status === "idle" && (
        <button onClick={onRemove} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: T.color.muted, display: "flex" }}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}

function ToolSeoSection({ page, accent }) {
  const content = TOOL_SEO[page];
  if (!content) return null;
  return (
    <section style={{ marginTop: 46, display: "grid", gap: 16 }}>
      <div style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: 20 }}>
        <h2 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 24, color: T.color.dark, margin: "0 0 8px" }}>How to use {PAGE_LABEL[page]}</h2>
        <p style={{ fontFamily: T.font.body, fontSize: 14, color: T.color.mid, lineHeight: 1.7, margin: "0 0 16px" }}>{content.intro}</p>
        <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
          {content.steps.map(step => (
            <li key={step} style={{ fontFamily: T.font.body, fontSize: 14, color: T.color.mid, lineHeight: 1.55 }}>{step}</li>
          ))}
        </ol>
      </div>
      {(content.searches?.length || content.useCases?.length) && (
        <div style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: 20 }}>
          <h2 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 23, color: T.color.dark, margin: "0 0 14px" }}>Popular {PAGE_LABEL[page]} searches</h2>
          {content.searches?.length && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: content.useCases?.length ? 18 : 0 }}>
              {content.searches.map(term => (
                <span key={term} style={{ fontFamily: T.font.body, fontSize: 12.5, fontWeight: 600, color: accent, background: `${accent}10`, border: `1px solid ${accent}22`, borderRadius: T.radius.pill, padding: "7px 10px" }}>{term}</span>
              ))}
            </div>
          )}
          {content.useCases?.length && (
            <div>
              <h3 style={{ fontFamily: T.font.body, fontWeight: 700, fontSize: 14.5, color: T.color.dark, margin: "0 0 8px" }}>Best for</h3>
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                {content.useCases.map(item => (
                  <li key={item} style={{ fontFamily: T.font.body, fontSize: 13.5, color: T.color.mid, lineHeight: 1.55 }}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: 20 }}>
        <h2 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 23, color: T.color.dark, margin: "0 0 14px" }}>{PAGE_LABEL[page]} FAQ</h2>
        <div style={{ display: "grid", gap: 12 }}>
          {content.faqs.map(([q, a]) => (
            <div key={q} style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 12 }}>
              <h3 style={{ fontFamily: T.font.body, fontWeight: 700, fontSize: 14.5, color: T.color.dark, margin: "0 0 4px" }}>{q}</h3>
              <p style={{ fontFamily: T.font.body, fontSize: 13.5, color: T.color.mid, lineHeight: 1.65, margin: 0 }}>{a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ConverterPage({ meta, page }) {
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | converting | done | error
  const [progress, setProgress] = useState(0);
  const [errMsg, setErrMsg] = useState("");
  const { FromIcon, ToIcon } = meta;

  const addFiles = f => {
    setStatus("idle"); setErrMsg("");
    setFiles(prev => {
      const nextFiles = f.filter(nf => !prev.find(x => x.name === nf.name));
      trackUploadedFiles(nextFiles.length);
      return [...prev, ...nextFiles];
    });
  };
  const remove = i => setFiles(f => f.filter((_, idx) => idx !== i));

  const convert = async () => {
    if (!files.length) return;
    setStatus("converting"); setProgress(0); setErrMsg("");
    try {
      await meta.convert(files, (p) => setProgress(p));
      setStatus("done");
    } catch (err) {
      setErrMsg(err?.message || "Conversion failed. Please try another file.");
      setStatus("error");
    }
  };

  const reset = () => { setFiles([]); setStatus("idle"); setProgress(0); setErrMsg(""); };

  return (
    <div style={{ maxWidth: 660, margin: "0 auto", padding: "40px 16px 72px" }}>
      {/* Hero */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ width: 64, height: 64, borderRadius: T.radius.md, background: `${meta.accent}12`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <meta.Icon size={30} color={meta.accent} strokeWidth={1.5} />
        </div>
        <h1 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: "clamp(28px,6vw,42px)", color: T.color.dark, margin: "0 0 10px", letterSpacing: "-0.5px" }}>{meta.title}</h1>
        <p style={{ fontFamily: T.font.body, fontSize: 15, color: T.color.mid, margin: "0 0 22px" }}>{meta.sub}</p>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.pill, padding: "8px 18px" }}>
          <FromIcon size={15} color={meta.accent} />
          <span style={{ fontFamily: T.font.body, fontWeight: 600, fontSize: 13, color: meta.accent }}>{meta.from}</span>
          <ArrowRight size={13} color={T.color.muted} />
          <ToIcon size={15} color={meta.accent} />
          <span style={{ fontFamily: T.font.body, fontWeight: 600, fontSize: 13, color: meta.accent }}>{meta.to}</span>
        </div>
      </div>

      {/* Info badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: T.radius.md, padding: "10px 14px", marginBottom: 20 }}>
        <Shield size={15} color="#2563EB" strokeWidth={2} style={{ flexShrink: 0 }} />
        <span style={{ fontFamily: T.font.body, fontSize: 13, color: "#1D4ED8" }}>
          Private by design — browser tools run locally, while Word/PDF conversions use the configured FileFlow converter service.
        </span>
      </div>

      {status !== "done" && <DropZone meta={meta} onFiles={addFiles} />}

      {files.length > 0 && status !== "done" && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {files.map((f, i) => (
            <FileRow key={f.name} file={f} meta={meta} onRemove={() => remove(i)}
              status={status === "converting" ? "converting" : status === "error" ? "error" : "idle"} />
          ))}
        </div>
      )}

      {/* Progress */}
      {status === "converting" && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontFamily: T.font.body, fontSize: 12, color: T.color.muted }}>Converting files…</span>
            <span style={{ fontFamily: T.font.body, fontSize: 12, fontWeight: 600, color: meta.accent }}>{Math.round(progress)}%</span>
          </div>
          <div style={{ background: T.color.border, borderRadius: 50, height: 5, overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: meta.accent, transition: "width .25s", borderRadius: 50 }} />
          </div>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: T.radius.md, padding: "12px 16px" }}>
          <AlertCircle size={18} color="#DC2626" />
          <span style={{ fontFamily: T.font.body, fontSize: 13.5, color: "#991B1B" }}>{errMsg}</span>
        </div>
      )}

      {/* Done */}
      {status === "done" && (
        <div style={{ textAlign: "center", padding: "48px 24px", background: "#F0FDF4", border: "1.5px solid #BBF7D0", borderRadius: T.radius.lg }}>
          <CheckCircle size={44} color="#059669" strokeWidth={1.5} style={{ marginBottom: 14 }} />
          <h2 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 26, color: T.color.dark, margin: "0 0 8px" }}>Download Started</h2>
          <p style={{ fontFamily: T.font.body, fontSize: 14, color: T.color.mid, margin: "0 0 28px" }}>
            {files.length} file{files.length > 1 ? "s" : ""} converted — check your downloads folder.
          </p>
          <button onClick={reset} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: T.color.dark, color: "#fff", border: "none", borderRadius: T.radius.md, padding: "12px 28px", fontFamily: T.font.body, fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
            <RotateCcw size={15} /> Convert More Files
          </button>
        </div>
      )}

      {/* Convert button */}
      {status === "idle" && files.length > 0 && (
        <button onClick={convert} style={{
          marginTop: 20, width: "100%", background: meta.accent, color: "#fff", border: "none",
          borderRadius: T.radius.md, padding: "15px", fontFamily: T.font.body, fontWeight: 700,
          fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <Zap size={17} /> Convert &amp; Download {files.length} File{files.length > 1 ? "s" : ""}
        </button>
      )}
      {status === "error" && (
        <button onClick={reset} style={{ marginTop: 14, width: "100%", background: T.color.surface, color: T.color.dark, border: `1.5px solid ${T.color.border}`, borderRadius: T.radius.md, padding: "13px", fontFamily: T.font.body, fontWeight: 600, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <RotateCcw size={15} /> Try Again
        </button>
      )}

      {/* Steps */}
      <div style={{ marginTop: 56 }}>
        <h3 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 22, color: T.color.dark, marginBottom: 20, textAlign: "center" }}>How It Works</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 14 }}>
          {[
            { n: "01", Icon: Upload, label: "Upload", desc: "Drop or select files" },
            { n: "02", Icon: Zap, label: "Convert", desc: "Processed in your browser" },
            { n: "03", Icon: Download, label: "Download", desc: "Files save automatically" },
          ].map(({ n, Icon: Ic, label, desc }) => (
            <div key={n} style={{ padding: "22px 16px", background: T.color.surface, borderRadius: T.radius.md, border: `1px solid ${T.color.border}`, textAlign: "center" }}>
              <span style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 13, color: T.color.muted, letterSpacing: 1 }}>{n}</span>
              <div style={{ margin: "12px auto 10px", width: 40, height: 40, borderRadius: T.radius.sm, background: `${meta.accent}10`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic size={18} color={meta.accent} strokeWidth={1.8} />
              </div>
              <p style={{ fontFamily: T.font.body, fontWeight: 600, fontSize: 14, color: T.color.dark, margin: "0 0 4px" }}>{label}</p>
              <p style={{ fontFamily: T.font.body, fontSize: 12, color: T.color.muted, margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>
      <ToolSeoSection page={page} accent={meta.accent} />
    </div>
  );
}

function SplitPdfPage() {
  const meta = META[P.SPLIT];
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("all");
  const [selection, setSelection] = useState("");
  const [outputMode, setOutputMode] = useState("single");
  const [naming, setNaming] = useState("source");
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [errMsg, setErrMsg] = useState("");

  const addFiles = files => {
    const nextFile = files.find(f => /\.pdf$/i.test(f.name)) || null;
    setFile(nextFile);
    if (nextFile) trackUploadedFiles(1);
    setStatus("idle");
    setErrMsg("");
    setProgress(0);
  };
  const reset = () => {
    setFile(null);
    setMode("all");
    setSelection("");
    setOutputMode("single");
    setNaming("source");
    setStatus("idle");
    setProgress(0);
    setErrMsg("");
  };
  const convert = async () => {
    if (!file) return;
    setStatus("converting");
    setProgress(0);
    setErrMsg("");
    try {
      await splitPdfWithOptions(file, { mode, selection, outputMode, naming }, setProgress);
      setStatus("done");
    } catch (err) {
      setErrMsg(err?.message || "Split failed. Check your page range and try again.");
      setStatus("error");
    }
  };

  const optionStyle = active => ({
    flex: 1, minWidth: 150, padding: "13px 14px", borderRadius: T.radius.md,
    border: `1.5px solid ${active ? meta.accent : T.color.border}`,
    background: active ? `${meta.accent}10` : T.color.surface,
    color: active ? meta.accent : T.color.dark,
    fontFamily: T.font.body, fontWeight: 700, fontSize: 13.5, cursor: "pointer",
  });

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 16px 72px" }}>
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ width: 64, height: 64, borderRadius: T.radius.md, background: `${meta.accent}12`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <FileOutput size={30} color={meta.accent} strokeWidth={1.5} />
        </div>
        <h1 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: "clamp(28px,6vw,42px)", color: T.color.dark, margin: "0 0 10px" }}>Split PDF</h1>
        <p style={{ fontFamily: T.font.body, fontSize: 15, color: T.color.mid, margin: 0 }}>Split all pages, selected page numbers, or page ranges like 1-6, 8-9.</p>
      </div>

      {!file && <DropZone meta={meta} onFiles={addFiles} />}

      {file && status !== "done" && (
        <div style={{ display: "grid", gap: 16 }}>
          <FileRow file={file} meta={meta} onRemove={reset} status={status === "converting" ? "converting" : status === "error" ? "error" : "idle"} />

          <div style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: 18 }}>
            <h2 style={{ fontFamily: T.font.body, fontSize: 15, color: T.color.dark, margin: "0 0 12px" }}>Split mode</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => setMode("all")} style={optionStyle(mode === "all")}>All pages</button>
              <button onClick={() => setMode("numbers")} style={optionStyle(mode === "numbers")}>Page numbers</button>
              <button onClick={() => setMode("range")} style={optionStyle(mode === "range")}>Page ranges</button>
            </div>
            {mode !== "all" && (
              <div style={{ marginTop: 14 }}>
                <input value={selection} onChange={e => setSelection(e.target.value)} placeholder={mode === "numbers" ? "Example: 1, 3, 7" : "Example: 1-6, 8-9"}
                  style={{ width: "100%", border: `1.5px solid ${T.color.border}`, borderRadius: T.radius.sm, padding: "12px 13px", fontFamily: T.font.body, fontSize: 14, outline: "none" }} />
                <p style={{ fontFamily: T.font.body, fontSize: 12.5, color: T.color.muted, margin: "8px 0 0" }}>Use commas to separate pages or ranges. Pages start at 1.</p>
              </div>
            )}
          </div>

          <div style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: 18 }}>
            <h2 style={{ fontFamily: T.font.body, fontSize: 15, color: T.color.dark, margin: "0 0 12px" }}>Output options</h2>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: T.font.body, fontSize: 14, color: T.color.mid }}>
                <input type="radio" checked={outputMode === "single"} onChange={() => setOutputMode("single")} /> Create one PDF per page/range
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: T.font.body, fontSize: 14, color: T.color.mid }}>
                <input type="radio" checked={outputMode === "combined"} onChange={() => setOutputMode("combined")} /> Create one PDF containing selected pages
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: T.font.body, fontSize: 14, color: T.color.mid }}>
                <input type="checkbox" checked={naming === "source"} onChange={e => setNaming(e.target.checked ? "source" : "simple")} /> Include source filename in downloads
              </label>
            </div>
          </div>

          {status === "converting" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontFamily: T.font.body, fontSize: 12, color: T.color.muted }}>Splitting PDF...</span>
                <span style={{ fontFamily: T.font.body, fontSize: 12, fontWeight: 600, color: meta.accent }}>{Math.round(progress)}%</span>
              </div>
              <div style={{ background: T.color.border, borderRadius: 50, height: 5, overflow: "hidden" }}>
                <div style={{ width: `${progress}%`, height: "100%", background: meta.accent, transition: "width .25s", borderRadius: 50 }} />
              </div>
            </div>
          )}

          {status === "error" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: T.radius.md, padding: "12px 16px" }}>
              <AlertCircle size={18} color="#DC2626" />
              <span style={{ fontFamily: T.font.body, fontSize: 13.5, color: "#991B1B" }}>{errMsg}</span>
            </div>
          )}

          <button onClick={convert} disabled={status === "converting"} style={{ width: "100%", background: meta.accent, color: "#fff", border: "none", borderRadius: T.radius.md, padding: "15px", fontFamily: T.font.body, fontWeight: 700, fontSize: 16, cursor: status === "converting" ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Zap size={17} /> Split &amp; Download
          </button>
        </div>
      )}

      {status === "done" && (
        <div style={{ textAlign: "center", padding: "48px 24px", background: "#F0FDF4", border: "1.5px solid #BBF7D0", borderRadius: T.radius.lg }}>
          <CheckCircle size={44} color="#059669" strokeWidth={1.5} style={{ marginBottom: 14 }} />
          <h2 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 26, color: T.color.dark, margin: "0 0 8px" }}>Download Started</h2>
          <button onClick={reset} style={{ marginTop: 20, display: "inline-flex", alignItems: "center", gap: 8, background: T.color.dark, color: "#fff", border: "none", borderRadius: T.radius.md, padding: "12px 28px", fontFamily: T.font.body, fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
            <RotateCcw size={15} /> Split Another PDF
          </button>
        </div>
      )}
      <ToolSeoSection page={P.SPLIT} accent={meta.accent} />
    </div>
  );
}

function CompressPdfPage() {
  const meta = META[P.COMPRESS];
  const [file, setFile] = useState(null);
  const [pageCount, setPageCount] = useState(null);
  const [compression, setCompression] = useState(60);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [errMsg, setErrMsg] = useState("");
  const [outputSize, setOutputSize] = useState(null);

  const addFiles = async files => {
    const pdfFile = files.find(f => /\.pdf$/i.test(f.name)) || null;
    setFile(pdfFile);
    if (pdfFile) trackUploadedFiles(1);
    setStatus("idle");
    setErrMsg("");
    setOutputSize(null);
    setProgress(0);
    if (pdfFile) {
      try {
        await ensurePdfLib();
        const pdf = await window.PDFLib.PDFDocument.load(await pdfFile.arrayBuffer());
        const count = pdf.getPageCount();
        setPageCount(count);
      } catch {
        setPageCount(null);
      }
    }
  };
  const reset = () => {
    setFile(null);
    setPageCount(null);
    setCompression(60);
    setStatus("idle");
    setProgress(0);
    setErrMsg("");
    setOutputSize(null);
  };
  const convert = async () => {
    if (!file) return;
    setStatus("converting");
    setProgress(0);
    setErrMsg("");
    setOutputSize(null);
    try {
      const size = await compressPdfWithOptions(file, { compression }, setProgress);
      setOutputSize(size);
      setStatus("done");
    } catch (err) {
      setErrMsg(err?.message || "Compression failed. Adjust the compression range and try again.");
      setStatus("error");
    }
  };
  const compressionLabel = compression < 35 ? "Low" : compression < 65 ? "Balanced" : compression < 90 ? "High" : "Extreme";

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 16px 72px" }}>
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ width: 64, height: 64, borderRadius: T.radius.md, background: `${meta.accent}12`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <Download size={30} color={meta.accent} strokeWidth={1.5} />
        </div>
        <h1 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: "clamp(28px,6vw,42px)", color: T.color.dark, margin: "0 0 10px" }}>Compress PDF</h1>
        <p style={{ fontFamily: T.font.body, fontSize: 15, color: T.color.mid, margin: 0 }}>Drag the compression range to increase or decrease optimization strength.</p>
      </div>

      {!file && <DropZone meta={meta} onFiles={addFiles} />}

      {file && status !== "done" && (
        <div style={{ display: "grid", gap: 16 }}>
          <FileRow file={file} meta={meta} onRemove={reset} status={status === "converting" ? "converting" : status === "error" ? "error" : "idle"} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
            <div style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: 16 }}>
              <p style={{ fontFamily: T.font.body, fontSize: 12, color: T.color.muted, margin: "0 0 5px" }}>Original size</p>
              <p style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 26, color: T.color.dark, margin: 0 }}>{formatBytes(file.size)}</p>
            </div>
            <div style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: 16 }}>
              <p style={{ fontFamily: T.font.body, fontSize: 12, color: T.color.muted, margin: "0 0 5px" }}>Pages</p>
              <p style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 26, color: T.color.dark, margin: 0 }}>{pageCount || "-"}</p>
            </div>
          </div>

          <div style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ fontFamily: T.font.body, fontSize: 15, color: T.color.dark, margin: 0 }}>Compression range</h2>
              <span style={{ fontFamily: T.font.body, fontWeight: 700, fontSize: 13, color: meta.accent }}>{compression}% · {compressionLabel}</span>
            </div>
            <input type="range" min="1" max="100" value={compression} onChange={e => setCompression(Number(e.target.value))}
              style={{ width: "100%", accentColor: meta.accent }} />
            <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", fontFamily: T.font.body, fontSize: 12, color: T.color.muted }}>
              <span>Smaller change</span>
              <span>More compression</span>
            </div>
            <p style={{ fontFamily: T.font.body, fontSize: 12.5, color: T.color.muted, margin: "12px 0 0" }}>Drag higher for stronger compression. Extreme mode makes image-heavy PDFs much smaller by reducing image resolution and quality.</p>
          </div>

          {status === "converting" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontFamily: T.font.body, fontSize: 12, color: T.color.muted }}>Compressing PDF...</span>
                <span style={{ fontFamily: T.font.body, fontSize: 12, fontWeight: 600, color: meta.accent }}>{Math.round(progress)}%</span>
              </div>
              <div style={{ background: T.color.border, borderRadius: 50, height: 5, overflow: "hidden" }}>
                <div style={{ width: `${progress}%`, height: "100%", background: meta.accent, transition: "width .25s", borderRadius: 50 }} />
              </div>
            </div>
          )}

          {status === "error" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: T.radius.md, padding: "12px 16px" }}>
              <AlertCircle size={18} color="#DC2626" />
              <span style={{ fontFamily: T.font.body, fontSize: 13.5, color: "#991B1B" }}>{errMsg}</span>
            </div>
          )}

          <button onClick={convert} disabled={status === "converting"} style={{ width: "100%", background: meta.accent, color: "#fff", border: "none", borderRadius: T.radius.md, padding: "15px", fontFamily: T.font.body, fontWeight: 700, fontSize: 16, cursor: status === "converting" ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Zap size={17} /> Compress &amp; Download
          </button>
        </div>
      )}

      {status === "done" && (
        <div style={{ textAlign: "center", padding: "42px 24px", background: "#F0FDF4", border: "1.5px solid #BBF7D0", borderRadius: T.radius.lg }}>
          <CheckCircle size={44} color="#059669" strokeWidth={1.5} style={{ marginBottom: 14 }} />
          <h2 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 26, color: T.color.dark, margin: "0 0 16px" }}>Download Started</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 24 }}>
            <div style={{ background: T.color.surface, borderRadius: T.radius.sm, padding: 14 }}>
              <p style={{ fontFamily: T.font.body, fontSize: 12, color: T.color.muted, margin: "0 0 4px" }}>Original</p>
              <p style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 22, color: T.color.dark, margin: 0 }}>{formatBytes(file?.size || 0)}</p>
            </div>
            <div style={{ background: T.color.surface, borderRadius: T.radius.sm, padding: 14 }}>
              <p style={{ fontFamily: T.font.body, fontSize: 12, color: T.color.muted, margin: "0 0 4px" }}>Output</p>
              <p style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 22, color: T.color.dark, margin: 0 }}>{formatBytes(outputSize || 0)}</p>
            </div>
          </div>
          <button onClick={reset} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: T.color.dark, color: "#fff", border: "none", borderRadius: T.radius.md, padding: "12px 28px", fontFamily: T.font.body, fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
            <RotateCcw size={15} /> Compress Another PDF
          </button>
        </div>
      )}
      <ToolSeoSection page={P.COMPRESS} accent={meta.accent} />
    </div>
  );
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

async function renderPdfPagesFromBytes(bytes, source, onProgress = () => {}) {
  await ensureLibs();
  const pdf = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const renderViewport = page.getViewport({ scale: 1.25 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(renderViewport.width);
    canvas.height = Math.ceil(renderViewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport: renderViewport }).promise;
    const preview = canvas.toDataURL("image/png");
    canvas.width = 0;
    canvas.height = 0;
    pages.push({
      id: `${source}_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
      source,
      bytes,
      sourcePageIndex: i - 1,
      width: viewport.width,
      height: viewport.height,
      preview,
      overlays: [],
    });
    onProgress(Math.round((i / pdf.numPages) * 100));
  }
  return pages;
}

function PdfEditorPage() {
  const meta = META[P.EDITOR];
  const mainInput = useRef(null);
  const imageInput = useRef(null);
  const rightInput = useRef(null);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const [pages, setPages] = useState([]);
  const [current, setCurrent] = useState(0);
  const [rightPages, setRightPages] = useState([]);
  const [rightSelected, setRightSelected] = useState(null);
  const [selectedOverlay, setSelectedOverlay] = useState(null);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [errMsg, setErrMsg] = useState("");
  const [zoom, setZoom] = useState(.85);
  const [editingOverlay, setEditingOverlay] = useState(null);
  const activePage = pages[current];
  const activeOverlay = activePage?.overlays.find(item => item.id === selectedOverlay);

  const loadMainPdf = async file => {
    if (!file) return;
    trackUploadedFiles(1);
    setStatus("loading"); setProgress(0); setErrMsg("");
    try {
      const bytes = await file.arrayBuffer();
      const nextPages = await renderPdfPagesFromBytes(bytes, "main", setProgress);
      setPages(nextPages);
      setCurrent(0);
      setSelectedOverlay(null);
      setStatus("idle");
    } catch (err) {
      setErrMsg(err?.message || "Could not open this PDF.");
      setStatus("error");
    }
  };

  const loadRightPdf = async file => {
    if (!file) return;
    trackUploadedFiles(1);
    setStatus("loading"); setProgress(0); setErrMsg("");
    try {
      const bytes = await file.arrayBuffer();
      const nextPages = await renderPdfPagesFromBytes(bytes, "right", setProgress);
      setRightPages(nextPages);
      setRightSelected(null);
      setStatus("idle");
    } catch (err) {
      setErrMsg(err?.message || "Could not open the second PDF.");
      setStatus("error");
    }
  };

  const updatePage = (pageIndex, updater) => {
    setPages(prev => prev.map((page, index) => index === pageIndex ? updater(page) : page));
  };

  const addBlankAfter = index => {
    const base = pages[index] || activePage || { width: 595, height: 842 };
    const blank = {
      id: `blank_${Date.now()}`,
      source: "blank",
      width: base.width,
      height: base.height,
      preview: null,
      overlays: [],
    };
    setPages(prev => [...prev.slice(0, index + 1), blank, ...prev.slice(index + 1)]);
    setCurrent(index + 1);
    setSelectedOverlay(null);
  };

  const addRightPageAfter = index => {
    const page = rightSelected === null ? null : rightPages[rightSelected];
    if (!page) return addBlankAfter(index);
    const imported = { ...page, id: `import_${Date.now()}_${rightSelected}`, source: "right", overlays: [] };
    setPages(prev => [...prev.slice(0, index + 1), imported, ...prev.slice(index + 1)]);
    setCurrent(index + 1);
    setSelectedOverlay(null);
  };

  const deletePage = index => {
    if (pages.length <= 1) return;
    setPages(prev => prev.filter((_, i) => i !== index));
    setCurrent(prev => Math.max(0, Math.min(prev >= index ? prev - 1 : prev, pages.length - 2)));
    setSelectedOverlay(null);
  };

  const addText = () => {
    if (!activePage) return;
    const id = `text_${Date.now()}`;
    updatePage(current, page => ({
      ...page,
      overlays: [...page.overlays, {
        id, type: "text", text: "New text", x: .12, y: .12, width: .36, height: .06,
        fontSize: 18, color: "#111318", font: "Helvetica", bold: false,
      }],
    }));
    setSelectedOverlay(id);
  };

  const addImage = async file => {
    if (!file || !activePage) return;
    trackUploadedFiles(1);
    const dataUrl = await readAsDataUrl(file);
    const bytes = await file.arrayBuffer();
    const img = new window.Image();
    img.onload = () => {
      const id = `image_${Date.now()}`;
      const ratio = img.naturalHeight / img.naturalWidth;
      updatePage(current, page => ({
        ...page,
        overlays: [...page.overlays, {
          id, type: "image", dataUrl, bytes, mime: file.type || "image/png",
          x: .16, y: .16, width: .28, height: Math.min(.32, .28 * ratio), ratio,
        }],
      }));
      setSelectedOverlay(id);
    };
    img.src = dataUrl;
  };

  const updateOverlay = changes => {
    if (!selectedOverlay) return;
    updatePage(current, page => ({
      ...page,
      overlays: page.overlays.map(item => {
        if (item.id !== selectedOverlay) return item;
        const next = { ...item, ...changes };
        next.width = clampNumber(next.width, .04, Math.max(.04, 1 - next.x));
        next.height = clampNumber(next.height, .03, Math.max(.03, 1 - next.y));
        next.x = clampNumber(next.x, 0, Math.max(0, 1 - next.width));
        next.y = clampNumber(next.y, 0, Math.max(0, 1 - next.height));
        return next;
      }),
    }));
  };

  const deleteOverlay = () => {
    if (!selectedOverlay) return;
    updatePage(current, page => ({ ...page, overlays: page.overlays.filter(item => item.id !== selectedOverlay) }));
    setSelectedOverlay(null);
    setEditingOverlay(null);
  };

  const startDrag = (event, item) => {
    if (event.target.closest?.("[data-resize-handle], textarea, input, select, button")) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedOverlay(item.id);
    setEditingOverlay(null);
    const point = event.touches?.[0] || event;
    dragRef.current = { id: item.id, x: item.x, y: item.y, sx: point.clientX, sy: point.clientY };
    const move = moveEvent => {
      const drag = dragRef.current;
      if (!drag || !stageRef.current) return;
      const movePoint = moveEvent.touches?.[0] || moveEvent;
      const rect = stageRef.current.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dx = (movePoint.clientX - drag.sx) / rect.width;
      const dy = (movePoint.clientY - drag.sy) / rect.height;
      updatePage(current, page => ({
        ...page,
        overlays: page.overlays.map(overlay => overlay.id === drag.id
          ? {
              ...overlay,
              x: clampNumber(drag.x + dx, 0, Math.max(0, 1 - overlay.width)),
              y: clampNumber(drag.y + dy, 0, Math.max(0, 1 - overlay.height)),
            }
          : overlay),
      }));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("blur", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("blur", up);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
  };

  const startResize = (event, item) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedOverlay(item.id);
    setEditingOverlay(null);
    dragRef.current = { id: item.id, x: item.x, y: item.y };
    const move = moveEvent => {
      const drag = dragRef.current;
      if (!drag || !stageRef.current) return;
      const movePoint = moveEvent.touches?.[0] || moveEvent;
      const rect = stageRef.current.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const cursorX = clampNumber((movePoint.clientX - rect.left) / rect.width, 0, 1);
      const cursorY = clampNumber((movePoint.clientY - rect.top) / rect.height, 0, 1);
      updatePage(current, page => ({
        ...page,
        overlays: page.overlays.map(overlay => overlay.id === drag.id
          ? (() => {
              const maxWidth = Math.max(.04, 1 - drag.x);
              const maxHeight = Math.max(.03, 1 - drag.y);
              let width = clampNumber(cursorX - drag.x, .04, maxWidth);
              let height = clampNumber(cursorY - drag.y, .03, maxHeight);
              if (overlay.type === "image" && overlay.ratio) {
                width = Math.min(width, maxHeight / overlay.ratio);
                height = width * overlay.ratio;
              }
              return { ...overlay, width, height };
            })()
          : overlay),
      }));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("blur", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("blur", up);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
  };

  const exportPdf = async () => {
    if (!pages.length) return;
    setStatus("exporting"); setProgress(0); setErrMsg("");
    try {
      await ensurePdfLib();
      const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
      const out = await PDFDocument.create();
      const fontCache = {};
      const getFont = async name => {
        const key = name === "Times" ? StandardFonts.TimesRoman : name === "Courier" ? StandardFonts.Courier : StandardFonts.Helvetica;
        if (!fontCache[key]) fontCache[key] = await out.embedFont(key);
        return fontCache[key];
      };
      for (let i = 0; i < pages.length; i++) {
        const item = pages[i];
        let page;
        if (item.source === "blank") {
          page = out.addPage([item.width, item.height]);
        } else {
          const sourceDoc = await PDFDocument.load(item.bytes.slice(0));
          const [copied] = await out.copyPages(sourceDoc, [item.sourcePageIndex]);
          page = out.addPage(copied);
        }
        for (const overlay of item.overlays) {
          const x = overlay.x * item.width;
          const y = item.height - (overlay.y + overlay.height) * item.height;
          if (overlay.type === "text") {
            const font = await getFont(overlay.font);
            const hex = overlay.color.replace("#", "");
            const color = rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
            const lines = String(overlay.text || "").split("\n");
            lines.forEach((line, lineIndex) => {
              page.drawText(line, {
                x,
                y: y + Math.max(0, overlay.height * item.height - overlay.fontSize) - lineIndex * overlay.fontSize * 1.2,
                size: overlay.fontSize,
                font,
                color,
              });
            });
          } else if (overlay.type === "image") {
            const bytes = overlay.bytes.slice(0);
            const image = overlay.mime.includes("jpg") || overlay.mime.includes("jpeg") ? await out.embedJpg(bytes) : await out.embedPng(bytes);
            page.drawImage(image, { x, y, width: overlay.width * item.width, height: overlay.height * item.height });
          }
        }
        setProgress(Math.round(((i + 1) / pages.length) * 100));
      }
      downloadBlob(new Blob([await out.save()], { type: "application/pdf" }), "edited.pdf");
      setStatus("idle");
    } catch (err) {
      setErrMsg(err?.message || "Export failed. Try a simpler PDF or remove unsupported images.");
      setStatus("error");
    }
  };

  if (!pages.length) {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px 72px" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 64, height: 64, borderRadius: T.radius.md, background: `${meta.accent}12`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <FileOutput size={30} color={meta.accent} strokeWidth={1.5} />
          </div>
          <h1 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: "clamp(28px,6vw,42px)", color: T.color.dark, margin: "0 0 10px" }}>PDF Editor</h1>
          <p style={{ fontFamily: T.font.body, fontSize: 15, color: T.color.mid, margin: 0 }}>Upload a PDF, edit pages, add images or text, and download a new PDF.</p>
        </div>
        <DropZone meta={meta} onFiles={files => loadMainPdf(files[0])} />
        {status === "loading" && <p style={{ textAlign: "center", fontFamily: T.font.body, color: meta.accent, marginTop: 18 }}>Loading PDF... {progress}%</p>}
        {errMsg && <p style={{ textAlign: "center", fontFamily: T.font.body, color: "#DC2626", marginTop: 18 }}>{errMsg}</p>}
        <ToolSeoSection page={P.EDITOR} accent={meta.accent} />
      </div>
    );
  }

  const displayWidth = Math.min(activePage.width * zoom, 760);
  const scale = displayWidth / activePage.width;

  return (
    <div style={{ padding: "18px 14px 48px" }}>
      <div className="ff-pdf-editor-grid" style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "190px minmax(0,1fr) 240px", gap: 14 }}>
        <aside style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: 12, maxHeight: "78vh", overflow: "auto" }}>
          <button onClick={() => mainInput.current?.click()} style={{ width: "100%", border: `1px solid ${T.color.border}`, background: "#fff", borderRadius: T.radius.sm, padding: 10, fontFamily: T.font.body, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}><Upload size={14} /> New PDF</button>
          <input ref={mainInput} type="file" accept=".pdf" hidden onChange={e => loadMainPdf(e.target.files?.[0])} />
          {pages.map((page, index) => (
            <div key={page.id} style={{ marginBottom: 10 }}>
              <button onClick={() => { setCurrent(index); setSelectedOverlay(null); }} style={{ width: "100%", border: `2px solid ${current === index ? meta.accent : T.color.border}`, borderRadius: T.radius.sm, background: "#fff", padding: 6, cursor: "pointer" }}>
                {page.preview ? <img src={page.preview} alt={`Page ${index + 1}`} style={{ width: "100%", display: "block" }} /> : <div style={{ aspectRatio: `${page.width}/${page.height}`, display: "grid", placeItems: "center", background: T.color.bg, fontFamily: T.font.body, color: T.color.muted }}>Blank</div>}
                <span style={{ display: "block", marginTop: 5, fontFamily: T.font.body, fontSize: 12, color: T.color.mid }}>Page {index + 1}</span>
              </button>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
                <button title="Add selected right page here" onClick={() => addRightPageAfter(index)} style={{ border: "none", background: meta.accent, color: "#fff", borderRadius: T.radius.sm, padding: 8, cursor: "pointer" }}><Plus size={14} /></button>
                <button title="Delete page" onClick={() => deletePage(index)} disabled={pages.length <= 1} style={{ border: `1px solid ${T.color.border}`, background: "#fff", color: pages.length <= 1 ? T.color.muted : "#DC2626", borderRadius: T.radius.sm, padding: 8, cursor: pages.length <= 1 ? "default" : "pointer" }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </aside>

        <section style={{ minWidth: 0 }}>
          <div style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: 12, marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={addText} style={{ border: "none", background: meta.accent, color: "#fff", borderRadius: T.radius.sm, padding: "9px 12px", fontFamily: T.font.body, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><Type size={15} /> Text</button>
            <button onClick={() => imageInput.current?.click()} style={{ border: `1px solid ${T.color.border}`, background: "#fff", color: T.color.dark, borderRadius: T.radius.sm, padding: "9px 12px", fontFamily: T.font.body, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><ImagePlus size={15} /> Image</button>
            <input ref={imageInput} type="file" accept=".png,.jpg,.jpeg" hidden onChange={e => addImage(e.target.files?.[0])} />
            <button onClick={() => setZoom(z => Math.max(.45, +(z - .1).toFixed(2)))} style={{ border: `1px solid ${T.color.border}`, background: "#fff", borderRadius: T.radius.sm, padding: 9, cursor: "pointer" }}><ZoomOut size={15} /></button>
            <button onClick={() => setZoom(z => Math.min(1.4, +(z + .1).toFixed(2)))} style={{ border: `1px solid ${T.color.border}`, background: "#fff", borderRadius: T.radius.sm, padding: 9, cursor: "pointer" }}><ZoomIn size={15} /></button>
            <button onClick={exportPdf} disabled={status === "exporting"} style={{ marginLeft: "auto", border: "none", background: T.color.dark, color: "#fff", borderRadius: T.radius.sm, padding: "10px 14px", fontFamily: T.font.body, fontWeight: 700, cursor: "pointer", display: "flex", gap: 7, alignItems: "center" }}><Download size={15} /> {status === "exporting" ? `Saving ${progress}%` : "Download PDF"}</button>
          </div>

          <div style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: 18, overflow: "auto" }}>
            <div ref={stageRef} onClick={() => setSelectedOverlay(null)} style={{ position: "relative", width: displayWidth, maxWidth: "100%", aspectRatio: `${activePage.width}/${activePage.height}`, margin: "0 auto", background: "#fff", boxShadow: "0 14px 34px rgba(17,19,24,.14)" }}>
              {activePage.preview ? <img src={activePage.preview} alt={`Selected page ${current + 1}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", userSelect: "none", pointerEvents: "none" }} /> : null}
              {activePage.overlays.map(item => (
                <div key={item.id}
                  onMouseDown={e => startDrag(e, item)}
                  onTouchStart={e => startDrag(e, item)}
                  onClick={e => { e.stopPropagation(); setSelectedOverlay(item.id); }}
                  onDoubleClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedOverlay(item.id);
                    if (item.type === "text") setEditingOverlay(item.id);
                  }}
                  style={{
                    position: "absolute", left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.width * 100}%`, height: `${item.height * 100}%`,
                    outline: selectedOverlay === item.id ? `2px solid ${meta.accent}` : "1px solid transparent",
                    background: selectedOverlay === item.id ? "rgba(37,99,235,.08)" : "transparent",
                    cursor: "move", touchAction: "none", overflow: "visible", zIndex: selectedOverlay === item.id ? 20 : 10,
                  }}>
                  {item.type === "image"
                    ? <img src={item.dataUrl} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />
                    : editingOverlay === item.id ? (
                      <textarea
                        value={item.text}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => e.stopPropagation()}
                        onDoubleClick={e => e.stopPropagation()}
                        onChange={e => updateOverlay({ text: e.target.value.slice(0, 800) })}
                        onBlur={() => setEditingOverlay(null)}
                        autoFocus
                        style={{
                          width: "100%", height: "100%", minHeight: 34, border: "none", outline: `2px solid ${meta.accent}`,
                          resize: "none", background: "rgba(255,255,255,.96)", color: item.color, fontFamily: item.font,
                          fontSize: item.fontSize * scale, fontWeight: item.bold ? 700 : 400, lineHeight: 1.2, padding: 3,
                        }}
                      />
                    ) : (
                      <span style={{ display: "block", width: "100%", height: "100%", color: item.color, fontFamily: item.font, fontSize: item.fontSize * scale, fontWeight: item.bold ? 700 : 400, whiteSpace: "pre-wrap", lineHeight: 1.2, pointerEvents: "none", overflow: "hidden" }}>{item.text}</span>
                    )}
                  {selectedOverlay === item.id && (
                    <>
                      <button
                        type="button"
                        title="Delete selected"
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); deleteOverlay(); }}
                        style={{
                          position: "absolute", top: -28, right: -2, width: 24, height: 24, borderRadius: 6,
                          border: "1px solid #fecaca", background: "#fff", color: "#DC2626", cursor: "pointer",
                          display: "grid", placeItems: "center", padding: 0,
                        }}>
                        <Trash2 size={13} />
                      </button>
                      <span
                        data-resize-handle
                        title="Drag to resize"
                        onMouseDown={e => startResize(e, item)}
                        onTouchStart={e => startResize(e, item)}
                        style={{
                          position: "absolute", right: -7, bottom: -7, width: 14, height: 14,
                          borderRadius: 4, background: meta.accent, border: "2px solid #fff",
                          boxShadow: "0 2px 8px rgba(17,19,24,.24)", cursor: "nwse-resize",
                        }}
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          {errMsg && <p style={{ fontFamily: T.font.body, color: "#DC2626", fontSize: 13 }}>{errMsg}</p>}
        </section>

        <aside style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: 12, maxHeight: "78vh", overflow: "auto" }}>
          <button onClick={() => rightInput.current?.click()} style={{ width: "100%", border: `1px solid ${T.color.border}`, background: "#fff", borderRadius: T.radius.sm, padding: 10, fontFamily: T.font.body, fontWeight: 700, cursor: "pointer", marginBottom: 12 }}><Copy size={14} /> Select PDF</button>
          <input ref={rightInput} type="file" accept=".pdf" hidden onChange={e => loadRightPdf(e.target.files?.[0])} />
          {rightPages.length === 0 && <p style={{ fontFamily: T.font.body, fontSize: 13, color: T.color.muted, lineHeight: 1.6, margin: 0 }}>Upload another PDF here. Select a page, then click the plus button under any left page to insert it.</p>}
          {rightPages.length > 0 && rightSelected === null && <p style={{ fontFamily: T.font.body, fontSize: 12.5, color: T.color.muted, lineHeight: 1.5, margin: "0 0 10px" }}>No import page selected. The left plus button will add a blank page.</p>}
          {rightPages.map((page, index) => (
            <button key={page.id} onClick={() => setRightSelected(prev => prev === index ? null : index)} style={{ width: "100%", border: `2px solid ${rightSelected === index ? meta.accent : T.color.border}`, borderRadius: T.radius.sm, background: "#fff", padding: 6, cursor: "pointer", marginBottom: 10 }}>
              <img src={page.preview} alt={`Import page ${index + 1}`} style={{ width: "100%", display: "block" }} />
              <span style={{ display: "block", marginTop: 5, fontFamily: T.font.body, fontSize: 12, color: T.color.mid }}>Import page {index + 1}</span>
            </button>
          ))}

          {activeOverlay && (
            <div style={{ borderTop: `1px solid ${T.color.border}`, paddingTop: 12, marginTop: 12, display: "grid", gap: 10 }}>
              {activeOverlay.type === "text" && (
                <>
                  <textarea value={activeOverlay.text} onChange={e => updateOverlay({ text: e.target.value.slice(0, 800) })} rows={4} style={{ border: `1px solid ${T.color.border}`, borderRadius: T.radius.sm, padding: 9, fontFamily: T.font.body }} />
                  <input type="color" value={activeOverlay.color} onChange={e => updateOverlay({ color: e.target.value })} />
                  <input type="range" min="8" max="96" value={activeOverlay.fontSize} onChange={e => updateOverlay({ fontSize: Number(e.target.value) })} style={{ accentColor: meta.accent }} />
                  <select value={activeOverlay.font} onChange={e => updateOverlay({ font: e.target.value })} style={{ border: `1px solid ${T.color.border}`, borderRadius: T.radius.sm, padding: 9 }}>
                    {["Helvetica", "Times", "Courier"].map(font => <option key={font}>{font}</option>)}
                  </select>
                </>
              )}
              <label style={{ fontFamily: T.font.body, fontSize: 12, color: T.color.muted }}>Width
                <input type="range" min="4" max="100" value={Math.round(activeOverlay.width * 100)}
                  onChange={e => {
                    const width = Number(e.target.value) / 100;
                    updateOverlay(activeOverlay.type === "image" && activeOverlay.ratio
                      ? { width, height: width * activeOverlay.ratio }
                      : { width });
                  }}
                  style={{ width: "100%", accentColor: meta.accent }} />
              </label>
              <label style={{ fontFamily: T.font.body, fontSize: 12, color: T.color.muted }}>Height
                <input type="range" min="3" max="100" value={Math.round(activeOverlay.height * 100)}
                  onChange={e => {
                    const height = Number(e.target.value) / 100;
                    updateOverlay(activeOverlay.type === "image" && activeOverlay.ratio
                      ? { height, width: height / activeOverlay.ratio }
                      : { height });
                  }}
                  style={{ width: "100%", accentColor: meta.accent }} />
              </label>
              <button onClick={deleteOverlay} style={{ border: "1px solid #fecaca", background: "#fff", color: "#DC2626", borderRadius: T.radius.sm, padding: 10, fontFamily: T.font.body, fontWeight: 700, cursor: "pointer" }}><Trash2 size={14} /> Delete selected</button>
            </div>
          )}
        </aside>
      </div>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <ToolSeoSection page={P.EDITOR} accent={meta.accent} />
      </div>
    </div>
  );
}

function HomePage({ go }) {
  const [uploadedCount, setUploadedCount] = useState(getUploadedCount);
  useEffect(() => {
    const sync = event => setUploadedCount(Number(event.detail) || getUploadedCount());
    const syncStorage = () => setUploadedCount(getUploadedCount());
    window.addEventListener("fileflow-upload-count", sync);
    window.addEventListener("storage", syncStorage);
    return () => {
      window.removeEventListener("fileflow-upload-count", sync);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  return (
    <div>
      <div style={{ background: T.color.dark, padding: "72px 20px 80px", textAlign: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -80, left: "50%", transform: "translateX(-50%)", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(37,99,235,0.18) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "relative" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: T.radius.pill, padding: "6px 16px", marginBottom: 24 }}>
            <Shield size={13} color="#93C5FD" />
            <span style={{ fontFamily: T.font.body, fontSize: 13, color: "#93C5FD", fontWeight: 500 }}>Fast conversion tools · Clear privacy · Always free</span>
          </div>
          <h1 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: "clamp(34px,7vw,60px)", color: "#fff", margin: "0 0 18px", letterSpacing: "-1px", lineHeight: 1.12 }}>
            File Conversion,<br /><span style={{ color: "#93C5FD" }}>Simplified</span>
          </h1>
          <p style={{ fontFamily: T.font.body, fontSize: "clamp(14px,2.5vw,17px)", color: "rgba(255,255,255,0.55)", maxWidth: 480, margin: "0 auto 40px", lineHeight: 1.7 }}>
            Convert documents, PDFs and images with focused tools for Word, PDF and image workflows. No signup, no watermarks.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <PageLink page={P.DOC} go={go} style={{ display: "flex", alignItems: "center", gap: 8, background: "#2563EB", color: "#fff", border: "none", borderRadius: T.radius.md, padding: "13px 26px", fontFamily: T.font.body, fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
              <FileText size={16} /> Doc to PDF
            </PageLink>
            <PageLink page={P.PDF} go={go} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: T.radius.md, padding: "13px 26px", fontFamily: T.font.body, fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
              <FileOutput size={16} /> PDF to Doc
            </PageLink>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "56px 16px" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <h2 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: "clamp(24px,4vw,36px)", color: T.color.dark, margin: "0 0 10px", letterSpacing: "-0.5px" }}>Choose a Tool</h2>
          <p style={{ fontFamily: T.font.body, fontSize: 15, color: T.color.muted, margin: 0 }}>Direct conversion pages for common PDF, Word and image tasks</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))", gap: 18 }}>
          {TOOLS.map(({ page, Icon: Ic, label, desc, accent }) => (
            <PageLink key={page} page={page} go={go}
              style={{ background: T.color.surface, borderRadius: T.radius.lg, padding: "32px 26px", border: `1.5px solid ${T.color.border}`, cursor: "pointer", transition: "all .2s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.boxShadow = `0 8px 28px ${accent}18`; e.currentTarget.style.transform = "translateY(-3px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.color.border; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "translateY(0)"; }}
            >
              <div style={{ width: 46, height: 46, borderRadius: T.radius.md, background: `${accent}12`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
                <Ic size={22} color={accent} strokeWidth={1.8} />
              </div>
              <h3 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 20, color: T.color.dark, margin: "0 0 8px" }}>{label}</h3>
              <p style={{ fontFamily: T.font.body, fontSize: 13.5, color: T.color.muted, margin: "0 0 22px" }}>{desc}</p>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: accent, fontFamily: T.font.body, fontWeight: 600, fontSize: 13 }}>
                Convert now <ArrowRight size={13} />
              </div>
            </PageLink>
          ))}
        </div>
      </div>

      <div style={{ background: T.color.surface, borderTop: `1px solid ${T.color.border}`, borderBottom: `1px solid ${T.color.border}`, padding: "36px 16px" }}>
        <div style={{ maxWidth: 840, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 24, textAlign: "center" }}>
          {[
            { n: "10M+", l: "Files Converted", Icon: File },
            { n: "100%", l: "Free Forever", Icon: Gift },
            { n: uploadedCount.toLocaleString(), l: "Files Uploaded", Icon: Shield },
            { n: "50+", l: "Formats Supported", Icon: Zap },
          ].map(({ n, l, Icon: Ic }) => (
            <div key={l}>
              <Ic size={20} color={T.color.muted} strokeWidth={1.6} style={{ marginBottom: 8 }} />
              <div style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 28, color: T.color.dark, letterSpacing: "-1px" }}>{n}</div>
              <div style={{ fontFamily: T.font.body, fontSize: 12.5, color: T.color.muted, marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      <section style={{ maxWidth: 1080, margin: "0 auto", padding: "54px 16px 0" }}>
        <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 30px" }}>
          <h2 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: "clamp(22px,4vw,34px)", color: T.color.dark, margin: "0 0 10px" }}>Popular FileFlow Converters</h2>
          <p style={{ fontFamily: T.font.body, fontSize: 14.5, color: T.color.mid, lineHeight: 1.7, margin: 0 }}>
            Open the exact converter page from search results: PDF to DOC, Word to PDF, merge PDF, split PDF, compress PDF, PDF editor, PDF to JPG, JPG to PDF and PNG to PDF.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
          {[
            [P.PDF, "PDF to DOC converter", "Create editable Word DOCX files from PDF documents."],
            [P.DOC, "DOC to PDF converter", "Convert DOC, DOCX, RTF, ODT and TXT files to PDF."],
            [P.MERGE, "Merge PDF files", "Combine multiple PDFs into one organized document."],
            [P.SPLIT, "Split PDF pages", "Extract all pages, selected pages or custom ranges."],
            [P.COMPRESS, "Compress PDF online", "Reduce PDF file size with adjustable compression strength."],
            [P.EDITOR, "PDF editor", "Add pages, text and images, then export a new PDF."],
          ].map(([toolPage, title, text]) => (
            <PageLink key={toolPage} page={toolPage} go={go} style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: "18px 18px 17px", display: "block" }}>
              <h3 style={{ fontFamily: T.font.body, fontWeight: 700, fontSize: 15, color: T.color.dark, margin: "0 0 7px" }}>{title}</h3>
              <p style={{ fontFamily: T.font.body, fontSize: 13, color: T.color.mid, lineHeight: 1.6, margin: 0 }}>{text}</p>
            </PageLink>
          ))}
        </div>
      </section>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "56px 16px 72px" }}>
        <h2 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: "clamp(22px,4vw,34px)", color: T.color.dark, textAlign: "center", margin: "0 0 36px", letterSpacing: "-0.5px" }}>Why FileFlow?</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 18 }}>
          {[
            { Icon: Zap, t: "Lightning Fast", d: "Conversion happens locally in your browser — no upload wait time.", c: T.color.accent.doc },
            { Icon: Shield, t: "100% Private", d: "Your files never leave your device. Zero server contact.", c: T.color.accent.pdf },
            { Icon: Gift, t: "Always Free", d: "No subscription, no watermarks, no file count limits.", c: T.color.accent.img },
            { Icon: Smartphone, t: "Works Everywhere", d: "Optimized for desktop, tablet and mobile browsers.", c: "#D97706" },
          ].map(({ Icon: Ic, t, d, c }) => (
            <div key={t} style={{ padding: "24px 20px", background: T.color.surface, borderRadius: T.radius.md, border: `1px solid ${T.color.border}` }}>
              <div style={{ width: 42, height: 42, borderRadius: T.radius.sm, background: `${c}10`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <Ic size={20} color={c} strokeWidth={1.8} />
              </div>
              <h4 style={{ fontFamily: T.font.body, fontWeight: 700, fontSize: 15, color: T.color.dark, margin: "0 0 6px" }}>{t}</h4>
              <p style={{ fontFamily: T.font.body, fontSize: 13.5, color: T.color.muted, margin: 0, lineHeight: 1.65 }}>{d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FAQPage() {
  const [open, setOpen] = useState(null);
  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "44px 16px 72px" }}>
      <div style={{ textAlign: "center", marginBottom: 44 }}>
        <div style={{ width: 54, height: 54, borderRadius: T.radius.md, background: `${T.color.accent.doc}12`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
          <HelpCircle size={26} color={T.color.accent.doc} strokeWidth={1.5} />
        </div>
        <h1 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: "clamp(26px,5vw,38px)", color: T.color.dark, margin: "0 0 10px", letterSpacing: "-0.5px" }}>Frequently Asked Questions</h1>
        <p style={{ fontFamily: T.font.body, fontSize: 15, color: T.color.muted, margin: 0 }}>Everything you need to know about FileFlow</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {FAQ_DATA.map(({ q, a }, i) => (
          <div key={i} style={{ background: T.color.surface, borderRadius: T.radius.md, border: `1.5px solid ${open === i ? T.color.accent.doc : T.color.border}`, overflow: "hidden", transition: "border-color .18s" }}>
            <button onClick={() => setOpen(open === i ? null : i)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "17px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span style={{ fontFamily: T.font.body, fontWeight: 600, fontSize: 14.5, color: T.color.dark }}>{q}</span>
              <ChevronDown size={17} color={T.color.muted} style={{ flexShrink: 0, transition: "transform .2s", transform: open === i ? "rotate(180deg)" : "rotate(0)" }} />
            </button>
            {open === i && (
              <div style={{ padding: "0 18px 18px" }}>
                <p style={{ fontFamily: T.font.body, fontSize: 14, color: T.color.mid, margin: 0, lineHeight: 1.72 }}>{a}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AboutPage() {
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "48px 16px 78px" }}>
      <div style={{ textAlign: "center", marginBottom: 38 }}>
        <div style={{ width: 58, height: 58, borderRadius: T.radius.md, background: `${T.color.accent.doc}12`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
          <Zap size={27} color={T.color.accent.doc} strokeWidth={1.7} />
        </div>
        <h1 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: "clamp(28px,5vw,42px)", color: T.color.dark, margin: "0 0 10px" }}>About FileFlow</h1>
        <p style={{ fontFamily: T.font.body, fontSize: 15, color: T.color.mid, maxWidth: 620, margin: "0 auto", lineHeight: 1.7 }}>
          FileFlow is a focused file conversion tool for PDFs, documents and images, built to keep common conversion workflows fast, simple and private.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16, marginBottom: 26 }}>
        {[
          { Icon: Shield, title: "Privacy First", text: "The app is designed around local processing so files stay on the user's device whenever possible." },
          { Icon: Zap, title: "Practical Tools", text: "PDF to DOCX, DOC to PDF and image to PDF are available from direct, searchable pages." },
          { Icon: FileText, title: "Clean Workflow", text: "Each converter is built as a direct tool page instead of a confusing multi-step dashboard." },
        ].map(({ Icon, title, text }) => (
          <div key={title} style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: 22 }}>
            <Icon size={22} color={T.color.accent.doc} strokeWidth={1.8} style={{ marginBottom: 12 }} />
            <h2 style={{ fontFamily: T.font.body, fontSize: 16, color: T.color.dark, margin: "0 0 8px" }}>{title}</h2>
            <p style={{ fontFamily: T.font.body, fontSize: 13.5, color: T.color.mid, margin: 0, lineHeight: 1.65 }}>{text}</p>
          </div>
        ))}
      </div>

      <div style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: "26px 24px" }}>
        <p style={{ fontFamily: T.font.body, fontWeight: 700, fontSize: 12, color: T.color.muted, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 10px" }}>Developer</p>
        <h2 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 28, color: T.color.dark, margin: "0 0 6px" }}>Kanaka Raju</h2>
        <p style={{ fontFamily: T.font.body, fontSize: 15, color: T.color.mid, margin: "0 0 12px" }}>Full stack developer</p>
        <p style={{ fontFamily: T.font.body, fontSize: 14, color: T.color.mid, lineHeight: 1.7, margin: "0 0 18px", maxWidth: 620 }}>
          Kanaka Raju builds practical web tools and full stack applications with a focus on clean user experience, reliable workflows and useful automation.
        </p>
        <a href="https://www.linkedin.com/in/kanakaraju9390/" target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: T.font.body, fontWeight: 600, fontSize: 14, color: T.color.accent.doc, textDecoration: "none" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
            <path fill="currentColor" d="M20.45 20.45h-3.56v-5.58c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.68H9.34V8.98h3.42v1.57h.05c.48-.9 1.64-1.85 3.37-1.85 3.61 0 4.28 2.38 4.28 5.47v6.28ZM5.32 7.41a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12Zm1.78 13.04H3.54V8.98H7.1v11.47ZM22.23 0H1.76C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.76 24h20.47c.97 0 1.77-.77 1.77-1.72V1.72C24 .77 23.2 0 22.23 0Z" />
          </svg>
          LinkedIn Profile
        </a>
      </div>
    </div>
  );
}

function ContactPage() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 16px 78px" }}>
      <div style={{ textAlign: "center", marginBottom: 34 }}>
        <div style={{ width: 58, height: 58, borderRadius: T.radius.md, background: `${T.color.accent.img}12`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
          <HelpCircle size={27} color={T.color.accent.img} strokeWidth={1.7} />
        </div>
        <h1 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: "clamp(28px,5vw,42px)", color: T.color.dark, margin: "0 0 10px" }}>Contact FileFlow</h1>
        <p style={{ fontFamily: T.font.body, fontSize: 15, color: T.color.mid, maxWidth: 560, margin: "0 auto", lineHeight: 1.7 }}>
          For support, feedback or conversion-related questions, contact the FileFlow developer.
        </p>
      </div>

      <div style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: "28px 24px", marginBottom: 16 }}>
        <p style={{ fontFamily: T.font.body, fontWeight: 700, fontSize: 12, color: T.color.muted, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 10px" }}>Developer</p>
        <h2 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 28, color: T.color.dark, margin: "0 0 6px" }}>Kanaka Raju</h2>
        <p style={{ fontFamily: T.font.body, fontSize: 15, color: T.color.mid, margin: "0 0 12px" }}>Full stack developer</p>
        <a href="mailto:enjoytech8@gmail.com" style={{ display: "inline-flex", fontFamily: T.font.body, fontWeight: 600, fontSize: 14, color: T.color.accent.doc, marginBottom: 20, textDecoration: "none" }}>
          enjoytech8@gmail.com
        </a>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
          {[
            { label: "Support", value: "Email for FileFlow support and file conversion help." },
            { label: "Feedback", value: "Share issues with conversion quality, file types or page behavior." },
          ].map(({ label, value }) => (
            <div key={label} style={{ border: `1px solid ${T.color.border}`, borderRadius: T.radius.sm, padding: 14, background: T.color.bg }}>
              <p style={{ fontFamily: T.font.body, fontWeight: 700, fontSize: 13, color: T.color.dark, margin: "0 0 5px" }}>{label}</p>
              <p style={{ fontFamily: T.font.body, fontSize: 13, color: T.color.mid, margin: 0, lineHeight: 1.55 }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      <p style={{ fontFamily: T.font.body, fontSize: 13, color: T.color.muted, lineHeight: 1.65, margin: 0, textAlign: "center" }}>
        Email: <a href="mailto:enjoytech8@gmail.com" style={{ color: T.color.accent.doc, fontWeight: 600, textDecoration: "none" }}>enjoytech8@gmail.com</a>
      </p>
    </div>
  );
}

const INFO_PAGE_CONTENT = {
  [P.PRIVACY]: {
    title: "Privacy Policy",
    intro: "FileFlow is designed to minimize file exposure and keep conversion behavior clear before launch.",
    items: [
      ["File handling", "Browser-based tools process files locally in the tab. Word/PDF engine conversions use the configured converter service and should remove temporary files after conversion."],
      ["Contact", "Support email is enjoytech8@gmail.com."],
      ["Analytics", "Add analytics only after documenting what is collected and why."],
    ],
  },
  [P.TERMS]: {
    title: "Terms of Service",
    intro: "These terms explain acceptable use of FileFlow conversion tools.",
    items: [
      ["Allowed use", "Use FileFlow for documents and files you own or have permission to process."],
      ["No warranty", "Conversion quality depends on the source file, fonts, scanned pages and document structure."],
      ["Responsibility", "Review converted files before sharing or using them for official work."],
    ],
  },
  [P.SECURITY]: {
    title: "Security",
    intro: "Security matters because file converters handle sensitive user documents.",
    items: [
      ["Upload limits", "Production hosting should enforce file size limits, MIME validation, rate limits and HTTPS."],
      ["Temporary files", "Server conversion jobs should store files only temporarily and delete them after each request."],
      ["Deployment", "Run converter engines in isolated workers or containers before public launch."],
    ],
  },
  [P.FORMATS]: {
    title: "Supported Formats",
    intro: "FileFlow supports the most common document, PDF and image conversion workflows.",
    items: [
      ["Documents", "DOC, DOCX, RTF, ODT and TXT to PDF."],
      ["PDF", "PDF to DOCX, JPG, merge, split, compress and OCR page workflows."],
      ["Images", "JPG, JPEG, PNG, WebP, GIF, BMP and TIFF to PDF, with dedicated JPG and PNG pages."],
    ],
  },
  [P.QUALITY]: {
    title: "Conversion Quality",
    intro: "Different file types need different engines to preserve layout, fonts, colors and images.",
    items: [
      ["Best results", "Native Word export gives the best DOCX to PDF fidelity when Microsoft Word is available."],
      ["PDF to DOCX", "PDF to Word quality depends on how the PDF was created. Scanned PDFs need OCR."],
      ["Limitations", "Complex layouts, missing fonts, embedded images and scanned pages can affect output."],
    ],
  },
};

function InfoPage({ page }) {
  const content = INFO_PAGE_CONTENT[page] || INFO_PAGE_CONTENT[P.PRIVACY];
  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "48px 16px 78px" }}>
      <div style={{ textAlign: "center", marginBottom: 34 }}>
        <h1 style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: "clamp(28px,5vw,42px)", color: T.color.dark, margin: "0 0 10px" }}>{content.title}</h1>
        <p style={{ fontFamily: T.font.body, fontSize: 15, color: T.color.mid, maxWidth: 620, margin: "0 auto", lineHeight: 1.7 }}>{content.intro}</p>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {content.items.map(([title, text]) => (
          <div key={title} style={{ background: T.color.surface, border: `1px solid ${T.color.border}`, borderRadius: T.radius.md, padding: "20px 22px" }}>
            <h2 style={{ fontFamily: T.font.body, fontWeight: 700, fontSize: 16, color: T.color.dark, margin: "0 0 8px" }}>{title}</h2>
            <p style={{ fontFamily: T.font.body, fontSize: 14, color: T.color.mid, lineHeight: 1.7, margin: 0 }}>{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Footer({ go }) {
  const year = new Date().getFullYear();
  return (
    <footer style={{ background: T.color.dark, padding: "44px 20px 24px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 32, marginBottom: 36 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: "#2563EB", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Zap size={14} color="#fff" strokeWidth={2.5} />
              </div>
              <span style={{ fontFamily: T.font.display, fontWeight: 700, fontSize: 18, color: "#fff" }}>FileFlow</span>
            </div>
            <p style={{ fontFamily: T.font.body, fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.7, margin: 0 }}>Professional file conversion. Free, fast, and private.</p>
          </div>
          <div>
            <p style={{ fontFamily: T.font.body, fontWeight: 700, fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 14, textTransform: "uppercase", letterSpacing: 1.2 }}>Tools</p>
            {[{ l: "Document to PDF", p: P.DOC }, { l: "PDF to Document", p: P.PDF }, { l: "Merge PDF", p: P.MERGE }, { l: "Compress PDF", p: P.COMPRESS }, { l: "PDF Editor", p: P.EDITOR }, { l: "PDF to JPG", p: P.PDF_TO_JPG }].map(({ l, p }) => (
              <PageLink key={p} page={p} go={go} style={{ display: "block", fontFamily: T.font.body, fontSize: 13.5, color: "rgba(255,255,255,0.45)", margin: "0 0 10px", cursor: "pointer" }}>{l}</PageLink>
            ))}
          </div>
          <div>
            <p style={{ fontFamily: T.font.body, fontWeight: 700, fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 14, textTransform: "uppercase", letterSpacing: 1.2 }}>Support</p>
            {[{ l: "FAQ", p: P.FAQ }, { l: "About", p: P.ABOUT }, { l: "Contact", p: P.CONTACT }, { l: "Privacy", p: P.PRIVACY }, { l: "Terms", p: P.TERMS }, { l: "Security", p: P.SECURITY }, { l: "Supported Formats", p: P.FORMATS }, { l: "Conversion Quality", p: P.QUALITY }].map(({ l, p }) => (
              <PageLink key={l} page={p} go={go} style={{ display: "block", fontFamily: T.font.body, fontSize: 13.5, color: "rgba(255,255,255,0.45)", margin: "0 0 10px", cursor: "pointer" }}>{l}</PageLink>
            ))}
          </div>
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 20, textAlign: "center" }}>
          <p style={{ fontFamily: T.font.body, fontSize: 12.5, color: "rgba(255,255,255,0.2)", margin: 0 }}>© {year} FileFlow. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  const { page, go } = useNav();
  const renderPage = () => {
    if (page === P.HOME) return <HomePage go={go} />;
    if (page === P.FAQ) return <FAQPage />;
    if (page === P.ABOUT) return <AboutPage />;
    if (page === P.CONTACT) return <ContactPage />;
    if (INFO_PAGE_CONTENT[page]) return <InfoPage page={page} />;
    if (page === P.SPLIT) return <SplitPdfPage />;
    if (page === P.COMPRESS) return <CompressPdfPage />;
    if (page === P.EDITOR) return <PdfEditorPage />;
    if (META[page]) return <ConverterPage meta={META[page]} page={page} />;
    return <HomePage go={go} />;
  };
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: T.color.bg }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Outfit:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;}body{margin:0;}
        @keyframes ff-spin{to{transform:rotate(360deg);}}
        @media(max-width:640px){.ff-desk-nav{display:none!important;}.ff-ham{display:flex!important;}.ff-pdf-editor-grid{grid-template-columns:1fr!important;}}
        @media(min-width:641px){.ff-mob-menu{display:none!important;}}
        @media(max-width:980px){.ff-pdf-editor-grid{grid-template-columns:1fr!important;}}
        button{transition:opacity .15s;}button:active{opacity:.8;}
      `}</style>
      <Header page={page} go={go} />
      <Crumb page={page} go={go} />
      <main style={{ flex: 1 }}>{renderPage()}</main>
      <Footer go={go} />
    </div>
  );
}
