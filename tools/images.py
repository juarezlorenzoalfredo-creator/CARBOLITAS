#!/usr/bin/env python3
"""CARBOLITAS - pipeline de imagen.

Recorta cada fotografia al encuadre definido, genera variantes responsive en
WebP y extrae el logotipo original sobre fondo transparente (sin alterar el
arte: solo se elimina la placa negra que lo rodea).
"""
import json
import os
from PIL import Image, ImageDraw, ImageFilter

RAW = "assets/raw"
OUT = "dist/img"
os.makedirs(OUT, exist_ok=True)

# slug -> (archivo, ratio destino w/h, foco vertical 0..1, foco horizontal 0..1)
PHOTOS = {
    # Tarjetas 4:3 y portada panorámica, al estilo de la referencia aprobada.
    "alitas-salsa":    ("f61ae108-image.jpg", 4 / 3, 0.52, 0.52),
    "alitas-carbon":   ("6001568f-image.jpg", 4 / 3, 0.48, 0.56),
    "boneless":        ("0434bf9a-image.jpg", 4 / 3, 0.50, 0.48),
    "burger-sencilla": ("1c5b4d73-image.jpg", 4 / 3, 0.46, 0.50),
    "burger-especial": ("c390e305-image.jpg", 4 / 3, 0.46, 0.52),
    "burger-suprema":  ("c4fba7c4-image.jpg", 4 / 3, 0.46, 0.50),
    "carbopapas":      ("30e45ac3-image.jpg", 4 / 3, 0.50, 0.50),
    "papas":           ("829b98e6-image.jpg", 4 / 3, 0.56, 0.50),
    "portada":         ("f61ae108-image.jpg", 16 / 9, 0.54, 0.55),
    "portada-alta":    ("f61ae108-image.jpg", 3 / 4, 0.50, 0.52),
    "local":           ("9791dad4-image.jpg", 16 / 10, 0.45, 0.50),
}

WIDTHS = [320, 560, 900]
LOCAL_WIDTHS = [720, 1280, 1800]


def crop_ratio(im, ratio, fy, fx):
    w, h = im.size
    target_h = w / ratio
    if target_h <= h:
        new_w, new_h = w, int(round(target_h))
    else:
        new_h, new_w = h, int(round(h * ratio))
    left = int(round((w - new_w) * fx))
    top = int(round((h - new_h) * fy))
    return im.crop((left, top, left + new_w, top + new_h))


manifest = {}
for slug, (fname, ratio, fy, fx) in PHOTOS.items():
    im = Image.open(os.path.join(RAW, fname)).convert("RGB")
    im = crop_ratio(im, ratio, fy, fx)
    widths = LOCAL_WIDTHS if slug in ("local", "portada", "portada-alta") else WIDTHS
    base_w, base_h = im.size
    widths = sorted({min(w, base_w) for w in widths})
    variants = []
    for w in widths:
        h = int(round(w / ratio))
        rz = im.resize((w, h), Image.LANCZOS)
        # microcontraste: la comida gana definicion tras el downscale
        rz = rz.filter(ImageFilter.UnsharpMask(radius=1.1, percent=52, threshold=3))
        path = f"{OUT}/{slug}-{w}.webp"
        rz.save(path, "WEBP", quality=74, method=6)
        variants.append({"w": w, "h": h, "src": f"img/{slug}-{w}.webp",
                         "kb": round(os.path.getsize(path) / 1024, 1)})
    manifest[slug] = {"ratio": round(ratio, 4), "variants": variants}

# --- Logotipo original: recorte al disco + alfa circular, sin retocar el arte
logo = Image.open(os.path.join(RAW, "7c41da8d-image.jpg")).convert("RGB")
gray = logo.convert("L")
bbox = gray.point(lambda v: 255 if v > 26 else 0).getbbox()
logo = logo.crop(bbox)
side = max(logo.size)
square = Image.new("RGB", (side, side), (0, 0, 0))
square.paste(logo, ((side - logo.size[0]) // 2, (side - logo.size[1]) // 2))
for w in (256, 512):
    rz = square.resize((w, w), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (w * 4, w * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, w * 4 - 1, w * 4 - 1), fill=255)
    mask = mask.resize((w, w), Image.LANCZOS)
    rz.putalpha(mask)
    p = f"{OUT}/logo-{w}.webp"
    rz.save(p, "WEBP", quality=92, method=6, exact=True)
    manifest.setdefault("logo", {"ratio": 1.0, "variants": []})["variants"].append(
        {"w": w, "h": w, "src": f"img/logo-{w}.webp", "kb": round(os.path.getsize(p) / 1024, 1)})

with open("src/data/images.json", "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=1)

total = sum(v["kb"] for m in manifest.values() for v in m["variants"])
print(json.dumps({k: [f'{v["w"]}px {v["kb"]}KB' for v in m["variants"]]
                  for k, m in manifest.items()}, indent=1, ensure_ascii=False))
print(f"TOTAL {total:.0f} KB en {sum(len(m['variants']) for m in manifest.values())} archivos")
