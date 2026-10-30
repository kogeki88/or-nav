"""
Procedural Pixel Art Geometry Generator for Ragnarok Online Classes
Renders distinct pixel-art equipment, gear, silhouettes, headpieces,
and weapons for the remaining class archetypes:
- Archbishop (Celestial Halo & Sunburst Crozier)
- Cardinal Sage (Cardinal Biretta, Velvet Mozzetta & Ruby Scepter)
- Professor (Academic Trencher, Spectacles & Orbiting Arcane Runes)
- Arcane Chronomancer (Clockwork Diadem, Hourglass Staff & Temporal Rings)
"""

import math
from pathlib import Path
from PIL import Image, ImageDraw

SPRITES_DIR = Path(r"C:\Users\igles\.gemini\antigravity\scratch\or-nav\frontend\public\sprites")

def shift_hue(img: Image.Image, shift_deg: int) -> Image.Image:
    if shift_deg == 0:
        return img
    rgba = img.convert("RGBA")
    r, g, b, a = rgba.split()
    rgb = Image.merge("RGB", (r, g, b))
    hsv = rgb.convert("HSV")
    h, s, v = hsv.split()
    shift_val = int(shift_deg * 255 / 360)
    h = h.point(lambda p: (p + shift_val) % 256)
    shifted_rgb = Image.merge("HSV", (h, s, v)).convert("RGB")
    sr, sg, sb = shifted_rgb.split()
    return Image.merge("RGBA", (sr, sg, sb, a))

def draw_outlined_polygon(draw: ImageDraw.ImageDraw, points, fill_color, outline_color, width=3):
    draw.polygon(points, fill=fill_color, outline=outline_color, width=width)

def draw_outlined_circle(draw: ImageDraw.ImageDraw, xy, r, fill_color, outline_color, width=3):
    x, y = xy
    draw.ellipse([x - r, y - r, x + r, y + r], fill=fill_color, outline=outline_color, width=width)

def generate_archbishop():
    print("Generating distinct pixel geometry for Archbishop (ro_archbishop.png)...")
    base = Image.open(SPRITES_DIR / "ro_highpriest.png").convert("RGBA")
    base = shift_hue(base, 45) # Golden ivory shift
    w, h = base.size

    # Layer for floating celestial halo & sunburst
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # 1. Floating Celestial Sunburst Halo behind/above head (center ~ (265, 80))
    cx, cy = 265, 85
    # Radiant solar spikes
    for angle_deg in range(0, 360, 30):
        rad = math.radians(angle_deg)
        r_inner = 95
        r_outer = 135
        x1 = cx + int(math.cos(rad) * r_inner)
        y1 = cy + int(math.sin(rad) * r_inner)
        x2 = cx + int(math.cos(rad) * r_outer)
        y2 = cy + int(math.sin(rad) * r_outer)
        # 3px gold spike
        draw.line([(x1, y1), (x2, y2)], fill=(254, 240, 138, 255), width=5)
        draw.line([(x1, y1), (x2, y2)], fill=(180, 83, 9, 255), width=1)

    # Golden Halo Ring
    draw.ellipse([cx - 95, cy - 95, cx + 95, cy + 95], outline=(180, 83, 9, 255), width=8)
    draw.ellipse([cx - 93, cy - 93, cx + 93, cy + 93], outline=(250, 204, 21, 255), width=5)
    draw.ellipse([cx - 91, cy - 91, cx + 91, cy + 91], outline=(254, 240, 138, 255), width=2)

    # 2. Golden Patriarchal Sunburst Crozier atop staff (approx x: 120, y: 90)
    sx, sy = 125, 95
    for a in range(0, 360, 45):
        rad = math.radians(a)
        x2 = sx + int(math.cos(rad) * 45)
        y2 = sy + int(math.sin(rad) * 45)
        draw.line([(sx, sy), (x2, y2)], fill=(250, 204, 21, 255), width=4)
    draw.ellipse([sx - 20, sy - 20, sx + 20, sy + 20], fill=(254, 240, 138, 255), outline=(180, 83, 9, 255), width=3)
    draw.ellipse([sx - 8, sy - 8, sx + 8, sy + 8], fill=(56, 189, 248, 255), outline=(3, 105, 161, 255), width=2) # Sapphire jewel

    # 3. Golden Scapular / Stoles down vestments
    stole_pts_left = [(225, 180), (245, 180), (230, 480), (210, 480)]
    stole_pts_right = [(285, 180), (305, 180), (320, 480), (300, 480)]
    draw.polygon(stole_pts_left, fill=(234, 179, 8, 255), outline=(161, 98, 7, 255), width=2)
    draw.polygon(stole_pts_right, fill=(234, 179, 8, 255), outline=(161, 98, 7, 255), width=2)
    # Stole fringe & ruby cross embroidery
    for y in [240, 320, 400]:
        draw.rectangle([220, y, 236, y + 16], fill=(220, 38, 38, 255), outline=(153, 27, 27, 255))
        draw.rectangle([294, y, 310, y + 16], fill=(220, 38, 38, 255), outline=(153, 27, 27, 255))

    combined = Image.alpha_composite(base, overlay)
    combined.save(SPRITES_DIR / "ro_archbishop.png", "PNG")
    print(f"  [OK] Saved ro_archbishop.png ({combined.size})")

def generate_cardinal():
    print("Generating distinct pixel geometry for Cardinal Sage (ro_cardinal.png)...")
    base = Image.open(SPRITES_DIR / "ro_highpriest.png").convert("RGBA")
    base = shift_hue(base, 290) # Imperial Crimson / Scarlet shift
    w, h = base.size

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # 1. Cardinal Biretta (Flat 3-peaked scarlet academic cap) on head (center ~ (265, 55))
    biretta_pts = [
        (230, 60), (250, 30), (265, 45), (280, 30), (300, 60),
        (295, 75), (235, 75)
    ]
    draw.polygon(biretta_pts, fill=(185, 28, 28, 255), outline=(69, 10, 10, 255), width=3)
    # Cardinal pompom at apex
    draw.ellipse([260, 22, 270, 32], fill=(220, 38, 38, 255), outline=(69, 10, 10, 255), width=2)

    # 2. Scarlet Velvet Mozzetta (Shoulder Cape) with ermine lining
    mozzetta_pts = [
        (210, 140), (320, 140), (365, 260), (340, 280), (265, 295),
        (190, 280), (165, 260)
    ]
    draw.polygon(mozzetta_pts, fill=(185, 28, 28, 230), outline=(69, 10, 10, 255), width=3)
    # Golden clasps & buttons down chest
    for by in range(160, 280, 20):
        draw.ellipse([262, by, 268, by + 6], fill=(250, 204, 21, 255), outline=(161, 98, 7, 255), width=1)

    # 3. Ruby Imperial Scepter in hand (left hand ~ 125, 95)
    draw.line([(125, 60), (125, 180)], fill=(234, 179, 8, 255), width=6)
    draw.line([(125, 60), (125, 180)], fill=(113, 63, 18, 255), width=1)
    # Large faceted ruby gem on top of scepter
    ruby_pts = [(125, 35), (140, 55), (125, 75), (110, 55)]
    draw.polygon(ruby_pts, fill=(239, 68, 68, 255), outline=(153, 27, 27, 255), width=2)

    # 4. Swinging Silver Thurible (Incense Censer) with aromatic vapor puffs
    th_x, th_y = 100, 320
    draw.line([(125, 180), (th_x, th_y)], fill=(148, 163, 184, 255), width=2) # Chain
    # Censer vessel
    draw.polygon([(th_x - 12, th_y), (th_x + 12, th_y), (th_x + 8, th_y + 20), (th_x - 8, th_y + 20)],
                 fill=(203, 213, 225, 255), outline=(71, 85, 105, 255), width=2)
    # Gentle incense smoke
    for sx, sy, r in [(th_x + 5, th_y - 20, 8), (th_x + 15, th_y - 35, 12), (th_x + 10, th_y - 55, 16)]:
        draw.ellipse([sx - r, sy - r, sx + r, sy + r], fill=(241, 245, 249, 140))

    combined = Image.alpha_composite(base, overlay)
    combined.save(SPRITES_DIR / "ro_cardinal.png", "PNG")
    print(f"  [OK] Saved ro_cardinal.png ({combined.size})")

def generate_professor():
    print("Generating distinct pixel geometry for Professor (ro_professor.png)...")
    base = Image.open(SPRITES_DIR / "ro_scholar.png").convert("RGBA")
    base = shift_hue(base, 140) # Deep Sapphire / Arcane Blue
    w, h = base.size

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # 1. Academic Researcher Mortarboard Cap (x: 250..380, y: 15..70)
    mortar_diamond = [(315, 20), (380, 45), (315, 70), (250, 45)]
    draw.polygon(mortar_diamond, fill=(30, 41, 59, 255), outline=(2, 6, 23, 255), width=3)
    # Golden hanging tassel to the side
    draw.line([(315, 45), (370, 75), (375, 110)], fill=(250, 204, 21, 255), width=3)
    draw.ellipse([372, 108, 378, 114], fill=(254, 240, 138, 255), outline=(161, 98, 7, 255))

    # 2. Golden Scholar Spectacles / Monocle (around eyes ~ (305, 95))
    draw.ellipse([295, 90, 315, 110], outline=(234, 179, 8, 255), width=2)
    draw.ellipse([325, 90, 345, 110], outline=(234, 179, 8, 255), width=2)
    draw.line([(315, 100), (325, 100)], fill=(234, 179, 8, 255), width=2)

    # 3. Double-Breasted Trenchcoat Lapels & Pocket Watch Chain
    draw.polygon([(280, 150), (350, 150), (330, 320), (270, 320)],
                 fill=(30, 58, 138, 180), outline=(234, 179, 8, 255), width=2)
    # Pocket watch chain
    chain_pts = [(285, 230), (300, 250), (320, 245), (330, 230)]
    draw.line(chain_pts, fill=(250, 204, 21, 255), width=2)

    # 4. Floating Orbiting Spectral Magic Runes & Geometric Arcane Rings around hands/book (~ x: 440, y: 280)
    rx, ry = 450, 290
    draw.ellipse([rx - 55, ry - 55, rx + 55, ry + 55], outline=(56, 189, 248, 220), width=2)
    draw.ellipse([rx - 40, ry - 40, rx + 40, ry + 40], outline=(14, 165, 233, 180), width=1)
    # Arcane glyph runes around perimeter
    for ang in range(0, 360, 45):
        rad = math.radians(ang)
        gx = rx + int(math.cos(rad) * 48)
        gy = ry + int(math.sin(rad) * 48)
        draw.rectangle([gx - 3, gy - 3, gx + 3, gy + 3], fill=(186, 230, 253, 255), outline=(2, 132, 199, 255))

    combined = Image.alpha_composite(base, overlay)
    combined.save(SPRITES_DIR / "ro_professor.png", "PNG")
    print(f"  [OK] Saved ro_professor.png ({combined.size})")

def generate_chronomancer():
    print("Generating distinct pixel geometry for Arcane Chronomancer (ro_chronomancer.png)...")
    base = Image.open(SPRITES_DIR / "ro_scholar.png").convert("RGBA")
    base = shift_hue(base, 220) # Chrono Emerald / Teal
    w, h = base.size

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # 1. Brass Clockwork Astrolabe Diadem / Tiara on Brow (x: 270..360, y: 40..85)
    diadem_pts = [(270, 75), (290, 45), (315, 35), (340, 45), (360, 75), (315, 65)]
    draw.polygon(diadem_pts, fill=(217, 119, 6, 255), outline=(69, 26, 3, 255), width=3)
    # Gear cog teeth on crown
    for gx in [285, 315, 345]:
        draw.rectangle([gx - 4, 30, gx + 4, 38], fill=(251, 191, 36, 255), outline=(69, 26, 3, 255))

    # 2. Tall Brass Hourglass Grand Staff on Right Side (x: 520, y: 40..620)
    hx, hy = 520, 160
    # Long brass staff pole
    draw.line([(hx, 60), (hx, 640)], fill=(217, 119, 6, 255), width=7)
    draw.line([(hx, 60), (hx, 640)], fill=(253, 230, 138, 255), width=2)
    draw.line([(hx, 60), (hx, 640)], fill=(69, 26, 3, 255), width=1)

    # Hourglass Mounting Brackets
    draw.rectangle([hx - 28, hy - 45, hx + 28, hy - 35], fill=(180, 83, 9, 255), outline=(69, 26, 3, 255), width=2)
    draw.rectangle([hx - 28, hy + 35, hx + 28, hy + 45], fill=(180, 83, 9, 255), outline=(69, 26, 3, 255), width=2)

    # Hourglass Glass Bulbs (Upper & Lower)
    draw.polygon([(hx - 22, hy - 35), (hx + 22, hy - 35), (hx + 4, hy), (hx - 4, hy)],
                 fill=(6, 182, 212, 140), outline=(217, 119, 6, 255), width=2)
    draw.polygon([(hx - 4, hy), (hx + 4, hy), (hx + 22, hy + 35), (hx - 22, hy + 35)],
                 fill=(6, 182, 212, 180), outline=(217, 119, 6, 255), width=2)

    # Glowing Cyan Sands of Time trickling down center
    draw.line([(hx, hy - 15), (hx, hy + 25)], fill=(165, 243, 252, 255), width=3)
    # Luminous temporal glow
    draw.ellipse([hx - 35, hy - 35, hx + 35, hy + 35], outline=(103, 232, 249, 120), width=3)

    # 3. Concentric Temporal Clock Orbiting Rings around body
    ocx, ocy = 315, 340
    draw.ellipse([ocx - 130, ocy - 60, ocx + 130, ocy + 60], outline=(45, 212, 191, 160), width=2)
    # Roman numeral hour tick marks
    for h_ang in range(0, 360, 30):
        rad = math.radians(h_ang)
        tx1 = ocx + int(math.cos(rad) * 122)
        ty1 = ocy + int(math.sin(rad) * 55)
        tx2 = ocx + int(math.cos(rad) * 130)
        ty2 = ocy + int(math.sin(rad) * 60)
        draw.line([(tx1, ty1), (tx2, ty2)], fill=(204, 251, 241, 240), width=2)

    combined = Image.alpha_composite(base, overlay)
    combined.save(SPRITES_DIR / "ro_chronomancer.png", "PNG")
    print(f"  [OK] Saved ro_chronomancer.png ({combined.size})")

def main():
    print("=" * 65)
    print("  PROCEDURAL PIXEL ART GEOMETRY ENGINE FOR RAGNAROK ONLINE")
    print("=" * 65)
    generate_archbishop()
    generate_cardinal()
    generate_professor()
    generate_chronomancer()
    print("\nAll 4 custom geometric class sprites generated successfully!")

if __name__ == "__main__":
    main()
