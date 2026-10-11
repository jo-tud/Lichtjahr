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

- **Lichter, Tiefen, Klarheit (örtlich):** wie in Lightroom kantentreu statt als globale Kurve. Lichter und Tiefen
  wirken auf eine Basisschicht, die die Beleuchtung schätzt (Guided Filter auf der Helligkeit in Blenden): Schatten
  werden nach ihrer Beleuchtung aufgehellt, Oberflächen behalten ihre Helligkeit – dunkle Haut, Haare und Kleidung
  werden nicht ausgewaschen. Klarheit verstärkt (oder glättet) mittelgroße Details mit einem schnellen lokalen
  Laplace-Filter (Paris et al. 2011, Aubry et al. 2014), ohne Lichthöfe an Kanten.

Alles Örtliche entsteht als eine Helligkeitskarte auf 1600 Pixeln und wird einmal kantentreu auf die Zielgröße
übertragen. Gesichter werden dabei nie stärker aufgehellt als die übrigen Schattenbereiche des Fotos.

Die Einstellung reist als kurzer Text mit, z. B. ``f0.60n0.40h-0.30s0.50c0.20`` (Fusion, Rauschminderung,
Lichter, Tiefen, Klarheit; nur was nicht 0 ist).
"""

from __future__ import annotations

import math
import re

from PIL import Image

VERSION = "d3"                      # ändert sich, wenn sich das Ergebnis ändert (Zwischenspeicher)
PROXY = 1600                        # Kantenlänge, auf der die Helligkeitskarte entsteht
ANALYZE = 800                       # Kantenlänge für die Analyse (Gegenlicht ja oder nein)
GUIDE_MAX = 2400                    # bis zu dieser Größe kantentreu übertragen, darüber glatt hochrechnen
EVS = (-1.0, 0.0, 1.0, 2.0, 3.0)    # künstliche Belichtungsreihe in Blenden
COARSEST = 32                       # gröbste Stufe der Pyramide in Pixeln: so bleibt die Wirkung örtlich
_FX = re.compile(r"([fnhsc])(-?\d*\.?\d+)")
KEYS = {"f": "fusion", "n": "denoise", "h": "highlights", "s": "shadows", "c": "clarity"}
SIGNED = {"highlights", "shadows", "clarity"}       # −1 … +1, die anderen 0 … 1
TONE = ("fusion", "highlights", "shadows", "clarity")


def available() -> bool:
    from importlib.util import find_spec
    return find_spec("cv2") is not None


def parse_fx(text: str | None) -> dict | None:
    """„f0.6n0.4h-0.3“ → {"fusion": 0.6, "denoise": 0.4, "highlights": -0.3, …}; nichts Wirksames → None."""
    out = {k: 0.0 for k in KEYS.values()}
    for key, val in _FX.findall(text or ""):
        name = KEYS[key]
        try:
            v = max(-1.0 if name in SIGNED else 0.0, min(1.0, float(val)))
        except ValueError:
            continue
        out[name] = round(v, 2)
    return out if any(abs(v) >= 0.01 for v in out.values()) else None


def fx_key(fx: dict | None) -> str:
    """Eindeutiger Text für Zwischenspeicher und Abfragen; leer ohne Bearbeitung."""
    if not fx:
        return ""
    return "".join(f"{k}{fx.get(name, 0):.2f}" for k, name in KEYS.items() if abs(fx.get(name, 0)) >= 0.01) or ""


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


def transfer(a, lg):
    """Helligkeitskarte ``lg`` (log2, auf der 1600er-Fassung) kantentreu auf die Größe von ``a`` bringen."""
    import numpy as np
    h, w = a.shape[:2]
    long = max(w, h)
    gw, gh = (w, h) if long <= GUIDE_MAX else (round(w * GUIDE_MAX / long), round(h * GUIDE_MAX / long))
    guide = _luma(_resize(a, gw, gh) if (gw, gh) != (w, h) else a).astype(np.float32)
    g = _resize(lg.astype(np.float32), gw, gh)
    g = _guided(guide, g, max(2, round(4 * max(gw, gh) / PROXY)), 1e-3)
    return g if (gw, gh) == (w, h) else _resize(g, w, h)


def gain_map(a, size: tuple[int, int] | None = None):
    """Helligkeitskarte der Fusion in der Größe ``size`` (Breite, Höhe) bzw. von ``a``."""
    lg = _log_gain(_proxy(a))
    return transfer(_resize(a, *size) if size and size != (a.shape[1], a.shape[0]) else a, lg)


# -- Örtliche Tonwerte: Lichter, Tiefen, Klarheit --------------------------------------------
def _lin_log(p):
    """Helligkeit in Blenden (log2 der linearen Leuchtdichte) aus kodierten RGB-Werten."""
    import numpy as np
    return np.log2(_luma(np.power(np.clip(p, 0.0, 1.0), 2.2)) + 2.0 ** -12)


def _smooth(e0: float, e1: float, x):
    import numpy as np
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def base_layer(L):
    """Beleuchtung schätzen: kantentreu geglättete Helligkeit in Blenden. Feine Strukturen und Oberflächen
    fallen heraus, große Hell-dunkel-Grenzen (Himmel, Schatten) bleiben scharf."""
    r = max(3, round(max(L.shape) / 48))
    return _guided(L, L, r, 0.25)


def tone_delta(B, highlights: float, shadows: float):
    """Änderung in Blenden je nach Beleuchtung B: Tiefen heben dunkle Bereiche (nicht das tiefste Schwarz),
    Lichter senken (oder heben) helle; dazwischen bleibt alles, wie es ist."""
    import numpy as np
    d = np.zeros_like(B)
    if shadows:
        d += shadows * 1.6 * _smooth(-1.2, -4.5, B) * _smooth(-11.0, -8.0, B)
    if highlights:
        w = _smooth(-2.8, -0.4, B)
        if highlights < 0:                               # Ausgefressenes hat keine Zeichnung: weiß lassen, nicht grau
            w = w * (1.0 - _smooth(-0.6, -0.08, B))
        d += highlights * 1.2 * w
    return d


def _pyramid(x, levels: int):
    import cv2
    g = [x]
    for _ in range(levels - 1):
        g.append(cv2.pyrDown(g[-1]))
    return g


def _up(x, like):
    import cv2
    return cv2.pyrUp(x, dstsize=(like.shape[1], like.shape[0]))


def clarity(L, amount: float, sigma: float = 0.6, samples: int | None = None):
    """Klarheit mit dem schnellen lokalen Laplace-Filter (Aubry et al. 2014) auf der Helligkeit in Blenden.
    Nur die mittleren Bänder (Details zwischen etwa 1/200 und 1/20 der langen Seite) werden verändert: feine
    Strukturen und Rauschen bleiben, die große Tonverteilung auch. Kleine Unterschiede (unter ``sigma`` Blenden)
    werden mit α < 1 verstärkt bzw. mit α > 1 geglättet, große Kanten bleiben unverändert – daher keine Lichthöfe."""
    import numpy as np
    alpha = 1.0 - 0.75 * amount if amount > 0 else 1.0 - amount
    h, w = L.shape
    long = max(h, w)
    levels = max(2, int(math.log2(max(1, min(h, w)) / 16)) + 1)
    lo, hi = max(1, round(math.log2(long / 400))), min(levels - 2, round(math.log2(long / 20)))
    if hi < lo:
        return L
    G = _pyramid(L.astype(np.float32), levels)
    lap = [G[i] - _up(G[i + 1], G[i]) for i in range(levels - 1)] + [G[-1]]
    g0, g1 = (float(v) for v in np.percentile(L, [0.5, 99.5]))
    if g1 - g0 < 1e-3:
        return L
    # Stützwerte höchstens σ/2 auseinander (sonst fällt die Verstärkung zwischen sie, Aubry et al. 2014)
    samples = samples or int(min(32, max(8, math.ceil((g1 - g0) / (sigma * 0.5)) + 1)))
    gammas = np.linspace(g0, g1, samples)
    step = gammas[1] - gammas[0]
    acc = {lv: np.zeros_like(lap[lv]) for lv in range(lo, hi + 1)}
    for gam in gammas:
        d = L - gam
        ad = np.abs(d)
        detail = np.sign(d) * sigma * np.power(np.minimum(ad, sigma) / sigma, alpha)
        r = (gam + np.where(ad <= sigma, detail, d)).astype(np.float32)
        P = _pyramid(r, hi + 2)
        for lv in range(lo, hi + 1):
            wgt = np.clip(1.0 - np.abs(np.clip(G[lv], g0, g1) - gam) / step, 0.0, 1.0)
            acc[lv] += wgt * (P[lv] - _up(P[lv + 1], P[lv]))
    for lv in range(lo, hi + 1):
        lap[lv] = acc[lv]
    out = lap[-1]
    for lv in range(levels - 2, -1, -1):
        out = _up(out, lap[lv]) + lap[lv]
    return out


def _boxes(shape, f, grow: float):
    h, w = shape
    x0, y0 = (f["x"] - f["w"] * grow / 2) * w, (f["y"] - f["h"] * grow / 2) * h
    x1, y1 = (f["x"] + f["w"] * (1 + grow / 2)) * w, (f["y"] + f["h"] * (1 + grow / 2)) * h
    return max(0, int(y0)), min(h, int(y1)), max(0, int(x0)), min(w, int(x1))


def guard_faces(g, faces):
    """Ein Gesicht nie stärker aufhellen als seine unmittelbare Umgebung (Median der Aufhellung dessen, was in
    einem Ring ums Gesicht selbst aufgehellt wird: Haare, Hals, Kleidung, schattiger Hintergrund). Die Fusion hebt dunkle Stellen stärker an – ohne diese Grenze würde
    dunkle Haut behandelt wie ein Schatten und ausgewaschen. Es zählt die Beleuchtung, nicht die Hautfarbe."""
    import cv2
    import numpy as np
    if not faces or not (g > 0).any():
        return g
    h, w = g.shape
    for f in faces:
        a0, a1, b0, b1 = _boxes((h, w), f, 0.2)
        if a1 <= a0 or b1 <= b0:
            continue
        ring = np.zeros((h, w), bool)
        r0, r1, c0, c1 = _boxes((h, w), f, 1.2)
        ring[r0:r1, c0:c1] = True
        i0, i1, j0, j1 = _boxes((h, w), f, 0.35)
        ring[i0:i1, j0:j1] = False
        lifted = g[ring]
        lifted = lifted[lifted > 0.05]                   # nur was selbst aufgehellt wird (nicht der helle Himmel)
        if lifted.size < 30:
            continue
        cap = float(np.median(lifted))
        m = np.zeros((h, w), np.float32)
        m[a0:a1, b0:b1] = 1.0
        k = max(3, int(0.25 * max(a1 - a0, b1 - b0)) | 1)
        m = cv2.GaussianBlur(m, (k, k), 0)
        g = g * (1.0 - m) + np.minimum(g, cap) * m
    return g


def face_light(p, faces) -> list[float]:
    """Lichtverhältnis je Gesicht: hellste 5 % zum Median der inneren Gesichtsfläche, in linearem Licht.
    Das Verhältnis hängt von der Beleuchtung ab (Sonne, Lampe: hoch; flaches Gegenlicht: niedrig), nicht von der
    Hautfarbe – beide Werte werden mit derselben Haut gemessen."""
    import numpy as np
    out = []
    y = _luma(np.power(np.clip(p, 0.0, 1.0), 2.2))
    for f in faces:
        a0, a1, b0, b1 = _boxes(y.shape, {"x": f["x"] + f["w"] * .2, "y": f["y"] + f["h"] * .2, "w": f["w"] * .6, "h": f["h"] * .6}, 0.0)
        part = y[a0:a1, b0:b1]
        if part.size >= 50:
            med = float(np.median(part))
            out.append(float(np.percentile(part, 95)) / max(med, 1e-4))
    return out


def tone_log_gain(p, fx: dict, faces=None):
    """Helligkeitskarte (log2 der Verstärkung kodierter Werte) auf der Vorschau ``p``: Fusion, Lichter, Tiefen,
    Klarheit zusammen; Gesichter geschützt."""
    import numpy as np
    g = np.zeros(p.shape[:2], np.float32)
    if fx.get("fusion", 0) >= 0.01:
        g += fx["fusion"] * _log_gain(p)
    h, s, c = fx.get("highlights", 0), fx.get("shadows", 0), fx.get("clarity", 0)
    L = _lin_log(p)
    if abs(h) >= 0.01 or abs(s) >= 0.01 or abs(c) >= 0.01:
        L2 = L + tone_delta(base_layer(L), h, s)
        if abs(c) >= 0.01:
            L2 = clarity(L2, c)
        g += ((L2 - L) / 2.2).astype(np.float32)        # Blenden → Faktor auf kodierte Werte
    if fx.get("fusion", 0) >= 0.01 or s > 0:
        if faces is None:
            from . import faces as facedet
            faces = facedet.detect_rgb((np.clip(p, 0, 1) * 255 + 0.5).astype(np.uint8)) if facedet.available() else []
        g = guard_faces(g, faces)
    return g


def _shoulder(orig, out, knee: float = 0.85):
    """Weiche Schulter für Aufgehelltes: was über ``knee`` (bzw. den ursprünglichen Wert) hinausgeht, wird sanft
    gestaucht statt abgeschnitten; Farbton bleibt (alle Kanäle gleich), Unverändertes bleibt unverändert."""
    import numpy as np
    m0, m1 = orig.max(axis=2), out.max(axis=2)
    k0 = np.maximum(knee, m0)
    over = m1 > k0
    if not over.any():
        return np.clip(out, 0.0, 1.0)
    room = np.maximum(1.0 - k0, 1e-4)
    soft = k0 + room * (1.0 - np.exp(-np.maximum(m1 - k0, 0.0) / room))
    k = np.where(over, soft / np.maximum(m1, 1e-6), 1.0)
    return np.clip(out * k[..., None], 0.0, 1.0)


def tone(a, fx: dict, faces=None):
    """Örtliche Tonwerte (Fusion, Lichter, Tiefen, Klarheit) auf ein Bild beliebiger Größe anwenden."""
    import numpy as np
    lg = tone_log_gain(_proxy(a), fx, faces)
    return _shoulder(a, a * np.power(2.0, transfer(a, lg))[..., None])


def fuse(a, strength: float):
    return tone(a, {"fusion": strength})


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
    if any(abs(fx.get(k, 0)) >= 0.01 for k in TONE):
        a = tone(a, fx)
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


def analyze(full: Image.Image, proxy: Image.Image, faces=None) -> dict:
    """Rauschen (am Original) und Gegenlicht (an der Vorschau) messen und daraus vorschlagen, wie stark
    ausgeglichen werden sollte. ``fusion``/``denoise`` 0 heißt: nicht nötig.
    Gegenlicht wird nur aus Bildteilen außerhalb der Gesichter erkannt (dunkle Haut allein macht kein Gegenlicht),
    dazu das Lichtverhältnis in den Gesichtern: Sind alle Gesichter deutlich von vorn oder der Seite beleuchtet,
    ist es kein Gegenlicht."""
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
    faces = [f for f in (faces or []) if f.get("score", 1) >= 0.8]
    keep = np.ones(p.shape[:2], bool)
    for f in faces:
        a0, a1, b0, b1 = _boxes(p.shape[:2], f, 0.3)
        keep[a0:a1, b0:b1] = False
    if keep.mean() < 0.2:                                # fast nur Gesicht: das ganze Bild nehmen
        keep[:] = True
    py = _luma(p)
    dark = (py < 0.22) & keep
    bright = (py > 0.85) & keep
    lg = _log_gain(p)
    n = max(1, int(keep.sum()))
    lift = float(lg[dark].mean()) if dark.sum() > 0.005 * n else 0.0
    dark_share, bright_share = float(dark.sum()) / n, float(bright.sum()) / n
    light = face_light(p, faces)
    lit = bool(light) and min(light) >= 2.0              # alle Gesichter mit deutlichem Licht von vorn/der Seite
    # Gegenlicht: nennenswerte dunkle Flächen, die die Fusion deutlich anheben würde, neben hellen Flächen
    # (bewusst streng: dunkle Kleidung neben etwas Himmel ist noch kein Gegenlicht, Fehlalarme kosten Vertrauen)
    backlit = dark_share >= 0.08 and bright_share >= 0.05 and lift >= 0.75 and not lit
    fusion = round(min(0.8, 0.45 + 0.4 * (lift - 0.75)), 2) if backlit else 0.0
    # Rauschen: ab etwa 2,5 (Helligkeit) bzw. 1,5 (Farbe, halbe Größe) auf 0–255 sichtbar, vor allem nach dem Aufhellen
    level = max(ycc_noise / 2.5, chroma / 1.5)
    denoise_s = round(min(0.9, 0.3 + 0.25 * (level - 1.0)), 2) if level >= 1.0 else 0.0
    return {"version": VERSION, "noise": round(ycc_noise, 2), "chromaNoise": round(chroma, 2),
            "dark": round(dark_share, 3), "bright": round(bright_share, 3), "lift": round(lift, 2),
            "faceLight": [round(v, 2) for v in light], "backlit": backlit, "fusion": fusion, "denoise": denoise_s}
