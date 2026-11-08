"""Decode any audio or video file to 16 kHz mono float32, what whisper expects. PyAV bundles ffmpeg."""

import av
import numpy as np

RATE = 16000


def decode_audio(path: str) -> tuple[np.ndarray, int]:
    """Returns (samples, duration_ms). Raises if the file has no audio stream."""
    with av.open(path) as container:
        stream = next((s for s in container.streams if s.type == "audio"), None)
        if stream is None:
            raise ValueError("no audio stream")
        resampler = av.AudioResampler(format="flt", layout="mono", rate=RATE)
        chunks = []
        for frame in container.decode(stream):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray().reshape(-1))
    samples = np.concatenate(chunks).astype(np.float32) if chunks else np.zeros(0, dtype=np.float32)
    return samples, int(len(samples) * 1000 / RATE)
