#!/usr/bin/env python3
from PIL import Image
import pathlib

p = pathlib.Path("screenshots/onisaga-home-2026-09-12-22_52_07.png")
im = Image.open(p).convert("RGB")
W, H = im.size

def luma(r,g,b): return 0.2126*r + 0.7152*g + 0.0722*b

# 1) Header exact: find where hero starts (first non-nav row)
# Nav is grey (~63,63,63) at top 0-50px; hero is brighter/more varied
print("Header band luma sweep:")
for y in range(0, 120, 10):
    c = im.getpixel((W//2, y))
    print(f"  y={y:3d} {c} luma {luma(*c):.0f}")

# 2) Hero center vs left text area — Onisaga hero likely has text on left over banner
# Check if hero is full-bleed banner with left overlay
print("\nHero horizontal profile at y~200:")
for x in [int(W*0.08), int(W*0.18), int(W*0.30), int(W*0.45), int(W*0.60), int(W*0.80)]:
    c = im.getpixel((x, 200))
    print(f"  x={x:4d} {c} luma {luma(*c):.0f}")

# 3) Hero height — find where hero ends (transition to first rail bg #262626-ish)
print("\nVertical luma sweep (center x):")
for y in range(80, 700, 30):
    c = im.getpixel((W//2, y))
    print(f"  y={y:3d} {c} luma {luma(*c):.0f}")

# 4) Rail header style — is it a small pill + 'View all', or just text?
# Sample around first rail's header band
print("\nFirst rail header band (y~520-580):")
for y in range(520, 620, 15):
    left = im.getpixel((int(W*0.06), y))
    center = im.getpixel((W//2, y))
    right = im.getpixel((int(W*0.92), y))
    print(f"  y={y:3d} left {left} luma {luma(*left):.0f}  center {center} luma {luma(*center):.0f}  right {right} luma {luma(*right):.0f}")

# 5) Card geometry — crop a rail card tile and measure aspect
# Estimate: find a poster edge by looking for a vertical dark gap between cards
rail_y = 700
print(f"\nCard edge scan at rail_y={rail_y} (looking for gaps):")
# sample horizontally at the rail's vertical center
prev_luma = None
for x in range(int(W*0.08), int(W*0.92), 8):
    c = im.getpixel((x, rail_y))
    lv = luma(*c)
    if prev_luma is not None and abs(lv - prev_luma) > 35:
        print(f"  edge x={x:4d} luma {prev_luma:.0f} -> {lv:.0f}  color {c}")
    prev_luma = lv

# 6) Overall bg
bg = im.getpixel((W//2, int(H*0.55)))
print(f"\nOverall page bg (mid) {bg} luma {luma(*bg):.0f}")

# 7) Accent — any warm/red/orange pill? sample a likely accent zone
print("\nAccent hunt — bright non-grey pixels near rail headers:")
for y in [540, 800, 1050, 1350]:
    for x in [int(W*0.12), int(W*0.85)]:
        c = im.getpixel((x, y))
        # accent if one channel notably higher
        mx = max(c)
        mn = min(c)
        if mx - mn > 18:
            print(f"  y={y:4d} x={x:4d} {c} delta {mx-mn}")

print("\nDone")
