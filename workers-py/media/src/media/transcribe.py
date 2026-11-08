"""whisper.cpp through pywhispercpp. The model is downloaded once into the repository's tooling directory."""

import os
import threading

from .audio import decode_audio

MODEL_NAME = os.environ.get("PIM_WHISPER_MODEL", "base")
MODELS_DIR = os.environ.get("PIM_MODELS_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".tooling", "models"))
_model = None
_lock = threading.Lock()
# whisper.cpp contexts are not thread-safe: two concurrent transcriptions abort inside ggml. One at a time.
_run_lock = threading.Lock()


def model():
    global _model
    with _lock:
        if _model is None:
            from pywhispercpp.model import Model

            os.makedirs(MODELS_DIR, exist_ok=True)
            _model = Model(MODEL_NAME, models_dir=MODELS_DIR, n_threads=max(2, (os.cpu_count() or 4) // 2), print_progress=False, print_realtime=False)
        return _model


def transcribe(path: str, language: str | None = None) -> dict:
    samples, duration_ms = decode_audio(path)
    if len(samples) == 0:
        return {"fragments": [], "duration_ms": 0}
    kwargs = {"language": language} if language else {}
    with _run_lock:
        segments = model().transcribe(samples, **kwargs)
    fragments = []
    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue
        start_ms, end_ms = int(seg.t0) * 10, int(seg.t1) * 10  # whisper.cpp timestamps are centiseconds
        fragments.append({"ordinal": len(fragments), "selector": {"kind": "time", "start_ms": start_ms, "end_ms": min(end_ms, duration_ms) or end_ms}, "text": text})
    return {"fragments": fragments, "duration_ms": duration_ms, "model": f"whisper.cpp/{MODEL_NAME}"}
