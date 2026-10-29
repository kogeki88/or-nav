"""
Veo 3.1 Image-to-Video Batch Generation Script for Ragnarok Online Sprites
Uses the official Google Gen AI Python SDK (google-genai) to transform static
character sprites into breathing 2D idle video loops.
"""

import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv

# Load environment
ENV_PATH = Path(__file__).resolve().parent.parent / "backend" / ".env"
load_dotenv(ENV_PATH)

SPRITES_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public" / "sprites"
VIDEOS_DIR = SPRITES_DIR / "videos"

CLASSES = [
    ("crusader", "ro_crusader.png", "Paladin holding kite shield, subtle 2D MMORPG breathing animation, armor sheen, holy aura, 24fps loop."),
    ("assassin", "ro_assassin.png", "Assassin Cross with dual glowing katar blades, scarf swaying gently in wind, spiky hair bounce, 24fps loop."),
    ("alchemist", "ro_alchemist.png", "Biochemist with goggles, bubbling glowing green potion emitting tiny vapor sparks, 24fps loop."),
    ("highpriest", "ro_highpriest.png", "High Priest with golden winged staff, clerical vestments fluttering gently, holy particles, 24fps loop."),
    ("scholar", "ro_scholar.png", "Scholar with beret and floating open arcane spellbook with glowing magic runes and quill, 24fps loop.")
]

def generate_video_for_sprite(job_class, filename, motion_prompt):
    from google import genai
    from google.genai import types

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("GEMINI_API_KEY not found in environment.")
        return False

    client = genai.Client(api_key=api_key)
    sprite_path = SPRITES_DIR / filename
    if not sprite_path.exists():
        print(f"Sprite not found: {sprite_path}")
        return False

    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    out_video_path = VIDEOS_DIR / f"{job_class}_idle.mp4"

    print(f"\n[Veo 3.1] Generating Image-to-Video for {job_class} ({filename})...")
    print(f"  Prompt: {motion_prompt}")

    try:
        image = types.Image.from_file(location=str(sprite_path))
        operation = client.models.generate_videos(
            model="veo-3.1-generate-preview",
            source=types.GenerateVideosSource(
                prompt=motion_prompt,
                image=image
            ),
            config=types.GenerateVideosConfig(
                number_of_videos=1,
                duration_seconds=4,
                aspect_ratio="1:1"
            )
        )

        print(f"  Operation started: {operation.name}. Polling for completion...")
        while not operation.done:
            print("  Waiting 10s for Veo video synthesis...")
            time.sleep(10)
            operation = client.operations.get(operation)

        if operation.error:
            print(f"  Operation error: {operation.error}")
            return False

        video = operation.response.generated_videos[0].video
        client.files.download(file=video, destination=str(out_video_path))
        print(f"  SUCCESS! Saved idle video to: {out_video_path}")
        return True

    except Exception as e:
        print(f"  Veo API execution note: {e}")
        return False

def main():
    print("=" * 70)
    print("      VEO 3.1 IMAGE-TO-VIDEO PIPELINE FOR RAGNAROK ONLINE SPRITES      ")
    print("=" * 70)

    target_class = sys.argv[1] if len(sys.argv) > 1 else None

    for job_class, filename, prompt in CLASSES:
        if target_class and target_class.lower() != job_class:
            continue
        generate_video_for_sprite(job_class, filename, prompt)

if __name__ == "__main__":
    main()
