"""Apple Vision text recognition through pyobjc. One fragment per recognised line, with a normalized box (top-left origin)."""

import Quartz
import Vision
from Foundation import NSURL


def _cgimage(path: str):
    src = Quartz.CGImageSourceCreateWithURL(NSURL.fileURLWithPath_(path), None)
    if src is None:
        raise ValueError(f"cannot open image {path}")
    img = Quartz.CGImageSourceCreateImageAtIndex(src, 0, None)
    if img is None:
        raise ValueError(f"cannot decode image {path}")
    return img


def recognize(cgimage) -> list[dict]:
    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cgimage, None)
    request = Vision.VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    request.setUsesLanguageCorrection_(True)
    ok, error = handler.performRequests_error_([request], None)
    if not ok:
        raise RuntimeError(f"vision failed: {error}")
    lines = []
    for obs in request.results() or []:
        candidates = obs.topCandidates_(1)
        if not candidates:
            continue
        text = str(candidates[0].string()).strip()
        if not text:
            continue
        bb = obs.boundingBox()  # normalized, origin bottom-left
        x, y, w, h = bb.origin.x, bb.origin.y, bb.size.width, bb.size.height
        lines.append({"text": text, "confidence": float(candidates[0].confidence()), "box": {"x": x, "y": 1 - y - h, "w": w, "h": h}})
    # reading order: top to bottom, then left to right
    lines.sort(key=lambda l: (round(l["box"]["y"], 2), l["box"]["x"]))
    return lines


def ocr_image(path: str) -> dict:
    fragments = []
    for line in recognize(_cgimage(path)):
        fragments.append({"ordinal": len(fragments), "selector": {"kind": "box", **line["box"]}, "text": line["text"], "confidence": line["confidence"]})
    return {"fragments": fragments}
