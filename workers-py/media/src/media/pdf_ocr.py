"""OCR for PDF pages without a text layer: render each page with pdfium, recognise with Vision, map boxes back to PDF points."""

import os
import tempfile

import pypdfium2 as pdfium

from .ocr import _cgimage, recognize

SCALE = 2.0  # 144 dpi: enough for Vision, small enough to stay quick


def ocr_pdf(path: str) -> dict:
    fragments = []
    pdf = pdfium.PdfDocument(path)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            for index in range(len(pdf)):
                page = pdf[index]
                width, height = page.get_size()  # PDF points
                image = page.render(scale=SCALE).to_pil()
                png = os.path.join(tmp, f"page-{index + 1}.png")
                image.save(png)
                offset = 0
                for line in recognize(_cgimage(png)):
                    b = line["box"]  # normalized, top-left origin
                    x0, x1 = b["x"] * width, (b["x"] + b["w"]) * width
                    y_top, y_bottom = (1 - b["y"]) * height, (1 - b["y"] - b["h"]) * height  # PDF origin is bottom-left
                    fragments.append({
                        "ordinal": len(fragments),
                        "selector": {"kind": "page", "page": index + 1, "start": offset, "end": offset + len(line["text"]), "bbox": [x0, y_bottom, x1, y_top]},
                        "text": line["text"],
                        "confidence": line["confidence"],
                    })
                    offset += len(line["text"]) + 1
        return {"fragments": fragments, "pages": len(pdf)}
    finally:
        pdf.close()
