"""M0: the media worker registers media::health only. M3 adds transcription, OCR and keyframes."""

import os
import signal
import threading
import time

from iii import InitOptions, register_worker

NAME = "media"
VERSION = "0.1.0"
ENGINE_URL = os.environ.get("III_URL", "ws://127.0.0.1:49140")


def main() -> None:
    started = time.monotonic()
    worker = register_worker(ENGINE_URL, InitOptions(worker_name=NAME))

    def health(_data):
        return {"worker": NAME, "version": VERSION, "ok": True, "uptime_ms": int((time.monotonic() - started) * 1000)}

    worker.register_function(f"{NAME}::health", health)
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    print(f'{{"event":"worker.start","worker":"{NAME}","version":"{VERSION}","engine":"{ENGINE_URL}"}}', flush=True)
    stop.wait()
    worker.shutdown()


if __name__ == "__main__":
    main()
