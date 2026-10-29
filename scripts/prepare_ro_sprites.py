"""
Ragnarok Online Sprite Post-Processing Pipeline
Locates generated sprites in the artifact directory, copies them to frontend/public/sprites/,
removes the pure white background with corner flood-fill + tolerance,
and saves 100% crisp transparent alpha PNG sprites.
"""

import os
from pathlib import Path
from collections import deque
from PIL import Image

BRAIN_DIR = Path(r"C:\Users\igles\.gemini\antigravity\brain\c7b8346c-72d6-4e0f-8948-e05576f54ccc")
DEST_DIR = Path(r"C:\Users\igles\.gemini\antigravity\scratch\or-nav\frontend\public\sprites")

SPRITE_MAP = {
    "ro_crusader.png": "ro_crusader_png_*.jpg",
    "ro_assassin.png": "ro_assassin_png_*.jpg",
    "ro_alchemist.png": "ro_alchemist_png_*.jpg",
    "ro_highpriest.png": "ro_highpriest_png_*.jpg",
    "ro_scholar.png": "ro_scholar_png_*.jpg",
    "ro_novice.png": "ro_novice_png_*.jpg"
}

def is_background(pixel, tolerance=30):
    r, g, b = pixel[:3]
    return r >= (255 - tolerance) and g >= (255 - tolerance) and b >= (255 - tolerance)

def process_sprite(src_path: Path, dest_path: Path):
    print(f"Processing: {src_path.name} -> {dest_path.name}")
    img = Image.open(src_path).convert("RGBA")
    width, height = img.size
    pixels = img.load()

    visited = set()
    queue = deque()

    # Seed flood-fill from all 4 borders
    for x in range(width):
        if is_background(pixels[x, 0]):
            queue.append((x, 0))
            visited.add((x, 0))
        if is_background(pixels[x, height - 1]):
            queue.append((x, height - 1))
            visited.add((x, height - 1))

    for y in range(height):
        if is_background(pixels[0, y]) and (0, y) not in visited:
            queue.append((0, y))
            visited.add((0, y))
        if is_background(pixels[width - 1, y]) and (width - 1, y) not in visited:
            queue.append((width - 1, y))
            visited.add((width - 1, y))

    # 4-way BFS flood-fill to turn exterior white into transparent
    while queue:
        cx, cy = queue.popleft()
        pixels[cx, cy] = (0, 0, 0, 0)

        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in visited:
                if is_background(pixels[nx, ny], tolerance=40):
                    visited.add((nx, ny))
                    queue.append((nx, ny))

    # Edge anti-halo pass
    for y in range(height):
        for x in range(width):
            if pixels[x, y][3] > 0 and is_background(pixels[x, y], tolerance=22):
                has_transparent_neighbor = False
                for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < width and 0 <= ny < height:
                        if pixels[nx, ny][3] == 0:
                            has_transparent_neighbor = True
                            break
                if has_transparent_neighbor:
                    pixels[x, y] = (0, 0, 0, 0)

    # Tight crop of the character sprite with small padding
    bbox = img.getbbox()
    if bbox:
        # Add 12px padding
        pad = 12
        crop_box = (
            max(0, bbox[0] - pad),
            max(0, bbox[1] - pad),
            min(width, bbox[2] + pad),
            min(height, bbox[3] + pad)
        )
        img = img.crop(crop_box)

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest_path, "PNG")
    print(f"  -> Successfully generated {dest_path.name} ({img.size[0]}x{img.size[1]})")

def main():
    DEST_DIR.mkdir(parents=True, exist_ok=True)

    for target_name, pattern in SPRITE_MAP.items():
        matches = sorted(list(BRAIN_DIR.glob(pattern)), key=lambda p: p.stat().st_mtime)
        if not matches:
            print(f"No match found for {pattern} in {BRAIN_DIR}")
            continue
        # Take the most recent one (e.g. for highpriest re-generation)
        latest_file = matches[-1]
        target_path = DEST_DIR / target_name
        process_sprite(latest_file, target_path)

    print("\nAll Ragnarok Online sprites processed successfully into frontend/public/sprites/!")

if __name__ == "__main__":
    main()
