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


def _find(data: bytes):
    """Bild laden (wie angezeigt, höchstens SIZE) und Gesichter suchen: (BGR-Bild, [(Rechteck, Rohzeile)]), größte zuerst."""
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
        box = {"x": round(x0 / w, 4), "y": round(y0 / h, 4), "w": round((x1 - x0) / w, 4), "h": round((y1 - y0) / h, 4),
               "score": round(score, 3)}
        out.append((box, f, min(x1 - x0, y1 - y0)))
    out.sort(key=lambda r: r[0]["w"] * r[0]["h"], reverse=True)
    return bgr, out


def detect_rgb(rgb) -> list[dict]:
    """Gesichter in einem RGB-Feld (uint8, H×W×3), höchstens SIZE groß; für die Detailbearbeitung."""
    import numpy as np
    if not available():
        return []
    h, w = rgb.shape[:2]
    bgr = np.ascontiguousarray(rgb[:, :, ::-1])
    _, found = _detector((w, h)).detect(bgr)
    out = []
    for f in [] if found is None else found:
        x, y, fw, fh, score = float(f[0]), float(f[1]), float(f[2]), float(f[3]), float(f[-1])
        x0, y0, x1, y1 = max(0.0, x), max(0.0, y), min(float(w), x + fw), min(float(h), y + fh)
        if x1 <= x0 or y1 <= y0 or min(x1 - x0, y1 - y0) < MIN_FACE * min(w, h) or score < SCORE:
            continue
        out.append({"x": x0 / w, "y": y0 / h, "w": (x1 - x0) / w, "h": (y1 - y0) / h, "score": score})
    return out


def detect(data: bytes) -> list[dict]:
    """Gesichter in einem Bild (JPEG/PNG …); leer, wenn keine gefunden werden oder OpenCV fehlt."""
    if not available():
        return []
    return [box for box, _, _ in _find(data)[1]]


# -- Wiedererkennen: wer ist wie oft auf den Fotos ---------------------------------------------
# SFace (OpenCV Zoo, Apache-2.0) berechnet je Gesicht 128 Merkmale; ähnliche Merkmale heißen „dieselbe Person“.
# Das Modell (10 MB) liegt nicht im Repository, sondern wird beim ersten Gebrauch geladen und geprüft. Die Merkmale
# bleiben im lokalen Zwischenspeicher des Dienstes und kommen nie in den Projektordner.
REC_FILE = "face_recognition_sface_2021dec_int8.onnx"
REC_URL = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/" + REC_FILE
REC_SHA256 = "2b0e941e6f16cc048c20aee0c8e31f569118f65d702914540f7bfdc14048d78a"
REC_SIZE = 9_896_933
REC_VERSION = "sface2021dec8-1"
MIN_REC_PX = 36                          # kleinere Gesichter geben unzuverlässige Merkmale


def recognizer_path(data_dir: str) -> str:
    return os.path.join(data_dir, "models", REC_FILE)


def recognizer_ready(data_dir: str) -> bool:
    path = recognizer_path(data_dir)
    return available() and os.path.exists(path) and os.path.getsize(path) == REC_SIZE


def download_recognizer(data_dir: str, url: str = REC_URL) -> None:
    """Modell laden und gegen die Prüfsumme prüfen; nur eine vollständige, passende Datei bleibt liegen."""
    import hashlib

    import httpx
    path = recognizer_path(data_dir)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.{threading.get_ident()}.part"
    digest = hashlib.sha256()
    try:
        with httpx.stream("GET", url, follow_redirects=True, timeout=60) as r:
            r.raise_for_status()
            with open(tmp, "wb") as fh:
                for chunk in r.iter_bytes(1 << 20):
                    digest.update(chunk)
                    fh.write(chunk)
        if digest.hexdigest() != REC_SHA256:
            raise ValueError("checksum")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def _recognizer(path: str):
    import cv2
    rec = getattr(_local, "rec", None)
    if rec is None:
        rec = _local.rec = cv2.FaceRecognizerSF.create(path, "")
    return rec


def embed(data: bytes, data_dir: str) -> list[dict]:
    """Wie ``detect``, dazu je Gesicht „emb“: 128 Merkmale (Länge 1) oder ``None`` für zu kleine Gesichter."""
    if not recognizer_ready(data_dir):
        return []
    import numpy as np
    bgr, found = _find(data)
    rec = _recognizer(recognizer_path(data_dir))
    out = []
    for box, row, px in found:
        e = None
        if px >= MIN_REC_PX:
            v = rec.feature(rec.alignCrop(bgr, row)).flatten().astype(np.float64)
            n = float(np.linalg.norm(v))
            e = [round(float(x) / n, 4) for x in v] if n else None
        out.append({**box, "emb": e})
    return out
