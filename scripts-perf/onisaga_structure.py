#!/usr/bin/env python3
"""Extract Onisaga Home section structure via horizontal band luma analysis.

No OCR needed — we just need: header height, hero height, rail count,
card density, section header style, bg color, and palette.
"""
import sys
from PIL import Image
import pathlib

p = pathlib.Path("screenshots/onisaga-home-2026-09-12-22_52_07.png")
im = Image.open(p).convert("RGB")
W, H = im.size
print(f"Image {W}x{H}")

px = im.load()

def luma(r,g,b): return 0.2126*r + 0.7152*g + 0.0722*b

# Sample a vertical scan down the center to find section boundaries
# by looking for sharp luma transitions and uniform dark bands.
step = 4
xs = W // 2
ys = list(range(0, H, step))
lumas = []
for y in ys:
    # average across a horizontal window (avoid card edges)
    s = 0
    for x in range(W//4, 3*W//4, 40):
        r,g,b = im.getpixel((x,y))
        s += luma(r,g,b)
    lumas.append(s / ((W//2)//40))

# find dark bands (potential bg between rails)
dark_threshold = 30  # near-black bg
print("\nDark bands (bg):")
in_dark = False
start = 0
for i, v in enumerate(lumas):
    y = ys[i]
    is_dark = v < dark_threshold
    if is_dark and not in_dark:
        in_dark = True
        start = y
    elif not is_dark and in_dark:
        in_dark = False
        print(f"  dark  y={start:4d}-{y:4d}  ({y-start}px)  avg={sum(lumas[ys.index(start):i])/max(1,i-ys.index(start)):.1f}")

# Header color
header_sample = [im.getpixel((W//2, y)) for y in range(10, 60, 10)]
print(f"\nHeader sample (y~30): {header_sample[0]} avg luma {sum(luma(*c) for c in header_sample)/len(header_sample):.1f}")
# Hero left (should be banner)
hero_y = H // 8
hero_sample = [im.getpixel((int(W*0.15), hero_y)), im.getpixel((int(W*0.5), hero_y)), im.getpixel((int(W*0.85), hero_y))]
print(f"Hero band y={hero_y}: left {hero_sample[0]} center {hero_sample[1]} right {hero_sample[2]}")

# Try to find card edges by sampling a rail at ~30% height
rail_y = int(H * 0.30)
row = [im.getpixel((x, rail_y)) for x in range(0, W, 20)]
# look for vertical edges (bright -> dark -> bright)
print(f"\nRail y={rail_y} sampled {len(row)} cols, min luma {min(luma(*c) for c in row):.1f} max {max(luma(*c) for c in row):.1f}")

# BG color between rails (most reliable for theme)
bg_y_candidates = []
for i, v in enumerate(lumas):
    if v < 40 and v > 5:
        bg_y_candidates.append(ys[i])
# sample the most common dark band
import collections
# histogram of luma in dark region
darks = [v for v in lumas if v < 40]
if darks:
    print(f"Dark luma stats: min {min(darks):.1f} max {max(darks):.1f} median {sorted(darks)[len(darks)//2]:.1f}")
    # color at a known between-rails position
    for frac in [0.42, 0.55, 0.68, 0.80]:
        y = int(H*frac)
        c = im.getpixel((W//2, y))
        print(f"  y={y:4d} ({frac:.0%}) color {c} luma {luma(*c):.1f}")

# Palette: most common colors (k-means cheap: just histogram)
print("\n--- Dominant header/hero hues ---")
from collections import Counter
header_colors = [im.getpixel((x, 30)) for x in range(0, W, 20)]
cnt = Counter(header_colors)
for col, n in cnt.most_common(5):
    print(f"  {col}  {n}")

im_small = im.resize((64, int(64*H/W)))
colors = Counter([im_small.getpixel((x,y)) for y in range(im_small.size[1]) for x in range(64)])
print("\n--- Overall top colors (64px thumb) ---")
for col, n in colors.most_common(8):
    print(f"  {col}  {n}")

print("\nDone")
