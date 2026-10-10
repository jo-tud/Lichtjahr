"""Gesichter finden (nicht erkennen): Wo im Foto sind Gesichter?

Die Oberfläche nutzt das beim automatischen Zuschneiden (Gesichter bleiben im Ausschnitt), beim Platzieren des
Kalendariums (es verdeckt keine Gesichter) und für den Hinweis „Gesicht angeschnitten“. Gerechnet wird mit dem
YuNet-Detektor (OpenCV Zoo, MIT-Lizenz) auf dem Vorschaubild, ganz lokal. Ohne OpenCV ist die Funktion aus und
alles andere geht wie bisher.

Ergebnis je Foto: Liste von Rechtecken in Bruchteilen des Fotos wie angezeigt (nach EXIF-Drehung),
``{"x", "y", "w", "h", "score"}``, größte zuerst.
"""

from __future__ import annotations

import importlib.util
import io
import os
import threading

from PIL import Image, ImageOps

MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "face_detection_yunet_2023mar.onnx")
VERSION = "yunet2023mar-1"              # Teil des Cache-Schlüssels: neue Version → neu rechnen
SIZE = 1600                             # Vorschaugröße, auf der gesucht wird (auch kleine Gesichter in Gruppenfotos)
SCORE = 0.8
MIN_FACE = 0.012                        # kleiner als 1,2 % der kürzeren Seite: Hintergrund, nicht gemeint

_local = threading.local()


def available() -> bool:
    """Ohne OpenCV zu laden (das startet Threads): nur nachsehen, ob es installiert ist."""
    return importlib.util.find_spec("cv2") is not None and os.path.exists(MODEL)


def _detector(size: tuple[int, int]):
    import cv2
    det = getattr(_local, "det", None)            # je Thread ein Detektor (nicht threadsicher)
    if det is None:
        det = _local.det = cv2.FaceDetectorYN.create(MODEL, "", size, SCORE, 0.3, 5000)
    det.setInputSize(size)
    return det


def detect(data: bytes) -> list[dict]:
    """Gesichter in einem Bild (JPEG/PNG …); leer, wenn keine gefunden werden oder OpenCV fehlt."""
    if not available():
        return []
    import numpy as np
    with Image.open(io.BytesIO(data)) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
    if max(im.size) > SIZE:
        im.thumbnail((SIZE, SIZE))
    w, h = im.size
    bgr = np.ascontiguousarray(np.asarray(im)[:, :, ::-1])
    _, found = _detector((w, h)).detect(bgr)
    out = []
    for f in [] if found is None else found:
        x, y, fw, fh, score = float(f[0]), float(f[1]), float(f[2]), float(f[3]), float(f[-1])
        x0, y0, x1, y1 = max(0.0, x), max(0.0, y), min(float(w), x + fw), min(float(h), y + fh)
        if x1 <= x0 or y1 <= y0 or min(x1 - x0, y1 - y0) < MIN_FACE * min(w, h):
            continue
        out.append({"x": round(x0 / w, 4), "y": round(y0 / h, 4), "w": round((x1 - x0) / w, 4), "h": round((y1 - y0) / h, 4),
                    "score": round(score, 3)})
    out.sort(key=lambda r: r["w"] * r["h"], reverse=True)
    return out
