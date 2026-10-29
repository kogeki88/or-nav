// ============================================================================
// VEO 3.1 IMAGE-TO-VIDEO INTEGRATION FOR JULES PIXEL WORKSHOP
// Programmatically transforms static RO character sprites into breathing idle loops
// ============================================================================

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

function getAiClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'dummy_key' });
}

export interface AnimateSpriteOptions {
  spriteName: string;
  sourceImagePath: string;
  jobClass: 'crusader' | 'assassin' | 'alchemist' | 'highpriest' | 'scholar';
  currentState: 'IN_PROGRESS' | 'WAITING_FOR_INPUT' | 'COMPLETED' | 'IDLE';
  outputPath?: string;
  modelName?: string;
}

interface ImageInputSource {
  gcsUri?: string;
  imageBytes?: string;
  mimeType?: string;
}

/**
 * Generates an organic idle animation loop from a static Nano Banana character sprite 
 * using Google's Veo 3.1 Image-to-Video model API.
 */
export async function generateSpriteIdleVideo(options: AnimateSpriteOptions): Promise<string> {
  const { spriteName, sourceImagePath, jobClass, currentState, outputPath, modelName = 'veo-3.1-generate-preview' } = options;

  // Build dynamic prompt cues matching the state and RO aesthetic
  let motionPrompt = "Subtle 2D MMORPG idle breathing animation, crisp pixel lines, gentle torso rise and fall, natural hair sway, blinking eyes, loopable motion.";
  
  if (currentState === 'IN_PROGRESS') {
    motionPrompt = "Active combat stance idle, subtle magical aura pulsing around boots, weapons shimmering, glowing particle effects floating upward, 24fps seamless loop.";
  } else if (currentState === 'WAITING_FOR_INPUT') {
    motionPrompt = "Impatient idle animation, tilting head, tapping foot, a question mark icon bobbing slightly above, subtle breathing motion.";
  } else if (currentState === 'COMPLETED') {
    motionPrompt = "Victory pose, arms raised proudly, golden sparkling dust particles and light pillar effects showering down around the character sprite.";
  }

  console.log(`[Veo 3.1] Initializing image-to-video job for sprite: ${spriteName} (${jobClass})...`);

  // Prepare image source: either GCS URI or base64 local imageBytes
  let imageSource: ImageInputSource;

  if (sourceImagePath.startsWith('gs://')) {
    imageSource = {
      gcsUri: sourceImagePath,
      mimeType: 'image/png'
    };
  } else {
    const resolvedPath = path.isAbsolute(sourceImagePath)
      ? sourceImagePath
      : path.resolve(process.cwd(), sourceImagePath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Source sprite image not found at: ${resolvedPath}`);
    }

    const imageBuffer = fs.readFileSync(resolvedPath);
    const base64Data = imageBuffer.toString('base64');
    imageSource = {
      imageBytes: base64Data,
      mimeType: 'image/png'
    };
  }

  // Call the Veo 3.1 video generation endpoint via the official Google Gen AI SDK
  const ai = getAiClient();
  let operation = await ai.models.generateVideos({
    model: modelName,
    source: {
      prompt: motionPrompt,
      image: imageSource
    },
    config: {
      numberOfVideos: 1,
      aspectRatio: '1:1', // Square framing optimized for character portrait tiles
      durationSeconds: 4,  // Clean 4-second seamless loop segment
    }
  });

  // Long-running operation polling loop for async video generation
  while (!operation.done) {
    console.log(`[Veo 3.1] Processing motion generation for ${spriteName}... polling in 10s.`);
    await new Promise((resolve) => setTimeout(resolve, 10000));
    // Refresh operation status
    operation = await ai.operations.getVideosOperation({ operation });
  }

  if (operation.error) {
    throw new Error(`Veo generation failed for ${spriteName}: ${operation.error.message}`);
  }

  const generatedVideo = operation.response?.generatedVideos?.[0]?.video;
  const generatedVideoUri = generatedVideo?.uri || '';
  console.log(`[Veo 3.1] Success! Idle video generated for ${spriteName}: ${generatedVideoUri}`);

  // If local output path is specified, download the video file
  if (outputPath && generatedVideo) {
    const destDir = path.dirname(outputPath);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    
    await ai.files.download({
      file: generatedVideo,
      downloadPath: outputPath
    });
    console.log(`[Veo 3.1] Downloaded video locally to: ${outputPath}`);
    return outputPath;
  }

  return generatedVideoUri;
}
