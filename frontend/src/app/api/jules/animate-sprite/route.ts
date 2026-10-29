import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { generateSpriteIdleVideo, type AnimateSpriteOptions } from '@/lib/veoMotion';

export const dynamic = 'force-static';

const SPRITES_DIR = path.resolve(process.cwd(), 'public', 'sprites');
const VIDEOS_DIR = path.join(SPRITES_DIR, 'videos');

export async function GET() {
  const availableVideos: Record<string, string> = {};
  if (fs.existsSync(VIDEOS_DIR)) {
    const files = fs.readdirSync(VIDEOS_DIR);
    for (const file of files) {
      if (file.endsWith('.mp4') || file.endsWith('.webm')) {
        const className = file.replace(/_idle\.(mp4|webm)$/, '');
        availableVideos[className] = `/sprites/videos/${file}`;
      }
    }
  }

  return NextResponse.json({
    success: true,
    availableVideos,
    veoModel: 'veo-3.1-generate-preview'
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { jobClass = 'crusader', currentState = 'IN_PROGRESS' } = body;

    const spriteFilename = `ro_${jobClass === 'crusader' ? 'crusader' : (jobClass === 'assassin' ? 'assassin' : (jobClass === 'alchemist' ? 'alchemist' : (jobClass === 'highpriest' ? 'highpriest' : 'scholar')))}.png`;
    const sourcePath = path.join(SPRITES_DIR, spriteFilename);
    const outputPath = path.join(VIDEOS_DIR, `${jobClass}_idle.mp4`);

    if (!fs.existsSync(sourcePath)) {
      return NextResponse.json(
        { error: `Sprite not found at: ${sourcePath}` },
        { status: 404 }
      );
    }

    const videoUri = await generateSpriteIdleVideo({
      spriteName: spriteFilename,
      sourceImagePath: sourcePath,
      jobClass,
      currentState,
      outputPath
    });

    return NextResponse.json({
      success: true,
      jobClass,
      currentState,
      videoUri,
      localVideoPath: `/sprites/videos/${jobClass}_idle.mp4`
    });

  } catch (err: any) {
    console.warn(`[Veo 3.1 API] Video generation note: ${err.message}`);
    return NextResponse.json({
      success: false,
      error: err.message,
      fallbackMode: 'css-pixel-stepped-idle'
    }, { status: 200 }); // Graceful fallback
  }
}
