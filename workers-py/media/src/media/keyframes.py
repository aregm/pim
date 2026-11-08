"""Keyframes at scene changes: decode at a low rate, compare downscaled grey frames, keep the first frame and every jump."""

import os

import av
import numpy as np

SAMPLE_FPS = 2
THRESHOLD = 24.0  # mean absolute difference on 0..255 grey, 32x18 thumbnails
MIN_GAP_MS = 1500


def keyframes(path: str, scratch_dir: str, max_frames: int = 40) -> dict:
    os.makedirs(scratch_dir, exist_ok=True)
    frames = []
    with av.open(path) as container:
        stream = next((s for s in container.streams if s.type == "video"), None)
        if stream is None:
            raise ValueError("no video stream")
        duration_ms = int((stream.duration or 0) * float(stream.time_base) * 1000) if stream.duration else int((container.duration or 0) / 1000)
        stream.thread_type = "AUTO"
        last_grey = None
        last_kept_ms = -10**9
        next_sample_ms = 0
        for frame in container.decode(stream):
            at_ms = int(float(frame.pts * stream.time_base) * 1000) if frame.pts is not None else 0
            if at_ms < next_sample_ms:
                continue
            next_sample_ms = at_ms + int(1000 / SAMPLE_FPS)
            grey = frame.to_ndarray(format="gray", width=32, height=18).astype(np.float32)
            jump = float(np.abs(grey - last_grey).mean()) if last_grey is not None else float("inf")
            last_grey = grey
            if jump < THRESHOLD or at_ms - last_kept_ms < MIN_GAP_MS:
                continue
            out = os.path.join(scratch_dir, f"kf-{at_ms:08d}.jpg")
            frame.to_image().convert("RGB").resize((640, max(1, int(640 * frame.height / max(1, frame.width))))).save(out, quality=82)
            frames.append({"at_ms": at_ms, "path": out})
            last_kept_ms = at_ms
            if len(frames) >= max_frames:
                break
    return {"keyframes": frames, "duration_ms": duration_ms}
