#!/usr/bin/env python3
"""Draw the iPad app's icon: a room's floor plan being scanned.

    python3 scripts/make-app-icon.py

Writes apps/ios/MozuScanner/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png.
1024 x 1024, RGB with no alpha channel - App Store Connect refuses an icon
with transparency. Drawn at 4x and scaled down, so the edges are smooth.
"""
from pathlib import Path

from PIL import Image, ImageDraw

S = 4096
k = S / 1024


def px(v):
    return int(round(v * k))


def main() -> None:
    # Night-blue, a little lighter towards the bottom.
    bg = Image.new("RGB", (S, S))
    top, bottom = (11, 18, 32), (22, 40, 72)
    d = ImageDraw.Draw(bg)
    for y in range(S):
        t = y / (S - 1)
        d.line([(0, y), (S, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))

    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # Scan waves from the iPad, under the plan.
    cx, cy = px(392), px(664)
    for i, r in enumerate((150, 250, 350)):
        alpha = (150, 105, 65)[i]
        d.arc([cx - px(r), cy - px(r), cx + px(r), cy + px(r)], start=-80, end=-10,
              fill=(34, 211, 238, alpha), width=px(22))

    # The L-shaped room, white.
    room = [(232, 232), (792, 232), (792, 560), (560, 560), (560, 792), (232, 792)]
    pts = [(px(x), px(y)) for x, y in room]
    d.line(pts + [pts[0]], fill=(255, 255, 255, 255), width=px(44), joint="curve")
    for x, y in pts:
        r = px(22)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 255))

    # A bulkhead along the windows, dashed amber.
    y = px(318)
    x = px(290)
    while x < px(734):
        d.line([(x, y), (min(x + px(46), px(734)), y)], fill=(245, 158, 11, 255), width=px(20))
        x += px(72)

    # Corners found: cyan dots.
    for x, y in pts:
        r = px(13)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(34, 211, 238, 255))

    # The iPad.
    r = px(26)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))

    bg.paste(layer, (0, 0), layer)
    icon = bg.resize((1024, 1024), Image.LANCZOS).convert("RGB")
    out = Path(__file__).resolve().parent.parent / "apps/ios/MozuScanner/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    icon.save(out, optimize=True)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
