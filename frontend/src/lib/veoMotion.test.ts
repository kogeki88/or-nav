import test, { describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import type { AnimateSpriteOptions } from './veoMotion';

describe('generateSpriteIdleVideo', () => {
  let generateSpriteIdleVideo: typeof import('./veoMotion').generateSpriteIdleVideo;

  beforeEach(async () => {
    // Set up the global mock before importing the module
    const matchMediaMock = mock.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: mock.fn(),
      removeListener: mock.fn(),
      addEventListener: mock.fn(),
      removeEventListener: mock.fn(),
      dispatchEvent: mock.fn(),
    }));

    (global as { window?: unknown }).window = { matchMedia: matchMediaMock };

    // Dynamic import to ensure global is evaluated correctly
    const veoMotionModule = await import('./veoMotion');
    generateSpriteIdleVideo = veoMotionModule.generateSpriteIdleVideo;
  });

  afterEach(() => {
    delete (global as { window?: unknown }).window;
    mock.restoreAll();
  });

  test('returns sourceImagePath instantly when prefers-reduced-motion is true', async () => {
    const options: AnimateSpriteOptions = {
      spriteName: 'testSprite',
      sourceImagePath: '/path/to/static/sprite.png',
      jobClass: 'crusader',
      currentState: 'IDLE',
    };

    const result = await generateSpriteIdleVideo(options);

    assert.strictEqual(result, '/path/to/static/sprite.png');
  });
});
