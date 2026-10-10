"""Kleines RGB-Matrixprofil (ICC v2) für Tests, etwa Display P3: Primärvalenzen von DCI-P3 mit D65-Weiß,
nach D50 angepasst (Bradford), Gradation wie sRGB. Selbst erzeugt, damit kein fremdes Profil im Repo liegt."""

import struct

# Display P3, auf D50 angepasst (Bradford), Spalten = R, G, B
P3_D50 = ((0.515102, 0.241182, -0.001050), (0.291965, 0.692236, 0.041882), (0.157153, 0.066582, 0.784073))
ADOBE_D50 = ((0.609741, 0.311111, 0.019470), (0.205276, 0.625671, 0.060867), (0.149185, 0.063217, 0.744568))


def _s15(v: float) -> bytes:
    return struct.pack(">i", round(v * 65536))


def _xyz(x, y, z) -> bytes:
    return b"XYZ " + b"\0" * 4 + _s15(x) + _s15(y) + _s15(z)


def _desc(text: str) -> bytes:
    a = text.encode("ascii") + b"\0"
    return b"desc" + b"\0" * 4 + struct.pack(">I", len(a)) + a + struct.pack(">II", 0, 0) + struct.pack(">HB", 0, 0) + b"\0" * 67


def _curve() -> bytes:
    def srgb(v):
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    n = 1024
    return b"curv" + b"\0" * 4 + struct.pack(">I", n) + b"".join(struct.pack(">H", round(srgb(i / (n - 1)) * 65535)) for i in range(n))


def rgb_profile(name: str = "Display P3", colorants=P3_D50) -> bytes:
    trc = _curve()
    tags = [(b"desc", _desc(name)), (b"cprt", b"text" + b"\0" * 4 + b"Public domain\0"), (b"wtpt", _xyz(0.9642, 1.0, 0.8249)),
            (b"rXYZ", _xyz(*colorants[0])), (b"gXYZ", _xyz(*colorants[1])), (b"bXYZ", _xyz(*colorants[2])),
            (b"rTRC", trc), (b"gTRC", trc), (b"bTRC", trc)]
    table, data, offset = b"", b"", 128 + 4 + 12 * len(tags)
    for sig, body in tags:
        while len(body) % 4:
            body += b"\0"
        table += sig + struct.pack(">II", offset + len(data), len(body))
        data += body
    size = offset + len(data)
    header = (struct.pack(">I", size) + b"lcms" + bytes([2, 0x10, 0, 0]) + b"mntrRGB XYZ " + b"\0" * 12 + b"acsp" + b"\0" * 4
              + b"\0" * 4 + b"\0" * 8 + b"\0" * 8 + struct.pack(">I", 0) + _s15(0.9642) + _s15(1.0) + _s15(0.8249) + b"\0" * 4
              + b"\0" * 16 + b"\0" * 28)
    assert len(header) == 128
    return header + struct.pack(">I", len(tags)) + table + data
