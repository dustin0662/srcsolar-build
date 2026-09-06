#!/usr/bin/env python3
"""Cut the Task Tracker reference-skin sprites out of the concept mock.

Reads the 864x1536 mock, crops one clean exemplar of each point sprite (pile,
post cap, torque-tube segment, module panel) plus the header logo and the
compass, keys the background to alpha, upscales, and writes
src/tt_ref_sprites.js (base64 PNG data URIs + native sizes).  A contact sheet
is written next to the scratch output for eyeballing the cut-outs.

Usage:  python3 scripts/extract_ref_sprites.py [mock.jpg] [--sheet path.png]
"""
import sys, base64, io, json, os
import numpy as np, cv2
from PIL import Image

MOCK = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else \
    '/root/.claude/uploads/5b79f514-cf32-595c-bb1c-cf2c8443988f/cfef099b-image.jpg'
SHEET = None
if '--sheet' in sys.argv: SHEET = sys.argv[sys.argv.index('--sheet') + 1]
OUT_JS = os.path.join(os.path.dirname(__file__), '..', 'src', 'tt_ref_sprites.js')

img = cv2.imread(MOCK)
assert img is not None, MOCK
H, W = img.shape[:2]

# tight bboxes (x0,y0,x1,y1 inclusive) measured on the mock
SPEC = {
    's1': dict(box=(89, 645, 102, 671), ring='all',   scale=4, hue=('gray',),        t=(1.0, 2.6)),
    's2': dict(box=(300, 611, 317, 636), ring='all',  scale=4, hue=('blue',),        t=(1.0, 2.6)),
    's3': dict(box=(474, 627, 485, 647), ring='sides', scale=4, hue=('purple',),     t=(1.0, 2.6)),
    's4': dict(box=(615, 448, 635, 486), ring='sides', scale=4, hue=('teal',),       t=(1.0, 2.6)),
    'logo': dict(box=(88, 44, 181, 129), ring='all',  scale=2, hue=('yellow', 'blue'), t=(1.2, 3.0)),
    'compass': dict(box=(766, 254, 844, 332), ring=None, scale=2, hue=(), t=None),
}
MARGIN = 1

def ring_pixels(box, kind, w=3):
    x0, y0, x1, y1 = box
    pts = []
    if kind in ('all', 'sides'):
        pts.append(img[y0 - MARGIN:y1 + MARGIN + 1, x0 - MARGIN - w:x0 - MARGIN])
        pts.append(img[y0 - MARGIN:y1 + MARGIN + 1, x1 + MARGIN + 1:x1 + MARGIN + 1 + w])
    if kind == 'all':
        pts.append(img[y0 - MARGIN - w:y0 - MARGIN, x0 - MARGIN:x1 + MARGIN + 1])
        pts.append(img[y1 + MARGIN + 1:y1 + MARGIN + 1 + w, x0 - MARGIN:x1 + MARGIN + 1])
    return np.concatenate([p.reshape(-1, 3) for p in pts], 0)

def lab(bgr):
    a = np.asarray(bgr, np.uint8); shp = a.shape
    out = cv2.cvtColor(a.reshape(-1, 1, 3), cv2.COLOR_BGR2LAB).astype(np.float32)
    return out.reshape(shp)

def hue_force(crop_bgr, kinds):
    hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0].astype(int), hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    m = np.zeros(h.shape, bool)
    for k in kinds:
        if k == 'gray':   m |= (s < 40) & (v > 135)
        if k == 'blue':   m |= (h >= 92) & (h <= 112) & (s > 70) & (v > 80)
        if k == 'purple': m |= (h >= 128) & (h <= 155) & (s > 50) & (v > 70)
        if k == 'teal':   m |= (h >= 72) & (h <= 95) & (s > 85) & (v > 90)
        if k == 'yellow': m |= (h >= 12) & (h <= 35) & (s > 90) & (v > 120)
    return m

def key_alpha(crop, ring, t0, t1, kinds):
    L = lab(crop); R = lab(ring)
    med = np.median(R, 0); mad = np.median(np.abs(R - med), 0)
    d = np.sqrt((((L - med) / (1.5 * mad + 2.0)) ** 2).sum(-1))
    a = np.clip((d - t0) / (t1 - t0), 0, 1)
    a[hue_force(crop, kinds)] = 1.0
    bg = np.median(ring, 0)
    return a.astype(np.float32), bg

def grabcut_refine(crop, a):
    f = 3
    big = cv2.resize(crop, None, fx=f, fy=f, interpolation=cv2.INTER_NEAREST)
    A = cv2.resize(a, None, fx=f, fy=f, interpolation=cv2.INTER_NEAREST)
    mask = np.full(A.shape, cv2.GC_PR_BGD, np.uint8)
    mask[A >= 0.5] = cv2.GC_PR_FGD
    sure_fg = cv2.erode((A > 0.9).astype(np.uint8), np.ones((3, 3), np.uint8))
    mask[sure_fg > 0] = cv2.GC_FGD
    mask[A < 0.08] = cv2.GC_BGD
    if (mask == cv2.GC_FGD).sum() < 8 or (mask == cv2.GC_BGD).sum() < 8: return a
    bgd = np.zeros((1, 65), np.float64); fgd = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(big, mask, None, bgd, fgd, 5, cv2.GC_INIT_WITH_MASK)
    except cv2.error:
        return a
    fg = ((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)).astype(np.float32)
    soft = cv2.resize(fg, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_AREA)
    return a * np.clip(soft * 1.25, 0, 1)

def decontaminate(crop, a, bg):
    c = crop.astype(np.float32)
    out = (c - (1 - a[..., None]) * bg[None, None, :]) / np.maximum(a[..., None], 0.05)
    return np.clip(out, 0, 255)

def upscale(bgr, a, f):
    prem = bgr * a[..., None]
    big = cv2.resize(prem, None, fx=f, fy=f, interpolation=cv2.INTER_LANCZOS4)
    A = cv2.resize(a, None, fx=f, fy=f, interpolation=cv2.INTER_LANCZOS4)
    A = np.clip(cv2.GaussianBlur(A, (0, 0), 0.8), 0, 1)
    rgb = np.clip(big / np.maximum(A[..., None], 1e-3), 0, 255)
    blur = cv2.GaussianBlur(rgb, (0, 0), 1.0)
    rgb = np.clip(rgb + 0.35 * (rgb - blur), 0, 255)
    return rgb, A

def to_png_b64(bgr, a, colors=128):
    rgba = np.dstack([bgr[..., 2], bgr[..., 1], bgr[..., 0], a * 255]).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    q = im.quantize(colors=colors, method=Image.Quantize.FASTOCTREE)
    buf = io.BytesIO(); q.save(buf, 'PNG', optimize=True)
    return base64.b64encode(buf.getvalue()).decode(), buf.getvalue(), rgba

results, sheet_cells = {}, []
for code, sp in SPEC.items():
    x0, y0, x1, y1 = sp['box']
    crop = img[y0 - MARGIN:y1 + MARGIN + 1, x0 - MARGIN:x1 + MARGIN + 1].copy()
    if sp['ring'] is None:  # compass: circular mask only
        h, w = crop.shape[:2]; yy, xx = np.mgrid[0:h, 0:w]
        cy, cx = (h - 1) / 2, (w - 1) / 2; r = min(h, w) / 2 - 1.5
        dist = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
        a = np.clip((r + 0.75 - dist) / 1.5, 0, 1).astype(np.float32)
        bgr = crop.astype(np.float32)
    else:
        ring = ring_pixels(sp['box'], sp['ring'])
        a, bg = key_alpha(crop, ring, sp['t'][0], sp['t'][1], sp['hue'])
        a = grabcut_refine(crop, a)
        if code == 'logo':
            hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV); dark = (hsv[..., 2] < 75) & (hsv[..., 1] < 140)
            a[dark] = 0.0
        # 1-px erode at native scale, only where alpha is soft (keeps cores intact)
        core = (a > 0.98).astype(np.uint8)
        a = np.minimum(a, np.maximum(core.astype(np.float32), cv2.GaussianBlur(a, (0, 0), 0.6)))
        bgr = decontaminate(crop, a, bg)
    big, A = upscale(bgr, a, sp['scale'])
    # trim to the alpha bbox (keep the point sprites' full native box so sizes stay honest)
    b64, raw, rgba = to_png_b64(big, A, 128 if code in ('s1', 's2', 's3', 's4') else 96)
    h, w = crop.shape[:2]
    results[code] = dict(uri='data:image/png;base64,' + b64, w=w, h=h, scale=sp['scale'], bytes=len(raw))
    # contact sheet cells: orig x8 | keyed on checker | on grass | on dark
    orig = cv2.resize(crop, None, fx=8, fy=8, interpolation=cv2.INTER_NEAREST)
    def compose(bgcol):
        canvas = np.full(big.shape, bgcol, np.float32)
        return (big * A[..., None] + canvas * (1 - A[..., None])).astype(np.uint8)
    ch = np.indices(big.shape[:2]).sum(0) // 8 % 2
    checker = (np.where(ch[..., None] == 0, 200, 140)).astype(np.float32).repeat(3, -1)
    keyed_ck = (big * A[..., None] + checker * (1 - A[..., None])).astype(np.uint8)
    cells = [orig, cv2.resize(keyed_ck, None, fx=8 / sp['scale'], fy=8 / sp['scale'], interpolation=cv2.INTER_NEAREST),
             cv2.resize(compose((54, 76, 65)), None, fx=8 / sp['scale'], fy=8 / sp['scale'], interpolation=cv2.INTER_NEAREST),
             cv2.resize(compose((32, 37, 25)), None, fx=8 / sp['scale'], fy=8 / sp['scale'], interpolation=cv2.INTER_NEAREST)]
    hh = max(c.shape[0] for c in cells)
    row = np.hstack([np.pad(c, ((0, hh - c.shape[0]), (0, 12), (0, 0)), constant_values=60) for c in cells])
    sheet_cells.append(row)
    print(f'{code}: crop {w}x{h} scale x{sp["scale"]} png {len(raw)} bytes')

total = sum(r['bytes'] for r in results.values())
print('total png bytes', total, '-> data URI chars ~', int(total * 4 / 3))
if SHEET:
    ww = max(r.shape[1] for r in sheet_cells)
    sheet = np.vstack([np.pad(r, ((0, 16), (0, ww - r.shape[1]), (0, 0)), constant_values=60) for r in sheet_cells])
    cv2.imwrite(SHEET, sheet); print('sheet', SHEET, sheet.shape)

with open(OUT_JS, 'w') as f:
    f.write('/* generated by scripts/extract_ref_sprites.py from the reference mock — do not edit */\n')
    f.write('export const REF_SPRITES = {\n')
    for code, r in results.items():
        extra = ''
        if code in ('s3', 's4'): extra = f", ay: 0, ay2: {r['h']}"
        f.write(f"  {code}: {{ w: {r['w']}, h: {r['h']}, scale: {r['scale']}, ax: {r['w'] / 2}, ay: {r['h'] / 2}{extra}, uri: '{r['uri']}' }},\n")
    f.write('};\n')
print('wrote', OUT_JS, os.path.getsize(OUT_JS), 'bytes')
