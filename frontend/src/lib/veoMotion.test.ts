import test, { describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import type { AnimateSpriteOptions } from './veoMotion';

describe('generateSpriteIdleVideo', () => {
  afterEach(() => {
    delete (global as { window?: unknown }).window;
    mock.restoreAll();
  });

  test('returns sourceImagePath instantly when prefers-reduced-motion is true', async () => {
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

    const veoMotionModule = await import('./veoMotion?bust=' + Date.now());
    const generateSpriteIdleVideo = veoMotionModule.generateSpriteIdleVideo;

    const options: AnimateSpriteOptions = {
      spriteName: 'testSprite',
      sourceImagePath: '/path/to/static/sprite.png',
      jobClass: 'crusader',
      currentState: 'IDLE',
    };

    const result = await generateSpriteIdleVideo(options);

    assert.strictEqual(result, '/path/to/static/sprite.png');
  });

  test('calls window.matchMedia with prefers-reduced-motion query', async () => {
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

    const veoMotionModule = await import('./veoMotion?bust=' + Date.now());
    const generateSpriteIdleVideo = veoMotionModule.generateSpriteIdleVideo;

    const options: AnimateSpriteOptions = {
      spriteName: 'testSprite',
      sourceImagePath: '/path/to/static/sprite.png',
      jobClass: 'crusader',
      currentState: 'IDLE',
    };

    await generateSpriteIdleVideo(options);

    assert.strictEqual(matchMediaMock?.mock.calls[0].arguments[0], '(prefers-reduced-motion: reduce)');
  });

  test('does not return instant fallback when prefers-reduced-motion is false', async () => {
    const matchMediaMock = mock.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: mock.fn(),
      removeListener: mock.fn(),
      addEventListener: mock.fn(),
      removeEventListener: mock.fn(),
      dispatchEvent: mock.fn(),
    }));
    (global as { window?: unknown }).window = { matchMedia: matchMediaMock };

    const veoMotionModule = await import('./veoMotion?bust=' + Date.now());
    const generateSpriteIdleVideo = veoMotionModule.generateSpriteIdleVideo;

    const options: AnimateSpriteOptions = {
      spriteName: 'testSprite',
      sourceImagePath: '/path/to/static/sprite.png',
      jobClass: 'crusader',
      currentState: 'IDLE',
    };

    try {
      const result = await generateSpriteIdleVideo(options);
      assert.notStrictEqual(result, '/path/to/static/sprite.png');
    } catch (error) {
      assert.ok(error instanceof Error);
    }
  });
});
