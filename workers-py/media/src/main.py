"""The media worker: media::transcribe, media::ocr, media::ocr_pdf, media::keyframes, media::health.

Reads files by path (read-only). Writes only keyframes into the scratch directory it is given.
"""

import json
import os
import signal
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(__file__))

from iii import InitOptions, register_worker  # noqa: E402

NAME = "media"
VERSION = "0.3.0"
ENGINE_URL = os.environ.get("III_URL", "ws://127.0.0.1:49140")


def log(event: str, **fields) -> None:
    print(json.dumps({"event": event, **fields}), flush=True)


def timed(fn):
    def wrapper(data):
        t = time.monotonic()
        out = fn(data)
        log(fn.__name__, ms=int((time.monotonic() - t) * 1000), fragments=len(out.get("fragments", [])), keyframes=len(out.get("keyframes", [])))
        return out

    return wrapper


@timed
def transcribe(data):
    from media.transcribe import transcribe as run

    return run(data["path"], data.get("language"))


@timed
def ocr(data):
    from media.ocr import ocr_image

    return ocr_image(data["path"])


@timed
def ocr_pdf(data):
    from media.pdf_ocr import ocr_pdf as run

    return run(data["path"])


@timed
def keyframes(data):
    from media.keyframes import keyframes as run

    return run(data["path"], data["scratch_dir"], int(data.get("max_frames", 40)))


def main() -> None:
    started = time.monotonic()
    worker = register_worker(ENGINE_URL, InitOptions(worker_name=NAME))
    worker.register_function(f"{NAME}::health", lambda _d: {"worker": NAME, "version": VERSION, "ok": True, "uptime_ms": int((time.monotonic() - started) * 1000)})
    worker.register_function(f"{NAME}::transcribe", transcribe)
    worker.register_function(f"{NAME}::ocr", ocr)
    worker.register_function(f"{NAME}::ocr_pdf", ocr_pdf)
    worker.register_function(f"{NAME}::keyframes", keyframes)
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    log("worker.start", worker=NAME, version=VERSION, engine=ENGINE_URL)
    stop.wait()
    worker.shutdown()


if __name__ == "__main__":
    main()
