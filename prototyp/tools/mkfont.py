import sys, json, base64, io
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset
src = sys.argv[1]
out = {}
chars = set()
for b in range(32, 256):
    try: chars.add(ord(bytes([b]).decode('cp1252')))
    except: pass
for name, w in [('regular', 400), ('bold', 600)]:
    f = TTFont(src)
    inst = instancer.instantiateVariableFont(f, {'wght': w})
    buf = io.BytesIO(); inst.save(buf); buf.seek(0)
    f2 = TTFont(buf)
    opts = subset.Options(); opts.name_IDs=['*']; opts.notdef_outline=True; opts.layout_features=['kern','liga']; opts.drop_tables += ['DSIG','STAT','MVAR','HVAR']
    sub = subset.Subsetter(opts); sub.populate(unicodes=chars); sub.subset(f2)
    # rename
    psname = 'Jost-' + ('Regular' if w==400 else 'SemiBold')
    for rec in f2['name'].names:
        if rec.nameID == 6: rec.string = psname
    buf = io.BytesIO(); f2.save(buf); data = buf.getvalue()
    upm = f2['head'].unitsPerEm
    cmap = f2.getBestCmap(); hmtx = f2['hmtx']
    widths = []
    for b in range(32, 256):
        try: u = ord(bytes([b]).decode('cp1252'))
        except: widths.append(0); continue
        g = cmap.get(u)
        widths.append(round(hmtx[g][0]*1000/upm) if g else 0)
    os2 = f2['OS/2']; head = f2['head']
    out[name] = dict(ps=psname, b64=base64.b64encode(data).decode(), widths=widths,
        ascent=round(os2.sTypoAscender*1000/upm), descent=round(os2.sTypoDescender*1000/upm),
        cap=round(getattr(os2,'sCapHeight',700)*1000/upm),
        bbox=[round(v*1000/upm) for v in (head.xMin, head.yMin, head.xMax, head.yMax)])
    print(name, len(data), file=sys.stderr)
print('const FONTS=' + json.dumps(out, separators=(',',':')) + ';')
