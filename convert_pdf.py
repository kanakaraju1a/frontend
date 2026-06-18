import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / ".python_packages"))

import fitz
from pdf2docx import Converter


def _pt_to_twip(value):
    return max(1, round(float(value) * 20))


def _pt_to_emu(value):
    return max(1, round(float(value) * 12700))


def _section_xml(width_pt, height_pt, is_last):
    page_break = "" if is_last else '<w:type w:val="nextPage"/>'
    return (
        f"<w:sectPr>{page_break}"
        f'<w:pgSz w:w="{_pt_to_twip(width_pt)}" w:h="{_pt_to_twip(height_pt)}"/>'
        '<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>'
        "</w:sectPr>"
    )


def _page_image_xml(rel_id, page_no, width_pt, height_pt, is_last):
    cx = _pt_to_emu(max(1, width_pt - 0.75))
    cy = _pt_to_emu(max(1, height_pt - 0.75))
    section = _section_xml(width_pt, height_pt, is_last)
    return f"""<w:p>
      <w:pPr>
        <w:spacing w:before="0" w:after="0"/>
        {'' if is_last else section}
      </w:pPr>
      <w:r>
        <w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
            <wp:extent cx="{cx}" cy="{cy}"/>
            <wp:effectExtent l="0" t="0" r="0" b="0"/>
            <wp:docPr id="{page_no}" name="PDF page {page_no}"/>
            <wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:nvPicPr><pic:cNvPr id="{page_no}" name="page-{page_no}.png"/><pic:cNvPicPr/></pic:nvPicPr>
                  <pic:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
                  <pic:spPr>
                    <a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>
                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  </pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>{section if is_last else ''}"""


def _content_types(page_count):
    overrides = "\n".join(
        f'<Override PartName="/word/media/page-{index}.png" ContentType="image/png"/>'
        for index in range(1, page_count + 1)
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  {overrides}
</Types>"""


def _package_rels():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""


def _document_rels(page_count):
    image_rels = "\n".join(
        f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page-{index}.png"/>'
        for index in range(1, page_count + 1)
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  {image_rels}
</Relationships>"""


def _settings_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:displayBackgroundShape/>
</w:settings>"""


def _document_xml(pages):
    body = "\n".join(
        _page_image_xml(f"rId{page_no}", page_no, width_pt, height_pt, page_no == len(pages))
        for page_no, (_, width_pt, height_pt) in enumerate(pages, start=1)
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:w10="urn:schemas-microsoft-com:office:word"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
  xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
  xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  mc:Ignorable="w14 wp14">
  <w:body>{body}</w:body>
</w:document>"""


def convert_pdf_to_editable_docx(pdf_path, docx_path):
    converter = Converter(str(pdf_path))
    try:
        converter.convert(str(docx_path), start=0, end=None)
    finally:
        converter.close()


def convert_pdf_to_visual_docx(pdf_path, docx_path, scale=2.4):
    pdf_path = Path(pdf_path)
    docx_path = Path(docx_path)
    pages = []

    with fitz.open(pdf_path) as document:
        for page in document:
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False, annots=True)
            pages.append((pixmap.tobytes("png"), float(page.rect.width), float(page.rect.height)))

    if not pages:
        raise RuntimeError("PDF has no pages to convert.")

    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as docx:
        docx.writestr("[Content_Types].xml", _content_types(len(pages)))
        docx.writestr("_rels/.rels", _package_rels())
        docx.writestr("word/document.xml", _document_xml(pages))
        docx.writestr("word/settings.xml", _settings_xml())
        docx.writestr("word/_rels/document.xml.rels", _document_rels(len(pages)))
        for page_no, (png_bytes, _, _) in enumerate(pages, start=1):
            docx.writestr(f"word/media/page-{page_no}.png", png_bytes)


def convert_pdf_to_docx(pdf_path, docx_path):
    convert_pdf_to_visual_docx(pdf_path, docx_path)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python convert_pdf.py input.pdf output.docx")
    convert_pdf_to_docx(Path(sys.argv[1]), Path(sys.argv[2]))
