"""Run with: .tooling/py/bin/python -m unittest discover -s workers-py/media/tests  (from the repository root)."""

import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "..", "src"))

from media.audio import decode_audio  # noqa: E402
from media.keyframes import keyframes  # noqa: E402
from media.ocr import ocr_image  # noqa: E402
from media.pdf_ocr import ocr_pdf  # noqa: E402

SAMPLE_PDF = os.path.join(HERE, "..", "..", "..", "packages", "worker-parse", "test", "fixtures", "sample.pdf")


def make_video(path: str, seconds=(4, 4, 4), fps=10):
    """Three solid-colour scenes, one after another, so the scene changes sit at known times."""
    import av
    import numpy as np

    with av.open(path, "w") as out:
        stream = out.add_stream("mpeg4", rate=fps)
        stream.width, stream.height, stream.pix_fmt = 320, 180, "yuv420p"
        colours = [(200, 30, 30), (30, 200, 30), (30, 30, 200)]
        for scene, length in enumerate(seconds):
            frame_rgb = np.zeros((180, 320, 3), dtype=np.uint8)
            frame_rgb[:, :] = colours[scene % 3]
            for _ in range(length * fps):
                for packet in stream.encode(av.VideoFrame.from_ndarray(frame_rgb, format="rgb24")):
                    out.mux(packet)
        for packet in stream.encode(None):
            out.mux(packet)


class MediaTests(unittest.TestCase):
    def test_decode_audio_from_speech_sample(self):
        with tempfile.TemporaryDirectory() as tmp:
            aiff = os.path.join(tmp, "s.aiff")
            subprocess.run(["say", "-o", aiff, "one two three"], check=True)
            samples, duration_ms = decode_audio(aiff)
            self.assertGreater(duration_ms, 500)
            self.assertAlmostEqual(len(samples) / 16000, duration_ms / 1000, places=1)

    def test_keyframes_at_scene_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            video = os.path.join(tmp, "scenes.mp4")
            make_video(video)
            out = keyframes(video, os.path.join(tmp, "kf"))
            times = [k["at_ms"] for k in out["keyframes"]]
            self.assertEqual(len(times), 3, times)
            self.assertEqual(times[0], 0)
            self.assertTrue(3500 <= times[1] <= 4500 and 7500 <= times[2] <= 8500, times)
            self.assertTrue(all(os.path.exists(k["path"]) for k in out["keyframes"]))
            self.assertTrue(11000 <= out["duration_ms"] <= 12500, out["duration_ms"])

    def test_ocr_pdf_page_without_text_layer_logic_on_sample(self):
        out = ocr_pdf(SAMPLE_PDF)
        self.assertEqual(out["pages"], 1)
        texts = " ".join(f["text"] for f in out["fragments"])
        self.assertIn("PIM gate one PDF", texts)
        sel = out["fragments"][0]["selector"]
        self.assertEqual(sel["kind"], "page")
        x0, y0, x1, y1 = sel["bbox"]
        # the text is drawn at x=20, baseline y=80 on a 300x144 point page
        self.assertTrue(10 <= x0 <= 30 and 70 <= y0 <= 82 and 120 <= x1 <= 300 and 90 <= y1 <= 110, sel["bbox"])

    def test_ocr_image_from_rendered_page(self):
        import pypdfium2 as pdfium

        with tempfile.TemporaryDirectory() as tmp:
            png = os.path.join(tmp, "page.png")
            pdf = pdfium.PdfDocument(SAMPLE_PDF)
            pdf[0].render(scale=2).to_pil().save(png)
            pdf.close()
            out = ocr_image(png)
            self.assertIn("PIM gate one PDF", " ".join(f["text"] for f in out["fragments"]))
            box = out["fragments"][0]["selector"]
            self.assertEqual(box["kind"], "box")
            self.assertTrue(0 <= box["x"] < 0.15 and 0.2 < box["y"] < 0.5 and box["w"] > 0.3 and 0 < box["h"] < 0.3, box)


if __name__ == "__main__":
    unittest.main()
