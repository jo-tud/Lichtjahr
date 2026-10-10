"""Detailbearbeitung vor dem Rezept: Gegenlicht ausgleichen (Belichtungsfusion) und Rauschen mindern.

Anders als das Rezept (Farbmatrix und Tonkurve, für jeden Bildpunkt gleich) wirken beide örtlich und laufen
deshalb im Dienst. Sie kommen vor dem Rezept, damit Automatik, Looks und Druckausgleich auf dem bearbeiteten
Bild aufsetzen. Gleiches Ergebnis in Vorschau, Druckansicht und Druck-PDF:

- **Gegenlicht:** Aus dem einen Foto entstehen künstlich fünf Belichtungen (−1 bis +3 Blenden). Die
  Mertens-Fusion nimmt aus jeder die gut belichteten, kontrastreichen Stellen. Gerechnet wird immer auf einer
  Fassung mit 1600 Pixeln Kantenlänge; heraus kommt eine Helligkeitskarte (Verstärkung je Stelle), die kantentreu
  (Guided Filter, geführt von der Helligkeit des Bildes) auf jede Größe übertragen wird. So hellt sich ein
  dunkles Gesicht vor hellem Himmel auf, ohne dass der Himmel ausfrisst – und die Vorschau zeigt, was gedruckt wird.
- **Rauschen:** Stärke nach dem gemessenen Rauschen (Immerkær-Schätzer). Farbrauschen, das auf Fotos aus dem
  Handy am meisten stört, wird kräftig gemindert, Helligkeitsrauschen behutsam (Non-Local Means), damit
  Haut und Haare nicht wie gemalt aussehen.

Die Einstellung reist als kurzer Text mit, z. B. ``f0.60n0.40`` (Fusion 60 %, Rauschminderung 40 %).
"""

from __future__ import annotations

import math
import re

from PIL import Image

VERSION = "d2"                      # ändert sich, wenn sich das Ergebnis ändert (Zwischenspeicher)
PROXY = 1600                        # Kantenlänge, auf der die Helligkeitskarte entsteht
ANALYZE = 800                       # Kantenlänge für die Analyse (Gegenlicht ja oder nein)
GUIDE_MAX = 2400                    # bis zu dieser Größe kantentreu übertragen, darüber glatt hochrechnen
EVS = (-1.0, 0.0, 1.0, 2.0, 3.0)    # künstliche Belichtungsreihe in Blenden
COARSEST = 32                       # gröbste Stufe der Pyramide in Pixeln: so bleibt die Wirkung örtlich
_FX = re.compile(r"([fn])(\d*\.?\d+)")


def available() -> bool:
    from importlib.util import find_spec
    return find_spec("cv2") is not None


def parse_fx(text: str | None) -> dict | None:
    """„f0.6n0.4“ → {"fusion": 0.6, "denoise": 0.4}; nichts Wirksames → None."""
    out = {"fusion": 0.0, "denoise": 0.0}
    for key, val in _FX.findall(text or ""):
        try:
            v = max(0.0, min(1.0, float(val)))
        except ValueError:
            continue
        out["fusion" if key == "f" else "denoise"] = round(v, 2)
    return out if out["fusion"] >= 0.01 or out["denoise"] >= 0.01 else None


def fx_key(fx: dict | None) -> str:
    """Eindeutiger Text für Zwischenspeicher und Abfragen; leer ohne Bearbeitung."""
    if not fx:
        return ""
    return f"f{fx.get('fusion', 0):.2f}n{fx.get('denoise', 0):.2f}"


# -- Bausteine -----------------------------------------------------------------------------
def _luma(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def _guided(guide, src, r: int, eps: float):
    """Guided Filter (He et al.): glättet ``src`` und folgt dabei den Kanten von ``guide``."""
    import cv2
    k = (2 * r + 1, 2 * r + 1)
    box = lambda x: cv2.boxFilter(x, -1, k)            # noqa: E731
    mi, mp = box(guide), box(src)
    a = (box(guide * src) - mi * mp) / (box(guide * guide) - mi * mi + eps)
    b = mp - a * mi
    return box(a) * guide + box(b)


def _resize(a, w: int, h: int):
    import cv2
    shrink = w < a.shape[1]
    return cv2.resize(a, (w, h), interpolation=cv2.INTER_AREA if shrink else cv2.INTER_LINEAR)


def noise_sigma(y) -> float:
    """Rauschen (Standardabweichung, 0–255) eines Graubilds nach Immerkær, ohne Kanten und Struktur."""
    import cv2
    import numpy as np
    y = np.asarray(y, dtype=np.float32)
    h, w = y.shape
    if max(h, w) > 1600:                                 # Mitte genügt und hält es schnell
        cy, cx, s = h // 2, w // 2, 800
        y = y[max(0, cy - s):cy + s, max(0, cx - s):cx + s]
    if min(y.shape) < 8:
        return 0.0
    lap = cv2.filter2D(y, -1, np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], np.float32))[1:-1, 1:-1]
    grad = np.hypot(cv2.Sobel(y, -1, 1, 0), cv2.Sobel(y, -1, 0, 1))[1:-1, 1:-1]
    flat = grad <= np.percentile(grad, 60)               # glatte Stellen: dort ist Rauschen, nicht Bildinhalt
    if flat.sum() < 100:
        return 0.0
    return float(math.sqrt(math.pi / 2) * np.abs(lap[flat]).mean() / 6.0)


def mertens(exposures):
    """Belichtungsfusion nach Mertens, Kautz und Van Reeth (2007): je Stelle die gut belichteten,
    kontrastreichen, farbigen Anteile aller Belichtungen, gemischt über Laplace-Pyramiden.
    Anders als ``cv2.MergeMertens`` endet die Pyramide bei etwa 32 Pixeln statt bei einem: sonst mischt die
    gröbste Stufe über das ganze Bild, und ein großer heller Himmel zieht ein dunkles Motiv noch dunkler."""
    import cv2
    import numpy as np
    h, w = exposures[0].shape[:2]
    levels = max(1, int(math.log2(max(1, min(h, w)) / COARSEST)) + 1)
    weights = []
    for e in exposures:
        gray = _luma(e)
        contrast = np.abs(cv2.Laplacian(gray, cv2.CV_32F))
        saturation = e.std(axis=2)
        exposed = np.exp(-((e - 0.5) ** 2) / (2 * 0.2 ** 2)).prod(axis=2)
        weights.append(exposed * (contrast + 0.05) * (saturation + 0.05) + 1e-12)
    total = np.sum(weights, axis=0)
    out = None
    for e, wgt in zip(exposures, weights):
        gw = [(wgt / total).astype(np.float32)]
        gi = [e.astype(np.float32)]
        for _ in range(levels - 1):
            gw.append(cv2.pyrDown(gw[-1]))
            gi.append(cv2.pyrDown(gi[-1]))
        lap = [gi[i] - cv2.pyrUp(gi[i + 1], dstsize=(gi[i].shape[1], gi[i].shape[0])) for i in range(levels - 1)] + [gi[-1]]
        blended = [lp * g[..., None] for lp, g in zip(lap, gw)]
        out = blended if out is None else [o + b for o, b in zip(out, blended)]
    res = out[-1]
    for lp in reversed(out[:-1]):
        res = cv2.pyrUp(res, dstsize=(lp.shape[1], lp.shape[0])) + lp
    return np.clip(res, 0.0, 1.0)


def _log_gain(proxy):
    """Helligkeitskarte (log2 der Verstärkung) aus der Fusion einer künstlichen Belichtungsreihe."""
    import cv2
    import numpy as np
    lin = np.power(proxy, 2.2)
    exposures = [np.power(np.clip(lin * 2.0 ** ev, 0.0, 1.0), 1 / 2.2).astype(np.float32) for ev in EVS]
    fused = mertens(exposures)
    y = _luma(proxy)
    gain = np.log2((_luma(fused) + 0.02) / (y + 0.02))
    # Vor allem aufhellen: abdunkeln höchstens wenig und nicht auf fast weißen Flächen (ein heller Himmel
    # bliebe sonst nicht weiß, sondern würde grau – der flache „HDR-Look“)
    bright = np.clip((y - 0.6) / 0.3, 0.0, 1.0)
    gain = np.where(gain < 0, np.maximum(gain, -0.2) * (1.0 - bright), gain)
    return cv2.GaussianBlur(np.minimum(gain, 2.5).astype(np.float32), (0, 0), 1.2)


def _proxy(a):
    h, w = a.shape[:2]
    long = max(h, w)
    if long <= PROXY:
        return a
    s = PROXY / long
    return _resize(a, max(1, round(w * s)), max(1, round(h * s)))


def gain_map(a, size: tuple[int, int] | None = None):
    """Helligkeitskarte in der Größe ``size`` (Breite, Höhe) bzw. von ``a``, kantentreu übertragen."""
    import numpy as np
    h, w = a.shape[:2]
    tw, th = size or (w, h)
    lg = _log_gain(_proxy(a))
    long = max(tw, th)
    gw, gh = (tw, th) if long <= GUIDE_MAX else (round(tw * GUIDE_MAX / long), round(th * GUIDE_MAX / long))
    guide = _luma(_resize(a, gw, gh) if (gw, gh) != (w, h) else a).astype(np.float32)
    g = _resize(lg, gw, gh)
    g = _guided(guide, g, max(2, round(8 * max(gw, gh) / PROXY)), 1e-3)
    return g if (gw, gh) == (tw, th) else _resize(g, tw, th)


def fuse(a, strength: float):
    import numpy as np
    g = gain_map(a)
    return np.clip(a * np.power(2.0, strength * g)[..., None], 0.0, 1.0)


def denoise(a, strength: float):
    """Farbrauschen kräftig, Helligkeitsrauschen behutsam; Stärke folgt dem gemessenen Rauschen."""
    import cv2
    import numpy as np
    a8 = (np.clip(a, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    ycc = cv2.cvtColor(a8, cv2.COLOR_RGB2YCrCb)
    y, cr, cb = (np.ascontiguousarray(ycc[..., i]) for i in range(3))
    sy = noise_sigma(y)
    hy = strength * 1.3 * sy
    if hy >= 0.5:
        y = cv2.fastNlMeansDenoising(y, None, h=hy, templateWindowSize=5, searchWindowSize=11)
    h0, w0 = cr.shape
    sw, sh = max(1, w0 // 2), max(1, h0 // 2)
    out_c = []
    for c in (cr, cb):
        small = _resize(c, sw, sh)                       # Farbrauschen ist grobkörnig: auf halber Größe messen und mindern
        hc = strength * 3.0 * max(noise_sigma(small), 1.0)
        small = cv2.fastNlMeansDenoising(small, None, h=hc, templateWindowSize=5, searchWindowSize=15)
        out_c.append(_resize(small, w0, h0))
    ycc = np.dstack([y, *out_c])
    return cv2.cvtColor(ycc, cv2.COLOR_YCrCb2RGB).astype(np.float32) / 255.0


def apply(im: Image.Image, fx: dict | None) -> Image.Image:
    """Bild mit Detailbearbeitung; Farbprofil bleibt erhalten. Erst Rauschen, dann Gegenlicht (das Aufhellen
    würde Rauschen sonst verstärken)."""
    import numpy as np
    if not fx or not available():
        return im
    a = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0
    if fx.get("denoise", 0) >= 0.01:
        a = denoise(a, fx["denoise"])
    if fx.get("fusion", 0) >= 0.01:
        a = fuse(a, fx["fusion"])
    out = Image.fromarray((a * 255.0 + 0.5).astype(np.uint8), "RGB")
    if im.info.get("icc_profile"):
        out.info["icc_profile"] = im.info["icc_profile"]
    return out


# -- Analyse und Vorschlag -----------------------------------------------------------------
def _chroma_noise(a255) -> float:
    """Farbrauschen (0–255) auf halber Größe, wie es ``denoise`` mindert."""
    import cv2
    import numpy as np
    ycc = cv2.cvtColor(np.clip(a255, 0, 255).astype(np.uint8), cv2.COLOR_RGB2YCrCb)
    h, w = ycc.shape[:2]
    return max(noise_sigma(_resize(np.ascontiguousarray(ycc[..., i]), max(1, w // 2), max(1, h // 2))) for i in (1, 2))


def analyze(full: Image.Image, proxy: Image.Image) -> dict:
    """Rauschen (am Original) und Gegenlicht (an der Vorschau) messen und daraus vorschlagen, wie stark
    ausgeglichen werden sollte. ``fusion``/``denoise`` 0 heißt: nicht nötig."""
    import numpy as np
    w, h = full.size
    side = 1600                                          # Rauschen je Pixel des Originals: die Mitte genügt
    box = (max(0, (w - side) // 2), max(0, (h - side) // 2), min(w, (w + side) // 2), min(h, (h + side) // 2))
    full_a = np.asarray(full.crop(box).convert("RGB"), dtype=np.float32)
    y = _luma(full_a)
    ycc_noise = noise_sigma(y)
    chroma = _chroma_noise(full_a)
    p = np.asarray(proxy.convert("RGB"), dtype=np.float32) / 255.0
    long = max(p.shape[:2])
    if long > ANALYZE:                                   # zum Entscheiden reicht eine kleinere Fassung (schnell)
        k = ANALYZE / long
        p = _resize(p, max(1, round(p.shape[1] * k)), max(1, round(p.shape[0] * k)))
    py = _luma(p)
    dark = py < 0.22
    bright = py > 0.85
    lg = _log_gain(p)
    lift = float(lg[dark].mean()) if dark.mean() > 0.005 else 0.0
    dark_share, bright_share = float(dark.mean()), float(bright.mean())
    # Gegenlicht: nennenswerte dunkle Flächen, die die Fusion deutlich anheben würde, neben hellen Flächen
    # (bewusst streng: dunkle Kleidung neben etwas Himmel ist noch kein Gegenlicht, Fehlalarme kosten Vertrauen)
    backlit = dark_share >= 0.08 and bright_share >= 0.05 and lift >= 0.75
    fusion = round(min(0.8, 0.45 + 0.4 * (lift - 0.75)), 2) if backlit else 0.0
    # Rauschen: ab etwa 2,5 (Helligkeit) bzw. 1,5 (Farbe, halbe Größe) auf 0–255 sichtbar, vor allem nach dem Aufhellen
    level = max(ycc_noise / 2.5, chroma / 1.5)
    denoise_s = round(min(0.9, 0.3 + 0.25 * (level - 1.0)), 2) if level >= 1.0 else 0.0
    return {"version": VERSION, "noise": round(ycc_noise, 2), "chromaNoise": round(chroma, 2),
            "dark": round(dark_share, 3), "bright": round(bright_share, 3), "lift": round(lift, 2),
            "backlit": backlit, "fusion": fusion, "denoise": denoise_s}
